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
 *   - LOUD NO-OP: if we cannot name a wasm this host can actually load, warn
 *     and return the config untouched. `next dev` must start regardless -
 *     markers are a nice-to-have, never a prerequisite.
 *   - ADDITIVE: never clobbers an existing experimental.swcPlugins; appends.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS MORE THAN ONE WASM, AND WHY WE TEST INSTEAD OF GUESSING
 *
 * An SWC wasm plugin is compiled against ONE `swc_core`, and a host can only
 * load it if the host's `swc_plugin_runner` speaks the same plugin AST schema.
 * There is no runtime negotiation and no graceful degradation: a mismatch is
 * `failed to invoke plugin`, which Next reports as a build error and serves as
 * a 500. A dev-only convenience taking the dev server down is the worst
 * failure mode this package has.
 *
 * The obvious fix - a table from Next version (or runner version) to artifact -
 * is not trustworthy. Measured by loading each artifact through the host's own
 * @next/swc binary:
 *
 *     host                          core35   core68
 *     Next 15.5.19 (runner 18)      ok       REJECTED
 *     Next 16.1.7  (runner 23)      REJECTED ok
 *     Next 16.2.1  (runner 24)      REJECTED ok
 *
 * Compatibility generations are wide and their edges are not where the version
 * numbers suggest: runners 23, 24 and 29 accept the same artifact, while two
 * Next 16 minors embed different runners. Any table we hand-maintain is a guess
 * that goes stale on a Next release we did not test.
 *
 * So we do not predict - we PREFLIGHT. The host's @next/swc binary is already
 * on disk and exposes `transformSync`; we run one tiny JSX transform through
 * each candidate wasm and keep the first that actually stamps. That is the same
 * handshake Turbopack will perform, done in-process where a rejection is a
 * catchable exception instead of a 500. Measured at ~4ms to load the binary and
 * ~2ms per candidate, once per process.
 *
 * The consequence worth keeping: a wrong guess now costs a skipped marker, and
 * a new Next release that changes ABI degrades to "no markers" rather than
 * "broken dev server" - and starts working again by itself if its ABI matches
 * an artifact we already ship.
 *
 * NOTE for maintainers: `@swc/core` (this package's devDependency, and what
 * test/next.test.js exercises) carries its OWN runner, generally not the one
 * any released Next embeds. A green test suite proves the transform is correct;
 * it does NOT prove the shipped artifact loads under `next dev`. That gap is
 * why a single artifact shipped for months while stamping nothing on Next 15.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { isEnabled, warnOnce } = require('./gating');

/**
 * Candidate artifacts, newest ABI first. Each is one build of the SAME source
 * against a different `swc_core`; they are behaviourally identical. Order only
 * decides which is tried first, never which is correct - preflight decides that.
 * Keep in lockstep with gen-abi-targets.mjs and the package `exports` map.
 */
const CANDIDATES = [
  { rel: '../swc-plugin/annotate.wasm', spec: '@designless/annotate/swc/annotate.wasm', core: 68 },
  { rel: '../swc-plugin-core35/annotate.wasm', spec: '@designless/annotate/swc/core35.wasm', core: 35 },
];

// A minimal host-JSX source. It must produce a marker under a correct load, so
// "loaded but stamped nothing" is treated as a failure rather than a pass.
const PREFLIGHT_SRC = 'const __d = <div />;';
const PREFLIGHT_FILE = 'designless-preflight.tsx';

/** Memoised per host binary - preflight is cheap but runs on every config load. */
const selectionCache = new Map();

/**
 * Locate the host's @next/swc native binary. Next ships one prebuilt package
 * per platform/arch (`@next/swc-darwin-arm64`, `@next/swc-linux-x64-gnu`, ...);
 * rather than reimplement that mapping we look for whichever one is installed.
 * @param {string} projectRoot
 * @returns {string|null} absolute path to a .node binary, or null
 */
function findSwcBinary(projectRoot) {
  let nextPkg;
  try {
    nextPkg = require.resolve('next/package.json', { paths: [projectRoot, __dirname] });
  } catch {
    return null; // no Next resolvable from here (a bare test env, a monorepo edge)
  }
  const scoped = path.join(path.dirname(path.dirname(nextPkg)), '@next');
  let entries;
  try { entries = fs.readdirSync(scoped); } catch { return null; }
  for (const entry of entries) {
    // `swc-wasm-*` is Next's pure-wasm fallback: no .node binary, and it does
    // not run native plugins at all, so it correctly matches nothing here.
    if (!entry.startsWith('swc-')) continue;
    const dir = path.join(scoped, entry);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    const bin = files.find((f) => f.endsWith('.node'));
    if (bin) return path.join(dir, bin);
  }
  return null;
}

/**
 * Run one throwaway transform through `bindings` using `wasmPath`, and report
 * whether a marker came out. This is the same runner<->plugin handshake
 * Turbopack performs, executed where we can catch the rejection.
 * @returns {boolean}
 */
