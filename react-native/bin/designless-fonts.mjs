#!/usr/bin/env node
/*
 * Put the brand's font files into the app, and record what went in.
 *
 * React Native has no way to add a font while the app is running, so the
 * set of usable faces is fixed when the app is built. This command is how
 * that set gets filled: it downloads the files the brand publishes, reads
 * the name each file actually carries, and writes that list where the
 * package will look for it.
 *
 * The name is read out of the file rather than taken from the list on
 * trust. A build that references a name a file does not carry renders in
 * the platform font, does not throw, and does not log, so it is the one
 * thing here worth proving rather than assuming.
 *
 * Two steps are left to do by hand, because they belong to the app's own
 * build and this command should not edit it. Both are printed at the end.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import {
  DEFAULT_BASE_URL,
  fail,
  getBytes,
  getJson,
  parseArgs,
  postscriptNameOf,
  readJsonFile,
  rejectUnknown,
  say,
} from "./shared.mjs";

const USAGE = `Put your brand's fonts into a React Native app.

  npx designless-fonts --brand=r_XXXX

Options
  --brand=<public id>   Required, except with --check. The public id of
                        your brand.
  --roles=<which>       Which text roles to include. "body" (the default),
                        "all", or "none".
  --dir=<path>          Where to write the files. Default assets/fonts.
  --snapshot=<path>     The snapshot file to record the names in.
                        Default brand.snapshot.json.
  --check               Prove the recorded faces are still on disk under
                        the names the app looks them up by, and that your
                        build includes the folder. Writes nothing, and
                        exits 1 when something is missing.
  --base-url=<url>      Where to read the brand from.
`;

const ROLE_SETS = { body: ["body"], all: null, none: [] };

function chooseFamilies(families, wantedRoles) {
  const roles = ROLE_SETS[wantedRoles];
  if (roles === null) return families;
  if (roles.length === 0) return [];
  return families.filter((family) => {
    const named = family.roles || [];
    for (let i = 0; i < roles.length; i += 1) {
      if (named.indexOf(roles[i]) !== -1) return true;
    }
    return false;
  });
}

/*
 * Files that decide whether a folder of fonts ends up in the binary.
 *
 * Never evaluated. Running a project's own config to answer a question
 * about it is a much larger promise than this command should make.
 *
 * The two JSON ones are parsed and walked, because a substring search
 * over them passes for the wrong reasons. It passed on a config that
 * lists two of six faces, which is the default this command's own
 * printed instructions produce -- they truncate the list at two entries
 * and an ellipsis. And it passed on a config that mentions the folder in
 * a description string, where it decides nothing at all. Both of those
 * exit 0 while the app renders in the platform font, which is the single
 * thing --check exists to fail.
 *
 * The two JS ones cannot be read without running them, so they are still
 * a text search, and what that proves is said out loud rather than
 * reported as if it were the same answer.
 */
const JSON_CONFIGS = ["app.json", "app.config.json"];
const CODE_CONFIGS = [
  "app.config.js",
  "app.config.ts",
  "react-native.config.js",
  "react-native.config.ts",
];
const BUILD_CONFIGS = JSON_CONFIGS.concat(CODE_CONFIGS);

function forwardSlashes(path) {
  return path.split("\\").join("/");
}

