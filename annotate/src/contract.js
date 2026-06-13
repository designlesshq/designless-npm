/**
 * @designless/annotate - the annotate/v1 marker contract.
 *
 * The single source of truth for the markers this package stamps, shared by
 * both engines (Babel for Vite-React, the SWC plugin for Next/Turbopack) and
 * read back by the Designless canvas. It is an interface, not an
 * implementation: it adds build-time source provenance to host elements so a
 * human selecting a rendered element can be routed to its exact source line.
 * It holds only attribute strings, no logic and no network calls, so the whole
 * package is verifiable with a single grep.
 *
 * The contract (frozen at v1):
 *   data-source-file  - repo-relative POSIX path of the JSX element's source
 *                       file. Never absolute, never containing '..'.
 *   data-source-line  - 1-based line of the element's opening tag.
 *   data-selectable   - presence marks the element as canvas-selectable. The
 *                       transform ADDS it to stamped host elements and PASSES
 *                       THROUGH any author-authored data-selectable untouched.
 *   data-designless   - the marker-contract version stamp ("annotate/v1"), so
 *                       a reader can tell which contract produced the markers.
 *
 * Only intrinsic HOST elements are stamped (lowercase JSX names: div, h1, p,
 * button). Components (Capitalized) and Fragments are skipped: their authorship
 * site is the component definition, not the call site. Elements with an
 * existing data-source-file are left untouched (idempotent; a nested transform
 * never double-stamps).
 */

'use strict';

const MARKER_VERSION = 'annotate/v1';

const ATTR = Object.freeze({
  FILE: 'data-source-file',
  LINE: 'data-source-line',
  SELECTABLE: 'data-selectable',
  VERSION: 'data-designless',
});

/**
 * Should this JSX element name be stamped? Host elements only: a non-empty
 * name whose first character is lowercase or is a custom-element name (contains
 * a hyphen, e.g. `my-widget`). Capitalized names are components; `null`/empty
 * is a Fragment. Pure.
 * @param {string|null|undefined} name
 * @returns {boolean}
 */
function isHostElement(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  // Member expressions (Foo.Bar) and namespaced (svg:use) are not host tags.
  if (name.includes('.')) return false;
  const first = name[0];
  // Lowercase intrinsic (div, h1) or custom element (has a dash).
  return (first >= 'a' && first <= 'z') || name.includes('-');
}

/**
 * Normalize an absolute file path to a repo-relative POSIX path. Returns null
 * when the result would escape the root (absolute or '..'-prefixed) - the
 * caller then SKIPS stamping that element rather than emit a marker the canvas
 * would reject. Pure (no fs); the caller supplies `root` and `filename`.
 * @param {string} root - project root (absolute)
 * @param {string} filename - source file (absolute)
 * @returns {string|null}
 */
function toRepoRelative(root, filename) {
  if (typeof root !== 'string' || typeof filename !== 'string' || !root || !filename) return null;
  // Minimal, dependency-free relativize: strip a leading root prefix.
  const r = root.replace(/[/\\]+$/, '');
  let rel;
  if (filename === r) return null;
  if (filename.startsWith(r + '/') || filename.startsWith(r + '\\')) {
    rel = filename.slice(r.length + 1);
  } else {
    // Outside the root - can't make a safe repo-relative path.
    return null;
  }
  rel = rel.replace(/\\/g, '/'); // POSIX
  if (rel.length === 0 || rel.startsWith('/') || rel.split('/').includes('..')) return null;
  return rel;
}

/**
 * The attribute set to stamp on a host element. Pure - the engines (Babel /
 * SWC) translate this into their own AST attribute nodes, so the exact marker
 * shape lives in exactly one place. Returns null when `relFile` is falsy
 * (unstampable) so the engine emits nothing.
 * @param {string|null} relFile - repo-relative POSIX path (from toRepoRelative)
 * @param {number} line - 1-based source line
 * @returns {{[attr:string]: string}|null}
 */
function markerAttributes(relFile, line) {
  if (!relFile || typeof relFile !== 'string') return null;
  const out = {};
  out[ATTR.FILE] = relFile;
  if (Number.isFinite(line) && line > 0) out[ATTR.LINE] = String(line);
  out[ATTR.SELECTABLE] = '';
  out[ATTR.VERSION] = MARKER_VERSION;
  return out;
}

module.exports = {
  MARKER_VERSION,
  ATTR,
  isHostElement,
  toRepoRelative,
  markerAttributes,
};
