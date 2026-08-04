/*
 * Whether the types this package ships can be used.
 *
 * Nothing else in this directory can see any of this. Every other test
 * runs the compiled bundle, and the compiled bundle is correct: these are
 * failures that happen in the customer's compiler, on the exact lines the
 * readme tells them to write, while every runtime assertion here stays
 * green. Three of them shipped at once.
 *
 * So a real consumer is built in a temporary directory, reaching the
 * package the way an installed one is reached, and compiled. The negative
 * control matters as much as the rest: if the declarations fail to
 * resolve, TypeScript does not complain, it silently hands the consumer
 * `any`, and every assertion below would pass against nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { packageRoot, snapshotFrom } from "./harness.mjs";

const runCommand = promisify(execFile);
const TSC = join(packageRoot, "node_modules", "typescript", "bin", "tsc");

/** The module setting each resolution mode is paired with in practice. */
const MODULE = { bundler: "esnext", node10: "commonjs" };

/** React Native's own fontWeight, copied from its style declarations. */
const RN_FONT_WEIGHT = `"normal" | "bold" | "100" | "200" | "300" | "400" |
  "500" | "600" | "700" | "800" | "900"`;

const USES = `
import {
  createBrand,
  isSnapshot,
  sizeForPoints,
} from "@designless/react-native";
import type {
  BrandSnapshot,
  TextStyle,
} from "@designless/react-native";

/*
 * The negative control. If the package resolved to \`any\`, this raises
 * nothing and TypeScript reports the expect-error itself as unused, which
 * fails the compile just the same. Either way a collapse is not silent.
 */
// @ts-expect-error a size off the list is a number, not a string
const notAString: string = sizeForPoints(24);
void notAString;

/*
 * A text style has to go into a Text component, and React Native's style
 * type is a narrow union. A fontWeight typed \`string\` does not go in,
 * and theme.text() is the only supported way to build one, so there is no
 * way round it.
 */
declare const style: TextStyle;
const weight: (${RN_FONT_WEIGHT}) | undefined = style.fontWeight;
void weight;

/*
 * The readme's own cold-start line, against a file the shipped snapshot
 * command wrote. Every string in an imported json file widens, which is
 * what a union on any of these fields fails on. isSnapshot is what
 * actually decides whether a file is one of these.
 */
import imported from "../brand.snapshot.json";
const snapshot: BrandSnapshot = imported;
void isSnapshot(snapshot);

const brand = createBrand({ publicId: "r_XXXX", snapshot, autoInit: false });
void brand.asset("logo-symbol", { pt: 40 });
`;

/** A consumer that reaches the package the way an installed one does. */
function consumer(moduleResolution) {
  const dir = mkdtempSync(join(tmpdir(), "designless-types-"));
  mkdirSync(join(dir, "node_modules", "@designless"), { recursive: true });
  symlinkSync(
    packageRoot,
    join(dir, "node_modules", "@designless", "react-native"),
    "dir",
  );
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "uses.ts"), USES);
  /*
   * A real captured payload, in the shape the snapshot command writes,
   * because the failure being guarded against is what json import does to
   * the types of these fields and a hand-written stub does not do it.
   */
  writeFileSync(
    join(dir, "brand.snapshot.json"),
    JSON.stringify(snapshotFrom("tokens.dark.json", [])),
  );
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        /* What React Native and Expo both set, and what makes a failure
         * to resolve the declarations silent rather than loud. */
        skipLibCheck: true,
        target: "es2020",
        module: MODULE[moduleResolution] || moduleResolution,
        moduleResolution,
        types: [],
        /* Both set by @react-native/typescript-config and by expo. */
        resolveJsonModule: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
      include: ["src"],
    }),
  );
  return dir;
}

async function compile(moduleResolution) {
  const dir = consumer(moduleResolution);
  try {
    await runCommand(process.execPath, [TSC, "--noEmit", "-p", dir], {
      encoding: "utf8",
    });
    return "";
  } catch (cause) {
    return String(cause.stdout) + String(cause.stderr);
  }
}

/*
 * bundler is what React Native and Expo set. node16 and nodenext are
 * where an unbundled declaration tree in a "type": "module" package stops
 * resolving, and where the require condition needs its own .d.cts rather
 * than an ESM file wearing its name.
 */
for (const resolution of ["bundler", "node16", "nodenext", "node10"]) {
  test("the shipped types compile for a consumer on " + resolution, async () => {
    assert.equal(await compile(resolution), "");
  });
}
