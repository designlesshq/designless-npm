/**
 * create-designless - config wiring.
 *
 * `planWiring` is PURE (content in -> plan out, unit-tested). It NEVER mangles
 * a config it doesn't understand: an unfamiliar shape returns a `manual` plan
 * with exact copy-paste instructions instead of a risky edit. This is the
 * "fails loud, never crashes the build" rule applied to the user's own files -
 * a wrong auto-edit that breaks `next dev` would be far worse than asking the
 * user to paste two lines.
 *
 * Plans:
 *   { action: 'already-wired' }
 *   { action: 'edit', content }                  - write `content` back
 *   { action: 'manual', instructions }           - print, let the user paste
 */

'use strict';

const { PACKAGE } = require('./capabilities');

function nextManual(configFileName) {
  return [
    `Wire @designless/annotate into ${configFileName || 'next.config.js'} by hand:`,
    '',
    "  const { withDesignless } = require('@designless/annotate/next')",
    '  // ...your config object as `nextConfig`...',
    '  module.exports = withDesignless(nextConfig)',
    '',
    '(ESM config: `import { withDesignless } from \"@designless/annotate/next\"`',
    ' then `export default withDesignless(nextConfig)`.)',
  ].join('\n');
}

function viteManual(configFileName) {
  return [
    `Add the Designless babel plugin to ${configFileName || 'vite.config.js'}:`,
    '',
    "  import react from '@vitejs/plugin-react'",
    '  // inside defineConfig({ plugins: [ ... ] }):',
    "  react({ babel: { plugins: ['@designless/annotate/babel'] } })",
  ].join('\n');
}

/**
 * @param {object} entry - capability entry (capabilities.js)
 * @param {string} content - current config file content ('' if absent)
 * @param {string} [configFileName]
 * @returns {{action:string, content?:string, instructions?:string}}
 */
function planWiring(entry, content, configFileName) {
  const src = typeof content === 'string' ? content : '';

  if (entry.wire && entry.wire.kind === 'next-config') {
    if (src.includes('withDesignless')) return { action: 'already-wired' };

    const importLine = "const { withDesignless } = require('@designless/annotate/next')\n";
    // CommonJS: module.exports = <expr>
    const cjs = src.match(/module\.exports\s*=\s*([\s\S]+?)(;?\s*)$/);
    if (cjs) {
      const expr = cjs[1].trim().replace(/;$/, '');
      const wrapped = src.replace(cjs[0], `module.exports = withDesignless(${expr})\n`);
      return { action: 'edit', content: importLine + wrapped };
    }
    // ESM: export default <expr>
    const esm = src.match(/export\s+default\s+([\s\S]+?)(;?\s*)$/);
    if (esm) {
      const expr = esm[1].trim().replace(/;$/, '');
      const importEsm = "import { withDesignless } from '@designless/annotate/next'\n";
      const wrapped = src.replace(esm[0], `export default withDesignless(${expr})\n`);
      return { action: 'edit', content: importEsm + wrapped };
    }
    return { action: 'manual', instructions: nextManual(configFileName) };
  }

  if (entry.wire && entry.wire.kind === 'vite-babel') {
    if (src.includes('@designless/annotate/babel')) return { action: 'already-wired' };
    // Vite plugin-option editing is too shape-dependent to auto-edit safely
    // (the plugins array, react() call args, and defineConfig form all vary).
    // Honest manual snippet - the doctor confirms it landed.
    return { action: 'manual', instructions: viteManual(configFileName) };
  }

  return { action: 'manual', instructions: `Unsupported framework wiring for ${PACKAGE}.` };
}

module.exports = { planWiring, nextManual, viteManual };
