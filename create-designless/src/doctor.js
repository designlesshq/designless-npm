/**
 * create-designless - the doctor.
 *
 * Verifies the install is actually wired: the package is a dependency, its
 * artifacts are present (the SWC wasm for the Next engine), and the config
 * references the wrapper/plugin. `doctorReport` is PURE over an injected facts
 * object (unit-tested); `runDoctor` gathers the facts from disk.
 *
 * The doctor never "fixes" - it reports. A green doctor is the initializer's
 * proof of success; a red doctor names exactly what's missing.
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
      name: 'SWC marker plugin present',
      ok: !!facts.wasmPresent,
      detail: facts.wasmPresent ? 'annotate.wasm shipped in the package' : 'annotate.wasm missing - reinstall the package',
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

/** Is the SWC wasm artifact present in the installed package? */
function isWasmPresent(projectDir) {
  try {
    return fs.existsSync(path.join(projectDir, 'node_modules', PACKAGE, 'swc-plugin', 'annotate.wasm'));
  } catch { return false; }
}

/** Does the config file reference our wrapper/plugin? */
function isConfigWired(entry, projectDir) {
  const needle = entry.engine === 'swc' ? 'withDesignless' : '@designless/annotate/babel';
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
