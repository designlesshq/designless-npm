/**
 * SWC engine - REAL transforms through @swc/core running the compiled wasm
 * plugin. This is the live-verify gate for the Next/Turbopack engine: a wasm
 * blob that compiles but isn't proven to stamp is unproven. Skips (with a loud
 * note) when the wasm artifact hasn't been built, so `npm test` is green on a
 * fresh checkout before `npm run build:swc`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const WASM = path.resolve(DIR, '../swc-plugin/annotate.wasm');
const ROOT = path.resolve(DIR, '..');

let swc;
try { swc = (await import('@swc/core')).default ?? (await import('@swc/core')); } catch { swc = null; }

const wasmBuilt = fs.existsSync(WASM);
const run = wasmBuilt && swc ? describe : describe.skip;
if (!wasmBuilt) console.warn('[swc.test] swc-plugin/annotate.wasm not built - run `npm run build:swc`. Skipping SWC transform tests.');

function transform(code, { filename = 'src/App.tsx', root = ROOT } = {}) {
  return swc.transformSync(code, {
    filename,
    jsc: {
      parser: { syntax: 'typescript', tsx: true },
      target: 'es2022',
      experimental: { plugins: [[WASM, { root }]] },
    },
  }).code;
}

run('SWC wasm plugin - annotate/v1 stamping (the Next/Turbopack engine)', () => {
  it('stamps a host element with the full v1 marker set', () => {
    const out = transform('const x = <div className="a">hi</div>;');
    expect(out).toContain('data-source-file');
    expect(out).toContain('src/App.tsx');
    expect(out).toContain('data-selectable');
    expect(out).toContain('annotate/v1');
  });

  it('records the true source line of each element', () => {
    const out = transform('const a = (\n  <section>\n    <h1>t</h1>\n  </section>\n);');
    expect(out).toMatch(/data-source-line"?\s*[:=]\s*"2"/); // <section> on line 2
    expect(out).toMatch(/data-source-line"?\s*[:=]\s*"3"/); // <h1> on line 3
  });

  it('skips component elements', () => {
    const out = transform('const x = <SkillCard skill={s} />;');
    expect(out).not.toContain('data-source-file');
  });

  it('is idempotent - an element with an existing data-source-file is untouched', () => {
    const out = transform('const x = <div data-source-file="manual.tsx">hi</div>;');
    expect((out.match(/data-source-file/g) || []).length).toBe(1);
    expect(out).toContain('manual.tsx');
  });

  it('matches the Babel engine\'s repo-relative path shape (cross-engine parity)', () => {
    const out = transform('const x = <p>hi</p>;', { filename: path.join(ROOT, 'app/about/page.tsx') });
    expect(out).toContain('app/about/page.tsx');
    expect(out).not.toContain(ROOT); // never absolute
  });

  it('refuses an out-of-root file (no marker rather than an unsafe path)', () => {
    const out = transform('const x = <p>hi</p>;', { filename: '/etc/evil.tsx', root: ROOT });
    expect(out).not.toContain('data-source-file');
  });
});
