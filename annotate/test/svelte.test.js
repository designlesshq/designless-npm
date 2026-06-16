/**
 * Svelte preprocessor engine - REAL transforms through the installed
 * svelte/compiler. Proves the markers land on host elements, skip components,
 * stay idempotent, respect dev-gating, and are BYTE-IDENTICAL in production.
 *
 * The installed svelte is v5 (modern AST: ast.fragment, host nodes
 * 'RegularElement'); those tests run against the real compiler. A crafted
 * Svelte-4-shaped AST (ast.html, host nodes 'Element') covers the v4 walk path
 * directly, so both majors are exercised without a second install.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import annotate from '../src/svelte.js';
import { _resetWarnings } from '../src/gating.js';

const ROOT = '/repo';

/** Run a .svelte source through the preprocessor's markup() hook. */
function transform(content, { filename = '/repo/src/App.svelte', enabled = true, root = ROOT } = {}) {
  const pre = annotate({ enabled, root });
  const out = pre.markup({ content, filename });
  // markup() returns undefined for "no transform"; callers then use `content`.
  return out === undefined ? content : out.code;
}

beforeEach(() => _resetWarnings());

describe('host-element stamping (real svelte/compiler, v5 path)', () => {
  it('stamps a host element with the full v1 marker set', () => {
    const out = transform('<div class="a">hi</div>');
    expect(out).toContain('data-source-file="src/App.svelte"');
    expect(out).toContain('data-source-line="1"');
    expect(out).toContain('data-selectable');
    expect(out).toContain('data-designless="annotate/v1"');
    // data-selectable is a bare presence attribute (no ="").
    expect(out).not.toContain('data-selectable=');
  });

  it('records the true 1-based source line of each element', () => {
    const out = transform('<section>\n  <h1>t</h1>\n</section>');
    // <section> opens on line 1, <h1> on line 2.
    expect(out).toMatch(/<section\s+data-source-file="src\/App\.svelte" data-source-line="1"/);
    expect(out).toMatch(/<h1\s+data-source-file="src\/App\.svelte" data-source-line="2"/);
  });

  it('stamps multiple host elements (descending-offset splice keeps offsets valid)', () => {
    const out = transform('<div><p>a</p><span>b</span></div>');
    expect((out.match(/data-source-file="src\/App\.svelte"/g) || []).length).toBe(3);
    // Original text between/around tags is preserved.
    expect(out).toContain('>a</p>');
    expect(out).toContain('>b</span>');
  });

  it('stamps a custom element (name with a dash is a host element)', () => {
    const out = transform('<my-widget></my-widget>');
    expect(out).toContain('data-source-file="src/App.svelte"');
    expect(out).toMatch(/<my-widget\s+data-source-file=/);
  });

  it('stamps an anchor and a button (ordinary host tags)', () => {
    const out = transform('<a href="/x">go</a>\n<button>ok</button>');
    expect(out).toMatch(/<a\s+data-source-file="src\/App\.svelte" data-source-line="1"/);
    expect(out).toMatch(/<button\s+data-source-file="src\/App\.svelte" data-source-line="2"/);
  });

  it('skips component elements (authorship site is the component, not the call)', () => {
    const out = transform('<SkillCard skill={s} />');
    expect(out).not.toContain('data-source-file');
    // byte-identical: nothing to stamp -> original returned.
    expect(out).toBe('<SkillCard skill={s} />');
  });

  it('preserves an author-authored data-selectable (passthrough, no clobber)', () => {
    const out = transform('<div data-selectable="custom">hi</div>');
    // author value kept exactly once...
    expect((out.match(/data-selectable/g) || []).length).toBe(1);
    expect(out).toContain('data-selectable="custom"');
    // ...and file/line/version still added around it.
    expect(out).toContain('data-source-file="src/App.svelte"');
    expect(out).toContain('data-designless="annotate/v1"');
  });

  it('is idempotent: an element already carrying data-source-file is left alone', () => {
    const src = '<div data-source-file="manual.svelte">hi</div>';
    const out = transform(src);
    expect((out.match(/data-source-file/g) || []).length).toBe(1);
    expect(out).toContain('manual.svelte');
    expect(out).toBe(src); // untouched
  });

  it('a real file with a script block stamps only the host markup', () => {
    const src = '<script>\n  let n = 1;\n</script>\n\n<div>\n  <h1>{n}</h1>\n  <Counter />\n</div>';
    const out = transform(src);
    // <div> on line 5, <h1> on line 6.
    expect(out).toMatch(/<div\s+data-source-file="src\/App\.svelte" data-source-line="5"/);
    expect(out).toMatch(/<h1\s+data-source-file="src\/App\.svelte" data-source-line="6"/);
    // Component untouched; script untouched.
    expect(out).toContain('<Counter />');
    expect(out).toContain('let n = 1;');
    expect(out).not.toMatch(/<Counter\s+data-source-file/);
  });
});

