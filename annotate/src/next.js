/**
 * @designless/annotate/next - the Next.js wrapper.
 *
 * Wraps a project's next config to inject the annotate/v1 SWC plugin into
 * `experimental.swcPlugins`. Next's default Turbopack resolves swcPlugins, so
 * this is the engine that stamps markers under `next dev`; the Babel engine
 * does not run there.
 *
 * Usage (next.config.js / next.config.mjs):
 *   const { withDesignless } = require('@designless/annotate/next')
 *   module.exports = withDesignless({ /* your next config *\/ })
 *
 * Hard rules:
 *   - DEV-ONLY: in production the wrapper returns the config UNCHANGED (no
 *     swcPlugins entry) -> byte-identical build. The SWC plugin itself also
 *     self-gates, so this is belt-and-braces.
 *   - LOUD NO-OP: if the wasm artifact is missing (a broken install), warn and
 *     return the config untouched. `next dev` must start regardless - markers
 *     are a nice-to-have, never a prerequisite.
 *   - ADDITIVE: never clobbers an existing experimental.swcPlugins; appends.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { isEnabled, warnOnce } = require('./gating');

const WASM_RELATIVE = '../swc-plugin/annotate.wasm';
// The swcPlugins entry MUST be a package SUBPATH SPECIFIER, not an absolute
// filesystem path: Next/Turbopack treats an absolute path as a server-relative
// import and fails to resolve it ("server relative imports are not
// implemented"). The specifier resolves through this package's `exports` map.
const WASM_SPECIFIER = '@designless/annotate/swc/annotate.wasm';

/**
 * Resolve the project root to thread into the SWC plugin config. The plugin's
 * `to_repo_relative` needs this to turn the absolute / Turbopack-supplied
 * filename into a repo-relative `data-source-file`; with no root it sees an
 * absolute path, can't relativize it safely, and stamps NOTHING (the S1 gap).
 *
 * Mirrors the Babel engine, which reads `state.file.opts.root || .cwd` per
 * file. Next gives us no per-file hook here, so we resolve the project root
 * ONCE the way Next itself does:
 *   1. explicit override `options.root` (an embedder can force it)
 *   2. `nextConfig.dir` (Next records the project dir on the resolved config)
 *   3. `process.cwd()` - where `next dev` is invoked = the project root
 * Returns '' only if every source is falsy, preserving the plugin's
 * empty-root back-compat branch (already-relative filenames still stamp).
 * @param {object} base - the project's Next config
 * @param {{ root?: string }} [options]
 * @returns {string}
 */
function resolveProjectRoot(base, options) {
  const fromOption = options && typeof options.root === 'string' ? options.root : '';
  if (fromOption) return fromOption;
  const fromConfig = base && typeof base.dir === 'string' ? base.dir : '';
  if (fromConfig) return fromConfig;
  try {
    return typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '';
  } catch {
    // A cwd that throws (revoked dir, sandbox) must not take the build down:
    // fall back to '' and let the plugin's empty-root branch handle it.
    return '';
  }
}

/**
 * @param {object} [nextConfig] - the project's existing Next config
 * @param {{ enabled?: boolean, root?: string }} [options]
 * @returns {object} the (possibly) wrapped config
 */
function withDesignless(nextConfig, options) {
  const base = nextConfig && typeof nextConfig === 'object' ? nextConfig : {};
  if (!isEnabled(options)) return base; // production -> untouched, byte-identical

  // Existence check (loud no-op) uses the real on-disk path; the swcPlugins
  // ENTRY uses the resolver specifier (above).
  const wasmPath = path.join(__dirname, WASM_RELATIVE);
  if (!fs.existsSync(wasmPath)) {
    warnOnce(
      'SWC marker plugin not found at ' + wasmPath + ' - markers disabled for this run. ' +
      'Reinstall @designless/annotate (the wasm artifact ships in the package).',
    );
    return base;
  }

  // Thread the project root into the plugin config so absolute filenames become
  // repo-relative markers. An empty root falls through to the plugin's
  // already-relative back-compat branch (never a crash, just fewer markers).
  const root = resolveProjectRoot(base, options);

  const experimental = base.experimental && typeof base.experimental === 'object' ? base.experimental : {};
  const existing = Array.isArray(experimental.swcPlugins) ? experimental.swcPlugins : [];
  // Idempotent: if our plugin is already wired (re-wrapped config), don't add twice.
  const alreadyWired = existing.some((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].includes('@designless/annotate'));
  const swcPlugins = alreadyWired ? existing : existing.concat([[WASM_SPECIFIER, { root }]]);

  return Object.assign({}, base, {
    experimental: Object.assign({}, experimental, { swcPlugins }),
  });
}

module.exports = { withDesignless, WASM_RELATIVE, resolveProjectRoot };
