/**
 * @designless/dev-auth/guard - the default-branch absence detector.
 *
 * The dev-auth bypass is meant to live ONLY on a throwaway worktree branch and
 * be reverted before merge (see README "Safety model"). This is the machine
 * check a customer's CI runs on its default branch to PROVE the wiring never
 * landed: it scans source for an import/require of this package and reports any
 * offender. Pure over strings - no filesystem, no network - so the caller owns
 * the file walk (or uses the zero-dep `grep` snippet in the README).
 *
 * Fail-SAFE by design: it matches the package specifier in any quoted
 * import/require position, so a stray reference blocks the merge rather than
 * slipping through. A false positive costs a one-line revert; a false negative
 * costs a standing backdoor.
 */

'use strict';

// Matches a quoted module specifier for this package or any of its subpaths,
// e.g. '@designless/dev-auth', "@designless/dev-auth/express", or a
// template-literal `@designless/dev-auth` in a dynamic import()/require(). All
// three JS string delimiters are covered so template-literal wiring cannot
// evade the check. A bare prose mention (unquoted) does not match.
const SPECIFIER_PATTERN = /['"`]@designless\/dev-auth(?:\/[^'"`]*)?['"`]/;

/**
 * Does this source text wire in @designless/dev-auth? Pure.
 * @param {string} source
 * @returns {boolean}
 */
function detectDevAuthWiring(source) {
  return typeof source === 'string' && SPECIFIER_PATTERN.test(source);
}

/**
 * Given `[{ path, content }]`, return the paths that wire in the package. Empty
 * array = clean (safe to merge). Pure.
 * @param {Array<{ path: string, content: string }>} files
 * @returns {string[]}
 */
function findDevAuthWiring(files) {
  if (!Array.isArray(files)) return [];
  const hits = [];
  for (const f of files) {
    if (f && detectDevAuthWiring(f.content)) hits.push(f.path);
  }
  return hits;
}

module.exports = { SPECIFIER_PATTERN, detectDevAuthWiring, findDevAuthWiring };
