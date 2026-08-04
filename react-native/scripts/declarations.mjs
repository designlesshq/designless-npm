/*
 * Make the emitted declarations resolvable, under every resolver.
 *
 * esbuild bundles the runtime into one file, but tsc emits declarations as
 * a tree, and a tree is where the two resolution modes disagree. This
 * package is "type": "module", so under node16 and nodenext a relative
 * specifier in a .d.ts without a file extension is an error, and TypeScript
 * answers that error by giving the consumer `any` for the whole package.
 * Nothing fails; the types just quietly stop existing.
 *
 * So two passes. The first adds the extension the ESM declarations need.
 * The second writes the .d.cts twin the "require" condition resolves to,
 * because a declaration file that is ESM cannot be the answer for a
 * require() and reporting one is how a package ends up masquerading.
 *
 * Both are mechanical, and both are checked by test/package.test.mjs.
 */

import {
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

/** Every relative module specifier a declaration file can carry. */
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)(["'])(\.\.?\/[^"']*)\2/g;

function withExtension(source, extension) {
  return source.replace(SPECIFIER, (whole, lead, quote, path) => {
    if (/\.(js|cjs|mjs|json)$/.test(path)) return whole;
    return lead + quote + path + extension + quote;
  });
}

function declarationsIn(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...declarationsIn(path));
    } else if (entry.endsWith(".d.cts")) {
      /* Written here, not by tsc, so a stale one outlives its source. */
      rmSync(path);
    } else if (entry.endsWith(".d.ts")) {
      found.push(path);
    }
  }
  return found;
}

const files = declarationsIn(dist);
if (files.length === 0) {
  process.stderr.write("designless: no declarations were emitted.\n");
  process.exit(1);
}

for (const path of files) {
  const source = readFileSync(path, "utf8");
  writeFileSync(path, withExtension(source, ".js"));
  writeFileSync(
    path.slice(0, -".d.ts".length) + ".d.cts",
    withExtension(source, ".cjs"),
  );
}
