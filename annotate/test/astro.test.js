/**
 * Astro engine - REAL transforms through the installed @astrojs/compiler (whose
 * parse() is async). Proves the markers land on host + custom elements, skip
 * components, stay idempotent, respect dev-gating, and are BYTE-IDENTICAL in
 * production. Also checks the Astro-integration wrapper shape.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import annotateAstroIntegration, { annotateAstroSource, vitePlugin } from '../src/astro.js';
import { _resetWarnings } from '../src/gating.js';

const ROOT = '/repo';

/** Run a .astro source through the (async) engine core. */
async function transform(content, { filename = '/repo/src/Page.astro', enabled = true, root = ROOT } = {}) {
  const out = await annotateAstroSource(content, { filename, enabled, root });
  return out === undefined ? content : out;
}

// Frontmatter (3 lines) then template: <div> on line 4, <h1> on 5, <MyComp> on
// 6 (skip), <my-widget> on 7.
const PAGE = `---
const n = 1;
---
<div class="a">
  <h1>{n}</h1>
  <MyComp />
  <my-widget></my-widget>
</div>
`;

beforeEach(() => _resetWarnings());

describe('host-element stamping (real @astrojs/compiler)', () => {
  it('stamps a host element with the full v1 marker set', async () => {
    const out = await transform('<div class="a">hi</div>');
    expect(out).toContain('data-source-file="src/Page.astro"');
    expect(out).toContain('data-source-line="1"');
    expect(out).toContain('data-selectable');
    expect(out).toContain('data-designless="annotate/v1"');
    expect(out).not.toContain('data-selectable=');
  });

  it('records the true 1-based source line of each element', async () => {
    const out = await transform(PAGE);
    expect(out).toMatch(/<div\s+data-source-file="src\/Page\.astro" data-source-line="4"/);
    expect(out).toMatch(/<h1\s+data-source-file="src\/Page\.astro" data-source-line="5"/);
  });

  it('stamps a dash-named custom element, skips a component', async () => {
    const out = await transform(PAGE);
    expect(out).toMatch(/<my-widget\s+data-source-file="src\/Page\.astro" data-source-line="7"/);
    expect(out).not.toMatch(/<MyComp\s+data-source-file/);
  });

  it('stamps multiple host elements and preserves text between them', async () => {
    const out = await transform('<div><p>a</p><span>b</span></div>');
    expect((out.match(/data-source-file="src\/Page\.astro"/g) || []).length).toBe(3);
    expect(out).toContain('>a</p>');
    expect(out).toContain('>b</span>');
  });

  it('preserves an author-authored data-selectable (passthrough, no clobber)', async () => {
    const out = await transform('<div data-selectable="custom">hi</div>');
    expect((out.match(/data-selectable/g) || []).length).toBe(1);
    expect(out).toContain('data-selectable="custom"');
    expect(out).toContain('data-source-file="src/Page.astro"');
  });

  it('is idempotent: an element already carrying data-source-file is left alone', async () => {
    const src = '<div data-source-file="manual.astro">hi</div>';
    const out = await transform(src);
    expect((out.match(/data-source-file/g) || []).length).toBe(1);
    expect(out).toBe(src);
  });

  it('leaves the frontmatter untouched', async () => {
    const out = await transform(PAGE);
    expect(out).toContain('const n = 1;');
  });
});

describe('the two hard rules', () => {
  it('PRODUCTION byte-identity: disabled output equals the input exactly', async () => {
    const code = '<main><p>hello</p></main>';
    const out = await transform(code, { enabled: false });
    expect(out).toBe(code);
    expect(out).not.toContain('data-source-file');
  });

  it('LOUD no-op: a virtual/out-of-root file is skipped, not crashed', async () => {
    const code = '<div>hi</div>';
    await expect(transform(code, { filename: '/elsewhere/v.astro' })).resolves.toBe(code);
  });

  it('LOUD no-op: an internal error never throws (degrades to no markers)', async () => {
    // A non-string content can't be parsed; the engine must swallow it and
    // resolve to undefined rather than reject.
    await expect(annotateAstroSource(123, { filename: '/repo/src/Page.astro', root: ROOT })).resolves.toBeUndefined();
  });

  it('returns undefined (no change) when there is nothing to stamp', async () => {
    expect(await annotateAstroSource('<MyComp />', { filename: '/repo/src/Page.astro', root: ROOT })).toBeUndefined();
    expect(await annotateAstroSource('---\nconst n=1;\n---\n', { filename: '/repo/src/Page.astro', root: ROOT })).toBeUndefined();
  });
});

describe('the Astro integration wrapper', () => {
  it('is an integration named for the package with an astro:config:setup hook', () => {
    const integ = annotateAstroIntegration({ enabled: true, root: ROOT });
    expect(integ.name).toBe('@designless/annotate');
    expect(typeof integ.hooks['astro:config:setup']).toBe('function');
  });

  it('injects a pre-enforced Vite plugin via updateConfig', () => {
    const integ = annotateAstroIntegration({ enabled: true, root: ROOT });
    let injected = null;
    integ.hooks['astro:config:setup']({ updateConfig: (cfg) => { injected = cfg; } });
    const plugins = injected && injected.vite && injected.vite.plugins;
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins[0].name).toBe('@designless/annotate');
    expect(plugins[0].enforce).toBe('pre');
    expect(typeof plugins[0].transform).toBe('function');
  });

  it('the injected plugin transforms only .astro ids', async () => {
    const p = vitePlugin({ enabled: true, root: ROOT });
    const out = await p.transform('<div>hi</div>', '/repo/src/Page.astro');
    expect(out.code).toContain('data-source-file="src/Page.astro"');
    expect(await p.transform('<div>hi</div>', '/repo/src/main.ts')).toBeNull();
  });
});
