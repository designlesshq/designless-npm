/**
 * Babel engine - real transforms through @babel/core. Proves the markers land
 * on host elements, skip components, stay idempotent, respect dev-gating, and
 * are BYTE-IDENTICAL in production.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as babel from '@babel/core';
import annotate from '../src/babel.js';
import { _resetWarnings } from '../src/gating.js';

const ROOT = '/repo';

function transform(code, { filename = '/repo/src/App.jsx', enabled = true } = {}) {
  return babel.transformSync(code, {
    root: ROOT,
    filename,
    configFile: false,
    babelrc: false,
    presets: [['@babel/preset-react', { runtime: 'classic' }]],
    plugins: [[annotate, { enabled }]],
  }).code;
}

beforeEach(() => _resetWarnings());

describe('host-element stamping', () => {
  it('stamps a host element with the full v1 marker set', () => {
    const out = transform('const x = <div className="a">hi</div>;');
    expect(out).toContain('"data-source-file": "src/App.jsx"');
    expect(out).toContain('"data-source-line": "1"');
    expect(out).toContain('"data-selectable"');
    expect(out).toContain('"data-designless": "annotate/v1"');
  });

  it('records the true source line of each element', () => {
    const out = transform('const a = (\n  <section>\n    <h1>t</h1>\n  </section>\n);');
    expect(out).toContain('"data-source-line": "2"'); // <section>
    expect(out).toContain('"data-source-line": "3"'); // <h1>
  });

  it('skips component elements (authorship site is the component, not the call)', () => {
    const out = transform('const x = <SkillCard skill={s} />;');
    expect(out).not.toContain('data-source-file');
  });

  it('preserves an author-authored data-selectable (passthrough, no clobber)', () => {
    const out = transform('const x = <div data-selectable="custom">hi</div>;');
    expect(out).toContain('"custom"');
    // file/line/version still added around it
    expect(out).toContain('"data-source-file": "src/App.jsx"');
  });

  it('is idempotent: an element already carrying data-source-file is left alone', () => {
    const out = transform('const x = <div data-source-file="manual.tsx">hi</div>;');
    expect((out.match(/data-source-file/g) || []).length).toBe(1);
    expect(out).toContain('manual.tsx');
  });
});

describe('the two hard rules', () => {
  it('PRODUCTION byte-identity: disabled output equals a no-plugin transform exactly', () => {
    const code = 'const x = <main><p>hello</p></main>;';
    const withDisabled = transform(code, { enabled: false });
    const noPlugin = babel.transformSync(code, {
      root: ROOT, filename: '/repo/src/App.jsx', configFile: false, babelrc: false,
      presets: [['@babel/preset-react', { runtime: 'classic' }]],
    }).code;
    expect(withDisabled).toBe(noPlugin);
    expect(withDisabled).not.toContain('data-source-file');
  });

  it('LOUD no-op: a virtual/out-of-root file is skipped, not crashed', () => {
    expect(() => transform('const x = <div>hi</div>;', { filename: '/elsewhere/v.jsx' }))
      .not.toThrow();
    const out = transform('const x = <div>hi</div>;', { filename: '/elsewhere/v.jsx' });
    expect(out).not.toContain('data-source-file');
  });

  it('never throws on a host element with no usable name shape', () => {
    expect(() => transform('const x = <div {...spread} />;')).not.toThrow();
  });
});
