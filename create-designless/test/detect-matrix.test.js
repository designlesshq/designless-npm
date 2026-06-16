/**
 * Detection test matrix — the GA gate for the Phase-5 decision-#8 detection
 * split ("the agent detects the framework from repo files; the server decides
 * the command"). The existing initializer.test.js covers `classifyFramework`
 * over INJECTED facts; this exercises the real `detectFramework` over actual
 * on-disk project layouts.
 *
 * Why fixtures rather than real `create-next-app`/`create-vite` installs: the
 * detector is PURELY file-based — it reads only package.json dependency names
 * and which config files exist. It never runs the framework or its bundler, so
 * a faithful fixture (real config filenames, real dep names, real monorepo
 * nesting) is empirically equivalent to a real scaffold FOR DETECTION, at a
 * fraction of the cost. Runtime behaviour (does the plugin actually stamp under
 * Turbopack) is covered separately by the real-Next CI job.
 *
 * Axes: framework (next/vite/svelte/vue/astro/qwik) × config-file variant
 * (.js/.mjs/.ts) × signal (config-hit vs dep-only) × dependency bucket ×
 * monorepo nesting × precedence (next-before-vite, config-beats-dep,
 * vue/qwik-dep-disambiguates-the-shared-vite.config) × negatives (fail-open to
 * null).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectFramework, readDeps, readConfigFiles } from '../src/detect.js';
import { BASELINE } from '../src/capabilities.js';

const roots = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

/** Create a throwaway project dir. `pkg`: object → JSON, string → written raw,
 *  undefined → no package.json. `files`: config files to touch (empty). */
function project({ pkg, files = [] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'dl-detect-'));
  roots.push(root);
  if (pkg !== undefined) writeFileSync(path.join(root, 'package.json'), typeof pkg === 'string' ? pkg : JSON.stringify(pkg));
  for (const f of files) writeFileSync(path.join(root, f), '');
  return root;
}

/** A monorepo workspace: a package dir nested under a workspace root (the root
 *  package.json carries no framework dep). Returns the PACKAGE dir to detect in. */
function monorepoPackage({ pkg, files = [] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'dl-mono-'));
  roots.push(root);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['apps/*'] }));
  const pkgDir = path.join(root, 'apps', 'web');
  mkdirSync(pkgDir, { recursive: true });
  if (pkg !== undefined) writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(pkg));
  for (const f of files) writeFileSync(path.join(pkgDir, f), '');
  return pkgDir;
}

const detect = (dir) => detectFramework(BASELINE, dir);

describe('detection matrix · framework × config-file variant (config-hit)', () => {
  for (const cfg of ['next.config.js', 'next.config.mjs', 'next.config.ts']) {
    it(`Next via ${cfg} → next / config`, () => {
      const r = detect(project({ pkg: { dependencies: { next: '^16' } }, files: [cfg] }));
      expect(r?.entry.id).toBe('next');
      expect(r?.via).toBe('config');
    });
  }
  for (const cfg of ['vite.config.js', 'vite.config.ts', 'vite.config.mjs']) {
    it(`Vite via ${cfg} → vite / config`, () => {
      const r = detect(project({ pkg: { devDependencies: { vite: '^5', '@vitejs/plugin-react': '^4' } }, files: [cfg] }));
      expect(r?.entry.id).toBe('vite');
      expect(r?.via).toBe('config');
    });
  }
});

describe('detection matrix · Svelte / Vue / Astro / Qwik (real on-disk fixtures)', () => {
  it('Svelte via svelte.config.js → svelte / config', () => {
    const r = detect(project({ pkg: { devDependencies: { svelte: '^5', '@sveltejs/kit': '^2' } }, files: ['svelte.config.js'] }));
    expect(r?.entry.id).toBe('svelte');
    expect(r?.via).toBe('config');
  });
  it('Astro via astro.config.mjs → astro / config', () => {
    const r = detect(project({ pkg: { dependencies: { astro: '^4' } }, files: ['astro.config.mjs'] }));
    expect(r?.entry.id).toBe('astro');
    expect(r?.via).toBe('config');
  });
  it('Vue on a shared vite.config is disambiguated by its dependency → vue / dep', () => {
    const r = detect(project({ pkg: { dependencies: { vue: '^3' }, devDependencies: { vite: '^5', '@vitejs/plugin-vue': '^5' } }, files: ['vite.config.ts'] }));
    expect(r?.entry.id).toBe('vue');
    expect(r?.via).toBe('dep');
  });
  it('Qwik on a shared vite.config is disambiguated by its dependency → qwik / dep', () => {
    const r = detect(project({ pkg: { devDependencies: { '@builder.io/qwik': '^1', vite: '^5' } }, files: ['vite.config.ts'] }));
    expect(r?.entry.id).toBe('qwik');
    expect(r?.via).toBe('dep');
  });
  it('Vite-React keeps the shared vite.config when no framework dep is present → vite / config', () => {
    const r = detect(project({ pkg: { devDependencies: { vite: '^5', '@vitejs/plugin-react': '^4' } }, files: ['vite.config.ts'] }));
    expect(r?.entry.id).toBe('vite');
    expect(r?.via).toBe('config');
  });
});

