/** Express adapter: sets req.user on a full pass; a no-op otherwise. */
import { describe, it, expect, vi } from 'vitest';
import devAuth from '../src/express.js';
import { HEADER } from '../src/contract.js';

const SECRET = 'express-secret';
const DEV = { NODE_ENV: 'development', DESIGNLESS_DEVAUTH_SECRET: SECRET };
const mkReq = () => ({ headers: { [HEADER.SECRET]: SECRET, [HEADER.ROLE]: 'admin' } });

describe('@designless/dev-auth/express', () => {
  it('a full pass sets req.user = { role } and calls next', () => {
    const req = mkReq();
    const next = vi.fn();
    devAuth({ env: DEV })(req, {}, next);
    expect(req.user).toEqual({ role: 'admin' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('production is a pure pass-through: req.user is never set even with valid headers', () => {
    const req = mkReq();
    const next = vi.fn();
    devAuth({ env: { NODE_ENV: 'production', DESIGNLESS_DEVAUTH_SECRET: SECRET } })(req, {}, next);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('a wrong secret grants nothing but still calls next', () => {
    const req = { headers: { [HEADER.SECRET]: 'nope', [HEADER.ROLE]: 'admin' } };
    const next = vi.fn();
    devAuth({ env: DEV })(req, {}, next);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('honors a custom userKey', () => {
    const req = mkReq();
    devAuth({ env: DEV, userKey: 'auth' })(req, {}, vi.fn());
    expect(req.auth).toEqual({ role: 'admin' });
    expect(req.user).toBeUndefined();
  });

  it('with the real process.env (NODE_ENV=test under vitest) it is fail-closed', () => {
    const req = mkReq();
    devAuth()(req, {}, vi.fn()); // no env override -> reads process.env
    expect(req.user).toBeUndefined();
  });

  it('a malformed req never throws and never half-grants', () => {
    const next = vi.fn();
    expect(() => devAuth({ env: DEV })({}, {}, next)).not.toThrow();
    expect(next).toHaveBeenCalledOnce();
  });
});