function stampsUnder(bindings, wasmPath, projectRoot) {
  try {
    const options = {
      filename: path.join(projectRoot || process.cwd(), PREFLIGHT_FILE),
      jsc: {
        parser: { syntax: 'typescript', tsx: true },
        target: 'es2022',
        experimental: { plugins: [[wasmPath, { root: projectRoot }]] },
      },
    };
    // Next's own binding signature: (source, isModule, optionsBuffer).
    const out = bindings.transformSync(PREFLIGHT_SRC, true, Buffer.from(JSON.stringify(options)));
    const code = typeof out === 'string' ? out : (out && out.code) || '';
    return code.indexOf('data-source-file') !== -1;
  } catch {
    return false; // an ABI rejection lands here; that is the whole point
  }
}

/**
 * Pick the artifact this host can actually load, by trying them.
 * @param {string} projectRoot
 * @param {{ wasm?: string }} [options]
 * @returns {{ rel: string, spec: string, core: number }|null} null -> fail open
 */
function selectPlugin(projectRoot, options) {
  const forced = (options && options.wasm) ||
    (typeof process !== 'undefined' && process.env && process.env.DESIGNLESS_SWC_WASM);
  if (forced) {
    const hit = CANDIDATES.find((c) => c.spec === forced || c.rel.indexOf(forced) !== -1 || String(c.core) === String(forced));
    if (hit) return hit; // escape hatch: skip preflight entirely
  }

  const bin = findSwcBinary(projectRoot);
  if (!bin) return null;
  if (selectionCache.has(bin)) return selectionCache.get(bin);

  let bindings = null;
  try {
    bindings = require(bin);
  } catch {
    bindings = null; // unloadable native module -> fail open, never throw
  }

  const chosen = chooseCandidate(bindings, projectRoot);
  selectionCache.set(bin, chosen);
  return chosen;
}

/**
 * Try each candidate against `bindings` and return the first that stamps.
 * Split out from selectPlugin so it can be exercised with a stub host - the
 * real binary is a 100MB+ platform artifact that CI may not have.
 * @param {{ transformSync?: Function }|null} bindings
 * @param {string} projectRoot
 * @returns {{ rel: string, spec: string, core: number }|null}
 */
function chooseCandidate(bindings, projectRoot) {
  if (!bindings || typeof bindings.transformSync !== 'function') return null;
  for (const candidate of CANDIDATES) {
    const wasmPath = path.join(__dirname, candidate.rel);
    if (!fs.existsSync(wasmPath)) continue;
    if (stampsUnder(bindings, wasmPath, projectRoot)) return candidate;
  }
  return null;
}

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
 * @param {{ enabled?: boolean, root?: string, runner?: number }} [options]
 * @returns {object} the (possibly) wrapped config
 */
function withDesignless(nextConfig, options) {
  const base = nextConfig && typeof nextConfig === 'object' ? nextConfig : {};
  if (!isEnabled(options)) return base; // production -> untouched, byte-identical

  // Thread the project root into the plugin config so absolute filenames become
  // repo-relative markers. An empty root falls through to the plugin's
  // already-relative back-compat branch (never a crash, just fewer markers).
  const root = resolveProjectRoot(base, options);

  // Which artifact can this host actually load? Determined by trying, not by
  // guessing - and every failure path below returns the config untouched so
  // `next dev` starts either way.
  const target = selectPlugin(root || process.cwd(), options);
  if (!target) {
    warnOnce(
      'no marker plugin matches this Next version\'s SWC plugin ABI - markers are off for ' +
      'this run. Your app and your build are unaffected. Updating @designless/annotate ' +
      'usually fixes it; if it persists, report which version of Next you are running.',
    );
    return base;
  }

  // Preflight already skips absent artifacts, but the forced-candidate escape
  // hatch does not go through it - and a broken install must still be a loud
  // no-op rather than a specifier Turbopack cannot resolve.
  const wasmPath = path.join(__dirname, target.rel);
  if (!fs.existsSync(wasmPath)) {
    warnOnce(
      'SWC marker plugin not found at ' + wasmPath + ' - markers are off for this run. ' +
      'Reinstall @designless/annotate (the wasm artifacts ship in the package).',
    );
    return base;
  }

  const experimental = base.experimental && typeof base.experimental === 'object' ? base.experimental : {};
  const existing = Array.isArray(experimental.swcPlugins) ? experimental.swcPlugins : [];
  // Idempotent: if our plugin is already wired (re-wrapped config), don't add twice.
  const alreadyWired = existing.some((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].includes('@designless/annotate'));
  const swcPlugins = alreadyWired ? existing : existing.concat([[target.spec, { root }]]);

  return Object.assign({}, base, {
    experimental: Object.assign({}, experimental, { swcPlugins }),
  });
}

module.exports = {
  withDesignless,
  resolveProjectRoot,
  selectPlugin,
  chooseCandidate,
  findSwcBinary,
  stampsUnder,
  CANDIDATES,
};
