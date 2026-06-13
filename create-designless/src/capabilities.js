/**
 * create-designless - the capability map (framework -> how to wire @designless/annotate).
 *
 * This is the baseline list of supported frameworks and how each is wired. It
 * works fully offline, since the initializer is the first thing a user runs.
 * `resolveCapabilities()` optionally fetches the latest published list from
 * designless.app and merges it over this baseline, so new framework support
 * can arrive without a package update; a failed or absent fetch simply uses
 * the baseline. Every framework's wiring lives in exactly one entry here.
 */

'use strict';

const PACKAGE = '@designless/annotate';

/**
 * One entry per supported framework. `id` is the verifiable positional arg
 * (`npm create designless@latest -- <id>`); `aliases` are typo-shims.
 */
const BASELINE = Object.freeze({
  next: {
    id: 'next',
    label: 'Next.js',
    aliases: ['nextjs', 'next.js'],
    engine: 'swc',
    detect: { dep: ['next'], config: ['next.config.js', 'next.config.mjs', 'next.config.ts'] },
    // How wire.js edits the config: wrap the export with withDesignless.
    wire: { kind: 'next-config', import: "@designless/annotate/next", wrapper: 'withDesignless' },
  },
  vite: {
    id: 'vite',
    label: 'Vite + React',
    aliases: ['vite-react', 'react', 'react-vite'],
    engine: 'babel',
    detect: { dep: ['vite', '@vitejs/plugin-react'], config: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'] },
    // Add the babel plugin to @vitejs/plugin-react({ babel: { plugins: [...] } }).
    wire: { kind: 'vite-babel', import: "@designless/annotate/babel" },
  },
});

const DEFAULT_MANIFEST_URL = 'https://cdn.designless.app/annotate/capabilities.v1.json';

/**
 * Merge a published manifest over the baseline. Pure (unit-tested). A manifest
 * may add frameworks or update a framework's wiring; it can never remove the
 * offline baseline (a partial or garbage manifest degrades, never breaks).
 * @param {object} baseline
 * @param {any} serverManifest - parsed JSON, or null
 */
function mergeCapabilities(baseline, serverManifest) {
  if (
    !serverManifest || typeof serverManifest !== 'object' ||
    !serverManifest.frameworks || typeof serverManifest.frameworks !== 'object' ||
    Array.isArray(serverManifest.frameworks)
  ) {
    return baseline;
  }
  const out = Object.assign({}, baseline);
  for (const [key, entry] of Object.entries(serverManifest.frameworks)) {
    if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
      out[key] = Object.assign({}, baseline[key] || {}, entry);
    }
  }
  return out;
}

/**
 * Resolve the effective capability map: the published manifest merged over the
 * baseline. `fetchImpl` is injected for testability; a failed or absent fetch
 * returns the baseline (the initializer always works offline).
 * @param {{ fetchImpl?: typeof fetch, url?: string }} [opts]
 */
async function resolveCapabilities(opts) {
  const url = (opts && opts.url) || DEFAULT_MANIFEST_URL;
  const doFetch = (opts && opts.fetchImpl) || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) return BASELINE;
  try {
    const res = await doFetch(url, { headers: { accept: 'application/json' } });
    if (!res || !res.ok) return BASELINE;
    const json = await res.json();
    return mergeCapabilities(BASELINE, json);
  } catch {
    return BASELINE; // offline / blocked / garbage -> baseline, no throw
  }
}

/**
 * Resolve a user-supplied framework token (positional arg) to a capability
 * entry, honoring aliases. Returns null for an unknown token. Pure.
 */
function frameworkByToken(capabilities, token) {
  if (!token || typeof token !== 'string') return null;
  const t = token.trim().toLowerCase();
  for (const entry of Object.values(capabilities)) {
    if (entry.id === t || (Array.isArray(entry.aliases) && entry.aliases.includes(t))) return entry;
  }
  return null;
}

module.exports = {
  PACKAGE,
  BASELINE,
  DEFAULT_MANIFEST_URL,
  mergeCapabilities,
  resolveCapabilities,
  frameworkByToken,
};
