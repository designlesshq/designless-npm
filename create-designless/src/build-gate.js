/**
 * create-designless - the build gate.
 *
 * Wiring is not the end of the scaffold; the project building afterwards is.
 * On a TypeScript project the compiler reads the config file we just wrapped,
 * so this is the one moment a missing declaration surfaces where the person
 * can see it, instead of in the next `next build`. The gate runs the
 * project's own type-check, reports the first errors in plain words, and,
 * when the errors are ours (the annotate package lacking declarations), says
 * which version to install. It never edits the project to make a check pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MIN_TYPED_VERSION = '0.4.1';

/** Pure: read a tsc transcript. */
function classifyTypecheck(output, exitCode) {
  const text = String(output || '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const errors = lines.filter((l) => /error TS\d+/.test(l));
  if (exitCode === 0 && errors.length === 0) return { ok: true, errors: [], cause: null };
  const ours = errors.filter((l) => /@designless\/annotate/.test(l) && /TS7016|TS2307|declaration file/.test(l));
  if (ours.length > 0) {
    return { ok: false, errors: errors.slice(0, 5), cause: 'annotate-declarations', fix: `Install a version of @designless/annotate that ships its declarations: npm install -D @designless/annotate@^${MIN_TYPED_VERSION}` };
  }
  return { ok: false, errors: errors.slice(0, 5), cause: errors.length ? 'project' : 'unknown', fix: errors.length ? 'These are the project\'s own type errors; fix them and run the type-check again.' : 'The type-check did not finish; run it by hand: npx tsc --noEmit' };
}

/** Is there anything to type-check here? A tsconfig and a resolvable compiler. */
function typecheckApplies(projectDir) {
  if (!fs.existsSync(path.join(projectDir, 'tsconfig.json'))) return { applies: false, reason: 'no tsconfig.json: nothing to type-check' };
  try { require.resolve('typescript/package.json', { paths: [projectDir] }); } catch { return { applies: false, reason: 'typescript is not installed in this project' }; }
  return { applies: true, reason: null };
}

/** Run the project's type-check. Returns the classification, never throws. */
function runTypecheck(projectDir, deps = {}) {
  const exec = deps.execFileSync || execFileSync;
  const applies = typecheckApplies(projectDir);
  if (!applies.applies) return { ok: null, skipped: applies.reason };
  let out = ''; let code = 0;
  try {
    out = exec('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json', '--pretty', 'false'], { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: Number(deps.timeoutMs || 180000) });
  } catch (e) { code = typeof e.status === 'number' ? e.status : 1; out = String(e.stdout || '') + String(e.stderr || ''); }
  return classifyTypecheck(out, code);
}

module.exports = { classifyTypecheck, typecheckApplies, runTypecheck, MIN_TYPED_VERSION };
