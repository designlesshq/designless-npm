/**
 * @designless/annotate/astro - the Astro engine.
 *
 * Stamps annotate/v1 markers onto host elements in `.astro` components. Same
 * contract as the other engines - it reads the marker shape from ./contract so
 * they can never diverge.
 *
 * An `.astro` file is frontmatter (`---` fenced JS) followed by an HTML-like
 * template. This engine parses it with @astrojs/compiler (whose parse() is
 * async and reports absolute source positions), walks the template for host
 * elements, and SPLICES the marker attributes into the original source text.
 * The author's bytes are otherwise preserved exactly.
 *
 * Shipped as an Astro INTEGRATION: the initializer adds it to astro.config's
 * `integrations` array, and on `astro:config:setup` it injects a Vite plugin
 * (enforce: 'pre') that runs before Astro compiles the `.astro` file. Dev-only
 * (gating.isEnabled); a pure pass-through in production (byte-identity);
 * loud-no-op on any surprise - markers degrade to nothing, the build never
 * breaks.
 */

'use strict';

const { ATTR, isHostElement, toRepoRelative, markerAttributes } = require('./contract');
const { isEnabled, warnOnce } = require('./gating');
const { attributesToSource, applyInsertions } = require('./splice-markers');

// Astro AST node types that carry a host/native tag name. 'element' is a native
// HTML element; 'custom-element' is a dash-named element. 'component'
// (Capitalized) is deliberately absent: its authorship site is the component,
// not the call site (same rule as every other engine).
const HOST_NODE_TYPES = new Set(['element', 'custom-element']);

/**
 * Collect a marker insertion for every unstamped host element in an Astro AST.
 * Positions are absolute in the source, so no base offset is needed. Defensive:
 * an unexpected node shape is skipped, never thrown.
 * @param {object} rootNode - the @astrojs/compiler AST root
 * @param {string} rel - repo-relative POSIX path
 * @returns {Array<{offset:number, str:string}>}
 */
function collectInsertions(rootNode, rel) {
  const inserts = [];
  const stack = [rootNode];

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;

    if (HOST_NODE_TYPES.has(node.type) && isHostElement(node.name)) {
      maybeStamp(node, rel, inserts);
    }

    if (Array.isArray(node.children)) for (const c of node.children) stack.push(c);
  }

  return inserts;
}

/** Stamp a single Astro host node if not already marked. */
function maybeStamp(node, rel, inserts) {
  const pos = node.position && node.position.start;
  if (!pos || typeof pos.offset !== 'number' || typeof node.name !== 'string') return;

  const present = attributeNames(node);
  if (present.has(ATTR.FILE)) return; // idempotent

  const line = typeof pos.line === 'number' && pos.line > 0 ? pos.line : 0;
  const attrs = markerAttributes(rel, line);
  if (!attrs) return;

  const toAdd = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (present.has(name)) continue; // never clobber an author attribute
    toAdd[name] = value;
  }
  if (Object.keys(toAdd).length === 0) return;

  // Insert right after the tag name in the opening tag: `<div` -> after `div`.
  const offset = pos.offset + 1 + node.name.length;
  inserts.push({ offset, str: attributesToSource(toAdd) });
}

/**
 * Names of the attributes already on an Astro element node. Astro attributes
 * are `{ kind, name, value }`; we collect those with a non-empty string name
 * (a spread `{...x}` has no literal name that could collide with our markers).
 * @param {object} node
 * @returns {Set<string>}
 */
function attributeNames(node) {
  const names = new Set();
  const attrs = node.attributes;
  if (!Array.isArray(attrs)) return names;
  for (const a of attrs) {
    if (a && typeof a.name === 'string' && a.name.length) names.add(a.name);
  }
  return names;
}

/**
 * Annotate one .astro source string. ASYNC (the Astro parser is async). Returns
 * the spliced source, or undefined when there is nothing to do (disabled,
 * unstampable file, no host elements, or any internal error - the loud-no-op
 * rule). Used by the Vite plugin below and exercised directly by the tests.
 * @param {string} content
 * @param {{ filename?: string, root?: string, enabled?: boolean }} [opts]
 * @returns {Promise<string|undefined>}
 */
async function annotateAstroSource(content, opts) {
  const options = opts || {};
  if (!isEnabled(options)) return undefined;

  try {
    let compiler;
    try {
      compiler = require('@astrojs/compiler');
    } catch (e) {
      warnOnce('@astrojs/compiler not resolvable - markers skipped (the build is unaffected): ' + (e && e.message));
      return undefined;
    }
    if (typeof compiler.parse !== 'function') {
      warnOnce('@astrojs/compiler has no parse() - markers skipped (the build is unaffected)');
      return undefined;
    }

    const root = options.root || process.cwd();
    const rel = toRepoRelative(root, options.filename || '');
    if (!rel) return undefined; // outside root / no filename - skip silently

    const result = await compiler.parse(content, { position: true });
    const ast = result && result.ast;
    if (!ast) {
      warnOnce('unrecognized Astro AST shape - markers skipped (the build is unaffected)');
      return undefined;
    }

    const inserts = collectInsertions(ast, rel);
    if (inserts.length === 0) return undefined;

    return applyInsertions(content, inserts);
  } catch (err) {
    warnOnce('skipped a .astro file after an internal error: ' + (err && err.message));
    return undefined;
  }
}

/**
 * The Vite plugin the integration injects. `enforce: 'pre'` makes it run before
 * Astro compiles the `.astro` file. Async transform (the parser is async).
 * @param {{ enabled?: boolean, root?: string }} [options]
 * @returns {object} a Vite plugin
 */
function makeVitePlugin(options) {
  const opts = options || {};
  let resolvedRoot = opts.root;
  return {
    name: '@designless/annotate',
    enforce: 'pre',
    configResolved(config) {
      if (!resolvedRoot && config && typeof config.root === 'string') resolvedRoot = config.root;
    },
    async transform(code, id) {
      if (typeof id !== 'string') return null;
      // Only the raw, queryless .astro module - never Astro's `?astro&type=...`
      // sub-requests (compiled fragments we must not touch).
      if (id.indexOf('?') !== -1) return null;
      if (!id.endsWith('.astro')) return null;
      const out = await annotateAstroSource(code, {
        filename: id,
        root: resolvedRoot || process.cwd(),
        enabled: opts.enabled,
      });
      return out === undefined ? null : { code: out, map: null };
    },
  };
}

/**
 * The Astro integration. Added to astro.config's `integrations` array by the
 * initializer; it injects the Vite plugin above on config setup.
 * @param {{ enabled?: boolean, root?: string }} [options]
 * @returns {object} an Astro integration
 */
module.exports = function designlessAnnotateAstro(options) {
  return {
    name: '@designless/annotate',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        try {
          updateConfig({ vite: { plugins: [makeVitePlugin(options)] } });
        } catch (e) {
          warnOnce('could not register the Vite plugin - markers skipped (the build is unaffected): ' + (e && e.message));
        }
      },
    },
  };
};

// Exposed for tests (and advanced users): the async core + the raw Vite plugin.
module.exports.annotateAstroSource = annotateAstroSource;
module.exports.vitePlugin = makeVitePlugin;
