/**
 * @designless/annotate/svelte - the Svelte preprocessor engine.
 *
 * Stamps annotate/v1 markers onto host elements in `.svelte` files for the
 * Svelte/SvelteKit toolchain. Same contract as the Babel (Vite-React) and SWC
 * (Next/Turbopack) engines - it reads the marker shape from ./contract so the
 * three engines can never diverge.
 *
 * Unlike Babel/SWC, a Svelte preprocessor does not rewrite an AST into code; it
 * returns a `{ code }` string. So this engine PARSES the markup to locate host
 * elements, then SPLICES the marker attributes into the original source text
 * (in descending offset order so earlier inserts don't shift later offsets).
 * The author's bytes are otherwise preserved exactly.
 *
 * Wired into a project's svelte.config.js `preprocess` array by the
 * initializer. Dev-only (gating.isEnabled); a pure pass-through in production
 * (returns undefined -> byte-identity); loud-no-op on any surprise (a missing
 * svelte/compiler peer, an unexpected AST shape) - markers degrade to nothing,
 * the build never breaks.
 *
 * Handles BOTH Svelte 4 and Svelte 5:
 *   - Svelte 4: parse(content) -> ast.html; host nodes are type 'Element'.
 *   - Svelte 5: parse(content, { modern: true }) -> ast.fragment; host nodes
 *     are type 'RegularElement'.
 */

'use strict';

const { ATTR, isHostElement, toRepoRelative, markerAttributes } = require('./contract');
const { isEnabled, warnOnce } = require('./gating');

// Element node types that carry a host/component tag name, across both AST
// shapes. 'Element' is Svelte 4; 'RegularElement' is the Svelte 5 modern AST.
// (Component/InlineComponent/Slot/etc. are deliberately absent: the contract's
// isHostElement also filters by name, but matching only these types keeps us
// from walking unrelated node kinds.)
const HOST_NODE_TYPES = new Set(['Element', 'RegularElement']);

/**
 * Render the contract's attribute map into source text to splice into an
 * opening tag, right after the tag name. A '' value (data-selectable) becomes a
 * bare presence attribute with no `=""`, matching how the contract represents
 * presence markers (and how the Babel engine emits them).
 * @param {{[attr:string]: string}} attrs
 * @returns {string}
 */
function attributesToSource(attrs) {
  let s = '';
  for (const [name, value] of Object.entries(attrs)) {
    s += value === '' ? ' ' + name : ' ' + name + '="' + value + '"';
  }
  return s;
}

/**
 * Walk a Svelte template AST, collecting a marker insertion for every
 * unstamped host element. Pure over (rootNode, content, rel). Defensive: an
 * unexpected node shape is skipped, never thrown.
 * @param {object} rootNode - ast.html (v4) or ast.fragment (v5)
 * @param {string} content - the original .svelte source
 * @param {string} rel - repo-relative POSIX path for this file
 * @returns {Array<{offset: number, str: string}>}
 */
function collectInsertions(rootNode, content, rel) {
  const inserts = [];
  const stack = [rootNode];

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;

    if (HOST_NODE_TYPES.has(node.type) && isHostElement(node.name)) {
      maybeStamp(node, content, rel, inserts);
    }

    // Descend into every child container both AST shapes use. `children` covers
    // Svelte 4; `fragment.nodes` covers Svelte 5 element bodies; `nodes` covers
    // a bare fragment.
    const kids = node.children
      || (node.fragment && node.fragment.nodes)
      || node.nodes;
    if (Array.isArray(kids)) {
      for (const child of kids) stack.push(child);
    }
  }

  return inserts;
}

/**
 * Decide whether a single host node gets stamped and, if so, push its
 * insertion. Idempotent (skips an element already carrying data-source-file)
 * and passthrough-safe (the contract's marker set never includes an attribute
 * the author already wrote, because we skip the whole element on a file marker;
 * for the other markers we re-check per-name below).
 */
function maybeStamp(node, content, rel, inserts) {
  if (typeof node.start !== 'number' || typeof node.name !== 'string') return;

  const present = attributeNames(node);
  // Idempotent: an existing data-source-file means this element was already
  // stamped (by a re-run or by the author). Leave it entirely alone.
  if (present.has(ATTR.FILE)) return;

  const line = countNewlines(content, node.start) + 1;
  const attrs = markerAttributes(rel, line);
  if (!attrs) return;

  // Never clobber an author-authored attribute (e.g. a hand-written
  // data-selectable): drop any marker whose name is already present.
  const toAdd = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (present.has(name)) continue;
    toAdd[name] = value;
  }
  if (Object.keys(toAdd).length === 0) return;

  // Insert right after the tag name in the opening tag: `<div` -> after `div`.
  const offset = node.start + 1 + node.name.length;
  inserts.push({ offset, str: attributesToSource(toAdd) });
}