function bareDir(dir) {
  const wanted = forwardSlashes(relative(".", dir)) || forwardSlashes(dir);
  return wanted.replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * Every asset path a parsed Expo config lists, from the two places that
 * decide whether a file reaches the binary.
 *
 * `plugins: [["expo-font", { fonts: [...] }]]` names files, or a folder
 * in the versions that accept one. `assetBundlePatterns` names patterns.
 * Anything else in the document is prose and is ignored, which is the
 * whole difference between this and a substring search.
 */
function listedAssets(parsed) {
  const out = [];
  const expo = parsed && typeof parsed === "object" ? parsed.expo || parsed : null;
  if (!expo || typeof expo !== "object") return out;

  const plugins = Array.isArray(expo.plugins) ? expo.plugins : [];
  for (const plugin of plugins) {
    if (!Array.isArray(plugin)) continue;
    if (plugin[0] !== "expo-font") continue;
    const config = plugin[1];
    if (!config || typeof config !== "object") continue;
    const fonts = config.fonts;
    if (!Array.isArray(fonts)) continue;
    for (const entry of fonts) {
      if (typeof entry === "string") out.push(entry);
      /* Newer shapes wrap each face in an object. */
      else if (entry && typeof entry === "object" && typeof entry.path === "string") {
        out.push(entry.path);
      }
    }
  }

  const patterns = expo.assetBundlePatterns;
  if (Array.isArray(patterns)) {
    for (const entry of patterns) if (typeof entry === "string") out.push(entry);
  }
  return out;
}

/** True when one listed entry would carry this file into the binary. */
function listedCovers(listed, filePath, dir) {
  const file = forwardSlashes(relative(".", filePath)).replace(/^\.\//, "");
  const folder = bareDir(dir);
  const entry = forwardSlashes(listed).replace(/^\.\//, "").replace(/\/+$/, "");
  if (entry === file) return true;
  /* The folder itself, however it was written, carries everything in it. */
  if (entry === folder) return true;
  if (entry === folder + "/*" || entry === folder + "/**" || entry === folder + "/**/*") {
    return true;
  }
  /* A pattern that reaches everything, which is the Expo default. */
  if (entry === "**/*") return true;
  return false;
}

/**
 * What the build config says about these files.
 *
 * `proof` is "listed" when a parsed config names every one of them,
 * "mentions" when only a config this command cannot parse names the
 * folder, and null when nothing does.
 */
function configCoverage(dir, files) {
  for (const name of JSON_CONFIGS) {
    if (!existsSync(name)) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(readFileSync(name, "utf8"));
    } catch {
      /* Unparseable JSON decides nothing, so it proves nothing. */
      continue;
    }
    const listed = listedAssets(parsed);
    if (listed.length === 0) continue;
    const unlisted = files.filter(
      (file) => !listed.some((entry) => listedCovers(entry, file, dir)),
    );
    return { config: name, proof: "listed", unlisted };
  }

  const folder = bareDir(dir);
  for (const name of CODE_CONFIGS) {
    if (!existsSync(name)) continue;
    let text = "";
    try {
      text = readFileSync(name, "utf8");
    } catch {
      continue;
    }
    if (text.indexOf(folder) !== -1) {
      return { config: name, proof: "mentions", unlisted: [] };
    }
  }
  return { config: null, proof: null, unlisted: files.slice() };
}

/*
 * What --check proves.
 *
 * The list in the snapshot records what was downloaded. Downloaded is not
 * the same as in the binary: the folder still has to be named by the
 * build, and a file can be renamed or deleted long after the command that
 * fetched it ran. Either way every string on the screen comes out in the
 * platform font, nothing throws, and nothing is logged, so the gap
 * between "the command was run once" and "this build has these faces" is
 * the one worth failing a build over.
 */
/** The extensions a face may have been written under. */
const FONT_EXTENSIONS = ["ttf", "otf"];

function fileFor(dir, name) {
  for (const extension of FONT_EXTENSIONS) {
    const path = join(dir, name + "." + extension);
    if (existsSync(path)) return path;
  }
  return null;
}

function check(snapshotPath, dir) {
  const snapshot = readJsonFile(snapshotPath);
  if (!snapshot) {
    fail(
      "there is no snapshot at " +
        snapshotPath +
        " to check. Take one: npx designless-snapshot --brand=r_XXXX",
    );
  }
  const recorded = Array.isArray(snapshot.fontsPresent)
    ? snapshot.fontsPresent
    : [];
  if (recorded.length === 0) {
    say(snapshotPath + " records no faces, so every role uses the platform font.");
    say("  Add them: npx designless-fonts --brand=" + (snapshot.publicId || "r_XXXX"));
    process.exit(1);
  }

  const missing = [];
  const found = [];
  for (const name of recorded) {
    const path = fileFor(dir, name);
    if (path) found.push(path);
    if (!path) {
      missing.push(
        name +
          ": no " +
          FONT_EXTENSIONS.join(" or ") +
          " file for it in " +
          forwardSlashes(dir) +
          ".",
      );
      continue;
    }
    let real = null;
    try {
      real = postscriptNameOf(readFileSync(path));
    } catch {
      missing.push(name + ": " + forwardSlashes(path) + " could not be read.");
      continue;
    }
    if (real === null) {
      missing.push(
        name +
          ": " +
          forwardSlashes(path) +
          " does not read as a font this platform can use.",
      );
      continue;
    }
    if (real !== name) {
      missing.push(
        name +
          ": " +
          forwardSlashes(path) +
          " calls itself " +
          real +
          ", so the app would look for a name that is not there.",
      );
    }
  }

  const coverage = configCoverage(dir, found);

  if (missing.length === 0 && coverage.proof === "listed" && coverage.unlisted.length === 0) {
    say(
      "All " +
        String(recorded.length) +
        " recorded faces are in " +
        forwardSlashes(dir) +
        " under the names the app looks them up by, and " +
        coverage.config +
        " lists every one of them.",
    );
    return;
  }

  if (missing.length === 0 && coverage.proof === "mentions") {
    /*
     * The honest answer for a config that is code. The folder is named
     * in it and this command cannot run it to find out what that line
     * does, so it says which half it proved rather than claiming both.
     */
    say(
      "All " +
        String(recorded.length) +
        " recorded faces are in " +
        forwardSlashes(dir) +
        " under the names the app looks them up by, and " +
        coverage.config +
        " names the folder.",
    );
    say(
      "That file is code, so this is not proof it reaches the binary. " +
        "Build the app once and check a screen.",
    );
    return;
  }

  for (const line of missing) say("Missing: " + line);

  if (coverage.proof === "listed" && coverage.unlisted.length > 0) {
    say(
      coverage.config +
        " does not list " +
        String(coverage.unlisted.length) +
        " of the " +
        String(found.length) +
        " files, so those would not reach the binary:",
    );
    for (const file of coverage.unlisted) {
      say("  " + forwardSlashes(relative(".", file)));
    }
    say("List every face, or list " + bareDir(dir) + " itself.");
  } else if (coverage.proof === null) {
    say(
      "No build config in this folder names " +
        forwardSlashes(dir) +
        ", so the files would not reach the binary. Checked: " +
        BUILD_CONFIGS.join(", ") +
        ".",
    );
  }

  say("");
  say("Text using these faces would render in the platform font, silently.");
  say("Put them back: npx designless-fonts --brand=" + (snapshot.publicId || "r_XXXX"));
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    say(USAGE);
    return;
  }
  rejectUnknown(args, [
    "brand",
    "roles",
    "dir",
    "snapshot",
    "check",
    "base-url",
    "help",
  ]);
  const dir = args.dir || join("assets", "fonts");
  const snapshotPath = args.snapshot || "brand.snapshot.json";

  /* Reads what is already here, so it needs no brand and no network. */
  if (args.check) {
    check(snapshotPath, dir);
    return;
  }

  const publicId = args.brand || args._[0];
  if (!publicId) fail("pass your brand: --brand=r_XXXX");

  const wantedRoles = args.roles || "body";
  if (!(wantedRoles in ROLE_SETS)) {
    fail(
      '--roles takes "body", "all" or "none". It was given "' +
        wantedRoles +
        '".',
    );
  }
  const baseUrl = args["base-url"] || DEFAULT_BASE_URL;

  const fonts = await getJson(baseUrl, publicId, "fonts.json");
  const format = (fonts.body.formats && fonts.body.formats.native) || "ttf";
  const chosen = chooseFamilies(fonts.body.families || [], wantedRoles);

  if (wantedRoles === "none") {
    say("No fonts were downloaded, so every role will use the platform font.");
    record(snapshotPath, []);
    return;
  }
  if (chosen.length === 0) {
    fail(
      "this brand publishes no font for the text roles --roles=" +
        wantedRoles +
        " covers. Try --roles=all to see everything it publishes.",
    );
  }

  mkdirSync(dir, { recursive: true });
  const written = [];
  const wrong = [];
  for (const family of chosen) {
    for (const face of family.faces || []) {
      const url = (face.src && (face.src[format] || face.src.ttf)) || "";
      if (!url) {
        wrong.push(face.postscriptName + " is published without a file.");
        continue;
      }
      const result = await getBytes(url);
      if (result.error) {
        wrong.push(face.postscriptName + " could not be downloaded: " + result.error);
        continue;
      }
      const real = postscriptNameOf(result.bytes);
      /*
       * A file whose name cannot be read is not written. The check exists
       * because a build that references a name a file does not carry
       * renders in the platform font and says nothing, and writing an
       * unreadable file records the name as present, which turns the one
       * warning that would have said so off as well. What arrived is not
       * a font this platform can register: a woff2 behind a ttf address,
       * a collection, or an error page with the wrong content type.
       */
      if (!real) {
        wrong.push(
          "the file for " +
            face.postscriptName +
            " does not read as a font this platform can use, so the name " +
            "it carries could not be checked.",
        );
        continue;
      }
      if (real !== face.postscriptName) {
        wrong.push(
          "the file for " +
            face.postscriptName +
            " calls itself " +
            real +
            ", so the app would look for a name that is not there.",
        );
        continue;
      }
      const path = join(dir, face.postscriptName + "." + format);
      writeFileSync(path, result.bytes);
      written.push({ name: face.postscriptName, path, family: family.family });
    }
  }

  for (const line of wrong) say("Skipped: " + line);
  if (written.length === 0) {
    fail("nothing was written, so this build would have no brand fonts.");
  }

  say("");
  const noun = written.length === 1 ? " file to " : " files to ";
  say("Wrote " + String(written.length) + noun + dir + ":");
  for (const face of written) say("  " + face.name + "  (" + face.family + ")");

  record(
    snapshotPath,
    written.map((face) => face.name),
  );

  say("");
  say("Three steps left. The first two belong to your app's build.");
  say("");
  say("1. Include the folder.");
  say("   Expo, in app.json under plugins:");
  say('     ["expo-font", { "fonts": [');
  for (let i = 0; i < written.length; i += 1) {
    const comma = i === written.length - 1 ? "" : ",";
    say('       "' + forwardSlashes(relative(".", written[i].path)) + '"' + comma);
  }
  say("     ] }]");
  say("   Every face, not the first few. A list missing one of them puts");
  say("   that one weight in the platform font and nothing says so.");
  say("   Bare React Native, in react-native.config.js:");
  say('     module.exports = { assets: ["./' + forwardSlashes(dir) + '"] };');
  say("   then run: npx react-native-asset");
  say("");
  say("   Both of these put the faces in the binary, where they are ready");
  say("   before the first frame. Loading them while the app runs instead,");
  say("   with useFonts or loadAsync, leaves every frame until that resolves");
  say("   in the platform font. If you do that, hold the first screen back");
  say("   until it has.");
  say("");
  say("2. Rebuild the app. A font added to a build is only in that build,");
  say("   so a reload over the old one will not pick it up.");
  say("");
  say("3. Keep it honest, in continuous integration:");
  say("     npx designless-fonts --check");
  say("   It fails the build when a recorded face is no longer on disk under");
  say("   the name the app looks it up by, or the folder is not in the build.");
}

function record(path, names) {
  const snapshot = readJsonFile(path);
  if (!snapshot) {
    say("");
    say("No snapshot at " + path + ", so pass the list to createBrand:");
    say("  fonts: { present: " + JSON.stringify(names) + " }");
    say("Or take a snapshot first: npx designless-snapshot --brand=...");
    return;
  }
  snapshot.fontsPresent = names;
  mkdirSync(dirname(path) || ".", { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n");
  say("");
  say("Recorded in " + path + ", so the app knows what it has.");
}

main().catch((cause) => {
  fail(String((cause && cause.message) || cause));
});
