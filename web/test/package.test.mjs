/*
 * Guards on the built artifacts and on the package manifest.
 * Build first: npm run build (the package test script does this).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("both builds are self contained with zero runtime imports", () => {
  const esm = readFileSync(join(packageRoot, "dist", "index.mjs"), "utf8");
  const cjs = readFileSync(join(packageRoot, "dist", "index.cjs"), "utf8");
  assert.ok(esm.includes("export "), "the ESM build exports");
  assert.ok(!/\bfrom\s+"/.test(esm), "the ESM build imports nothing");
  assert.ok(cjs.includes("module.exports"), "the CJS build exports");
  assert.ok(!/\brequire\(\s*"/.test(cjs), "the CJS build requires nothing");
});

test("declarations exist for both module systems", () => {
  const dts = readFileSync(join(packageRoot, "dist", "index.d.ts"), "utf8");
  const dcts = readFileSync(join(packageRoot, "dist", "index.d.cts"), "utf8");
  assert.ok(dts.includes("loadDesignless"), "d.ts declares the loader");
  assert.equal(dts, dcts, "the cts copy matches the ts declarations");
});

test("the manifest is publish ready and dependency free", () => {
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  );
  assert.equal(manifest.name, "@designless/web");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal(manifest.private, undefined, "the package is not private");
  assert.equal(manifest.dependencies, undefined, "zero runtime dependencies");
  // The source is public and lives here, so npm renders a source link. This
  // is the same shape @designless/annotate declares; the directory has to
  // match this package's folder or the link resolves to the repo root.
  assert.equal(manifest.repository.type, "git");
  assert.equal(
    manifest.repository.url,
    "git+https://github.com/designlesshq/designless-npm.git",
  );
  assert.equal(manifest.repository.directory, "web");
  assert.equal(manifest.homepage, "https://designless.app");
});

test("no long dash characters anywhere in the package", () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".turbo") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|cts|mjs|cjs|js|json|md)$/.test(name)) files.push(path);
    }
  };
  walk(packageRoot);
  assert.ok(files.length >= 8, "expected to scan the package files");
  for (const path of files) {
    const content = readFileSync(path, "utf8");
    assert.ok(
      !/[\u2013\u2014]/.test(content),
      "long dash found in " + path,
    );
  }
});
