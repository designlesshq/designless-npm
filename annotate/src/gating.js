/**
 * @designless/annotate - environment gating + the loud-no-op discipline.
 *
 * Two hard rules:
 *
 *  1. PRODUCTION BYTE-IDENTITY: the annotator stamps ONLY in development. In
 *     production every engine is an exact pass-through, so the build output is
 *     byte-for-byte what it would be without the package. `isEnabled()` is the
 *     one gate; both engines bail on false before touching the AST.
 *
 *  2. LOUD NO-OP: when the package cannot do its job (an unexpected AST shape,
 *     a missing source location, an ABI it does not recognize) it WARNS once and
 *     skips that element. It NEVER throws into the host build. A broken
 *     annotator must degrade to "no markers", never to "next dev won't start".
 */

'use strict';

/**
 * Is stamping enabled for this build? Development only. Resolution order:
 *   1. explicit option `{ enabled: boolean }` (the initializer can force it)
 *   2. NODE_ENV - anything other than 'production' is dev (the Vite/Next
 *      convention); undefined NODE_ENV counts as dev so a bare `vite`/`next dev`
 *      stamps without extra config.
 * Pure over the injected env (testable).
 * @param {{ enabled?: boolean }} [options]
 * @param {Record<string,string|undefined>} [env]
 * @returns {boolean}
 */
function isEnabled(options, env) {
  const e = env || (typeof process !== 'undefined' ? process.env : {}) || {};
  if (options && typeof options.enabled === 'boolean') return options.enabled;
  return e.NODE_ENV !== 'production';
}

// One warning per distinct message per process - a build touches thousands of
// files; we never want a marker problem to spam the console into uselessness.
const _warned = new Set();

/**
 * Warn ONCE, loudly, namespaced - and never throw. The whole point is that a
 * misbehaving annotator is visible but harmless.
 * @param {string} message
 */
function warnOnce(message) {
  const key = String(message);
  if (_warned.has(key)) return;
  _warned.add(key);
  try {
    // eslint-disable-next-line no-console
    console.warn('[@designless/annotate] ' + key);
  } catch {
    /* a console that throws must not take the build down with it */
  }
}

/** Test-only: reset the once-warned memo. */
function _resetWarnings() {
  _warned.clear();
}

module.exports = { isEnabled, warnOnce, _resetWarnings };
