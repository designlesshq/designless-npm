#!/usr/bin/env node
/**
 * create-designless - wire @designless/annotate into a Next.js or Vite-React
 * project so Designless can route a rendered element back to its source line.
 *
 * Usage:
 *   npm create designless@latest -- <framework> [--yes] [--dry-run]
 *   # <framework> is next or vite (with aliases); omit it to auto-detect
 *
 * Discipline: this writes only TWO things - a devDependency and a config edit
 * it fully understands (else it prints manual instructions). It never runs a
 * build, never touches source, and always ends by running the doctor so the
 * user sees proof. Failures are loud and human; nothing here can break a
 * project that wasn't already broken.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { PACKAGE, resolveCapabilities, frameworkByToken } = require('../src/capabilities');
const { detectFramework } = require('../src/detect');
const { planWiring } = require('../src/wire');
const { runDoctor } = require('../src/doctor');

function parseArgs(argv) {
  const out = { framework: null, yes: false, dryRun: false };
  for (const a of argv) {
    if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (!a.startsWith('-') && !out.framework) out.framework = a;
  }
  return out;
}

function log(msg) { process.stdout.write(msg + '\n'); }
function warn(msg) { process.stderr.write('[create-designless] ' + msg + '\n'); }
function safeRead(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  log('\n  Designless - connecting your project so edits route back to source.\n');

  const caps = await resolveCapabilities();

  // Framework: the explicit arg wins (verifiable); else detect.
  let entry = args.framework ? frameworkByToken(caps, args.framework) : null;
  if (args.framework && !entry) {
    warn(`unknown framework "${args.framework}". Known: ${Object.values(caps).map((c) => c.id).join(', ')}.`);
    process.exitCode = 1;
    return;
  }
  if (!entry) {
    const found = detectFramework(caps, cwd);
    if (found) { entry = found.entry; log(`  Detected ${entry.label} (via ${found.via}).`); }
  } else {
    log(`  Framework: ${entry.label}.`);
  }
  if (!entry) {
    warn('could not detect a supported framework. Re-run with a framework arg: `npm create designless@latest -- next` (or `vite`).');
    process.exitCode = 1;
    return;
  }

  // 1) The package (a devDependency - dev-only, zero runtime cost).
  const installCmd = ['install', '-D', PACKAGE];
  if (args.dryRun) {
    log(`\n  Would install:  npm ${installCmd.join(' ')}`);
  } else if (args.yes) {
    log(`\n  Installing ${PACKAGE} ...`);
    try {
      execFileSync('npm', installCmd, { cwd, stdio: 'inherit' });
    } catch (err) {
      warn(`install failed: ${err && err.message}. Install it manually: npm ${installCmd.join(' ')}`);
    }
  } else {
    log(`\n  Run:  npm ${installCmd.join(' ')}`);
  }

  // 2) The config wiring (or manual instructions for an unfamiliar shape).
  const configFile = (entry.detect.config || []).map((f) => path.join(cwd, f)).find((p) => fs.existsSync(p));
  const configName = configFile ? path.basename(configFile) : (entry.detect.config || [])[0];
  const content = configFile ? safeRead(configFile) : '';
  const plan = planWiring(entry, content, configName);

  if (plan.action === 'already-wired') {
    log(`  ${configName}: already wired. ✓`);
  } else if (plan.action === 'edit' && configFile) {
    if (args.dryRun) {
      log(`  Would wire ${configName}.`);
    } else if (args.yes) {
      try { fs.writeFileSync(configFile, plan.content); log(`  Wired ${configName}. ✓`); }
      catch (err) { warn(`couldn't write ${configName}: ${err && err.message}`); log('\n' + plan.instructions); }
    } else {
      log(`  Will wire ${configName} (re-run with --yes to apply).`);
    }
  } else {
    log('\n' + (plan.instructions || 'Manual wiring required.'));
  }

  // 3) Doctor - the proof.
  if (!args.dryRun && args.yes) {
    log('\n  Doctor:');
    const report = runDoctor(entry, cwd);
    for (const c of report.checks) log(`    ${c.ok ? '✓' : '✗'} ${c.name} - ${c.detail}`);
    log(report.ok
      ? '\n  Done. Start your dev server, open the Designless canvas, and edit live.\n'
      : '\n  Some checks failed above - resolve them, then re-run `npx create-designless` to re-check.\n');
    if (!report.ok) process.exitCode = 1;
  } else {
    log('\n  After installing + wiring, run `npx create-designless -- ' + entry.id + ' --yes` to verify.\n');
  }
}

main().catch((err) => { warn('unexpected error: ' + (err && err.message)); process.exitCode = 1; });
