/**
 * The package declares itself: a TypeScript consumer of every subpath
 * type-checks under both module resolutions, so a `next.config.ts` that
 * wraps with `withDesignless` builds without a shim. Runs the real compiler
 * against a fixture that installs this checkout as the package.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');

const CONSUMER = `
import { withDesignless } from '@designless/annotate/next';
import annotate from '@designless/annotate/babel';
import svelte from '@designless/annotate/svelte';
import vue from '@designless/annotate/vue';
import astro from '@designless/annotate/astro';
import qwik from '@designless/annotate/qwik';
import { MARKER_VERSION, ATTR } from '@designless/annotate/contract';
import * as barrel from '@designless/annotate';
const cfg: { reactStrictMode: boolean } = withDesignless({ reactStrictMode: true }, { enabled: true, root: '/x' });
const b = annotate({ types: {} });
const s = svelte({ root: '/x' }).markup({ content: '<div/>', filename: 'a.svelte' });
const v = vue().transform('x', 'a.vue');
const a = astro({ enabled: false });
const q = qwik().transform('x', 'a.tsx');
const version: 'annotate/v1' = MARKER_VERSION;
const file: 'data-source-file' = ATTR.FILE;
export { cfg, b, s, v, a, q, version, file, barrel };
`;

function fixture(moduleResolution) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'annotate-types-'));
  fs.mkdirSync(path.join(dir, 'node_modules', '@designless'), { recursive: true });
  fs.symlinkSync(pkg, path.join(dir, 'node_modules', '@designless', 'annotate'));
  fs.writeFileSync(path.join(dir, 'consumer.ts'), CONSUMER);
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, skipLibCheck: false, target: 'es2022', module: moduleResolution === 'bundler' ? 'esnext' : 'node16', moduleResolution, esModuleInterop: true, types: [] },
    files: ['consumer.ts'],
  }));
  return dir;
}

describe('type declarations', () => {
  for (const resolution of ['bundler', 'node16']) {
    it(`every subpath type-checks under moduleResolution ${resolution}`, () => {
      const dir = fixture(resolution);
      let out = '';
      try {
        out = execFileSync('npx', ['-y', '-p', 'typescript@5', 'tsc', '-p', path.join(dir, 'tsconfig.json'), '--pretty', 'false'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
      } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
      expect(out.trim(), out).toBe('');
    }, 200000);
  }
  it('the manifest points every subpath at its declaration', () => {
    const p = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
    for (const sub of ['.', './next', './babel', './svelte', './vue', './astro', './qwik', './contract']) {
      expect(p.exports[sub].types, sub).toMatch(/^\.\/types\/.*\.d\.ts$/);
      expect(fs.existsSync(path.join(pkg, p.exports[sub].types)), sub).toBe(true);
    }
    expect(p.files).toContain('types');
  });
});
