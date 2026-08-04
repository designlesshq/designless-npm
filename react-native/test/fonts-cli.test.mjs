/*
 * What the font command writes into the app, and what it refuses to.
 *
 * The command downloads a file and reads the name out of it, because a
 * build that references a name a file does not carry renders in the
 * platform font, does not throw and does not log. That check is the whole
 * reason the command exists, and it has one failure mode of its own: a
 * payload it cannot read at all. Writing that file anyway records the name
 * as present, which also switches off the one development warning that
 * would have said the face was missing. Two silences, stacked.
 *
 * So the cases below are driven end to end against a local server, with
 * fonts built here rather than downloaded, and each asserts on what is on
 * disk afterwards rather than on what was printed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { packageRoot } from "./harness.mjs";

const COMMAND = join(packageRoot, "bin", "designless-fonts.mjs");
const runCommand = promisify(execFile);

/**
 * The smallest thing that is a font as far as the platforms are
 * concerned: a name table carrying name id 6, which is the only record
 * iOS and Android resolve a registered face on.
 */
function fontNamed(postscriptName) {
  const value = Buffer.from(postscriptName, "utf16le");
  /* Font files are big-endian throughout, including their strings. */
  value.swap16();

  const nameHeader = Buffer.alloc(18);
  nameHeader.writeUInt16BE(0, 0); /* format */
  nameHeader.writeUInt16BE(1, 2); /* one record */
  nameHeader.writeUInt16BE(18, 4); /* where the strings start */
  nameHeader.writeUInt16BE(3, 6); /* platform: Windows */
  nameHeader.writeUInt16BE(1, 8); /* encoding */
  nameHeader.writeUInt16BE(0x409, 10); /* language */
  nameHeader.writeUInt16BE(6, 12); /* name id 6: the PostScript name */
  nameHeader.writeUInt16BE(value.length, 14);
  nameHeader.writeUInt16BE(0, 16);
  const nameTable = Buffer.concat([nameHeader, value]);

  const header = Buffer.alloc(12);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(1, 4); /* one table */
  const record = Buffer.alloc(16);
  record.write("name", 0, "latin1");
  record.writeUInt32BE(0, 4);
  record.writeUInt32BE(28, 8);
  record.writeUInt32BE(nameTable.length, 12);

  return Buffer.concat([header, record, nameTable]);
}