/**
 * The set of attribute names already on a node, across both AST shapes. Svelte
 * 4 and 5 both expose `attributes` with `name` strings on plain Attribute
 * nodes; spreads/directives have no plain `name` and are ignored (they can't
 * collide with our literal marker names).
 * @param {object} node
 * @returns {Set<string>}
 */
function attributeNames(node) {
  const names = new Set();
  const attrs = node.attributes;
  if (!Array.isArray(attrs)) return names;
  for (const a of attrs) {
    if (a && a.type === 'Attribute' && typeof a.name === 'string') names.add(a.name);
  }
  return names;
}

/** Count '\n' in content[0, end). Pure. */
function countNewlines(content, end) {
  let n = 0;
  for (let i = 0; i < end; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) n++;
  }
  return n;
}

/**
 * Parse `.svelte` markup with whichever Svelte major is installed. Tries the
 * Svelte 5 modern AST first (ast.fragment); falls back to the Svelte 4 shape
 * (ast.html). Returns the template root node, or null if neither shape is
 * available (an unrecognized compiler).
 * @param {object} compiler - the lazily-required svelte/compiler module
 * @param {string} content
 * @param {string} filename
 * @returns {object|null}
 */
function parseTemplateRoot(compiler, content, filename) {
  // Svelte 5: the modern AST hangs the template off `.fragment`. The `modern`
  // flag is a no-op (or harmless) on Svelte 4, which has no `.fragment`.
  try {
    const ast = compiler.parse(content, { modern: true, filename });
    if (ast && ast.fragment) return ast.fragment;
    // Svelte 4 returns `.html` even when handed an options object.
    if (ast && ast.html) return ast.html;
  } catch {
    /* fall through to the plain Svelte 4 call */
  }
  // Svelte 4: plain parse -> `.html`.
  const ast = compiler.parse(content);
  if (ast && ast.fragment) return ast.fragment;
  if (ast && ast.html) return ast.html;
  return null;
}

/**
 * @param {{ enabled?: boolean, root?: string }} [options]
 * @returns {{ name: string, markup: Function }} a Svelte preprocessor
 */
module.exports = function designlessAnnotateSvelte(options) {
  return {
    name: '@designless/annotate',
    /**
     * @param {{ content: string, filename?: string }} input
     * @returns {{ code: string } | undefined}
     */
    markup({ content, filename }) {
      // Dev-gate: production / disabled -> no transform, byte-identical output.
      if (!isEnabled(options)) return undefined;

      try {
        // The Svelte compiler is a peer dependency we parse with but never
        // bundle. A missing/broken peer must not break the host build.
        let compiler;
        try {
          // eslint-disable-next-line global-require
          compiler = require('svelte/compiler');
        } catch (e) {
          warnOnce('svelte/compiler not resolvable - markers skipped (the build is unaffected): ' + (e && e.message));
          return undefined;
        }
        if (!compiler || typeof compiler.parse !== 'function') {
          warnOnce('svelte/compiler has no parse() - markers skipped (the build is unaffected)');
          return undefined;
        }

        const root = (options && options.root) || process.cwd();
        const rel = toRepoRelative(root, filename || '');
        // Unstampable file (outside root / no filename): skip silently. A
        // virtual or generated component legitimately has no repo path.
        if (!rel) return undefined;

        const templateRoot = parseTemplateRoot(compiler, content, filename);
        if (!templateRoot) {
          warnOnce('unrecognized Svelte AST shape - markers skipped (the build is unaffected)');
          return undefined;
        }

        const inserts = collectInsertions(templateRoot, content, rel);
        if (inserts.length === 0) return undefined;

        // Apply in DESCENDING offset order so each splice leaves earlier
        // offsets valid.
        inserts.sort((a, b) => b.offset - a.offset);
        let code = content;
        for (const { offset, str } of inserts) {
          code = code.slice(0, offset) + str + code.slice(offset);
        }
        return { code };
      } catch (err) {
        // The cardinal rule: a marker bug degrades to no markers (original
        // content used), never to a broken build.
        warnOnce('skipped a file after an internal error: ' + (err && err.message));
        return undefined;
      }
    },
  };
};
