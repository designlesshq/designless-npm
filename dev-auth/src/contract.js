/**
 * @designless/dev-auth - the dev-auth/v1 receiver contract.
 *
 * The single source of truth for what this package reads and yields, shared by
 * every framework adapter. It is an interface, not an implementation: two header
 * names, a role-token shape, and the object the adapters populate. It holds only
 * strings and a regex - no auth-model knowledge, no dispatch, no network - so the
 * whole trust surface is verifiable with a single grep.
 *
 * WHAT THIS IS. During a Designless desktop capture of a route that needs a
 * signed-in view, the desktop app attaches two request headers to that capture's
 * outbound requests (and only that capture's - they are never persisted). This
 * package is the customer-side RECEIVER: an adapter reads those two headers and,
 * IF the fail-closed gate passes, populates the framework's request-scoped user
 * with `{ role }`. Nothing else.
 *
 * The contract (frozen at v1):
 *   X-Bypass-Auth  - the per-run shared secret. Compared (constant-time) against
 *                    the DESIGNLESS_DEVAUTH_SECRET the customer set in the SAME
 *                    dev process. A mismatch (or an absent secret) yields nothing.
 *   X-Bypass-Role  - the role string to stand up, e.g. `admin`. Validated against
 *                    ROLE_PATTERN; anything else yields nothing.
 *   { role }       - the ONLY thing an adapter puts on the request-scoped user.
 *                    No id, no email, no claims, no scopes. The role is opaque to
 *                    this package: it decides NOTHING from it (that is the app's
 *                    job) and knows NOTHING about which auth model produced it
 *                    (that stays server-side, off this public package).
 *
 * SAFETY (load-bearing - see gate.js). Unlike a source marker, a dev-auth
 * receiver FAKES authentication, so an accidental prod activation is a standing
 * backdoor (CWE-489). The gate is therefore fail-CLOSED and strict: it does
 * nothing unless NODE_ENV is exactly 'development' AND a non-empty
 * DESIGNLESS_DEVAUTH_SECRET is set AND the secret header matches it. See
 * README "Safety model".
 */

'use strict';

const CONTRACT_VERSION = 'dev-auth/v1';

// Header names, frozen. Lowercased because every adapter looks them up
// case-insensitively (Node lowercases incoming header keys; the Fetch `Headers`
// API is case-insensitive by spec).
const HEADER = Object.freeze({
  SECRET: 'x-bypass-auth',
  ROLE: 'x-bypass-role',
});

// A role is a short opaque token. This bounds what can be written onto the
// request-scoped user - never an arbitrary attacker-controlled string. Letters,
// digits, and `._-`, 1..64 chars. Anything else fails the gate (yields nothing).
const ROLE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Is `role` a well-formed role token? Pure.
 * @param {unknown} role
 * @returns {boolean}
 */
function isValidRole(role) {
  return typeof role === 'string' && ROLE_PATTERN.test(role);
}

module.exports = { CONTRACT_VERSION, HEADER, ROLE_PATTERN, isValidRole };
