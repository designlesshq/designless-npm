#!/usr/bin/env node
/*
 * Take a copy of the brand to ship inside the app.
 *
 * React Native cannot read storage before the first frame, so on a cold
 * install with no network there is nothing to paint with. A file imported
 * like any other json is already in memory before anything renders, which
 * is what this writes.
 *
 * A copy in a repository goes stale, and a stale copy turns a published
 * brand change into something that needs an app release. So this command
 * also has a check mode: it compares the committed file against what is
 * published and exits non-zero when they differ, which is the part that
 * belongs in continuous integration.
 *
 * What is in the app binary is not touched here. That is written by
 * designless-fonts, which knows because it put the files there, and an
 * existing list is carried across a refresh rather than overwritten.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  DEFAULT_BASE_URL,
  fail,
  getJson,
  parseArgs,
  readJsonFile,
  rejectUnknown,
  say,
} from "./shared.mjs";

const SCHEMA = "designless-native-snapshot/v1";

const USAGE = `Take a copy of your brand to ship inside the app.

  npx designless-snapshot --brand=r_XXXX

Options
  --brand=<public id>   Required. The public id of your brand.
  --appearance=<which>  "light" or "dark". Default light.
  --out=<path>          Where to write it. Default brand.snapshot.json.
  --check               Compare the file on disk with what is published
                        and exit 1 if they differ. Writes nothing.
  --base-url=<url>      Where to read the brand from.
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    say(USAGE);
    return;
  }
  rejectUnknown(args, [
    "brand",
    "appearance",
    "out",
    "check",
    "base-url",
    "help",
  ]);
  const publicId = args.brand || args._[0];
  if (!publicId) fail("pass your brand: --brand=r_XXXX");

  const appearance = args.appearance || "light";
  if (appearance !== "light" && appearance !== "dark") {
    fail('--appearance takes "light" or "dark".');
  }
  const baseUrl = args["base-url"] || DEFAULT_BASE_URL;
  const out = args.out || "brand.snapshot.json";

  const tokens = await getJson(
    baseUrl,
    publicId,
    "tokens.json",
    "appearance=" + appearance,
  );
  const fonts = await getJson(baseUrl, publicId, "fonts.json");

  const existing = readJsonFile(out);

  if (args.check) {
    if (!existing) fail("there is no file at " + out + " to check.");
    const same =
      existing.version &&
      existing.version.hash === tokens.version.hash &&
      existing.appearance === appearance &&
      existing.publicId === publicId;
    if (!same) {
      say(out + " is not the brand that is published now.");
      say("  in the file: " + describe(existing));
      say("  published:   " + describe({ appearance, version: tokens.version }));
      say("Refresh it: npx designless-snapshot --brand=" + publicId);
      process.exit(1);
    }
    say(out + " matches what is published.");
    return;
  }

  const snapshot = {
    $schema: SCHEMA,
    publicId,
    fetchedAt: new Date().toISOString(),
    appearance,
    version: tokens.version,
    tokens: tokens.body,
    fonts: fonts.body,
    /* Written by designless-fonts, and carried across a refresh. */
    fontsPresent:
      existing && Array.isArray(existing.fontsPresent)
        ? existing.fontsPresent
        : [],
  };

  mkdirSync(dirname(out) || ".", { recursive: true });
  writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");

  say("Wrote " + out + " (" + describe(snapshot) + ").");
  say("");
  say("Pass it to the provider so the first frame is already your brand:");
  say('  import snapshot from "./' + out.split("\\").join("/") + '";');
  say('  <DesignlessProvider publicId="' + publicId + '" snapshot={snapshot}>');
  if (snapshot.fontsPresent.length === 0) {
    say("");
    say("No fonts in this build yet, so text will use the platform font.");
    say("  npx designless-fonts --brand=" + publicId);
  }
}

function describe(snapshot) {
  const version = snapshot.version || {};
  const hash = version.hash ? version.hash.slice(0, 8) : "unknown";
  return (
    (snapshot.appearance || "?") +
    ", version " +
    String(version.semver || version.version || "unknown") +
    " (" +
    hash +
    ")"
  );
}

main().catch((cause) => {
  fail(String((cause && cause.message) || cause));
});
