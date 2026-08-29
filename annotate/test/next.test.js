/**
 * /next wrapper - config injection rules. The wasm artifact may not be built
 * in CI, so these tests exercise both the present and absent paths via a
 * temp wasm file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withDesignless, resolveProjectRoot, chooseCandidate, CANDIDATES } from '../src/next.js';
import { _resetWarnings } from '../src/gating.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WASM = path.resolve(HERE, '../src', CANDIDATES[0].rel);
// The wiring tests must not depend on a Next install: force the candidate so
// they exercise config shape, not host selection (which has its own tests).
const FORCE = { enabled: true, wasm: CANDIDATES[0].spec };

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
      const cfg = withDesignless({ reactStrictMode: true }, FORCE);
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
      const cfg = withDesignless({ experimental: { swcPlugins: [['other.wasm', {}]] } }, FORCE);
      const names = cfg.experimental.swcPlugins.map((p) => p[0]);
      expect(names.some((n) => n.includes('other.wasm'))).toBe(true);
      expect(names.some((n) => n.includes('annotate.wasm'))).toBe(true);
    });
  });

  it('is idempotent - re-wrapping a wrapped config does not double-wire', () => {
    withWasm(true, () => {
      const once = withDesignless({}, FORCE);
      const twice = withDesignless(once, FORCE);
      const count = twice.experimental.swcPlugins.filter((p) => p[0].includes('annotate.wasm')).length;
      expect(count).toBe(1);
    });
  });
});

describe('project-root threading (the S1 stamp-gap fix)', () => {
  it('threads a NON-EMPTY root into the plugin config (not the old `{}`)', () => {
    withWasm(true, () => {
      const cfg = withDesignless({}, { ...FORCE, root: '/repo/project' });
      const entry = cfg.experimental.swcPlugins[0];
      expect(entry[0]).toBe('@designless/annotate/swc/annotate.wasm');
      expect(entry[1]).toBeTypeOf('object');
      expect(entry[1].root).toBe('/repo/project');
      expect(entry[1].root.length).toBeGreaterThan(0); // never the empty-root no-marker case
    });
  });

  it('falls back to process.cwd() when no explicit root is given', () => {
    withWasm(true, () => {
      const cfg = withDesignless({}, FORCE);
      const entry = cfg.experimental.swcPlugins[0];
      expect(entry[1].root).toBe(process.cwd());
      expect(entry[1].root.length).toBeGreaterThan(0);
    });
  });

  it('prefers nextConfig.dir over cwd (Next records the project dir on the config)', () => {
    withWasm(true, () => {
      const cfg = withDesignless({ dir: '/somewhere/app' }, FORCE);
      expect(cfg.experimental.swcPlugins[0][1].root).toBe('/somewhere/app');
    });
  });

  it('resolution precedence: option.root > config.dir > cwd', () => {
    expect(resolveProjectRoot({ dir: '/cfg' }, { root: '/opt' })).toBe('/opt');
    expect(resolveProjectRoot({ dir: '/cfg' }, {})).toBe('/cfg');
    expect(resolveProjectRoot({}, {})).toBe(process.cwd());
    expect(resolveProjectRoot(undefined, undefined)).toBe(process.cwd());
  });

  it('back-compat: an empty root never crashes (plugin keeps its relative-path branch)', () => {
    // Force the empty-root path explicitly; the plugin tolerates it.
    expect(resolveProjectRoot({}, { root: '' })).toBe(process.cwd()); // '' option is falsy -> cwd
    // A truly empty resolution stays a string, never undefined/null.
    expect(typeof resolveProjectRoot({}, {})).toBe('string');
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
      const out = withDesignless(input, FORCE);
      expect(out).toBe(input);
      expect(out.experimental).toBeUndefined();
    });
  });

  it('tolerates a non-object config without throwing', () => {
    expect(() => withDesignless(undefined, { enabled: false })).not.toThrow();
    expect(withDesignless(null, { enabled: false })).toEqual({});
  });
});

/**
 * End-to-end marker-emission proof through the REAL wasm plugin. This is the
 * load-bearing test for the S1 fix: it takes the config `withDesignless`
 * produces, feeds its threaded `root` to @swc/core with an ABSOLUTE filename
 * under that root, and asserts a `data-source-file` marker now appears - the
 * exact case the old `[WASM_SPECIFIER, {}]` (empty root) silently dropped.
 * Skips (loud note) when the wasm isn't built / @swc/core is unavailable, so a
 * fresh checkout stays green before `npm run build:swc`.
 */
const WASM_ABS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../swc-plugin/annotate.wasm');
let swc;
try { swc = (await import('@swc/core')).default ?? (await import('@swc/core')); } catch { swc = null; }
const e2eReady = fs.existsSync(WASM_ABS) && swc;
if (!e2eReady) console.warn('[next.test] wasm not built or @swc/core missing - skipping end-to-end marker-emission proof. Run `npm run build:swc`.');

