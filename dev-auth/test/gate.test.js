/**
 * The fail-closed receiver core. This suite IS the safety property: every row
 * that should yield nothing must yield null, and only the one fully-valid row
 * yields { role }.
 */
import { describe, it, expect } from 'vitest';
import { readBypassRole, isDevAuthEnabled, safeEqual } from '../src/gate.js';
import { HEADER } from '../src/contract.js';

const SECRET = 's3cr3t-per-run-value';
const DEV = { NODE_ENV: 'development', DESIGNLESS_DEVAUTH_SECRET: SECRET };

// A header-getter from a { name: value } map (contract names are lowercase).
const mkGet = (map) => (name) => map[name];
const validHeaders = { [HEADER.SECRET]: SECRET, [HEADER.ROLE]: 'admin' };

describe('readBypassRole - the one passing row', () => {
  it('dev env + matching secret + valid role -> { role }', () => {
    expect(readBypassRole(mkGet(validHeaders), DEV)).toEqual({ role: 'admin' });
  });
  it('takes the first value of a repeated (array) header', () => {
    const get = mkGet({ [HEADER.SECRET]: [SECRET, 'other'], [HEADER.ROLE]: ['editor', 'x'] });
    expect(readBypassRole(get, DEV)).toEqual({ role: 'editor' });
  });
});

describe('readBypassRole - fail-closed on the environment', () => {
  it('NODE_ENV unset -> null', () => {
    expect(readBypassRole(mkGet(validHeaders), { DESIGNLESS_DEVAUTH_SECRET: SECRET })).toBeNull();
  });
  it("NODE_ENV 'production' -> null", () => {
    expect(readBypassRole(mkGet(validHeaders), { NODE_ENV: 'production', DESIGNLESS_DEVAUTH_SECRET: SECRET })).toBeNull();
  });
  it("NODE_ENV 'test' -> null", () => {
    expect(readBypassRole(mkGet(validHeaders), { NODE_ENV: 'test', DESIGNLESS_DEVAUTH_SECRET: SECRET })).toBeNull();
  });
  it("NODE_ENV 'staging' -> null", () => {
    expect(readBypassRole(mkGet(validHeaders), { NODE_ENV: 'staging', DESIGNLESS_DEVAUTH_SECRET: SECRET })).toBeNull();
  });
  it("wrong case 'Development' -> null (exact match only)", () => {
    expect(readBypassRole(mkGet(validHeaders), { NODE_ENV: 'Development', DESIGNLESS_DEVAUTH_SECRET: SECRET })).toBeNull();
  });
});

describe('readBypassRole - fail-closed on the secret', () => {
  it('no DESIGNLESS_DEVAUTH_SECRET -> null', () => {
    expect(readBypassRole(mkGet(validHeaders), { NODE_ENV: 'development' })).toBeNull();
  });
  it('empty DESIGNLESS_DEVAUTH_SECRET -> null', () => {
    expect(readBypassRole(mkGet(validHeaders), { NODE_ENV: 'development', DESIGNLESS_DEVAUTH_SECRET: '' })).toBeNull();
  });
  it('header secret does not match env secret -> null', () => {
    const get = mkGet({ [HEADER.SECRET]: 'wrong', [HEADER.ROLE]: 'admin' });
    expect(readBypassRole(get, DEV)).toBeNull();
  });
  it('secret header absent -> null', () => {
    expect(readBypassRole(mkGet({ [HEADER.ROLE]: 'admin' }), DEV)).toBeNull();
  });
});

describe('readBypassRole - fail-closed on the role', () => {
  it('role header absent -> null', () => {
    expect(readBypassRole(mkGet({ [HEADER.SECRET]: SECRET }), DEV)).toBeNull();
  });
  it('role with illegal characters -> null', () => {
    const get = mkGet({ [HEADER.SECRET]: SECRET, [HEADER.ROLE]: 'ad min!' });
    expect(readBypassRole(get, DEV)).toBeNull();
  });
  it('role longer than 64 chars -> null', () => {
    const get = mkGet({ [HEADER.SECRET]: SECRET, [HEADER.ROLE]: 'a'.repeat(65) });
    expect(readBypassRole(get, DEV)).toBeNull();
  });
  it('empty role -> null', () => {
    const get = mkGet({ [HEADER.SECRET]: SECRET, [HEADER.ROLE]: '' });
    expect(readBypassRole(get, DEV)).toBeNull();
  });
});

describe('readBypassRole - defensive inputs', () => {
  it('getHeader not a function -> null', () => {
    expect(readBypassRole(null, DEV)).toBeNull();
    expect(readBypassRole(undefined, DEV)).toBeNull();
  });
  it('a non-string (object) secret header collapses to no-grant', () => {
    const get = mkGet({ [HEADER.SECRET]: {}, [HEADER.ROLE]: 'admin' });
    expect(readBypassRole(get, DEV)).toBeNull();
  });
});

describe('readBypassRole - hardening', () => {
  it('ignores INHERITED env props (prototype-pollution safe)', () => {
    // env whose NODE_ENV + secret live on the PROTOTYPE, not as own props -
    // exactly the shape a host Object.prototype pollution would produce.
    const polluted = Object.create({ NODE_ENV: 'development', DESIGNLESS_DEVAUTH_SECRET: SECRET });
    expect(isDevAuthEnabled(polluted)).toBe(false);
    expect(readBypassRole(mkGet(validHeaders), polluted)).toBeNull();
  });
  it('production short-circuits BEFORE any header is read (byte-identity)', () => {
    // A getter that throws if invoked proves the env gate runs first: if a header
    // were read in production this would throw instead of returning null.
    const throwingGet = () => { throw new Error('a header was read in production'); };
    expect(
      readBypassRole(throwingGet, { NODE_ENV: 'production', DESIGNLESS_DEVAUTH_SECRET: SECRET }),
    ).toBeNull();
  });
});

describe('isDevAuthEnabled', () => {
  it('true only for exact development + non-empty secret', () => {
    expect(isDevAuthEnabled(DEV)).toBe(true);
    expect(isDevAuthEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(isDevAuthEnabled({ NODE_ENV: 'production', DESIGNLESS_DEVAUTH_SECRET: SECRET })).toBe(false);
    expect(isDevAuthEnabled(undefined)).toBe(false);
  });
});

describe('safeEqual - constant-time, length-agnostic', () => {
  it('equal strings are equal', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });
  it('different strings are not equal', () => {
    expect(safeEqual('abc', 'abd')).toBe(false);
  });
  it('different LENGTHS do not throw and are not equal', () => {
    expect(safeEqual('short', 'a-much-longer-value')).toBe(false);
  });
  it('non-strings are never equal', () => {
    expect(safeEqual('abc', undefined)).toBe(false);
    expect(safeEqual(123, 123)).toBe(false);
  });
});
