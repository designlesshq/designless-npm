/** The default-branch absence guard: detect any wiring of this package. */
import { describe, it, expect } from 'vitest';
import { detectDevAuthWiring, findDevAuthWiring } from '../src/guard.js';

describe('detectDevAuthWiring', () => {
  it('flags a require of the package or any subpath', () => {
    expect(detectDevAuthWiring("const d = require('@designless/dev-auth')")).toBe(true);
    expect(detectDevAuthWiring("const d = require('@designless/dev-auth/express')")).toBe(true);
  });
  it('flags an ESM import of the package or any subpath', () => {
    expect(detectDevAuthWiring("import { handle } from '@designless/dev-auth/svelte';")).toBe(true);
    expect(detectDevAuthWiring('import devAuth from "@designless/dev-auth/nuxt";')).toBe(true);
  });
  it('flags a backtick (template-literal) dynamic specifier', () => {
    expect(detectDevAuthWiring('const d = require(`@designless/dev-auth`)')).toBe(true);
    expect(detectDevAuthWiring('await import(`@designless/dev-auth/express`)')).toBe(true);
  });
  it('does not flag an unquoted prose mention', () => {
    expect(detectDevAuthWiring('// we use @designless/dev-auth on the capture branch')).toBe(false);
  });
  it('does not flag a similarly-named but different package', () => {
    expect(detectDevAuthWiring("require('@designless/annotate')")).toBe(false);
  });
  it('non-string input is not a hit', () => {
    expect(detectDevAuthWiring(null)).toBe(false);
    expect(detectDevAuthWiring(undefined)).toBe(false);
  });
});

describe('findDevAuthWiring', () => {
  it('returns only the offending paths; empty array is clean', () => {
    const files = [
      { path: 'src/app.js', content: "import express from 'express';" },
      { path: 'src/hooks.server.js', content: "import { handle } from '@designless/dev-auth/svelte';" },
      { path: 'src/util.js', content: 'export const x = 1;' },
    ];
    expect(findDevAuthWiring(files)).toEqual(['src/hooks.server.js']);
    expect(findDevAuthWiring([{ path: 'a', content: 'clean' }])).toEqual([]);
    expect(findDevAuthWiring(null)).toEqual([]);
  });
});
