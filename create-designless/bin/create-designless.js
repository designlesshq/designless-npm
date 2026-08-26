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
  const out = { framework: null, yes: false, dryRun: false, help: false };
  for (const a of argv) {
    if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('-') && !out.framework) out.framework = a;
  }
  return out;
}

// The door has TWO arms and must say so. Before this block existed there was
// no --help at all: a bare invocation fell straight into framework detection
// and died with "could not detect a supported framework" — a message that
// does not know `extract` exists, on the one class of project (a plain static
// site) where extract is exactly the right arm.
const USAGE = `
  create-designless: the door into Designless for a code repo.

  Wire annotate (framework apps, so edits route back to source):
    npm create designless@latest -- next          # or: vite
    npm create designless@latest                  # auto-detect the framework
      --yes       skip confirmation    --dry-run   plan only, write nothing

  Lift the style surface (any repo — static site or framework app):
    npm create designless@latest -- extract
      writes .designless/style-surface.json (contract extract/v1)
      --stdout    print the surface instead of writing it
`;

// The lift engine is a SEPARATE package (@designless/extract). This
// initializer INVOKES it by name — the same relationship it has with
// @designless/annotate, which it installs by name and never imports. That is
// why create-designless carries no runtime dependencies: it is a door, not a
// library. The monorepo checkout runs the sibling directly so local changes
// are exercised; everywhere else npx fetches the published package.
const EXTRACT_PACKAGE = '@designless/extract';

function runExtractCommand(cwd, passthrough) {
  const sibling = path.join(__dirname, '..', '..', 'extract', 'bin', 'extract.js');
  if (fs.existsSync(sibling)) {
    execFileSync(process.execPath, [sibling, ...passthrough], { cwd, stdio: 'inherit' });
    return;
  }
  execFileSync('npx', ['--yes', EXTRACT_PACKAGE, ...passthrough], { cwd, stdio: 'inherit' });
}

function log(msg) { process.stdout.write(msg + '\n'); }
function warn(msg) { process.stderr.write('[create-designless] ' + msg + '\n'); }
function safeRead(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (args.help) {
    log(USAGE);
    return;
  }

  // `extract` subcommand (brand-adoption end-to-end, 2026-08-23): the
  // mechanical style-surface lift into .designless/style-surface.json. Thin
  // by design — collection only; every judgment (escapes, clustering, token
  // mapping) lives server-side. Works identically for static sites and
  // framework apps; no framework detection needed.
  if (args.framework === 'extract') {
    log('\n  Designless - lifting this project\'s style surface.\n');
    try {
      runExtractCommand(cwd, process.argv.includes('--stdout') ? ['--stdout'] : []);
    } catch (err) {
      warn(`extract failed: ${err && err.message}. Run it directly:  npx ${EXTRACT_PACKAGE}`);
      process.exitCode = 1;
    }
    return;
  }

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
    warn('could not detect a supported framework. Re-run with a framework arg (`npm create designless@latest -- next` or `vite`), or, for a static site or any repo you only want the style surface of, use the extract arm:');
    log(USAGE);
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
