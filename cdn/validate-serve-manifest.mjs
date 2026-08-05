#!/usr/bin/env node
/**
 * Validates cdn/serve/capabilities.v1.json before it is published.
 *
 * The manifest is generated rather than hand-written, so this exists to catch
 * an edit made in place. It checks four things:
 *
 *   1. schema and shape, so a truncated or half-written file fails here rather
 *      than degrading quietly once it is served;
 *   2. every entry declares the file to wire and both wiring forms, since an
 *      entry missing either cannot produce a snippet;
 *   3. no alias is claimed by two entries, because resolution takes the first
 *      match and a duplicate would make the winner depend on ordering;
 *   4. every wired file is justified by that entry's own detect rules, so an
 *      entry never names a path with no evidence the project has it.
 *
 * Exit 1 on any failure. Run: node cdn/validate-serve-manifest.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const path = join(here, 'serve', 'capabilities.v1.json');

const problems = [];
const fail = (m) => problems.push(m);

let doc;
try {
  doc = JSON.parse(readFileSync(path, 'utf8'));
} catch (err) {
  console.error(`serve manifest is not valid JSON: ${err.message}`);
  process.exit(1);
}

if (doc.schema !== 'designless-serve-capabilities/v1') {
  fail(`schema must be "designless-serve-capabilities/v1", got ${JSON.stringify(doc.schema)}`);
}
if (doc.version !== 'v1') fail(`version must be "v1", got ${JSON.stringify(doc.version)}`);
if (!doc.frameworks || typeof doc.frameworks !== 'object' || Array.isArray(doc.frameworks)) {
  console.error('serve manifest has no frameworks object; nothing else can be checked');
  process.exit(1);
}

const entries = Object.entries(doc.frameworks);
if (entries.length === 0) fail('frameworks is empty; a manifest that adds nothing should not be published');

const seenAlias = new Map();

for (const [key, e] of entries) {
  const at = `frameworks.${key}`;
  if (e.id !== key) fail(`${at}: id ${JSON.stringify(e.id)} does not match its key`);
  if (!e.label) fail(`${at}: label is required`);

  const wire = e.wire;
  if (!wire || typeof wire !== 'object') {
    fail(`${at}: wire is required; there is nothing to apply without it`);
    continue;
  }
  if (!wire.file) fail(`${at}: wire.file is required`);
  if (!wire.cssForm) fail(`${at}: wire.cssForm is required`);
  if (!wire.scriptForm) fail(`${at}: wire.scriptForm is required`);

  // Resolution takes the first match, so a duplicate token would make the
  // winner depend on key order.
  for (const token of [e.id, ...(e.aliases ?? [])]) {
    const t = String(token).toLowerCase();
    if (seenAlias.has(t)) fail(`token "${t}" is claimed by both ${seenAlias.get(t)} and ${key}`);
    seenAlias.set(t, key);
  }

  // A wired file is justified three ways and no others: it is a config file
  // detect looks for, it sits under a directory detect requires, or it is at
  // the project root, where there is nothing to locate.
  if (wire.file) {
    const d = e.detect ?? {};
    const viaConfig = (d.config ?? []).includes(wire.file);
    const viaDir = (d.dir ?? []).some((dir) => String(wire.file).startsWith(`${dir}/`));
    const viaRoot = !String(wire.file).includes('/');
    if (!viaConfig && !viaDir && !viaRoot) {
      fail(
        `${at}: wires "${wire.file}" with no detect evidence the project has it. ` +
          `Add it to detect.config, or declare its directory in detect.dir.`,
      );
    }
  }
}

// ── This file says only what it is for ──────────────────────────────────────
//
// Served from a CDN to anyone who asks. It carried a `note` for months whose
// last sentence promised the file held "no secrets, no engine details" —
// written to reassure, and doing the opposite, because telling a reader what a
// document withholds tells them something is withheld and roughly what shape
// it has.
//
// So this checks by ALLOWLIST, not by banned words. A banned-word list would
// have to name the things we consider internal, in a public file, which is the
// same mistake with more detail. An allowlist names only what is permitted and
// says nothing about what is not.
//
// Every string in this document is one of four things: the schema and version
// tags, a framework's own identifiers, a path or wiring token, or the note.
// The note is pinned verbatim, so any edit to it — for any reason, by anyone —
// has to be made here, in the open, on purpose.
//
// WHAT THIS DELIBERATELY DOES NOT CATCH, so nobody assumes it does. A short
// word inside a framework `label` has the same shape as a legitimate one:
// "Next.js (App Router)" and a label naming something internal are
// indistinguishable by structure, and the only way to tell them apart is to
// list the words that are internal — which is the thing this file must not do.
//
// That check exists, and it lives on the private side, where a word list is
// not itself a disclosure. It runs against the PUBLISHED file rather than this
// one, so it also catches a manifest edited anywhere other than here. Adding a
// framework entry is a reviewed pull request in a public repository, which is
// the other half of the answer.

const EXPECTED_NOTE =
  'Framework support for the Designless serve integration: which file a ' +
  'project wires the brand stylesheet into, and in what form. Served ' +
  'statically at https://cdn.designless.app/serve/capabilities.v1.json and ' +
  'fetched at resolve time, so support for a new framework arrives without ' +
  "a client release. A partial, absent or malformed copy of this file falls " +
  "back to the client's own defaults and never breaks resolution.";

if (doc.note !== EXPECTED_NOTE) {
  fail(
    'the note does not match the pinned text. It is the only prose this file ' +
      'carries and it is read by everyone who fetches it, so changing it is a ' +
      'deliberate edit here rather than a passing one there.',
  );
}

// `note` is the only place prose is allowed. A sentence anywhere else is a
// sentence nobody reviewed as customer-facing.
const PROSE = /[.!?]\s+[A-Za-z]|\b(because|therefore|internal|do not|note that)\b/i;
const walk = (node, at) => {
  if (typeof node === 'string') {
    if (PROSE.test(node)) {
      fail(`${at}: reads as prose. Only \`note\` carries sentences in this file.`);
    }
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (at === '' && k === 'note') continue;
      walk(v, at ? `${at}.${k}` : k);
    }
  }
};
walk(doc, '');

// The top level is closed. A key added here reaches every consumer, so it is
// added on purpose or not at all.
const ALLOWED_TOP_LEVEL = ['schema', 'version', 'note', 'frameworks'];
for (const k of Object.keys(doc)) {
  if (!ALLOWED_TOP_LEVEL.includes(k)) {
    fail(`unexpected top-level key "${k}". This document is served publicly; add keys deliberately.`);
  }
}

if (problems.length > 0) {
  console.error(`serve manifest invalid (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`serve manifest OK: ${entries.length} frameworks, ${seenAlias.size} unique tokens`);
