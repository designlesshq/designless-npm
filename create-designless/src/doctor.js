/**
 * create-designless - the doctor.
 *
 * Verifies the install is actually wired: the package is a dependency, its
 * artifacts are present (the SWC wasm for the Next engine), and the config
 * references the wrapper/plugin. `doctorReport` is PURE over an injected facts
 * object (unit-tested); `runDoctor` gathers the facts from disk.
 *
 * These checks never "fix" - they report, and they report only what can be read
 * off disk: is the package a dependency, are its artifacts present, does the
 * config reference the wiring.
 *
 * WHAT THEY CANNOT TELL YOU, and must not be presented as telling you: whether
 * a marker actually reaches the rendered page. All three passed for months on
 * Next 15 while the plugin could not load at all and every route returned 500 -
 * the wiring was perfect and the result was a dead dev server. Proving markers
 * arrive means running the app and reading its output, which a scaffold has no
 * business doing. The agent already boots and captures the app, so it makes
 * that claim; this file only reports what it can see.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PACKAGE } = require('./capabilities');

/**
 * @param {object} entry - capability entry
 * @param {{ installed:boolean, wasmPresent:boolean, configWired:boolean, engine:string }} facts
 * @returns {{ ok:boolean, checks:Array<{name:string, ok:boolean, detail:string}> }}
 */
function doctorReport(entry, facts) {
  const checks = [];
  checks.push({
    name: 'package installed',
    ok: !!facts.installed,
    detail: facts.installed ? `${PACKAGE} is a dependency` : `${PACKAGE} is not installed - run the install step`,
  });
  // The wasm artifact only matters for the SWC (Next) engine.
  if (entry.engine === 'swc') {
    checks.push({
      name: 'marker plugin builds present',
      ok: !!facts.wasmPresent,
      detail: facts.wasmPresent
        ? 'every build the package ships is on disk'
        : 'a build the package ships is missing - reinstall it',
    });
  }
  checks.push({
    name: 'config wired',
    ok: !!facts.configWired,
    detail: facts.configWired ? 'config references the Designless wiring' : 'config not wired - see the wiring step',
  });
  return { ok: checks.every((c) => c.ok), checks };
}

/** Is PACKAGE in the project's package.json deps? */
function isInstalled(projectDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    for (const bucket of ['dependencies', 'devDependencies']) {
      if (pkg[bucket] && Object.prototype.hasOwnProperty.call(pkg[bucket], PACKAGE)) return true;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Are the SWC wasm artifacts present in the installed package?
 *
 * Reads the installed package's own `exports` map rather than a hardcoded path.
 * The package ships one build per compiler ABI and picks between them at
 * startup, so checking a single file reports "present" while the build this
 * host actually needs is missing - which fails open to no markers on exactly
 * the hosts that need it. Every artifact the package advertises must be there.
 */
function isWasmPresent(projectDir) {
  try {
    const root = path.join(projectDir, 'node_modules', PACKAGE);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const wasm = Object.values((pkg && pkg.exports) || {})
      .filter((t) => typeof t === 'string' && t.endsWith('.wasm'));
    // No wasm advertised at all: an older package, or a non-SWC install. Fall
    // back to the historical single path rather than reporting a false pass.
    if (!wasm.length) return fs.existsSync(path.join(root, 'swc-plugin', 'annotate.wasm'));
    return wasm.every((rel) => fs.existsSync(path.join(root, rel)));
  } catch { return false; }
}

/** Does the config file reference our wrapper/plugin? */
function isConfigWired(entry, projectDir) {
  // Every engine's wired config contains its own subpath import
  // (@designless/annotate/<engine>); that is the reliable needle. (Next also
  // contains `withDesignless`, but the import string is present there too.)
  const needle = (entry.wire && entry.wire.import) || 'withDesignless';
  for (const f of (entry.detect && entry.detect.config) || []) {
    try {
      const p = path.join(projectDir, f);
      if (fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes(needle)) return true;
    } catch { /* ignore */ }
  }
  return false;
}

function runDoctor(entry, projectDir) {
  return doctorReport(entry, {
    installed: isInstalled(projectDir),
    wasmPresent: isWasmPresent(projectDir),
    configWired: isConfigWired(entry, projectDir),
    engine: entry.engine,
  });
}

module.exports = { doctorReport, runDoctor, isInstalled, isWasmPresent, isConfigWired };
