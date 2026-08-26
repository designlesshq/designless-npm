/**
 * extract subcommand — the mechanical style-surface lift (thin by design:
 * collection only, judgment stays server-side). Fixture-based like
 * detect-matrix: the lifter is purely file-based, so faithful fixtures are
 * empirically equivalent to real scaffolds. Verified against two REAL repos on
 * 2026-08-24: a Next+Tailwind app (surface = tailwind-arbitrary + custom-prop
 * dominated) and a static HTML site (surface = css + custom-prop dominated) —
 * the two shapes these fixtures pin.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { extractSurface, runExtract, CONTRACT } from '../src/extract.js';

let root;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dl-extract-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules', 'junk'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.css'), [
    ':root { --brand: #FF6A00; --pad: 24px; }',
    '.hero { color: #111827; font-size: 48px; padding: 24px 32px; }',
    '.card { border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.1); display: flex; }',
  ].join('\n'));
  writeFileSync(join(root, 'src', 'Hero.tsx'), [
    'export const Hero = () => (',
    '  <div className="bg-[#0f172a] p-[13px] text-slate-400" style={{ color: "#fff", fontSize: "18px" }}>hi</div>',
    ');',
  ].join('\n'));
  writeFileSync(join(root, 'index.html'), [
    '<html><head><style>.x { margin: 12px; color: gray; }</style></head>',
    '<body><div style="padding: 9px; color: #222">y</div></body></html>',
  ].join('\n'));
  writeFileSync(join(root, 'tailwind.config.js'), 'module.exports = { theme: { colors: { brand: "#FF6A00" }, spacing: { lg: "24px" } } };');
  writeFileSync(join(root, 'node_modules', 'junk', 'x.css'), '.z { color: #bad; }');
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('extractSurface', () => {
  it('lifts every lane with file:line provenance and skips node_modules', () => {
    const s = extractSurface(root);
    expect(s.contract).toBe(CONTRACT);
    const lanes = new Set(s.entries.map((e) => e.lane));
    for (const lane of ['css', 'custom-prop', 'tailwind-arbitrary', 'tailwind-class', 'tailwind-config', 'jsx-inline']) {
      expect(lanes.has(lane), `${lane} missing`).toBe(true);
    }
    expect(s.entries.some((e) => e.file.includes('node_modules'))).toBe(false);
    for (const e of s.entries) {
      expect(typeof e.file).toBe('string');
      expect(e.line).toBeGreaterThan(0);
    }
  });

  it('custom-property declarations lift with their names (the palette home)', () => {
    const s = extractSurface(root);
    const brand = s.entries.find((e) => e.lane === 'custom-prop' && e.property === '--brand');
    expect(brand?.value).toBe('#FF6A00');
  });

  it('structural properties (display:flex) are NOT lifted — the allowlist is style-bearing only', () => {
    const s = extractSurface(root);
    expect(s.entries.some((e) => e.value === 'flex' && e.property === 'display')).toBe(false);
  });

  it('html <style> bodies AND inline style attributes lift as the css lane', () => {
    const s = extractSurface(root);
    const html = s.entries.filter((e) => e.file === 'index.html' && e.lane === 'css');
    expect(html.some((e) => e.property === 'margin' && e.value === '12px')).toBe(true);
    expect(html.some((e) => e.property === 'padding' && e.value === '9px')).toBe(true);
  });

  it('is deterministic: two runs produce identical surfaces', () => {
    expect(JSON.stringify(extractSurface(root))).toBe(JSON.stringify(extractSurface(root)));
  });
});

describe('runExtract', () => {
  it('writes .designless/style-surface.json with lane counts', () => {
    const s = runExtract(root);
    const p = join(root, '.designless', 'style-surface.json');
    expect(existsSync(p)).toBe(true);
    const onDisk = JSON.parse(readFileSync(p, 'utf8'));
    expect(onDisk.entry_count).toBe(s.entry_count);
    expect(onDisk.lanes['css']).toBeGreaterThan(0);
  });

  it('a second run does not re-lift its own output (.designless is skipped)', () => {
    const first = runExtract(root);
    const second = runExtract(root);
    expect(second.entry_count).toBe(first.entry_count);
  });
});

// ── Every utility in the attribute is lifted, not just the first ────────────
//
// The single-regex first cut anchored each match on `class=`; /g resumed past
// the opening quote, so the second and later utilities in the same attribute
// were invisible. The adopt e2e surfaced it: bg-red-950/30 hid behind
// text-red-300 in the same className.
describe('class lanes: whole-attribute scanning', () => {
  let root2;
  beforeAll(() => {
    root2 = mkdtempSync(join(tmpdir(), 'dl-extract-attr-'));
    writeFileSync(join(root2, 'a.tsx'),
      '<div className="flex text-red-300 bg-red-950/30 px-3 text-cyan-400 rounded" />');
    writeFileSync(join(root2, 'b.tsx'),
      '<h1 className="text-[44px] sm:text-[56px] leading-[1.1] max-w-[700px]" />');
    writeFileSync(join(root2, 'c.tsx'),
      '<div className="bg-gradient-to-r from-cyan-500 to-blue-600" />');
  });
  afterAll(() => { rmSync(root2, { recursive: true, force: true }); });

  it('lifts every palette class in one attribute, including /opacity modifiers', () => {
    const s = extractSurface(root2);
    const values = s.entries
      .filter((e) => e.lane === 'tailwind-class' && e.file === 'a.tsx')
      .map((e) => e.value).sort();
    expect(values).toEqual(['bg-red-950/30', 'text-cyan-400', 'text-red-300']);
  });

  it('lifts every arbitrary value in one attribute', () => {
    const s = extractSurface(root2);
    const values = s.entries
      .filter((e) => e.lane === 'tailwind-arbitrary' && e.file === 'b.tsx')
      .map((e) => e.value).sort();
    expect(values).toEqual(['1.1', '44px', '56px', '700px']);
  });

  it('gradient stop utilities (from/to/via) are palette classes too', () => {
    const s = extractSurface(root2);
    const values = s.entries
      .filter((e) => e.lane === 'tailwind-class' && e.file === 'c.tsx')
      .map((e) => e.value).sort();
    expect(values).toEqual(['from-cyan-500', 'to-blue-600']);
  });
});
