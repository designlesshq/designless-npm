import { describe, it, expect } from 'vitest';
import { classifyTypecheck, runTypecheck, MIN_TYPED_VERSION } from '../src/build-gate.js';

describe('build gate', () => {
  it('a clean type-check passes', () => {
    expect(classifyTypecheck('', 0)).toEqual({ ok: true, errors: [], cause: null });
  });
  it('a missing annotate declaration is named as ours, with the version that fixes it', () => {
    const r = classifyTypecheck("next.config.ts(1,32): error TS7016: Could not find a declaration file for module '@designless/annotate/next'.", 2);
    expect(r.ok).toBe(false); expect(r.cause).toBe('annotate-declarations'); expect(r.fix).toContain(`@designless/annotate@^${MIN_TYPED_VERSION}`);
  });
  it("the project's own errors are the project's", () => {
    const r = classifyTypecheck("src/app/page.tsx(4,7): error TS2322: Type 'string' is not assignable to type 'number'.", 2);
    expect(r.cause).toBe('project'); expect(r.errors.length).toBe(1);
  });
  it('a project without a tsconfig is skipped, not failed', () => {
    const r = runTypecheck('/nonexistent-dir-for-test');
    expect(r.ok).toBeNull(); expect(r.skipped).toContain('no tsconfig.json');
  });
});
