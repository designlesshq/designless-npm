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
 *
 * Detection order is deliberate. Some frameworks own a UNIQUE config file
 * (next.config, astro.config, svelte.config) - that is the strongest, least
 * ambiguous signal, so it is checked first. The Vite family (Vite-React, Vue,
 * Qwik) all share `vite.config`, so a config hit there can't tell them apart;
 * the DEPENDENCY is the disambiguator (a Vue/Qwik project also carries `vite`,
 * never the reverse), so deps are checked next, most-specific framework first,
 * with plain Vite-React as the fallback. `vite.config` alone (no framework dep)
 * falls back to Vite-React last.
 */
function classifyFramework(capabilities, facts) {
  const deps = facts && facts.deps instanceof Set ? facts.deps : new Set();
  const files = facts && facts.files instanceof Set ? facts.files : new Set();

  const hitConfig = (key) => {
    const e = capabilities[key];
    return e && e.detect && (e.detect.config || []).some((f) => files.has(f)) ? { entry: e, via: 'config' } : null;
  };
  const hitDep = (key) => {
    const e = capabilities[key];
    return e && e.detect && (e.detect.dep || []).some((d) => deps.has(d)) ? { entry: e, via: 'dep' } : null;
  };

  // 1. Frameworks with a unique config file (unambiguous, the strongest signal).
  for (const key of ['next', 'astro', 'svelte']) {
    const hit = hitConfig(key);
    if (hit) return hit;
  }
  // 2. A framework-SPECIFIC dependency - every framework except plain
  //    Vite-React, whose `vite`/@vitejs/plugin-react dep is too generic to
  //    outrank a real config file. This is the only way to tell Vue/Qwik apart
  //    on a shared vite.config; Next/Astro/Svelte by dep are a backstop for when
  //    their config file is absent.
  for (const key of ['next', 'astro', 'svelte', 'vue', 'qwik']) {
    const hit = hitDep(key);
    if (hit) return hit;
  }
  // 3. The shared vite.config -> Vite-React (a real config beats a bare dep).
  const viteByConfig = hitConfig('vite');
  if (viteByConfig) return viteByConfig;
  // 4. A bare Vite dependency with no config file.
  return hitDep('vite');
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
