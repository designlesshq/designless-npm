/**
 * @designless/dev-auth/next - the Next.js adapter.
 *
 * Next has no shared request-scoped `req.user` to mutate across a middleware and
 * a Server Component, so the thin-receiver shape here is a READER: call
 * `getDevUser(headers)` wherever you resolve the current user and, IF the fail-
 * closed gate passes, it returns `{ role }` (else null). No mutation, no side
 * effects. Pure pass-through in production (returns null).
 *
 * Usage (dev only, worktree-only - see README):
 *   // in a Route Handler, Server Component, or middleware
 *   import { getDevUser } from '@designless/dev-auth/next';
 *   import { headers } from 'next/headers';
 *   const devUser = getDevUser(await headers());     // { role } | null
 *   const user = devUser ?? (await resolveRealUser());
 */

'use strict';

const { readBypassRole } = require('./gate');

// Accept either a Fetch/`Headers`-like object (has `.get`, e.g. next/headers'
// `headers()`, a Route Handler's `request.headers`, a NextRequest's `.headers`)
// or a plain lowercase-keyed object. Returns a case-insensitive getter.
function headerGetterFor(headers) {
  if (headers && typeof headers.get === 'function') return (name) => headers.get(name);
  if (headers && typeof headers === 'object') return (name) => headers[name];
  return () => undefined;
}

/**
 * @param {Headers | Record<string,string|string[]|undefined>} headers
 * @param {{ env?: Record<string,string|undefined> }} [options] - env override (tests only).
 * @returns {{ role: string } | null}
 */
function getDevUser(headers, options) {
  try {
    return readBypassRole(headerGetterFor(headers), options && options.env);
  } catch {
    // Fail-closed: a receiver bug (e.g. a headers object whose .get throws) must
    // never grant a role and never throw into the host. Match the middleware
    // adapters' try/catch discipline.
    return null;
  }
}

module.exports = { getDevUser };
