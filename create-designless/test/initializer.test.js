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
    expect(frameworkByToken(BASELINE, 'svelte').id).toBe('svelte');
    expect(frameworkByToken(BASELINE, 'sveltekit').id).toBe('svelte');
    expect(frameworkByToken(BASELINE, 'vue').id).toBe('vue');
    expect(frameworkByToken(BASELINE, 'vuejs').id).toBe('vue');
    expect(frameworkByToken(BASELINE, 'astro').id).toBe('astro');
    expect(frameworkByToken(BASELINE, 'qwik').id).toBe('qwik');
    expect(frameworkByToken(BASELINE, 'qwik-city').id).toBe('qwik');
    expect(frameworkByToken(BASELINE, 'angular')).toBe(null);
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

  it('Vue wins over Vite-React on a shared vite.config via its dependency', () => {
    const r = classifyFramework(BASELINE, {
      deps: new Set(['vue', '@vitejs/plugin-vue', 'vite']),
      files: new Set(['vite.config.js']),
    });
    expect(r.entry.id).toBe('vue');
    expect(r.via).toBe('dep');
  });

  it('Qwik wins over Vite-React on a shared vite.config via its dependency', () => {
    const r = classifyFramework(BASELINE, {
      deps: new Set(['@builder.io/qwik', 'vite']),
      files: new Set(['vite.config.ts']),
    });
    expect(r.entry.id).toBe('qwik');
    expect(r.via).toBe('dep');
  });

  it('plain Vite-React still claims the shared vite.config when no framework dep is present', () => {
    const r = classifyFramework(BASELINE, {
      deps: new Set(['react', '@vitejs/plugin-react', 'vite']),
      files: new Set(['vite.config.js']),
    });
    expect(r.entry.id).toBe('vite');
  });

  it('Astro is detected by its unique config file', () => {
    const r = classifyFramework(BASELINE, { deps: new Set(['astro']), files: new Set(['astro.config.mjs']) });
    expect(r.entry.id).toBe('astro');
    expect(r.via).toBe('config');
  });

  it('Svelte is detected by its unique config file (previously unreachable)', () => {
    const r = classifyFramework(BASELINE, { deps: new Set(['svelte', '@sveltejs/kit']), files: new Set(['svelte.config.js']) });
    expect(r.entry.id).toBe('svelte');
    expect(r.via).toBe('config');
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

describe('planWiring - Svelte / Vue / Astro / Qwik (shape-dependent, manual)', () => {
  it('Svelte emits a manual preprocessor snippet and is idempotent', () => {
    const plan = planWiring(BASELINE.svelte, 'export default { preprocess: [vitePreprocess()] }', 'svelte.config.js');
    expect(plan.action).toBe('manual');
    expect(plan.instructions).toContain('@designless/annotate/svelte');
    expect(planWiring(BASELINE.svelte, "import x from '@designless/annotate/svelte'").action).toBe('already-wired');
  });

  it('Vue emits a manual Vite-plugin snippet with the right import + default name', () => {
    const plan = planWiring(BASELINE.vue, 'export default defineConfig({ plugins: [vue()] })', 'vite.config.js');
    expect(plan.action).toBe('manual');
    expect(plan.instructions).toContain('@designless/annotate/vue');
    expect(plan.instructions).toContain('designlessVue');
    expect(planWiring(BASELINE.vue, "import designlessVue from '@designless/annotate/vue'").action).toBe('already-wired');
  });

  it('Qwik emits a manual Vite-plugin snippet with its own import', () => {
    const plan = planWiring(BASELINE.qwik, 'export default defineConfig({ plugins: [qwikVite()] })', 'vite.config.ts');
    expect(plan.action).toBe('manual');
    expect(plan.instructions).toContain('@designless/annotate/qwik');
    expect(plan.instructions).toContain('designlessQwik');
    expect(planWiring(BASELINE.qwik, "import designlessQwik from '@designless/annotate/qwik'").action).toBe('already-wired');
  });

  it('Astro emits a manual integration snippet and is idempotent', () => {
    const plan = planWiring(BASELINE.astro, 'export default defineConfig({ integrations: [] })', 'astro.config.mjs');
    expect(plan.action).toBe('manual');
    expect(plan.instructions).toContain('@designless/annotate/astro');
    expect(plan.instructions).toContain('integrations:');
    expect(planWiring(BASELINE.astro, "import designlessAstro from '@designless/annotate/astro'").action).toBe('already-wired');
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
  it('cdn/annotate/capabilities.v1.json merges to exactly the baseline (every framework)', async () => {
    const fs = await import('node:fs');
    const url = new URL('../../cdn/annotate/capabilities.v1.json', import.meta.url);
    const manifest = JSON.parse(fs.readFileSync(url, 'utf8'));
    const merged = mergeCapabilities(BASELINE, manifest);
    // Every baked-in framework must be declared in the canonical manifest and
    // merge back to exactly the baseline (no drift, in either direction).
    for (const key of Object.keys(BASELINE)) {
      expect(manifest.frameworks[key], `manifest is missing "${key}"`).toBeTruthy();
      expect(merged[key]).toEqual(BASELINE[key]);
    }
    // ...and the manifest declares no framework the baseline doesn't know.
    expect(Object.keys(manifest.frameworks).sort()).toEqual(Object.keys(BASELINE).sort());
  });
});
