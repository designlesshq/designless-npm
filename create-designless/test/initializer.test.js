/**
 * create-designless - the pure cores: capability resolution, framework
 * classification, config-wiring plans, and the doctor verdict. The bin is a
 * thin orchestrator over these; everything decision-bearing is tested here.
 */
import { describe, it, expect } from 'vitest';
import { BASELINE, mergeCapabilities, resolveCapabilities, frameworkByToken } from '../src/capabilities.js';
import { classifyFramework } from '../src/detect.js';
import { planWiring } from '../src/wire.js';
import { doctorReport } from '../src/doctor.js';

describe('capabilities', () => {
  it('frameworkByToken resolves ids and aliases, rejects unknowns', () => {
    expect(frameworkByToken(BASELINE, 'next').id).toBe('next');
    expect(frameworkByToken(BASELINE, 'nextjs').id).toBe('next');
    expect(frameworkByToken(BASELINE, 'react').id).toBe('vite');
    expect(frameworkByToken(BASELINE, 'svelte')).toBe(null);
    expect(frameworkByToken(BASELINE, '')).toBe(null);
  });

  it('mergeCapabilities lets the server add/update but a garbage manifest degrades to baseline', () => {
    const merged = mergeCapabilities(BASELINE, { frameworks: { remix: { id: 'remix', label: 'Remix', engine: 'babel' } } });
    expect(merged.remix.id).toBe('remix');
    expect(merged.next.id).toBe('next'); // baseline preserved
    expect(mergeCapabilities(BASELINE, null)).toBe(BASELINE);
    expect(mergeCapabilities(BASELINE, { frameworks: 'junk' })).toBe(BASELINE);
  });

  it('resolveCapabilities returns the baseline when the fetch fails (works offline)', async () => {
    const caps = await resolveCapabilities({ fetchImpl: async () => { throw new Error('offline'); } });
    expect(caps).toBe(BASELINE);
    const caps2 = await resolveCapabilities({ fetchImpl: async () => ({ ok: false }) });
    expect(caps2).toBe(BASELINE);
  });
});

describe('classifyFramework', () => {
  it('a config-file hit wins over a dep hit, Next before Vite', () => {
    const both = classifyFramework(BASELINE, {
      deps: new Set(['vite', 'next']),
      files: new Set(['next.config.js']),
    });
    expect(both.entry.id).toBe('next');
    expect(both.via).toBe('config');
  });
  it('falls back to a dependency signal when no config file exists', () => {
    const r = classifyFramework(BASELINE, { deps: new Set(['vite', '@vitejs/plugin-react']), files: new Set() });
    expect(r.entry.id).toBe('vite');
    expect(r.via).toBe('dep');
  });
  it('returns null for an unrecognizable project', () => {
    expect(classifyFramework(BASELINE, { deps: new Set(['express']), files: new Set() })).toBe(null);
  });
});

describe('planWiring - Next', () => {
  const next = BASELINE.next;
  it('wraps a CommonJS module.exports config', () => {
    const plan = planWiring(next, 'const nextConfig = { reactStrictMode: true }\nmodule.exports = nextConfig\n', 'next.config.js');
    expect(plan.action).toBe('edit');
    expect(plan.content).toContain("require('@designless/annotate/next')");
    expect(plan.content).toContain('module.exports = withDesignless(nextConfig)');
  });
  it('wraps an ESM export default config', () => {
    const plan = planWiring(next, 'const nextConfig = {}\nexport default nextConfig\n', 'next.config.mjs');
    expect(plan.action).toBe('edit');
    expect(plan.content).toContain("import { withDesignless } from '@designless/annotate/next'");
    expect(plan.content).toContain('export default withDesignless(nextConfig)');
  });
  it('is idempotent - an already-wired config is left alone', () => {
    const plan = planWiring(next, "const { withDesignless } = require('@designless/annotate/next')\nmodule.exports = withDesignless({})\n");
    expect(plan.action).toBe('already-wired');
  });
  it('an unfamiliar shape yields manual instructions, never a risky edit', () => {
    const plan = planWiring(next, '// some exotic config with no recognizable export\n');
    expect(plan.action).toBe('manual');
    expect(plan.instructions).toContain('withDesignless');
  });
});

describe('planWiring - Vite', () => {
  it('emits a precise manual snippet (plugin-option editing is too shape-dependent to auto-edit)', () => {
    const plan = planWiring(BASELINE.vite, "import react from '@vitejs/plugin-react'\nexport default { plugins: [react()] }\n", 'vite.config.js');
    expect(plan.action).toBe('manual');
    expect(plan.instructions).toContain('@designless/annotate/babel');
  });
  it('is idempotent when the babel plugin is already referenced', () => {
    const plan = planWiring(BASELINE.vite, "react({ babel: { plugins: ['@designless/annotate/babel'] } })");
    expect(plan.action).toBe('already-wired');
  });
});

describe('doctorReport', () => {
  it('is green only when installed + wired (and wasm present for the SWC engine)', () => {
    const green = doctorReport(BASELINE.next, { installed: true, wasmPresent: true, configWired: true, engine: 'swc' });
    expect(green.ok).toBe(true);
    expect(green.checks).toHaveLength(3);
  });
  it('flags the SWC wasm only for the Next engine; Vite needs no wasm', () => {
    const vite = doctorReport(BASELINE.vite, { installed: true, configWired: true, engine: 'babel' });
    expect(vite.checks.find((c) => c.name.includes('SWC'))).toBeUndefined();
    expect(vite.ok).toBe(true);
  });
  it('is red and names the gap when wiring is missing', () => {
    const red = doctorReport(BASELINE.next, { installed: true, wasmPresent: true, configWired: false, engine: 'swc' });
    expect(red.ok).toBe(false);
    expect(red.checks.find((c) => c.name === 'config wired').ok).toBe(false);
  });
});

describe('the canonical CDN manifest stays in sync with the baked baseline', () => {
  // The published manifest (cdn/annotate/capabilities.v1.json) is the source of
  // truth; the package baseline is its offline mirror. They must not drift, or
  // an offline user and an online user would get different wiring.
  it('cdn/annotate/capabilities.v1.json merges to exactly the baseline', async () => {
    const fs = await import('node:fs');
    const url = new URL('../../cdn/annotate/capabilities.v1.json', import.meta.url);
    const manifest = JSON.parse(fs.readFileSync(url, 'utf8'));
    const merged = mergeCapabilities(BASELINE, manifest);
    expect(merged.next).toEqual(BASELINE.next);
    expect(merged.vite).toEqual(BASELINE.vite);
  });
});
