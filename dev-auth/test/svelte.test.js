/** SvelteKit adapter: sets event.locals.user on a full pass; resolves as normal. */
import { describe, it, expect, vi } from 'vitest';
import { handle, createHandle } from '../src/svelte.js';
import { HEADER } from '../src/contract.js';

const SECRET = 'svelte-secret';
const DEV = { NODE_ENV: 'development', DESIGNLESS_DEVAUTH_SECRET: SECRET };
const mkEvent = () => ({
  request: { headers: new Headers({ [HEADER.SECRET]: SECRET, [HEADER.ROLE]: 'editor' }) },
  locals: {},
});

describe('@designless/dev-auth/svelte', () => {
  it('a full pass sets event.locals.user = { role } and resolves the event', () => {
    const event = mkEvent();
    const resolve = vi.fn(() => 'RESPONSE');
    const out = createHandle({ env: DEV })({ event, resolve });
    expect(event.locals.user).toEqual({ role: 'editor' });
    expect(resolve).toHaveBeenCalledWith(event);
    expect(out).toBe('RESPONSE');
  });

  it('production grants nothing but still resolves', () => {
    const event = mkEvent();
    const resolve = vi.fn(() => 'RESPONSE');
    createHandle({ env: { NODE_ENV: 'production', DESIGNLESS_DEVAUTH_SECRET: SECRET } })({ event, resolve });
    expect(event.locals.user).toBeUndefined();
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('the ready-made `handle` is a function and is fail-closed under the real env', () => {
    const event = mkEvent();
    expect(typeof handle).toBe('function');
    handle({ event, resolve: (e) => e }); // process.env NODE_ENV=test -> no grant
    expect(event.locals.user).toBeUndefined();
  });
});
