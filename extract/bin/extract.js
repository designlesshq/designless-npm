#!/usr/bin/env node
/**
 * @designless/extract — CLI entry.
 *
 * Lifts the repo's style surface into .designless/style-surface.json (or
 * stdout with --stdout). Collection only; no judgment, no network. See
 * README.md for the lane contract.
 */
'use strict';

const { runExtract } = require('../src/extract.js');

const stdout = process.argv.includes('--stdout');
const cwd = process.cwd();

try {
  const surface = runExtract(cwd, { stdout });
  if (!stdout) {
    process.stdout.write(`\n  Wrote .designless/style-surface.json\n`);
    process.stdout.write(`  ${surface.entry_count} entries from ${surface.files_scanned} files`
      + (surface.truncated ? ' (TRUNCATED — surface is partial)' : '') + '\n');
    process.stdout.write(`  Lanes: ${Object.entries(surface.lanes).map(([k, v]) => `${k}:${v}`).join('  ')}\n\n`);
  }
} catch (err) {
  process.stderr.write(`[designless-extract] ${err && err.message}\n`);
  process.exitCode = 1;
}
