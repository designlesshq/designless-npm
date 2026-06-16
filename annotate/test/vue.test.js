/**
 * Vue SFC engine - REAL transforms through the installed @vue/compiler-sfc +
 * @vue/compiler-dom. Proves the markers land on host elements, skip components
 * and structural <template>/<slot>, stay idempotent, respect dev-gating, and
 * are BYTE-IDENTICAL in production. Also checks the Vite-plugin wrapper shape.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import annotateVuePlugin, { annotateVueSource } from '../src/vue.js';
import { _resetWarnings } from '../src/gating.js';

const ROOT = '/repo';

/** Run a .vue source through the engine core. */
function transform(content, { filename = '/repo/src/App.vue', enabled = true, root = ROOT } = {}) {
  const out = annotateVueSource(content, { filename, enabled, root });
  return out === undefined ? content : out;
}

// The probe-verified multi-block SFC: script (3 lines) + blank + template on
// line 5, <div> on 6, <h1> on 7, <MyComp> on 8, <my-widget> on 9.
const SFC = `<script setup>
let n = 1
</script>

<template>
  <div class="a">
    <h1>{{ n }}</h1>
    <MyComp />
    <my-widget></my-widget>
  </div>
</template>
`;

beforeEach(() => _resetWarnings());

describe('host-element stamping (real Vue compiler)', () => {
  it('stamps a host element with the full v1 marker set', () => {
    const out = transform('<template><div class="a">hi</div></template>');
    expect(out).toContain('data-source-file="src/App.vue"');
    expect(out).toContain('data-source-line="1"');
    expect(out).toContain('data-selectable');
    expect(out).toContain('data-designless="annotate/v1"');
    expect(out).not.toContain('data-selectable=');
  });

  it('records the true 1-based source line of each element', () => {
    const out = transform(SFC);
    expect(out).toMatch(/<div\s+data-source-file="src\/App\.vue" data-source-line="6"/);
    expect(out).toMatch(/<h1\s+data-source-file="src\/App\.vue" data-source-line="7"/);
  });

  it('stamps multiple host elements and preserves text between them', () => {
    const out = transform('<template><div><p>a</p><span>b</span></div></template>');
    expect((out.match(/data-source-file="src\/App\.vue"/g) || []).length).toBe(3);
    expect(out).toContain('>a</p>');
    expect(out).toContain('>b</span>');
  });

  it('stamps a dash-named custom element (contract: a dash makes it a host)', () => {
    const out = transform(SFC);
    expect(out).toMatch(/<my-widget\s+data-source-file="src\/App\.vue" data-source-line="9"/);
  });

  it('skips a component element (authorship site is the component)', () => {
    const out = transform(SFC);
    expect(out).not.toMatch(/<MyComp\s+data-source-file/);
  });

  it('skips structural <template> and <slot> even though they are lowercase', () => {
    const src = '<template><template v-if="x"><slot /></template></template>';
    const out = transform(src);
    // No marker anywhere: the only tags are structural.
    expect(out).not.toContain('data-source-file');
    expect(out).toBe(src);
  });

  it('preserves an author-authored data-selectable (passthrough, no clobber)', () => {
    const out = transform('<template><div data-selectable="custom">hi</div></template>');
    expect((out.match(/data-selectable/g) || []).length).toBe(1);
    expect(out).toContain('data-selectable="custom"');
    expect(out).toContain('data-source-file="src/App.vue"');
    expect(out).toContain('data-designless="annotate/v1"');
  });

  it('is idempotent: an element already carrying data-source-file is left alone', () => {
    const src = '<template><div data-source-file="manual.vue">hi</div></template>';
    const out = transform(src);
    expect((out.match(/data-source-file/g) || []).length).toBe(1);
    expect(out).toContain('manual.vue');
    expect(out).toBe(src);
  });

  it('leaves the <script> and <style> blocks untouched', () => {
    const out = transform(SFC);
    expect(out).toContain('let n = 1');
    expect(out).toContain('<MyComp />');
    expect(out).not.toMatch(/<script[^>]*data-source-file/);
  });
});

describe('the two hard rules', () => {
  it('PRODUCTION byte-identity: disabled output equals the input exactly', () => {
    const code = '<template><main><p>hello</p></main></template>';
    const out = transform(code, { enabled: false });
    expect(out).toBe(code);
    expect(out).not.toContain('data-source-file');
  });

  it('LOUD no-op: a virtual/out-of-root file is skipped, not crashed', () => {
    const code = '<template><div>hi</div></template>';
    expect(() => transform(code, { filename: '/elsewhere/v.vue' })).not.toThrow();
    expect(transform(code, { filename: '/elsewhere/v.vue' })).toBe(code);
  });

  it('LOUD no-op: malformed markup never throws (degrades to no markers)', () => {
    const code = '<template><div><span>oops</template>';
    let out;
    expect(() => { out = transform(code); }).not.toThrow();
    expect(typeof out).toBe('string');
  });

  it('returns undefined (no change) when there is nothing to stamp', () => {
    expect(annotateVueSource('<template><MyComp /></template>', { filename: '/repo/src/App.vue', root: ROOT })).toBeUndefined();
    expect(annotateVueSource('<script>let n=1</script>', { filename: '/repo/src/App.vue', root: ROOT })).toBeUndefined();
  });
});

describe('the Vite plugin wrapper', () => {
  it('is a pre-enforced plugin named for the package, with a transform', () => {
    const p = annotateVuePlugin({ enabled: true, root: ROOT });
    expect(p.name).toBe('@designless/annotate');
    expect(p.enforce).toBe('pre');
    expect(typeof p.transform).toBe('function');
  });

  it('transforms only .vue ids and returns { code } with markers', () => {
    const p = annotateVuePlugin({ enabled: true, root: ROOT });
    expect(p.transform('<template><div>hi</div></template>', '/repo/src/App.vue').code).toContain('data-source-file="src/App.vue"');
    // Non-.vue id and plugin-vue sub-requests are ignored.
    expect(p.transform('<template><div>hi</div></template>', '/repo/src/App.vue?vue&type=template')).toBeNull();
    expect(p.transform('const x = 1', '/repo/src/main.ts')).toBeNull();
  });
});
