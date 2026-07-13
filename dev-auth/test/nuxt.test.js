/** Nuxt (Nitro / H3) adapter: sets event.context.user on a full pass. */
import { describe, it, expect } from 'vitest';
import devAuth from '../src/nuxt.js';
import { HEADER } from '../src/contract.js';

const SECRET = 'nuxt-secret';
const DEV = { NODE_ENV: 'development', DESIGNLESS_DEVAUTH_SECRET: SECRET };
const nodeEvent = () => ({
  node: { req: { headers: { [HEADER.SECRET]: SECRET, [HEADER.ROLE]: 'admin' } } },
  context: {},
});

describe('@designless/dev-auth/nuxt', () => {
  it('reads Node request headers and sets event.context.user', () => {
    const event = nodeEvent();
    devAuth({ env: DEV })(event);
    expect(event.context.user).toEqual({ role: 'admin' });
  });

  it('reads a web-runtime Fetch Headers event too', () => {
    const event = {
      web: { request: { headers: new Headers({ [HEADER.SECRET]: SECRET, [HEADER.ROLE]: 'viewer' }) } },
      context: {},
    };
    devAuth({ env: DEV })(event);
    expect(event.context.user).toEqual({ role: 'viewer' });
  });

  it('production grants nothing', () => {
    const event = nodeEvent();
    devAuth({ env: { NODE_ENV: 'production', DESIGNLESS_DEVAUTH_SECRET: SECRET } })(event);
    expect(event.context.user).toBeUndefined();
  });

  it('fail-closed under the real env; never throws on a bare event', () => {
    const event = nodeEvent();
    devAuth()(event);
    expect(event.context.user).toBeUndefined();
    expect(() => devAuth({ env: DEV })({})).not.toThrow();
  });
});
