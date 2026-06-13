/**
 * @designless/annotate/babel - the Babel engine.
 *
 * Stamps annotate/v1 markers onto host JSX elements for the default
 * Vite-React (babel) toolchain. The Next/Turbopack target uses the SWC plugin
 * (../swc-plugin) instead - same contract, different compiler family. Both
 * read the marker shape from ./contract so the two engines can never diverge.
 *
 * Wrapped by the initializer into a project's Vite config as a
 * `@vitejs/plugin-react` babel plugin. Dev-only (gating.isEnabled); a pure
 * pass-through in production (byte-identity); loud-no-op on any surprise.
 */

'use strict';

const { ATTR, isHostElement, toRepoRelative, markerAttributes } = require('./contract');
const { isEnabled, warnOnce } = require('./gating');

/**
 * @param {object} babel - the @babel/core instance (provides `types`)
 * @param {{ enabled?: boolean }} [options]
 * @returns {object} a Babel visitor plugin
 */
module.exports = function designlessAnnotateBabel(babel, options) {
  const t = babel && babel.types;
  // No @babel/core types -> we cannot build attribute nodes. Loud no-op rather
  // than crash: return an empty visitor so the build proceeds unstamped.
  if (!t) {
    warnOnce('babel types unavailable - markers skipped (the build is unaffected)');
    return { name: '@designless/annotate', visitor: {} };
  }

  const enabled = isEnabled(options);

  return {
    name: '@designless/annotate',
    visitor: enabled ? {
      JSXOpeningElement(path, state) {
        try {
          const node = path.node;
          const nameNode = node.name;
          // Only intrinsic host tags (JSXIdentifier, lowercase / custom-element).
          if (!nameNode || nameNode.type !== 'JSXIdentifier' || !isHostElement(nameNode.name)) return;

          // Idempotent: never double-stamp (a re-run, or author-placed markers).
          const existing = new Set(
            node.attributes
              .filter((a) => a.type === 'JSXAttribute' && a.name && a.name.type === 'JSXIdentifier')
              .map((a) => a.name.name),
          );
          if (existing.has(ATTR.FILE)) return;

          const root = (state.file && state.file.opts && (state.file.opts.root || state.file.opts.cwd)) || '';
          const filename = (state.file && state.file.opts && state.file.opts.filename) || '';
          const rel = toRepoRelative(root, filename);
          // Unstampable file (outside root / no filename): skip silently - a
          // generated or virtual module legitimately has no repo path.
          if (!rel) return;

          const line = node.loc && node.loc.start ? node.loc.start.line : 0;
          const attrs = markerAttributes(rel, line);
          if (!attrs) return;

          for (const [name, value] of Object.entries(attrs)) {
            // Don't clobber an author-authored data-selectable (passthrough).
            if (existing.has(name)) continue;
            node.attributes.push(
              t.jsxAttribute(
                t.jsxIdentifier(name),
                value === '' ? null : t.stringLiteral(value),
              ),
            );
          }
        } catch (err) {
          // The cardinal rule: a marker bug degrades to no markers, never to a
          // broken build.
          warnOnce('skipped an element after an internal error: ' + (err && err.message));
        }
      },
    } : {
      // Production / disabled: NO visitor at all -> byte-identical output.
    },
  };
};
