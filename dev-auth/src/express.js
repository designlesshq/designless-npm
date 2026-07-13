/**
 * @designless/dev-auth/express - the Express / Connect adapter.
 *
 * Returns a middleware that, IF the fail-closed gate passes, sets
 * `req.user = { role }` before the next handler. On anything short of a full
 * pass it does nothing at all - `req.user` is left exactly as it was (usually
 * undefined), so an unconfigured or production app sees a plain unauthenticated
 * request. Pure pass-through in production (byte-identity): the gate short-
 * circuits before any header is read.
 *
 * Usage (dev only, worktree-only - see README):
 *   const devAuth = require('@designless/dev-auth/express');
 *   app.use(devAuth());
 */

'use strict';

const { readBypassRole } = require('./gate');

/**
 * @param {{ userKey?: string, env?: Record<string,string|undefined> }} [options]
 *   userKey: the request property to populate (default 'user').
 *   env: override process.env (tests only).
 * @returns {(req: any, res: any, next: Function) => void}
 */
module.exports = function designlessDevAuthExpress(options) {
  const userKey = (options && typeof options.userKey === 'string' && options.userKey) || 'user';
  const env = options && options.env;
  return function designlessDevAuth(req, res, next) {
    try {
      // Node lowercases incoming header keys, matching contract.HEADER.
      const result = readBypassRole((name) => (req && req.headers ? req.headers[name] : undefined), env);
      if (result) req[userKey] = { role: result.role };
    } catch {
      // Fail-closed AND never break the request: a receiver bug must not 500 a
      // dev server, and must never leave a half-set user. (result was falsy or
      // the assignment threw before completing; either way no auth is granted.)
    }
    next();
  };
};
