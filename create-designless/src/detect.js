/**
 * create-designless - framework detection.
 *
 * The initializer takes the framework as a positional arg. When omitted, we
 * detect it from the project so a bare `npm create designless@latest` still
 * works. Detection reads only two facts:
 * the project's package.json dependencies and which config files exist - both
 * cheap, deterministic, and offline.
 *
 * `classifyFramework` is PURE over an injected facts object (unit-tested);
 * `detectFramework` is the thin fs reader that gathers the facts.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @param {object} capabilities - from capabilities.js
 * @param {{ deps: Set<string>, files: Set<string> }} facts
 * @returns {{ entry: object, via: 'dep'|'config' }|null}
 */
function classifyFramework(capabilities, facts) {
  const deps = facts && facts.deps instanceof Set ? facts.deps : new Set();
  const files = facts && facts.files instanceof Set ? facts.files : new Set();
  // A config-file hit is the strongest signal (a real project of that
  // framework), then a dependency hit. Check Next before Vite: a Next project
  // can carry vite-ish transitive deps, never the reverse config file.
  const order = ['next', 'vite'];
  for (const key of order) {
    const entry = capabilities[key];
    if (!entry || !entry.detect) continue;
    if ((entry.detect.config || []).some((f) => files.has(f))) return { entry, via: 'config' };
  }
  for (const key of order) {
    const entry = capabilities[key];
    if (!entry || !entry.detect) continue;
    if ((entry.detect.dep || []).some((d) => deps.has(d))) return { entry, via: 'dep' };
  }
  return null;
}

/** Read package.json dependency names (all dependency buckets). */
function readDeps(projectDir) {
  const out = new Set();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    for (const bucket of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (pkg[bucket] && typeof pkg[bucket] === 'object') for (const name of Object.keys(pkg[bucket])) out.add(name);
    }
  } catch { /* no package.json / unreadable -> empty */ }
  return out;
}

/** Which known config files exist in the project root. */
function readConfigFiles(capabilities, projectDir) {
  const out = new Set();
  const candidates = new Set();
  for (const entry of Object.values(capabilities)) for (const f of (entry.detect && entry.detect.config) || []) candidates.add(f);
  for (const f of candidates) {
    try { if (fs.existsSync(path.join(projectDir, f))) out.add(f); } catch { /* ignore */ }
  }
  return out;
}

/**
 * Detect the framework of a project on disk. Returns the capability entry +
 * how it was found, or null. Never throws.
 */
function detectFramework(capabilities, projectDir) {
  const facts = { deps: readDeps(projectDir), files: readConfigFiles(capabilities, projectDir) };
  return classifyFramework(capabilities, facts);
}

module.exports = { classifyFramework, detectFramework, readDeps, readConfigFiles };
