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
 * @param {object} [nextConfig] - the project's existing Next config
 * @param {{ enabled?: boolean }} [options]
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

  const experimental = base.experimental && typeof base.experimental === 'object' ? base.experimental : {};
  const existing = Array.isArray(experimental.swcPlugins) ? experimental.swcPlugins : [];
  // Idempotent: if our plugin is already wired (re-wrapped config), don't add twice.
  const alreadyWired = existing.some((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].includes('@designless/annotate'));
  const swcPlugins = alreadyWired ? existing : existing.concat([[WASM_SPECIFIER, {}]]);

  return Object.assign({}, base, {
    experimental: Object.assign({}, experimental, { swcPlugins }),
  });
}

module.exports = { withDesignless, WASM_RELATIVE };
