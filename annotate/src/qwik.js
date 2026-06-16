/**
 * @designless/annotate/qwik - the Qwik engine.
 *
 * Stamps annotate/v1 markers onto host JSX elements in Qwik `.tsx`/`.jsx`
 * components. Same contract as the other engines - it reads the marker shape
 * from ./contract so they can never diverge.
 *
 * Qwik's build runs its own optimizer (the `$`-aware Rust transform), so unlike
 * Vite-React we cannot just add a Babel pass: re-printing the code would risk
 * disturbing Qwik's optimizer markers. Instead this engine PARSES the source
 * with @babel/parser to locate host JSX elements, then SPLICES the marker
 * attributes into the original source text - it never regenerates code, so the
 * author's bytes (and Qwik's `$` syntax) are preserved exactly.
 *
 * Shipped as a Vite plugin (enforce: 'pre') wired into vite.config by the
 * initializer, so it runs before the Qwik Vite plugin. Dev-only
 * (gating.isEnabled); a pure pass-through in production (returns null ->
 * byte-identity); loud-no-op on any surprise - markers degrade to nothing, the
 * build never breaks.
 */

'use strict';

const { ATTR, isHostElement, toRepoRelative, markerAttributes } = require('./contract');
const { isEnabled, warnOnce } = require('./gating');
const { attributesToSource, applyInsertions } = require('./splice-markers');

/**
 * Walk a Babel AST, collecting a marker insertion for every unstamped host JSX
 * element. The opening element's tag-name node carries `.end` (the absolute
 * offset just after the tag name) - that is where the markers go. Defensive: an
 * unexpected node shape is skipped, never thrown.
 * @param {object} ast - @babel/parser File node
 * @param {string} rel - repo-relative POSIX path
 * @returns {Array<{offset:number, str:string}>}
 */
function collectInsertions(ast, rel) {
  const inserts = [];
  const stack = [ast];

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;

    if (node.type === 'JSXOpeningElement') maybeStamp(node, rel, inserts);

    // Generic child walk: descend into node-shaped values and arrays. `loc`,
    // `range`, etc. have no `.type` and are skipped, so there are no cycles.
    for (const key in node) {
      if (key === 'loc' || key === 'range' || key === 'extra') continue;
      const v = node[key];
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c === 'object' && typeof c.type === 'string') stack.push(c);
      } else if (v && typeof v === 'object' && typeof v.type === 'string') {
        stack.push(v);
      }
    }
  }

  return inserts;
}

/** Stamp a single JSXOpeningElement if it is an unmarked host element. */
function maybeStamp(node, rel, inserts) {
  const nameNode = node.name;
  // Only intrinsic host tags: a JSXIdentifier that is lowercase / a custom
  // element. JSXMemberExpression (Foo.Bar) and JSXNamespacedName (svg:use) are
  // not host tags (same rule as the Babel engine).
  if (!nameNode || nameNode.type !== 'JSXIdentifier' || !isHostElement(nameNode.name)) return;
  if (typeof nameNode.end !== 'number') return;

  const present = attributeNames(node);
  if (present.has(ATTR.FILE)) return; // idempotent

  const line = node.loc && node.loc.start ? node.loc.start.line : 0;
  const attrs = markerAttributes(rel, line);
  if (!attrs) return;

  const toAdd = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (present.has(name)) continue; // never clobber an author attribute
    toAdd[name] = value;
  }
  if (Object.keys(toAdd).length === 0) return;

  // Insert right after the tag name: `<div` -> after `div`.
  inserts.push({ offset: nameNode.end, str: attributesToSource(toAdd) });
}

/**
 * Names of the static JSX attributes already on an opening element. Spreads
 * ({...props}) are JSXSpreadAttribute with no literal name and are ignored.
 * @param {object} node
 * @returns {Set<string>}
 */
function attributeNames(node) {
  const names = new Set();
  const attrs = node.attributes;
  if (!Array.isArray(attrs)) return names;
  for (const a of attrs) {
    if (a && a.type === 'JSXAttribute' && a.name && a.name.type === 'JSXIdentifier' && typeof a.name.name === 'string') {
      names.add(a.name.name);
    }
  }
  return names;
}

/** Babel parser plugins for a given file extension. */
function pluginsFor(filename) {
  const f = typeof filename === 'string' ? filename.toLowerCase() : '';
  // .tsx needs both jsx + typescript; .jsx uses jsx alone (the typescript
  // plugin changes `<T>expr` disambiguation, which only matters in TS files).
  if (f.endsWith('.tsx') || f.endsWith('.ts')) return ['jsx', 'typescript'];
  return ['jsx'];
}

/**
 * Annotate one Qwik JSX/TSX source string. Returns the spliced source, or
 * undefined when there is nothing to do (disabled, unstampable file, no host
 * elements, a parse error, or any internal error - the loud-no-op rule). Used
 * by the Vite plugin below and exercised directly by the tests.
 * @param {string} content
 * @param {{ filename?: string, root?: string, enabled?: boolean }} [opts]
 * @returns {string|undefined}
 */
function annotateQwikSource(content, opts) {
  const options = opts || {};
  if (!isEnabled(options)) return undefined;

  try {
    let parser;
    try {
      parser = require('@babel/parser');
    } catch (e) {
      warnOnce('@babel/parser not resolvable - markers skipped (the build is unaffected): ' + (e && e.message));
      return undefined;
    }
    if (typeof parser.parse !== 'function') {
      warnOnce('@babel/parser has no parse() - markers skipped (the build is unaffected)');
      return undefined;
    }

    const root = options.root || process.cwd();
    const rel = toRepoRelative(root, options.filename || '');
    if (!rel) return undefined; // outside root / no filename - skip silently

    let ast;
    try {
      ast = parser.parse(content, {
        sourceType: 'module',
        allowReturnOutsideFunction: true,
        plugins: pluginsFor(options.filename),
      });
    } catch (e) {
      // A syntax error is the host toolchain's problem to report, not ours.
      warnOnce('could not parse a file (left unmarked, the build is unaffected): ' + (e && e.message));
      return undefined;
    }

    const inserts = collectInsertions(ast, rel);
    if (inserts.length === 0) return undefined;

    return applyInsertions(content, inserts);
  } catch (err) {
    warnOnce('skipped a file after an internal error: ' + (err && err.message));
    return undefined;
  }
}

/** Does this id name a JSX/TSX file we should consider? */
function isJsxId(filepath) {
  return /\.[jt]sx$/.test(filepath);
}

/**
 * The Qwik engine as a Vite plugin. `enforce: 'pre'` makes it run before the
 * Qwik Vite plugin, on the raw source.
 * @param {{ enabled?: boolean, root?: string }} [options]
 * @returns {object} a Vite plugin
 */
module.exports = function designlessAnnotateQwik(options) {
  const opts = options || {};
  let resolvedRoot = opts.root;
  return {
    name: '@designless/annotate',
    enforce: 'pre',
    configResolved(config) {
      if (!resolvedRoot && config && typeof config.root === 'string') resolvedRoot = config.root;
    },
    transform(code, id) {
      if (typeof id !== 'string') return null;
      // Only raw, queryless source modules - skip `?worker`/`?url`/virtual ids.
      if (id.indexOf('?') !== -1) return null;
      if (!isJsxId(id)) return null;
      const out = annotateQwikSource(code, {
        filename: id,
        root: resolvedRoot || process.cwd(),
        enabled: opts.enabled,
      });
      return out === undefined ? null : { code: out, map: null };
    },
  };
};

// Exposed for tests (and advanced users who want the raw transform).
module.exports.annotateQwikSource = annotateQwikSource;
