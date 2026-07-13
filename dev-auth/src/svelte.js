/**
 * @designless/dev-auth/svelte - the SvelteKit adapter.
 *
 * Returns a `handle` hook for `src/hooks.server.js`. IF the fail-closed gate
 * passes it sets `event.locals.user = { role }` before resolving; otherwise it
 * touches nothing and resolves as normal. Pure pass-through in production.
 *
 * Usage (dev only, worktree-only - see README):
 *   // src/hooks.server.js
 *   import { handle as devAuth } from '@designless/dev-auth/svelte';
 *   export { devAuth as handle };
 *   // or compose with your own via @sveltejs/kit `sequence`.
 */

'use strict';

const { readBypassRole } = require('./gate');

/**
 * @param {{ userKey?: string, env?: Record<string,string|undefined> }} [options]
 * @returns {(input: { event: any, resolve: Function }) => any} a SvelteKit handle
 */
function createHandle(options) {
  const userKey = (options && typeof options.userKey === 'string' && options.userKey) || 'user';
  const env = options && options.env;
  return function handle({ event, resolve }) {
    try {
      // SvelteKit's request.headers is a Fetch `Headers` - case-insensitive.
      const get = event && event.request && event.request.headers
        ? (name) => event.request.headers.get(name)
        : () => undefined;
      const result = readBypassRole(get, env);
      if (result) {
        if (!event.locals) event.locals = {};
        event.locals[userKey] = { role: result.role };
      }
    } catch {
      /* fail-closed; never break the request */
    }
    return resolve(event);
  };
}

// Named exports (a plain object, so `import { handle }` resolves reliably across
// the CJS->ESM boundary): a ready-to-use `handle` with defaults + the factory.
module.exports = { handle: createHandle(), createHandle };
