/**
 * @designless/dev-auth - the fail-closed receiver core.
 *
 * Every adapter funnels through `readBypassRole`. It is pure over an injected
 * header-getter and env, so the entire safety property is unit-testable without
 * a framework.
 *
 * THE GATE IS FAIL-CLOSED. It returns `{ role }` only when ALL hold, else null:
 *   1. env.NODE_ENV is EXACTLY the string 'development'. Not "not production" -
 *      exactly 'development'. Unset, 'production', 'test', 'staging', or any
 *      typo -> off. (This is the one place we deliberately diverge from
 *      @designless/annotate, whose gate treats undefined as dev: a source marker
 *      is harmless in prod, a faked login is a backdoor, so dev-auth must be
 *      strict, not permissive - CWE-489.)
 *   2. A non-empty DESIGNLESS_DEVAUTH_SECRET is present in the same env. The
 *      customer sets this to a per-run secret the desktop app minted and they
 *      approved; it lives only in the dev process env and is never persisted.
 *   3. The X-Bypass-Auth header equals that secret under a constant-time compare.
 *   4. The X-Bypass-Role header is a well-formed role token.
 *
 * NO network, NO telemetry, NO persistence, NO auth-model knowledge. The only
 * effect a caller sees is the returned `{ role }` (or null).
 */

'use strict';

const crypto = require('crypto');
const { HEADER, isValidRole } = require('./contract');

// Per-process random key for the constant-time compare. `crypto.timingSafeEqual`
// requires equal-length buffers, so we HMAC both sides to a fixed 32-byte digest
// first: length-agnostic AND constant-time, with no early length-leak branch.
const HMAC_KEY = crypto.randomBytes(32);

/**
 * Constant-time string equality, length-agnostic. Non-strings are never equal.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const da = crypto.createHmac('sha256', HMAC_KEY).update(a).digest();
  const db = crypto.createHmac('sha256', HMAC_KEY).update(b).digest();
  return crypto.timingSafeEqual(da, db);
}

/**
 * Is the dev-auth bypass eligible to run at all in this env? Strict + secret-
 * gated (rules 1 + 2 above). Pure over env. Exported so an adapter can cheaply
 * short-circuit (skip even reading headers) in production.
 * @param {Record<string, string|undefined>} [env]
 * @returns {boolean}
 */
function isDevAuthEnabled(env) {
  const e = env || {};
  // OWN properties only: never trust an INHERITED NODE_ENV or secret. Reading
  // them off the prototype chain would let a host Object.prototype-pollution
  // gadget set them on the prototype (with the env vars themselves unset) and
  // flip the gate open in production. A real env var / customer-set secret is
  // always an own property, so this rejects only the polluted case.
  if (!Object.hasOwn(e, 'NODE_ENV') || !Object.hasOwn(e, 'DESIGNLESS_DEVAUTH_SECRET')) return false;
  return e.NODE_ENV === 'development'
    && typeof e.DESIGNLESS_DEVAUTH_SECRET === 'string'
    && e.DESIGNLESS_DEVAUTH_SECRET.length > 0;
}

// Normalize a header-getter's return into a single non-empty string, or ''.
// Node can hand back a string[] for a repeated header; take the first. Anything
// non-stringy collapses to '' (which fails every downstream check).
function firstHeaderValue(v) {
  if (Array.isArray(v)) v = v[0];
  return typeof v === 'string' ? v : '';
}

/**
 * The receiver core. Given a case-insensitive header-getter and an env, return
 * `{ role }` iff the full fail-closed gate passes, else null.
 *
 * @param {(name: string) => (string|string[]|undefined|null)} getHeader
 *   Looks a header up by its LOWERCASE name (contract.HEADER values are lowercase).
 * @param {Record<string, string|undefined>} [env] - defaults to process.env.
 * @returns {{ role: string } | null}
 */
function readBypassRole(getHeader, env) {
  const e = env || (typeof process !== 'undefined' ? process.env : {}) || {};
  // Rules 1 + 2: strict env + secret present. Off -> read nothing, return null.
  if (!isDevAuthEnabled(e)) return null;
  if (typeof getHeader !== 'function') return null;

  // Rule 3: the secret header must match the env secret (constant-time).
  const provided = firstHeaderValue(getHeader(HEADER.SECRET));
  if (!provided || !safeEqual(provided, e.DESIGNLESS_DEVAUTH_SECRET)) return null;

  // Rule 4: a well-formed role token.
  const role = firstHeaderValue(getHeader(HEADER.ROLE));
  if (!isValidRole(role)) return null;

  return { role };
}

module.exports = { safeEqual, isDevAuthEnabled, readBypassRole };
