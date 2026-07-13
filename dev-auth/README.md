# @designless/dev-auth

A dev-only, fail-closed receiver for signed-in captures.

When the Designless desktop app captures a route that only renders for a
signed-in user, it attaches two request headers to that capture's outbound
requests. This package is the customer-side receiver: an adapter reads those two
headers and, if the fail-closed gate passes, stands up a request-scoped
`{ role }` on the request. That is the whole job.

It reads two headers and sets one object. No network, no telemetry, no
persistence, and no knowledge of any authentication library. The entire trust
surface is a single `src/gate.js` you can read in a minute.

## The contract (frozen, `dev-auth/v1`)

| header | meaning |
| --- | --- |
| `X-Bypass-Auth` | the per-run shared secret, compared against `DESIGNLESS_DEVAUTH_SECRET` |
| `X-Bypass-Role` | the role to stand up, e.g. `admin` (validated: `[A-Za-z0-9._-]{1,64}`) |

On a full pass the adapter sets `{ role }` on the request. Never an id, an email,
claims, or scopes. The role string is opaque here: this package decides nothing
from it.

## Safety model

This package fakes authentication, so an accidental production activation would
be a standing backdoor ([CWE-489](https://cwe.mitre.org/data/definitions/489.html)).
Every layer below is fail-closed. If any single check does not hold, the adapter
does nothing and the request stays unauthenticated.

1. **Strict environment.** The gate runs only when `NODE_ENV` is exactly
   `development`. Unset, `production`, `test`, `staging`, or a typo all turn it
   off. (This is stricter than most dev-only tooling, which treats "not
   production" as dev. A faked login cannot afford that latitude.)
2. **Secret-gated.** A non-empty `DESIGNLESS_DEVAUTH_SECRET` must be set in the
   same process, and the `X-Bypass-Auth` header must equal it under a
   constant-time compare. The desktop app mints this secret per run, you approve
   it, and it lives only in your dev process environment. It is never persisted.
3. **Worktree-only, then reverted.** Install and wire this package on a
   throwaway git worktree branch for the capture, then revert. It should never be
   committed to your default branch.
4. **CI absence guard.** Prove step 3 held. In your default-branch CI, fail the
   build if the wiring is present. The zero-dependency form:

   ```sh
   # Scan the WHOLE tree (not just src/): the wiring can live in server/middleware/,
   # middleware.ts, app/, or hooks.server.js. Backticks are included too.
   ! grep -rqE "['\"\`]@designless/dev-auth" . --exclude-dir=node_modules --exclude-dir=.git \
     || { echo "dev-auth wiring must not reach the default branch"; exit 1; }
   ```

   Or programmatically, with the exported detector:

   ```js
   const { findDevAuthWiring } = require('@designless/dev-auth/guard');
   const offenders = findDevAuthWiring(files); // files: [{ path, content }]
   if (offenders.length) throw new Error('dev-auth wiring present: ' + offenders.join(', '));
   ```

Because of steps 1 and 2, even if the wiring did reach production it would be an
inert no-op: no `development` env and no matching secret means no role is ever
granted.

## Usage

Install on the capture worktree only:

```sh
npm install --no-save @designless/dev-auth
```

### Express / Connect

```js
const devAuth = require('@designless/dev-auth/express');
app.use(devAuth()); // sets req.user = { role } on a full pass; otherwise a no-op
```

### SvelteKit

```js
// src/hooks.server.js
import { handle } from '@designless/dev-auth/svelte';
export { handle }; // sets event.locals.user = { role }
// compose with your own via `sequence` from @sveltejs/kit if needed
```

### Nuxt (Nitro)

```js
// server/middleware/dev-auth.js
import { defineEventHandler } from 'h3';
import devAuth from '@designless/dev-auth/nuxt';
export default defineEventHandler(devAuth()); // sets event.context.user = { role }
```

### Next.js

Next has no shared `req.user` across middleware and Server Components, so the
adapter is a reader you call where you resolve the user:

```js
import { getDevUser } from '@designless/dev-auth/next';
import { headers } from 'next/headers';

const devUser = getDevUser(await headers()); // { role } | null
const user = devUser ?? (await resolveRealUser());
```

Each adapter accepts `{ userKey }` to change the property name (default `user`)
and `{ env }` to inject an environment (used by the tests).

## What it is not

It does not detect your auth setup, choose a method, mint tokens, or call
anything over the network. Deciding which header shape a given app needs is a
Designless server responsibility and is not in this package. This stays a thin
receiver on purpose: thinness is the trust property for code you let into a
build.

## License

Apache-2.0. (c) Designless Private Limited.