describe('the two hard rules', () => {
  it('PRODUCTION byte-identity: disabled output equals the input exactly', () => {
    const code = '<main><p>hello</p></main>';
    const out = transform(code, { enabled: false });
    expect(out).toBe(code);
    expect(out).not.toContain('data-source-file');
  });

  it('LOUD no-op: a virtual/out-of-root file is skipped, not crashed', () => {
    const code = '<div>hi</div>';
    expect(() => transform(code, { filename: '/elsewhere/v.svelte' })).not.toThrow();
    const out = transform(code, { filename: '/elsewhere/v.svelte' });
    expect(out).toBe(code);
    expect(out).not.toContain('data-source-file');
  });

  it('LOUD no-op: malformed markup never throws (degrades to no markers)', () => {
    // Unclosed tag - the compiler throws; the engine must swallow it.
    const code = '<div><span>oops';
    let out;
    expect(() => { out = transform(code); }).not.toThrow();
    expect(out).toBe(code);
  });

  it('returns undefined (no { code }) when there is nothing to stamp', () => {
    const pre = annotate({ enabled: true, root: ROOT });
    expect(pre.markup({ content: 'plain text, no elements', filename: '/repo/src/App.svelte' })).toBeUndefined();
    expect(pre.markup({ content: '<Comp />', filename: '/repo/src/App.svelte' })).toBeUndefined();
  });

  it('exposes the preprocessor name for svelte.config wiring', () => {
    expect(annotate({}).name).toBe('@designless/annotate');
  });
});

/**
 * Svelte 4 shape coverage. v4's parse() yields `ast.html` with host nodes typed
 * 'Element' (vs v5's `ast.fragment` + 'RegularElement'). We feed the engine a
 * fake svelte/compiler whose parse() returns a v4-shaped AST, exercising the
 * other branch of parseTemplateRoot + the 'Element' type in the walker.
 */
describe('Svelte 4 AST shape (ast.html / type "Element")', () => {
  // Build a minimal v4-shaped AST for `<div class="a">hi</div>` (offsets exact).
  function v4Ast() {
    const content = '<div class="a">hi</div>';
    return {
      html: {
        type: 'Fragment',
        children: [
          {
            type: 'Element',
            name: 'div',
            start: 0,
            attributes: [{ type: 'Attribute', name: 'class', start: 5 }],
            children: [{ type: 'Text', data: 'hi', start: 15 }],
          },
        ],
      },
    };
  }

  it('walks the v4 shape and stamps the host element', () => {
    // Patch require('svelte/compiler') via the module cache so the engine sees
    // our v4 parser. We require the real id first to capture/restore it.
    const Module = require('module');
    const orig = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === 'svelte/compiler') return { parse: () => v4Ast() };
      return orig.apply(this, arguments);
    };
    try {
      _resetWarnings();
      const out = transform('<div class="a">hi</div>');
      expect(out).toContain('data-source-file="src/App.svelte"');
      expect(out).toContain('data-source-line="1"');
      expect(out).toContain('data-selectable');
      expect(out).toContain('data-designless="annotate/v1"');
      // Inserted right after the tag name, before the author's class attr.
      expect(out).toMatch(/^<div data-source-file="src\/App\.svelte" data-source-line="1" data-selectable data-designless="annotate\/v1" class="a">/);
    } finally {
      Module._load = orig;
    }
  });
});