/** A brand serving one family, with whatever bytes each face is given. */
async function serving(faces) {
  const files = {};
  const published = [];
  for (const face of faces) {
    files["/files/" + face.name] = face.bytes;
    published.push({
      weight: 400,
      style: "normal",
      postscriptName: face.name,
      src: { ttf: "/files/" + face.name },
    });
  }
  const server = createServer((request, response) => {
    if (request.url === "/r/r_TEST/fonts.json") {
      response.writeHead(200, {
        "content-type": "application/json",
        "x-brand-hash": "aaaa",
      });
      response.end(
        JSON.stringify({
          formats: { native: "ttf" },
          families: [
            { family: "Inter", roles: ["body"], faces: published },
          ],
        }),
      );
      return;
    }
    const body = files[request.url];
    if (!body) {
      response.writeHead(404);
      response.end("no");
      return;
    }
    response.writeHead(200, { "content-type": "font/ttf" });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  /* The published src is absolute, the way the real one is. */
  for (const face of published) face.src.ttf = base + face.src.ttf;
  return { base, server };
}

/*
 * Run the command in its own directory and hand back what it left.
 *
 * Asynchronously, because the server answering it is in this process: a
 * synchronous child would hold the loop the server needs to reply on.
 */
async function run(base, dir) {
  const snapshotPath = join(dir, "brand.snapshot.json");
  writeFileSync(
    snapshotPath,
    JSON.stringify({
      $schema: "designless-native-snapshot/v1",
      publicId: "r_TEST",
      fontsPresent: [],
    }),
  );
  const fontDir = join(dir, "fonts");
  const argv = [
    COMMAND,
    "--brand=r_TEST",
    "--base-url=" + base,
    "--dir=" + fontDir,
    "--snapshot=" + snapshotPath,
  ];
  let stdout = "";
  let failed = false;
  try {
    const done = await runCommand(process.execPath, argv, { encoding: "utf8" });
    stdout = done.stdout + done.stderr;
  } catch (cause) {
    failed = true;
    stdout = String(cause.stdout) + String(cause.stderr);
  }
  let written = [];
  try {
    written = readdirSync(fontDir);
  } catch {
    /* Nothing was written, which is an answer. */
  }
  return {
    failed,
    stdout,
    written,
    recorded: JSON.parse(readFileSync(snapshotPath, "utf8")).fontsPresent,
  };
}

test("a payload that does not read as a font is not written or recorded", async () => {
  const { base, server } = await serving([
    { name: "Inter-Regular", bytes: Buffer.from("wOF2 this is not a ttf") },
  ]);
  const result = await run(base, mkdtempSync(join(tmpdir(), "designless-fonts-")));
  server.close();

  assert.equal(result.failed, true, "nothing usable was written, so it fails");
  assert.match(result.stdout, /does not read as a font/);
  assert.equal(result.written.length, 0, "the unreadable file is not written");
  assert.deepEqual(
    result.recorded,
    [],
    "recording it would tell the app a face is present that is not, and " +
      "switch off the warning that would have said so",
  );
});

test("a file that calls itself something else is not written or recorded", async () => {
  const { base, server } = await serving([
    { name: "Inter-Regular", bytes: fontNamed("Helvetica-Bold") },
  ]);
  const result = await run(base, mkdtempSync(join(tmpdir(), "designless-fonts-")));
  server.close();

  assert.equal(result.failed, true);
  assert.match(result.stdout, /calls itself Helvetica-Bold/);
  assert.equal(result.written.length, 0);
  assert.deepEqual(result.recorded, []);
});

test("a file carrying the name it was published as is written and recorded", async () => {
  const { base, server } = await serving([
    { name: "Inter-Regular", bytes: fontNamed("Inter-Regular") },
  ]);
  const result = await run(base, mkdtempSync(join(tmpdir(), "designless-fonts-")));
  server.close();

  assert.equal(result.failed, false, result.stdout);
  assert.deepEqual(result.written, ["Inter-Regular.ttf"]);
  assert.deepEqual(result.recorded, ["Inter-Regular"]);
});

/*
 * What --check is for.
 *
 * The recorded list says what was downloaded once. Downloaded is not the
 * same as in the binary: the folder still has to be named by the build,
 * and a file can be deleted, renamed or replaced long after the command
 * that fetched it ran. Every one of those ends the same way, in the
 * platform font, with nothing thrown and nothing logged, which is why the
 * check runs in continuous integration rather than in someone's eye.
 *
 * These drive it against a folder on disk, with no network and no brand.
 */
function checkable(files, config) {
  const dir = mkdtempSync(join(tmpdir(), "designless-check-"));
  const fontDir = join(dir, "assets", "fonts");
  mkdirSync(fontDir, { recursive: true });
  for (const file of files) {
    writeFileSync(join(fontDir, file.file), file.bytes);
  }
  writeFileSync(
    join(dir, "brand.snapshot.json"),
    JSON.stringify({
      $schema: "designless-native-snapshot/v1",
      publicId: "r_TEST",
      fontsPresent: files.map((file) => file.recorded),
    }),
  );
  if (config) writeFileSync(join(dir, config.name), config.text);
  return dir;
}

async function runCheck(dir) {
  const argv = [COMMAND, "--check", "--dir=" + join("assets", "fonts")];
  try {
    const done = await runCommand(process.execPath, argv, {
      encoding: "utf8",
      cwd: dir,
    });
    return { failed: false, stdout: done.stdout + done.stderr };
  } catch (cause) {
    return { failed: true, stdout: String(cause.stdout) + String(cause.stderr) };
  }
}

const EXPO_CONFIG = {
  name: "app.json",
  text: JSON.stringify({
    expo: {
      plugins: [["expo-font", { fonts: ["assets/fonts/Inter-Regular.ttf"] }]],
    },
  }),
};

test("a build with the files and the folder in it passes", async () => {
  const dir = checkable(
    [
      {
        file: "Inter-Regular.ttf",
        recorded: "Inter-Regular",
        bytes: fontNamed("Inter-Regular"),
      },
    ],
    EXPO_CONFIG,
  );
  const result = await runCheck(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.failed, false, result.stdout);
  assert.match(result.stdout, /All 1 recorded faces are in/);
  assert.match(result.stdout, /app\.json lists every one of them/);
});

/*
 * The two ways --check used to pass a build that renders in the platform
 * font, which is the one thing it exists to fail.
 *
 * Both came from proving the config with a substring search. A search
 * cannot tell a list that carries a file from a list that carries a
 * different file, and it cannot tell either from prose.
 */

test("a config listing some of the faces fails, naming the ones it left out", async () => {
  /*
   * The likely default. This command's own printed instructions used to
   * truncate the file list at two entries and an ellipsis, so a project
   * with six faces copied two of them into app.json and the other four
   * were never in the binary. The folder string was there either way, so
   * the check said everything was fine.
   */
  const dir = checkable(
    [
      {
        file: "Inter-Regular.ttf",
        recorded: "Inter-Regular",
        bytes: fontNamed("Inter-Regular"),
      },
      {
        file: "Inter-SemiBold.ttf",
        recorded: "Inter-SemiBold",
        bytes: fontNamed("Inter-SemiBold"),
      },
    ],
    EXPO_CONFIG,
  );
  const result = await runCheck(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.failed, true, result.stdout);
  assert.match(result.stdout, /does not list 1 of the 2 files/);
  assert.match(result.stdout, /Inter-SemiBold\.ttf/);
  assert.doesNotMatch(
    result.stdout,
    /Inter-Regular\.ttf/,
    "the one that is listed is not reported as a problem",
  );
});

test("a config that only mentions the folder in prose fails", async () => {
  const dir = checkable(
    [
      {
        file: "Inter-Regular.ttf",
        recorded: "Inter-Regular",
        bytes: fontNamed("Inter-Regular"),
      },
    ],
    {
      name: "app.json",
      text: JSON.stringify({
        expo: { description: "fonts live in assets/fonts", plugins: [] },
      }),
    },
  );
  const result = await runCheck(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(
    result.failed,
    true,
    "a folder named in a description decides nothing: " + result.stdout,
  );
  assert.match(result.stdout, /No build config in this folder names/);
});

test("a config listing the folder itself carries everything in it", async () => {
  const dir = checkable(
    [
      {
        file: "Inter-Regular.ttf",
        recorded: "Inter-Regular",
        bytes: fontNamed("Inter-Regular"),
      },
      {
        file: "Inter-SemiBold.ttf",
        recorded: "Inter-SemiBold",
        bytes: fontNamed("Inter-SemiBold"),
      },
    ],
    {
      name: "app.json",
      text: JSON.stringify({
        expo: { plugins: [["expo-font", { fonts: ["assets/fonts"] }]] },
      }),
    },
  );
  const result = await runCheck(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.failed, false, result.stdout);
  assert.match(result.stdout, /All 2 recorded faces are in/);
});

test("assetBundlePatterns counts as listing them", async () => {
  const dir = checkable(
    [
      {
        file: "Inter-Regular.ttf",
        recorded: "Inter-Regular",
        bytes: fontNamed("Inter-Regular"),
      },
    ],
    {
      name: "app.json",
      text: JSON.stringify({ expo: { assetBundlePatterns: ["**/*"] } }),
    },
  );
  const result = await runCheck(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.failed, false, result.stdout);
});

test("the printed instructions name every face, not the first few", async () => {
  /*
   * The truncated list is where the partial config above comes from: the
   * block printed two paths and an ellipsis, and a developer copied what
   * was printed. So whatever this prints has to be a config that would
   * pass --check.
   */
  const { base, server } = await serving([
    { name: "Inter-Regular", bytes: fontNamed("Inter-Regular") },
    { name: "Inter-SemiBold", bytes: fontNamed("Inter-SemiBold") },
    { name: "Inter-Bold", bytes: fontNamed("Inter-Bold") },
  ]);
  const result = await run(base, mkdtempSync(join(tmpdir(), "designless-fonts-")));
  server.close();

  assert.equal(result.failed, false, result.stdout);
  assert.equal(result.written.length, 3, "three faces were written");
  assert.doesNotMatch(
    result.stdout,
    /\n\s*\.\.\.\n/,
    "an ellipsis in a config block is a config that is missing faces",
  );
  for (const file of result.written) {
    assert.ok(
      result.stdout.indexOf(file) !== -1,
      file + " was written and is not named in the printed config block",
    );
  }
});

test("a recorded face with no file behind it fails the build", async () => {
  const dir = checkable(
    [
      {
        file: "Inter-Regular.ttf",
        recorded: "Inter-Regular",
        bytes: fontNamed("Inter-Regular"),
      },
    ],
    EXPO_CONFIG,
  );
  /* The file leaves, the record stays. Which is the whole failure. */
  rmSync(join(dir, "assets", "fonts", "Inter-Regular.ttf"));
  const result = await runCheck(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.failed, true, "a recorded face that is not there fails");
  assert.match(result.stdout, /Missing: Inter-Regular/);
  assert.match(result.stdout, /platform font, silently/);
});

test("a file replaced by one calling itself something else fails the build", async () => {
  const dir = checkable(
    [
      {
        file: "Inter-Regular.ttf",
        recorded: "Inter-Regular",
        bytes: fontNamed("Helvetica-Bold"),
      },
    ],
    EXPO_CONFIG,
  );
  const result = await runCheck(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.failed, true);
  assert.match(result.stdout, /calls itself Helvetica-Bold/);
});

test("files nothing in the build includes fail, however good they are", async () => {
  /*
   * The half of this that the download could never see. Every file is on
   * disk under the right name, and no build config mentions the folder,
   * so none of them reach the binary.
   */
  const dir = checkable([
    {
      file: "Inter-Regular.ttf",
      recorded: "Inter-Regular",
      bytes: fontNamed("Inter-Regular"),
    },
  ]);
  const result = await runCheck(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.failed, true, "downloaded is not the same as included");
  assert.match(result.stdout, /No build config in this folder names/);
});

test("a bare React Native config naming the folder is enough", async () => {
  const dir = checkable(
    [
      {
        file: "Inter-Regular.ttf",
        recorded: "Inter-Regular",
        bytes: fontNamed("Inter-Regular"),
      },
    ],
    {
      name: "react-native.config.js",
      text: 'module.exports = { assets: ["./assets/fonts"] };\n',
    },
  );
  const result = await runCheck(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.failed, false, result.stdout);
  assert.match(result.stdout, /react-native\.config\.js names the folder/);
  assert.match(
    result.stdout,
    /That file is code, so this is not proof it reaches the binary/,
    "a config this command cannot read is not the same answer as one it can",
  );
});

test("a snapshot recording nothing fails rather than passing quietly", async () => {
  const dir = checkable([], EXPO_CONFIG);
  const result = await runCheck(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.failed, true, "no faces is not the same as nothing wrong");
  assert.match(result.stdout, /records no faces/);
});

test("one bad face among good ones is dropped, and only the good are recorded", async () => {
  /*
   * The case the check is really for. A run that half worked still writes
   * a build, and the list it records is what the app will believe. A name
   * in that list with nothing behind it is a role that renders in the
   * platform font with the warning turned off.
   */
  const { base, server } = await serving([
    { name: "Inter-Regular", bytes: fontNamed("Inter-Regular") },
    { name: "Inter-SemiBold", bytes: Buffer.from("wOF2 not a ttf either") },
  ]);
  const result = await run(base, mkdtempSync(join(tmpdir(), "designless-fonts-")));
  server.close();

  assert.equal(result.failed, false, result.stdout);
  assert.deepEqual(result.written, ["Inter-Regular.ttf"]);
  assert.deepEqual(
    result.recorded,
    ["Inter-Regular"],
    "the face that never landed is not claimed to be in the build",
  );
  assert.match(result.stdout, /Skipped: .*Inter-SemiBold/);
});
