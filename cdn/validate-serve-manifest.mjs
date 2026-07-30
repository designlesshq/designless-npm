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

if (problems.length > 0) {
  console.error(`serve manifest invalid (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`serve manifest OK: ${entries.length} frameworks, ${seenAlias.size} unique tokens`);
