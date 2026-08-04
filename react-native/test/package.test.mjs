/*
 * What the package says it ships, and whether it does.
 *
 * Every command named here is also named in a warning the package prints,
 * so a missing one is not a packaging detail. It is the package telling a
 * customer to run something that does not exist, at the moment they are
 * already looking at text in the wrong font.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { packageRoot } from "./harness.mjs";

const manifest = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
);

test("every path the package ships exists", () => {
  for (const entry of manifest.files) {
    assert.equal(
      existsSync(join(packageRoot, entry)),
      true,
      entry + " is in files and is not there",
    );
  }
});

test("every command the package declares exists and runs", () => {
  const names = Object.keys(manifest.bin);
  assert.equal(names.length > 0, true);
  for (const name of names) {
    const path = join(packageRoot, manifest.bin[name]);
    assert.equal(existsSync(path), true, name + " is declared and is not there");
    const help = execFileSync(process.execPath, [path, "--help"], {
      encoding: "utf8",
    });
    assert.match(help, /--brand=/, name + " does not say how to use it");
  }
});

test("every command the package names in a warning is one it ships", () => {
  const bundle = readFileSync(join(packageRoot, "dist", "index.cjs"), "utf8");
  const named = bundle.match(/npx (designless-[a-z-]+)/g) || [];
  assert.equal(named.length > 0, true, "no command is named in the bundle");
  for (const line of named) {
    const command = line.slice(4);
    assert.equal(
      command in manifest.bin,
      true,
      "the package tells a customer to run " + command + " and does not ship it",
    );
  }
});

test("an option a command does not know stops it, rather than being ignored", () => {
  /*
   * A flag that is quietly dropped does not do nothing. It does the
   * default instead, so a mistyped --roles downloads the body role only
   * and the build looks like it worked. That reaches someone as text in
   * the platform font weeks later, with no way back to the typo.
   *
   * Every case here is a flag these commands do not have, and each is
   * answered the same way: the list of options they do take.
   */
  const cases = [
    ["designless-fonts", "--role=all", /is not an option this command has/],
    ["designless-fonts", "--dirr=x", /is not an option this command has/],
    ["designless-snapshot", "--apperance=dark", /is not an option this command has/],
  ];
  for (const [command, option, expected] of cases) {
    const path = join(packageRoot, manifest.bin[command]);
    let failed = false;
    try {
      execFileSync(process.execPath, [path, "--brand=r_TEST", option], {
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (cause) {
      failed = true;
      assert.match(String(cause.stderr), expected, command + " " + option);
    }
    assert.equal(failed, true, command + " carried on past " + option);
  }
});

test("a command asked for nothing says what it needs, and fails", () => {
  const path = join(packageRoot, manifest.bin["designless-fonts"]);
  let failed = false;
  try {
    execFileSync(process.execPath, [path], { encoding: "utf8", stdio: "pipe" });
  } catch (cause) {
    failed = true;
    assert.match(String(cause.stderr), /--brand=/);
  }
  assert.equal(failed, true, "it should not carry on without a brand");
});