describe('detection matrix · dependency-only (no config file)', () => {
  it('Next via the "next" dependency → next / dep', () => {
    const r = detect(project({ pkg: { dependencies: { next: '^16', react: '^19' } } }));
    expect(r?.entry.id).toBe('next');
    expect(r?.via).toBe('dep');
  });
  it('Vite via the "vite" dependency → vite / dep', () => {
    const r = detect(project({ pkg: { devDependencies: { vite: '^5' } } }));
    expect(r?.entry.id).toBe('vite');
    expect(r?.via).toBe('dep');
  });
  it('Vite via the "@vitejs/plugin-react" dependency → vite / dep', () => {
    const r = detect(project({ pkg: { devDependencies: { '@vitejs/plugin-react': '^4' } } }));
    expect(r?.entry.id).toBe('vite');
    expect(r?.via).toBe('dep');
  });
});

describe('detection matrix · dependency buckets all count', () => {
  for (const bucket of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    it(`Next listed in ${bucket} is detected`, () => {
      const r = detect(project({ pkg: { [bucket]: { next: '^16' } } }));
      expect(r?.entry.id).toBe('next');
    });
  }
});

describe('detection matrix · precedence (the load-bearing rules)', () => {
  it('config beats dep: next.config.js + a vite dependency → next / config', () => {
    const r = detect(project({ pkg: { devDependencies: { vite: '^5' } }, files: ['next.config.js'] }));
    expect(r?.entry.id).toBe('next');
    expect(r?.via).toBe('config');
  });
  it('Next before Vite: both deps, no config → next / dep', () => {
    const r = detect(project({ pkg: { dependencies: { next: '^16' }, devDependencies: { vite: '^5' } } }));
    expect(r?.entry.id).toBe('next');
    expect(r?.via).toBe('dep');
  });
  it('Next before Vite: both config files present → next / config', () => {
    const r = detect(project({ pkg: { dependencies: { next: '^16' } }, files: ['next.config.js', 'vite.config.js'] }));
    expect(r?.entry.id).toBe('next');
    expect(r?.via).toBe('config');
  });
});

describe('detection matrix · monorepo (detect inside the package dir)', () => {
  it('nested package with its own package.json{next} + next.config.js → next / config', () => {
    const r = detect(monorepoPackage({ pkg: { dependencies: { next: '^16' } }, files: ['next.config.js'] }));
    expect(r?.entry.id).toBe('next');
    expect(r?.via).toBe('config');
  });
  it('nested package, dep-only (package.json lists vite) → vite / dep', () => {
    const r = detect(monorepoPackage({ pkg: { devDependencies: { vite: '^5' } } }));
    expect(r?.entry.id).toBe('vite');
    expect(r?.via).toBe('dep');
  });
  it('nested package with the config but deps hoisted out of package.json → still next / config', () => {
    // pnpm/yarn hoisting can leave a package.json without the framework dep; the
    // config file in the package dir still pins the framework.
    const r = detect(monorepoPackage({ pkg: { name: '@app/web' }, files: ['next.config.ts'] }));
    expect(r?.entry.id).toBe('next');
    expect(r?.via).toBe('config');
  });
});

describe('detection matrix · negatives (fail-open → null, the agent falls back)', () => {
  it('a non-framework project (express only) → null', () => {
    expect(detect(project({ pkg: { dependencies: { express: '^4' } } }))).toBe(null);
  });
  it('no package.json and no config → null, no throw', () => {
    expect(detect(project({}))).toBe(null);
  });
  it('a malformed package.json → null, no throw', () => {
    expect(detect(project({ pkg: '{ this is not json' }))).toBe(null);
  });
  it('a non-existent directory → null, no throw', () => {
    expect(detect(path.join(tmpdir(), 'dl-does-not-exist-' + process.pid))).toBe(null);
  });
});

describe('detection matrix · fact readers', () => {
  it('readDeps unions every dependency bucket', () => {
    const dir = project({ pkg: { dependencies: { a: '1' }, devDependencies: { b: '1' }, peerDependencies: { c: '1' }, optionalDependencies: { d: '1' } } });
    const deps = readDeps(dir);
    expect(deps.has('a') && deps.has('b') && deps.has('c') && deps.has('d')).toBe(true);
  });
  it('readConfigFiles only reports files that actually exist', () => {
    const dir = project({ pkg: {}, files: ['next.config.js'] });
    const files = readConfigFiles(BASELINE, dir);
    expect(files.has('next.config.js')).toBe(true);
    expect(files.has('vite.config.js')).toBe(false);
  });
  it('readDeps on a missing package.json is an empty set, no throw', () => {
    expect(readDeps(project({})).size).toBe(0);
  });
});
