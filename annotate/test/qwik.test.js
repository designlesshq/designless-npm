/**
 * Qwik engine - REAL transforms through the installed @babel/parser. Proves the
 * markers land on host JSX elements, skip components and member-expression
 * tags, stay idempotent, respect dev-gating, and are BYTE-IDENTICAL in
 * production. The engine SPLICES (never regenerates), so Qwik's `$` syntax is
 * preserved byte-for-byte. Also checks the Vite-plugin wrapper shape.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import annotateQwikPlugin, { annotateQwikSource } from '../src/qwik.js';
import { _resetWarnings } from '../src/gating.js';

const ROOT = '/repo';

/** Run a .tsx source through the engine core. */
function transform(content, { filename = '/repo/src/App.tsx', enabled = true, root = ROOT } = {}) {
  const out = annotateQwikSource(content, { filename, enabled, root });
  return out === undefined ? content : out;
}

const QWIK = `import { component$ } from '@builder.io/qwik';
export const App = component$(() => {
  return (
    <div class="a">
      <h1>hi</h1>
      <Foo.Bar />
      <my-widget></my-widget>
    </div>
  );
});
`;

beforeEach(() => _resetWarnings());

describe('host-element stamping (real @babel/parser, JSX/TSX)', () => {
  it('stamps a host element with the full v1 marker set', () => {
    const out = transform('const A = () => <div class="a">hi</div>;');
    expect(out).toContain('data-source-file="src/App.tsx"');
    expect(out).toContain('data-source-line="1"');
    expect(out).toContain('data-selectable');
    expect(out).toContain('data-designless="annotate/v1"');
    expect(out).not.toContain('data-selectable=');
  });

  it('records the true 1-based source line of each element', () => {
    const out = transform(QWIK);
    expect(out).toMatch(/<div\s+data-source-file="src\/App\.tsx" data-source-line="4"/);
    expect(out).toMatch(/<h1\s+data-source-file="src\/App\.tsx" data-source-line="5"/);
  });

  it('stamps a dash-named custom element (a dash makes it a host)', () => {
    const out = transform(QWIK);
    expect(out).toMatch(/<my-widget\s+data-source-file="src\/App\.tsx" data-source-line="7"/);
  });

  it('skips a component and a member-expression tag', () => {
    const out = transform(QWIK);
    expect(out).not.toMatch(/<Foo\.Bar\s+data-source-file/);
  });

  it('stamps a self-closing host element validly', () => {
    const out = transform('const A = () => <img src="/x.png" />;');
    expect(out).toMatch(/<img\s+data-source-file="src\/App\.tsx" data-source-line="1" data-selectable data-designless="annotate\/v1" src="\/x\.png" \/>/);
  });

  it('preserves Qwik $ syntax and other bytes around the splice', () => {
    const out = transform(QWIK);
    expect(out).toContain("component$(() => {");
    expect(out).toContain("import { component$ } from '@builder.io/qwik';");
  });

  it('preserves an author-authored data-selectable (passthrough, no clobber)', () => {
    const out = transform('const A = () => <div data-selectable="custom">hi</div>;');
    expect((out.match(/data-selectable/g) || []).length).toBe(1);
    expect(out).toContain('data-selectable="custom"');
    expect(out).toContain('data-source-file="src/App.tsx"');
  });

  it('is idempotent: an element already carrying data-source-file is left alone', () => {
    const src = 'const A = () => <div data-source-file="manual.tsx">hi</div>;';
    const out = transform(src);
    expect((out.match(/data-source-file/g) || []).length).toBe(1);
    expect(out).toBe(src);
  });

  it('handles a .jsx file (jsx plugin, no typescript)', () => {
    const out = transform('const A = () => <section>x</section>;', { filename: '/repo/src/App.jsx' });
    expect(out).toMatch(/<section\s+data-source-file="src\/App\.jsx"/);
  });
});

describe('the two hard rules', () => {
  it('PRODUCTION byte-identity: disabled output equals the input exactly', () => {
    const code = 'const A = () => <main><p>hello</p></main>;';
    const out = transform(code, { enabled: false });
    expect(out).toBe(code);
    expect(out).not.toContain('data-source-file');
  });

  it('LOUD no-op: a virtual/out-of-root file is skipped, not crashed', () => {
    const code = 'const A = () => <div>hi</div>;';
    expect(() => transform(code, { filename: '/elsewhere/v.tsx' })).not.toThrow();
    expect(transform(code, { filename: '/elsewhere/v.tsx' })).toBe(code);
  });

  it('LOUD no-op: a syntax error never throws (degrades to no markers)', () => {
    const code = 'const A = () => <div><span>oops';
    let out;
    expect(() => { out = transform(code); }).not.toThrow();
    expect(out).toBe(code);
  });

  it('returns undefined (no change) when there is nothing to stamp', () => {
    expect(annotateQwikSource('const x = 1;', { filename: '/repo/src/App.tsx', root: ROOT })).toBeUndefined();
    expect(annotateQwikSource('const A = () => <Foo.Bar />;', { filename: '/repo/src/App.tsx', root: ROOT })).toBeUndefined();
  });
});

describe('the Vite plugin wrapper', () => {
  it('is a pre-enforced plugin named for the package, with a transform', () => {
    const p = annotateQwikPlugin({ enabled: true, root: ROOT });
    expect(p.name).toBe('@designless/annotate');
    expect(p.enforce).toBe('pre');
    expect(typeof p.transform).toBe('function');
  });

  it('transforms only .tsx/.jsx ids and returns { code } with markers', () => {
    const p = annotateQwikPlugin({ enabled: true, root: ROOT });
    expect(p.transform('const A = () => <div>hi</div>;', '/repo/src/App.tsx').code).toContain('data-source-file="src/App.tsx"');
    expect(p.transform('const x = 1', '/repo/src/main.ts')).toBeNull();
  });
});
