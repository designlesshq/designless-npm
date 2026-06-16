/**
 * @designless/annotate - shared source-splice helpers.
 *
 * The Vue, Astro, and Qwik engines all share one shape: their compiler family
 * does not let us rewrite an AST into code (the way Babel/SWC do), so each
 * PARSES to locate host elements, then SPLICES the marker attributes into the
 * original source text. The author's bytes are otherwise preserved exactly.
 *
 * This module holds the two pieces of that shape that are identical across the
 * three engines, so they cannot drift:
 *   - attributesToSource: render the contract's attribute map into tag-source.
 *   - applyInsertions: splice a set of (offset, string) inserts, in descending
 *     offset order, so each splice leaves earlier offsets valid.
 *
 * (The Svelte engine predates this util and keeps its own equivalents inline;
 * the marker SHAPE still comes from ./contract in every case, so they agree.)
 */

'use strict';

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
 * Apply a set of insertions to `content`. Each insertion is `{ offset, str }`:
 * `str` is inserted at `offset`. Applied in DESCENDING offset order so each
 * splice leaves every earlier offset valid. Returns the original string
 * unchanged when there is nothing to insert. Pure.
 * @param {string} content
 * @param {Array<{offset: number, str: string}>} insertions
 * @returns {string}
 */
function applyInsertions(content, insertions) {
  if (!Array.isArray(insertions) || insertions.length === 0) return content;
  const sorted = insertions.slice().sort((a, b) => b.offset - a.offset);
  let code = content;
  for (const { offset, str } of sorted) {
    if (typeof offset !== 'number' || offset < 0 || offset > code.length || !str) continue;
    code = code.slice(0, offset) + str + code.slice(offset);
  }
  return code;
}

module.exports = { attributesToSource, applyInsertions };
