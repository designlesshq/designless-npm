/** Next adapter: getDevUser reads headers and returns { role } | null. */
import { describe, it, expect } from 'vitest';
import { getDevUser } from '../src/next.js';
import { HEADER } from '../src/contract.js';

const SECRET = 'next-secret';
const DEV = { NODE_ENV: 'development', DESIGNLESS_DEVAUTH_SECRET: SECRET };

describe('@designless/dev-auth/next', () => {
  it('reads a Fetch Headers object -> { role }', () => {
    const headers = new Headers({ [HEADER.SECRET]: SECRET, [HEADER.ROLE]: 'admin' });
    expect(getDevUser(headers, { env: DEV })).toEqual({ role: 'admin' });
  });

  it('reads a plain lowercase-keyed object -> { role }', () => {
    const headers = { [HEADER.SECRET]: SECRET, [HEADER.ROLE]: 'editor' };
    expect(getDevUser(headers, { env: DEV })).toEqual({ role: 'editor' });
  });

  it('production -> null', () => {
    const headers = new Headers({ [HEADER.SECRET]: SECRET, [HEADER.ROLE]: 'admin' });
    expect(getDevUser(headers, { env: { NODE_ENV: 'production', DESIGNLESS_DEVAUTH_SECRET: SECRET } })).toBeNull();
  });

  it('real env (NODE_ENV=test) -> null; junk input -> null (no throw)', () => {
    const headers = new Headers({ [HEADER.SECRET]: SECRET, [HEADER.ROLE]: 'admin' });
    expect(getDevUser(headers)).toBeNull();
    expect(getDevUser(null, { env: DEV })).toBeNull();
    expect(getDevUser(undefined, { env: DEV })).toBeNull();
  });

  it('never throws even if headers.get throws -> fail-closed null', () => {
    const bad = { get() { throw new Error('boom'); } };
    expect(getDevUser(bad, { env: DEV })).toBeNull();
  });
});
