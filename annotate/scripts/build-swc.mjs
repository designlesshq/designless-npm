#!/usr/bin/env node
/**
 * Build every ABI variant of the SWC marker plugin.
 *
 * One source (swc-plugin/src/lib.rs), one behaviour, N pins - see
 * gen-abi-targets.mjs for why N is not 1 and why the targets are keyed on the
 * swc_plugin_runner rather than on a Next version.
 *
 * Every target must build. A partial artifact set is worse than none: the
 * wrapper would fail open on the missing ABI and silently stop stamping for
 * whichever Next release happens to land on it.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, readdirSync, existsSync } from 'node:fs'
import { TARGETS, generate } from '../gen-abi-targets.mjs'
generate()

// The base crate is the source of truth AND the runner-29 artifact.
const CRATES = [{ dir: 'swc-plugin', core: 68 }, ...TARGETS.map((t) => ({ dir: `swc-plugin-core${t.core}`, core: t.core }))]

let failed = 0
for (const { dir, core } of CRATES) {
  process.stdout.write(`building ${dir} (swc_core ${core}) ... `)
  try {
    execFileSync('cargo', ['build', '--release', '--locked', '--target', 'wasm32-wasip1', '--manifest-path', `${dir}/Cargo.toml`], { stdio: 'pipe' })
  } catch (e) {
    // --locked fails on a first build with no lockfile; retry once unlocked so
    // a fresh checkout can bootstrap, then the lockfile is committed.
    try {
      execFileSync('cargo', ['build', '--release', '--target', 'wasm32-wasip1', '--manifest-path', `${dir}/Cargo.toml`], { stdio: 'pipe' })
    } catch (e2) {
      console.log('FAILED')
      console.error(String(e2.stderr || e2.stdout || e2.message).split('\n').filter((l) => l.startsWith('error')).slice(0, 5).join('\n'))
      failed++
      continue
    }
  }
  const outDir = `${dir}/target/wasm32-wasip1/release`
  const wasm = readdirSync(outDir).find((f) => f.endsWith('.wasm'))
  if (!wasm) { console.log('FAILED (no .wasm emitted)'); failed++; continue }
  copyFileSync(`${outDir}/${wasm}`, `${dir}/annotate.wasm`)
  console.log('ok')
}

// Fail loudly if any artifact the package promises to ship is absent.
for (const { dir } of CRATES) {
  if (!existsSync(`${dir}/annotate.wasm`)) { console.error(`missing artifact: ${dir}/annotate.wasm`); failed++ }
}
if (failed) { console.error(`\n${failed} target(s) failed - do not publish.`); process.exit(1) }
console.log(`\nall ${CRATES.length} ABI targets built.`)
