/**
 * @designless/annotate/vue - the Vue SFC engine.
 *
 * Stamps annotate/v1 markers onto host elements in `.vue` Single File
 * Components. Same contract as the Babel (Vite-React), SWC (Next), and Svelte
 * engines - it reads the marker shape from ./contract so the engines can never
 * diverge.
 *
 * A Vue SFC is not pure markup: it has <script>/<style> blocks around the
 * <template>. So this engine uses @vue/compiler-sfc to ISOLATE the <template>
 * block, parses that block's markup with @vue/compiler-dom to locate host
 * elements (offsets relative to the block content), maps each back to its
 * absolute position in the file (block offset + content offset), and SPLICES
 * the marker attributes into the original source text. The author's bytes are
 * otherwise preserved exactly.
 *
 * Shipped as a Vite plugin (enforce: 'pre') wired into vite.config.js by the
 * initializer, so it runs before @vitejs/plugin-vue compiles the SFC. Dev-only
 * (gating.isEnabled); a pure pass-through in production (returns null ->
 * byte-identity); loud-no-op on any surprise (a missing compiler peer, an
 * unexpected AST shape) - markers degrade to nothing, the build never breaks.
 */

'use strict';

const { ATTR, isHostElement, toRepoRelative, markerAttributes } = require('./contract');
const { isEnabled, warnOnce } = require('./gating');
const { attributesToSource, applyInsertions } = require('./splice-markers');

// Vue AST node/element-type constants (NodeTypes.ELEMENT / ElementTypes.*).
// We never import them from Vue (they are not part of its public runtime API);
// the numeric values are stable across Vue 3.
const NODE_ELEMENT = 1; // NodeTypes.ELEMENT
const NODE_IF = 9; // NodeTypes.IF (has .branches)
const NODE_FOR = 11; // NodeTypes.FOR (has .children)
const EL_SLOT = 2; // ElementTypes.SLOT  (<slot>)  - structural, never stamped
const EL_TEMPLATE = 3; // ElementTypes.TEMPLATE (<template>) - structural, never stamped

/**
 * Collect a marker insertion for every unstamped host element under a Vue
 * template AST root. `base` is the absolute offset in the file where the parsed
 * content begins (so element offsets, which are relative to the content, map
 * back to the file). Defensive: an unexpected node shape is skipped, never
 * thrown.
 * @param {object} root - @vue/compiler-dom parse() result (the template content)
 * @param {string} fullSource - the entire .vue file
 * @param {number} base - absolute file offset of the parsed content's first char
 * @param {string} rel - repo-relative POSIX path
 * @returns {Array<{offset:number, str:string}>}
 */
function collectInsertions(root, fullSource, base, rel) {
  const inserts = [];
  const stack = [root];

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;

    if (node.type === NODE_ELEMENT) {
      maybeStamp(node, fullSource, base, rel, inserts);
    }

    // Descend into every child container Vue uses: element/root children, IF
    // branches (each branch carries its own children), FOR children.
    if (Array.isArray(node.children)) for (const c of node.children) stack.push(c);
    if (node.type === NODE_IF && Array.isArray(node.branches)) for (const b of node.branches) stack.push(b);
    if (node.type === NODE_FOR && node.children == null && node.branches) for (const b of node.branches) stack.push(b);
  }

  return inserts;
}

/**
 * Stamp a single Vue element node if it is a real host element and not already
 * marked. `<template>` and `<slot>` are structural (ElementTypes TEMPLATE/SLOT)
 * and never stamped even though their tag name is lowercase. A capitalized
 * component fails isHostElement; a dash-named custom element passes (contract).
 */
function maybeStamp(node, fullSource, base, rel, inserts) {
  if (typeof node.tag !== 'string' || !isHostElement(node.tag)) return;
  if (node.tagType === EL_SLOT || node.tagType === EL_TEMPLATE) return;
  if (!node.loc || !node.loc.start || typeof node.loc.start.offset !== 'number') return;

  const present = attributeNames(node);
  // Idempotent: an existing data-source-file means already stamped - leave it.
  if (present.has(ATTR.FILE)) return;

  const absStart = base + node.loc.start.offset; // '<' of the opening tag, in the file
  const line = countNewlines(fullSource, absStart) + 1;
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
  const offset = absStart + 1 + node.tag.length;
  inserts.push({ offset, str: attributesToSource(toAdd) });
}

