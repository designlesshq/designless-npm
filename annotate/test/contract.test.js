/**
 * annotate/v1 contract: the frozen public interface. These pins ARE the
 * contract: changing any of them is a breaking v2.
 */
import { describe, it, expect } from 'vitest';
import { MARKER_VERSION, ATTR, isHostElement, toRepoRelative, markerAttributes } from '../src/contract.js';

describe('the frozen marker shape', () => {
  it('is annotate/v1 with the ratified attribute names', () => {
    expect(MARKER_VERSION).toBe('annotate/v1');
    expect(ATTR).toEqual({
      FILE: 'data-source-file',
      LINE: 'data-source-line',
      SELECTABLE: 'data-selectable',
      VERSION: 'data-designless',
    });
  });
});

describe('isHostElement', () => {
  it('stamps lowercase intrinsics and custom elements', () => {
    expect(isHostElement('div')).toBe(true);
    expect(isHostElement('h1')).toBe(true);
    expect(isHostElement('my-widget')).toBe(true);
  });
  it('skips components, members, fragments, and junk', () => {
    expect(isHostElement('SkillCard')).toBe(false);
    expect(isHostElement('Foo.Bar')).toBe(false);
    expect(isHostElement('')).toBe(false);
    expect(isHostElement(null)).toBe(false);
    expect(isHostElement(undefined)).toBe(false);
  });
});

describe('toRepoRelative - source-path confinement at the source', () => {
  it('produces a POSIX repo-relative path inside the root', () => {
    expect(toRepoRelative('/Users/x/app', '/Users/x/app/src/page.tsx')).toBe('src/page.tsx');
    expect(toRepoRelative('/Users/x/app/', '/Users/x/app/a/b/c.jsx')).toBe('a/b/c.jsx');
  });
  it('backslashes normalize to POSIX', () => {
    expect(toRepoRelative('C:\\app', 'C:\\app\\src\\page.tsx')).toBe('src/page.tsx');
  });
  it('refuses anything the canvas server would reject: outside root, the root itself, traversal', () => {
    expect(toRepoRelative('/Users/x/app', '/etc/passwd')).toBe(null);
    expect(toRepoRelative('/Users/x/app', '/Users/x/app')).toBe(null);
    expect(toRepoRelative('/Users/x/app', '/Users/x/other/page.tsx')).toBe(null);
    expect(toRepoRelative('', '/a/b')).toBe(null);
    expect(toRepoRelative('/a', '')).toBe(null);
  });
});

describe('markerAttributes', () => {
  it('emits the full v1 set: file, line, selectable, version', () => {
    expect(markerAttributes('src/page.tsx', 12)).toEqual({
      'data-source-file': 'src/page.tsx',
      'data-source-line': '12',
      'data-selectable': '',
      'data-designless': 'annotate/v1',
    });
  });
  it('omits the line when it is not a positive number', () => {
    const m = markerAttributes('src/page.tsx', 0);
    expect(m['data-source-line']).toBeUndefined();
    expect(m['data-source-file']).toBe('src/page.tsx');
  });
  it('returns null for an unstampable (null) relative path', () => {
    expect(markerAttributes(null, 5)).toBe(null);
    expect(markerAttributes('', 5)).toBe(null);
  });
});
