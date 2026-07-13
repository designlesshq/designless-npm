/**
 * @designless/dev-auth/nuxt - the Nuxt (Nitro / H3) adapter.
 *
 * Returns an H3 event handler for a Nitro server middleware. IF the fail-closed
 * gate passes it sets `event.context.user = { role }`; otherwise it touches
 * nothing. Pure pass-through in production.
 *
 * Usage (dev only, worktree-only - see README):
 *   // server/middleware/dev-auth.js
 *   import { defineEventHandler } from 'h3';
 *   import devAuth from '@designless/dev-auth/nuxt';
 *   export default defineEventHandler(devAuth());
 *   // (Nitro also accepts a bare handler function, so `export default devAuth()`
 *   //  works too; wrap in defineEventHandler if your toolchain expects it.)
 */

'use strict';

const { readBypassRole } = require('./gate');

// Build a case-insensitive header-getter from an H3 event. H3 exposes the raw
// Node request at `event.node.req` (headers already lowercased); a web-runtime
// event exposes a Fetch Request at `event.web.request`. Try both, dep-free.
function headerGetterFor(event) {
  const nodeHeaders = event && event.node && event.node.req && event.node.req.headers;
  if (nodeHeaders && typeof nodeHeaders === 'object') return (name) => nodeHeaders[name];
  const webHeaders = event && event.web && event.web.request && event.web.request.headers;
  if (webHeaders && typeof webHeaders.get === 'function') return (name) => webHeaders.get(name);
  return () => undefined;
}

/**
 * @param {{ userKey?: string, env?: Record<string,string|undefined> }} [options]
 * @returns {(event: any) => void} an H3 event handler
 */
module.exports = function designlessDevAuthNuxt(options) {
  const userKey = (options && typeof options.userKey === 'string' && options.userKey) || 'user';
  const env = options && options.env;
  return function devAuthEventHandler(event) {
    try {
      const result = readBypassRole(headerGetterFor(event), env);
      if (result) {
        if (!event.context) event.context = {};
        event.context[userKey] = { role: result.role };
      }
    } catch {
      /* fail-closed; never break the request */
    }
    // A Nitro middleware returns nothing to fall through to the next handler.
  };
};