(e2eReady ? describe : describe.skip)('end-to-end: the threaded root actually yields a marker', () => {
  // Pull the plugin config object the wrapper generated, swap the resolver
  // SPECIFIER for the on-disk wasm path @swc/core needs at the test layer, and
  // keep the wrapper's threaded `{ root }` verbatim.
  function transformViaWrappedConfig(code, { projectRoot, filename }) {
    const cfg = withDesignless({ dir: projectRoot }, FORCE);
    const [, pluginOpts] = cfg.experimental.swcPlugins[0];
    return swc.transformSync(code, {
      filename,
      jsc: {
        parser: { syntax: 'typescript', tsx: true },
        target: 'es2022',
        experimental: { plugins: [[WASM_ABS, pluginOpts]] }, // pluginOpts === { root: projectRoot }
      },
    }).code;
  }

  it('an ABSOLUTE filename under the threaded root now stamps a repo-relative marker', () => {
    withWasm(true, () => {
      const projectRoot = '/repo/myapp';
      const out = transformViaWrappedConfig('const x = <div>hi</div>;', {
        projectRoot,
        filename: '/repo/myapp/app/page.tsx',
      });
      expect(out).toContain('data-source-file');
      expect(out).toContain('app/page.tsx');   // repo-relative, root stripped
      expect(out).not.toContain(projectRoot);  // never the absolute path
      expect(out).toContain('annotate/v1');
    });
  });

  it('REGRESSION GUARD: with the old empty `{}` config the same absolute file stamps NOTHING', () => {
    withWasm(true, () => {
      // Reproduce the pre-fix behaviour directly to prove the gap was real.
      const out = swc.transformSync('const x = <div>hi</div>;', {
        filename: '/repo/myapp/app/page.tsx',
        jsc: {
          parser: { syntax: 'typescript', tsx: true },
          target: 'es2022',
          experimental: { plugins: [[WASM_ABS, {}]] }, // empty root == the S1 bug
        },
      }).code;
      expect(out).not.toContain('data-source-file');
    });
  });
});

/**
 * ABI selection. The failure this guards is not "no markers" - it is a wasm the
 * host rejects, which Next reports as a build error and serves as a 500. A
 * dev-only convenience must never be able to do that, so every path that cannot
 * name a loadable artifact has to return the config untouched.
 */
describe('ABI selection preflights instead of predicting', () => {
  // A stub @next/swc: `stamping` lists the wasm paths this fake host accepts.
  // Anything else throws, exactly as a real runner/plugin mismatch does.
  const abs = (c) => path.resolve(HERE, '../src', c.rel);
  function fakeHost({ stamping = [], loadsButSilent = [] } = {}) {
    return {
      transformSync(src, isModule, buf) {
        const opts = JSON.parse(buf.toString());
        const wasm = opts.jsc.experimental.plugins[0][0];
        if (stamping.some((s) => wasm === s)) {
          return { code: 'const __d = <div data-source-file="a.tsx" />;' };
        }
        if (loadsButSilent.some((s) => wasm === s)) return { code: 'const __d = <div />;' };
        throw new Error('failed to invoke plugin');
      },
    };
  }

  it('picks the FIRST candidate the host actually accepts', () => {
    const chosen = chooseCandidate(fakeHost({ stamping: [abs(CANDIDATES[0])] }), '/repo');
    expect(chosen).toBeTruthy();
    expect(chosen.core).toBe(CANDIDATES[0].core);
  });

  it('SKIPS a candidate the host rejects and falls through to one it accepts', () => {
    // Reject the preferred artifact; accept only the older-ABI one. This is the
    // live Next 15.5 case: the newest build is exactly the one that cannot load.
    const older = CANDIDATES[CANDIDATES.length - 1];
    const chosen = chooseCandidate(fakeHost({ stamping: [abs(older)] }), '/repo');
    expect(chosen).toBeTruthy();
    expect(chosen.core).toBe(older.core);
  });

  it('a host that rejects EVERY candidate yields null (caller must fail open)', () => {
    expect(chooseCandidate(fakeHost({ stamping: [] }), '/repo')).toBe(null);
  });

  it('"loads but stamps nothing" counts as a failure, not a pass', () => {
    // A silent load is indistinguishable from a broken one from the user's
    // side, and picking it would mask a real regression behind a green wire.
    const all = CANDIDATES.map(abs);
    expect(chooseCandidate(fakeHost({ loadsButSilent: all }), '/repo')).toBe(null);
  });

  it('no usable host bindings -> null rather than a throw', () => {
    expect(chooseCandidate(null, '/repo')).toBe(null);
    expect(chooseCandidate({}, '/repo')).toBe(null);
    expect(chooseCandidate({ transformSync: 'nope' }, '/repo')).toBe(null);
  });

  it('FAIL OPEN: an unresolvable Next host returns the config untouched', () => {
    const input = { reactStrictMode: true };
    const out = withDesignless(input, { enabled: true, root: '/nonexistent/project' });
    expect(out).toBe(input);
    expect(out.experimental).toBeUndefined();
  });
});

/**
 * Packaging. Shipping an artifact the wrapper can name but npm does not publish
 * turns every host on that ABI into a silent no-op, which is precisely the
 * shape of the bug this whole mechanism exists to fix.
 */
describe('every candidate artifact is built AND published', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(HERE, '../package.json'), 'utf8'));

  it.each(CANDIDATES.map((c) => [c.core, c]))('swc_core %s is built, exported and packaged', (_core, candidate) => {
    const abs = path.resolve(HERE, '../src', candidate.rel);
    expect(fs.existsSync(abs), `missing artifact ${candidate.rel} - run npm run build:swc`).toBe(true);

    // The swcPlugins entry MUST be a package subpath specifier; Turbopack treats
    // an absolute path as a server-relative import and fails to resolve it.
    expect(candidate.spec.startsWith('@designless/annotate/')).toBe(true);
    const subpath = candidate.spec.replace('@designless/annotate', '.');
    expect(Object.keys(pkg.exports)).toContain(subpath);

    // ...and the file the exports map points at has to be in `files`, or the
    // published tarball resolves the specifier to nothing.
    const target = pkg.exports[subpath].replace(/^\.\//, '');
    expect(pkg.files.some((f) => target === f || target.startsWith(f.replace(/\/$/, '') + '/'))).toBe(true);
  });
});
