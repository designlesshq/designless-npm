/**
 * /next wrapper - config injection rules. The wasm artifact may not be built
 * in CI, so these tests exercise both the present and absent paths via a
 * temp wasm file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withDesignless, WASM_RELATIVE } from '../src/next.js';
import { _resetWarnings } from '../src/gating.js';

const WASM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src', WASM_RELATIVE);

beforeEach(() => _resetWarnings());

// Drive the present/absent wasm states WITHOUT mutating the real built
// artifact: snapshot its bytes up front and restore EXACTLY in finally, so a
// "missing wasm" test can never delete the real plugin (the bug that ate the
// artifact mid-suite, 2026-06-13).
function withWasm(present, fn) {
  const existedBefore = fs.existsSync(WASM);
  const backup = existedBefore ? fs.readFileSync(WASM) : null;
  try {
    if (present && !existedBefore) { fs.mkdirSync(path.dirname(WASM), { recursive: true }); fs.writeFileSync(WASM, 'stub'); }
    if (!present && existedBefore) fs.rmSync(WASM);
    return fn();
  } finally {
    if (existedBefore) fs.writeFileSync(WASM, backup);       // restore real bytes
    else if (fs.existsSync(WASM)) fs.rmSync(WASM);           // remove the stub
  }
}

describe('dev wiring', () => {
  it('injects the swcPlugin as a package SPECIFIER, not an absolute path (the Turbopack-resolution fix)', () => {
    withWasm(true, () => {
      const cfg = withDesignless({ reactStrictMode: true }, { enabled: true });
      expect(cfg.reactStrictMode).toBe(true);
      const plugins = cfg.experimental.swcPlugins;
      expect(Array.isArray(plugins)).toBe(true);
      // Specifier resolved through this package's exports map — NEVER an
      // absolute path (Turbopack treats that as a server-relative import and
      // fails: the bug live-found under Next 16, fixed in 0.1.1).
      expect(plugins[0][0]).toBe('@designless/annotate/swc/annotate.wasm');
      expect(plugins[0][0].startsWith('/')).toBe(false);
    });
  });

  it('is additive - never clobbers an existing swcPlugins entry', () => {
    withWasm(true, () => {
      const cfg = withDesignless({ experimental: { swcPlugins: [['other.wasm', {}]] } }, { enabled: true });
      const names = cfg.experimental.swcPlugins.map((p) => p[0]);
      expect(names.some((n) => n.includes('other.wasm'))).toBe(true);
      expect(names.some((n) => n.includes('annotate.wasm'))).toBe(true);
    });
  });

  it('is idempotent - re-wrapping a wrapped config does not double-wire', () => {
    withWasm(true, () => {
      const once = withDesignless({}, { enabled: true });
      const twice = withDesignless(once, { enabled: true });
      const count = twice.experimental.swcPlugins.filter((p) => p[0].includes('annotate.wasm')).length;
      expect(count).toBe(1);
    });
  });
});

describe('the two hard rules', () => {
  it('PRODUCTION: returns the config UNTOUCHED (no swcPlugins added)', () => {
    const input = { reactStrictMode: true };
    const out = withDesignless(input, { enabled: false });
    expect(out).toBe(input);
  });

  it('LOUD no-op: missing wasm -> config returned untouched, build proceeds', () => {
    withWasm(false, () => {
      const input = { reactStrictMode: true };
      const out = withDesignless(input, { enabled: true });
      expect(out).toBe(input);
      expect(out.experimental).toBeUndefined();
    });
  });

  it('tolerates a non-object config without throwing', () => {
    expect(() => withDesignless(undefined, { enabled: false })).not.toThrow();
    expect(withDesignless(null, { enabled: false })).toEqual({});
  });
});