/**
 * Names of the static attributes already on a Vue element node. Static
 * attributes are props of type 6 (NodeTypes.ATTRIBUTE) with a string `name`;
 * directives (v-bind etc., type 7) have no plain literal name that could
 * collide with our marker names and are ignored.
 * @param {object} node
 * @returns {Set<string>}
 */
function attributeNames(node) {
  const names = new Set();
  const props = node.props;
  if (!Array.isArray(props)) return names;
  for (const p of props) {
    if (p && p.type === 6 /* ATTRIBUTE */ && typeof p.name === 'string') names.add(p.name);
  }
  return names;
}

/** Count '\n' in content[0, end). Pure. */
function countNewlines(content, end) {
  let n = 0;
  for (let i = 0; i < end && i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) n++;
  }
  return n;
}

/**
 * Annotate one .vue source string. Returns the spliced source, or undefined
 * when there is nothing to do (disabled, unstampable file, no template, no host
 * elements, or any internal error - the loud-no-op rule). Used by the Vite
 * plugin below and exercised directly by the tests.
 * @param {string} content
 * @param {{ filename?: string, root?: string, enabled?: boolean }} [opts]
 * @returns {string|undefined}
 */
function annotateVueSource(content, opts) {
  const options = opts || {};
  if (!isEnabled(options)) return undefined;

  try {
    let sfc;
    try {
      sfc = require('@vue/compiler-sfc');
    } catch (e) {
      warnOnce('@vue/compiler-sfc not resolvable - markers skipped (the build is unaffected): ' + (e && e.message));
      return undefined;
    }
    let dom;
    try {
      dom = require('@vue/compiler-dom');
    } catch (e) {
      warnOnce('@vue/compiler-dom not resolvable - markers skipped (the build is unaffected): ' + (e && e.message));
      return undefined;
    }
    if (typeof sfc.parse !== 'function' || typeof (dom.parse || dom.baseParse) !== 'function') {
      warnOnce('Vue compiler missing parse() - markers skipped (the build is unaffected)');
      return undefined;
    }

    const root = options.root || process.cwd();
    const rel = toRepoRelative(root, options.filename || '');
    if (!rel) return undefined; // outside root / no filename - skip silently

    const { descriptor } = sfc.parse(content, { filename: options.filename || 'anonymous.vue' });
    const tpl = descriptor && descriptor.template;
    if (!tpl || typeof tpl.content !== 'string' || !tpl.loc || !tpl.loc.start) return undefined;

    // Parse ONLY the template block's markup; its node offsets are relative to
    // that content, so we add the block's absolute start offset to map back.
    const parseDom = dom.parse || dom.baseParse;
    const domRoot = parseDom(tpl.content);
    const inserts = collectInsertions(domRoot, content, tpl.loc.start.offset, rel);
    if (inserts.length === 0) return undefined;

    return applyInsertions(content, inserts);
  } catch (err) {
    warnOnce('skipped a .vue file after an internal error: ' + (err && err.message));
    return undefined;
  }
}

/**
 * The Vue engine as a Vite plugin. `enforce: 'pre'` makes it run before
 * @vitejs/plugin-vue, so it sees the raw .vue source. It transforms only the
 * top-level .vue module request (sub-requests like `App.vue?vue&type=template`
 * are emitted by plugin-vue afterwards and never end with `.vue`).
 * @param {{ enabled?: boolean, root?: string }} [options]
 * @returns {object} a Vite plugin
 */
module.exports = function designlessAnnotateVue(options) {
  const opts = options || {};
  let resolvedRoot = opts.root;
  return {
    name: '@designless/annotate',
    enforce: 'pre',
    configResolved(config) {
      // Capture the project root Vite resolved (absolute), unless forced.
      if (!resolvedRoot && config && typeof config.root === 'string') resolvedRoot = config.root;
    },
    transform(code, id) {
      if (typeof id !== 'string') return null;
      // Only the raw, queryless .vue module. plugin-vue's `?vue&type=...`
      // sub-requests are compiled fragments; annotating the main SFC is enough
      // (the markers flow into the compiled template).
      if (id.indexOf('?') !== -1) return null;
      if (!id.endsWith('.vue')) return null;
      const out = annotateVueSource(code, {
        filename: id,
        root: resolvedRoot || process.cwd(),
        enabled: opts.enabled,
      });
      // Returning null means "no change" -> Vite uses the original code.
      return out === undefined ? null : { code: out, map: null };
    },
  };
};

// Exposed for tests (and for advanced users who want the raw transform).
module.exports.annotateVueSource = annotateVueSource;
