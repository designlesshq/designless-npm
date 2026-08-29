import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isWasmPresent } from '../src/doctor.js';

/**
 * The artifact check must cover EVERY build the package advertises.
 *
 * The package ships one build per compiler ABI and chooses between them at
 * startup. Checking a single hardcoded path reports "present" while the build
 * this host actually needs is absent, which fails open to no markers on exactly
 * the hosts that need it - the failure the multi-build layout exists to prevent.
 */
describe('artifact presence covers every advertised build', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-doctor-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function installPackage({ exports: exp, present }) {
    const root = path.join(dir, 'node_modules', '@designless', 'annotate');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@designless/annotate', exports: exp }));
    for (const rel of present) {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, 'wasm');
    }
    return root;
  }

  const TWO_BUILDS = {
    '.': './src/index.js',
    './swc/annotate.wasm': './swc-plugin/annotate.wasm',
    './swc/core35.wasm': './swc-plugin-core35/annotate.wasm',
  };

  it('passes when every advertised build is on disk', () => {
    installPackage({ exports: TWO_BUILDS, present: ['swc-plugin/annotate.wasm', 'swc-plugin-core35/annotate.wasm'] });
    expect(isWasmPresent(dir)).toBe(true);
  });

  it('FAILS when a second build is missing, even though the first is present', () => {
    // The regression: a hardcoded swc-plugin/annotate.wasm check called this
    // green while the Next 15 build was absent.
    installPackage({ exports: TWO_BUILDS, present: ['swc-plugin/annotate.wasm'] });
    expect(isWasmPresent(dir)).toBe(false);
  });

  it('back-compat: a package advertising no wasm falls back to the historical path', () => {
    installPackage({ exports: { '.': './src/index.js' }, present: ['swc-plugin/annotate.wasm'] });
    expect(isWasmPresent(dir)).toBe(true);
  });

  it('an uninstalled package is absent, not a crash', () => {
    expect(isWasmPresent(dir)).toBe(false);
  });
});
