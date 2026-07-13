/**
 * dev-auth/v1 contract: the frozen public interface. These pins ARE the
 * contract; changing any is a breaking v2.
 */
import { describe, it, expect } from 'vitest';
import { CONTRACT_VERSION, HEADER, ROLE_PATTERN, isValidRole } from '../src/contract.js';

describe('the frozen contract', () => {
  it('is dev-auth/v1 with the ratified header names', () => {
    expect(CONTRACT_VERSION).toBe('dev-auth/v1');
    expect(HEADER).toEqual({ SECRET: 'x-bypass-auth', ROLE: 'x-bypass-role' });
  });
  it('freezes HEADER (no silent mutation of the contract)', () => {
    expect(Object.isFrozen(HEADER)).toBe(true);
  });
});

describe('isValidRole / ROLE_PATTERN', () => {
  it('accepts short opaque tokens', () => {
    for (const r of ['admin', 'editor', 'read-only', 'role_1', 'a.b', 'A1']) {
      expect(isValidRole(r)).toBe(true);
    }
  });
  it('rejects spaces, punctuation, control chars, over-length, and non-strings', () => {
    for (const r of ['ad min', 'a!', 'a\n', 'a'.repeat(65), '', null, undefined, 42]) {
      expect(isValidRole(r)).toBe(false);
    }
  });
  it('ROLE_PATTERN is the single source of the shape', () => {
    expect(ROLE_PATTERN.test('admin')).toBe(true);
    expect(ROLE_PATTERN.test('bad role')).toBe(false);
  });
});
