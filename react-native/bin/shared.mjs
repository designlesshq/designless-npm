/*
 * The bits both commands need: reading arguments, reaching a brand, and
 * reading the real name out of a font file.
 *
 * Neither command is allowed to guess. What a brand publishes is fetched,
 * and what a downloaded file actually calls itself is read out of the
 * file, because a build that references a name the file does not carry
 * renders in the platform font and says nothing about it.
 */

import { readFileSync } from "node:fs";

export const DEFAULT_BASE_URL = "https://cdn.designless.app";

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.slice(0, 2) !== "--") {
      out._.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const at = body.indexOf("=");
    if (at === -1) out[body] = true;
    else out[body.slice(0, at)] = body.slice(at + 1);
  }
  return out;
}

/*
 * An option a command does not know is a stop, not a shrug.
 *
 * A misspelled or renamed flag that is quietly ignored does not do
 * nothing: it does the default instead, which here means downloading a
 * different set of faces than the one that was asked for, and finding out
 * from a screen in the platform font weeks later. Renamed names are
 * listed so the message can say where the flag went rather than only that
 * it is gone.
 */
export function rejectUnknown(args, known) {
  for (const name of Object.keys(args)) {
    if (name === "_") continue;
    if (known.indexOf(name) !== -1) continue;
    fail(
      "--" +
        name +
        " is not an option this command has. It takes: " +
        known.map((option) => "--" + option).join(", ") +
        ".",
    );
  }
}

export function fail(message) {
  process.stderr.write("designless: " + message + "\n");
  process.exit(1);
}

export function say(message) {
  process.stdout.write(message + "\n");
}

function root(baseUrl, publicId) {
  return (
    baseUrl.replace(/\/+$/, "") + "/r/" + encodeURIComponent(publicId)
  );
}

export async function getJson(baseUrl, publicId, file, query) {
  const url = root(baseUrl, publicId) + "/" + file + (query ? "?" + query : "");
  let response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch (cause) {
    fail("could not reach " + url + ". " + String(cause && cause.message));
  }
  if (response.status === 404) {
    fail(
      "there is no brand at " +
        url +
        ". Check the public id, which looks like r_XXXX.",
    );
  }
  if (!response.ok) {
    fail(url + " answered " + String(response.status) + ".");
  }
  const version = versionOf(response.headers);
  return { body: await response.json(), version };
}

/*
 * Which published brand this answer came from.
 *
 * The three values arrive together under one prefix, so the prefix is
 * found on the response rather than pinned here, and a rename on the
 * serve surface does not need a release of this package to follow it.
 */
const VERSION_PREFIX = "x-brand-";

function prefixOn(headers) {
  if (headers.get(VERSION_PREFIX + "hash") !== null) return VERSION_PREFIX;
  let found = null;
  headers.forEach((_value, name) => {
    if (found !== null) return;
    const lower = String(name).toLowerCase();
    if (lower.slice(0, 2) !== "x-") return;
    if (lower.slice(-5) !== "-hash") return;
    const prefix = lower.slice(0, lower.length - 4);
    /* All three arrive together. A lone hash is a storage layer's own. */
    if (headers.get(prefix + "semver") === null) return;
    if (headers.get(prefix + "version") === null) return;
    found = prefix;
  });
  return found || VERSION_PREFIX;
}

export function versionOf(headers) {
  const prefix = prefixOn(headers);
  const raw = headers.get(prefix + "version");
  const count = raw === null ? NaN : Number(raw);
  return {
    hash: headers.get(prefix + "hash"),
    semver: headers.get(prefix + "semver"),
    version: Number.isFinite(count) ? count : null,
  };
}

export async function getBytes(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (cause) {
    return { error: String(cause && cause.message) };
  }
  if (!response.ok) return { error: "answered " + String(response.status) };
  const buffer = await response.arrayBuffer();
  return { bytes: Buffer.from(buffer) };
}

/*
 * The name a platform will resolve this file on.
 *
 * iOS, Android and everything on top of them look the face up by the
 * PostScript name recorded inside the file, not by the file name and not
 * by the family. This reads that record so a build can be checked rather
 * than hoped about. Font files are big-endian throughout.
 */
export function postscriptNameOf(bytes) {
  if (bytes.length < 12) return null;
  const tag = bytes.readUInt32BE(0);
  /* 0x74746366 is "ttcf", a collection of faces in one file. */
  if (tag === 0x74746366) return null;
  const tableCount = bytes.readUInt16BE(4);
  let nameOffset = null;
  for (let i = 0; i < tableCount; i += 1) {
    const record = 12 + i * 16;
    if (record + 16 > bytes.length) return null;
    if (bytes.toString("latin1", record, record + 4) === "name") {
      nameOffset = bytes.readUInt32BE(record + 8);
      break;
    }
  }
  if (nameOffset === null || nameOffset + 6 > bytes.length) return null;

  const count = bytes.readUInt16BE(nameOffset + 2);
  const stringsAt = nameOffset + bytes.readUInt16BE(nameOffset + 4);
  let fallback = null;
  for (let i = 0; i < count; i += 1) {
    const record = nameOffset + 6 + i * 12;
    if (record + 12 > bytes.length) break;
    /* Name id 6 is the PostScript name. */
    if (bytes.readUInt16BE(record + 6) !== 6) continue;
    const platform = bytes.readUInt16BE(record);
    const length = bytes.readUInt16BE(record + 8);
    const at = stringsAt + bytes.readUInt16BE(record + 10);
    if (at + length > bytes.length) continue;
    const slice = bytes.subarray(at, at + length);
    if (platform === 3) {
      /* Windows records two bytes per character, high byte first. */
      const copy = Buffer.from(slice);
      copy.swap16();
      return copy.toString("utf16le");
    }
    fallback = fallback || slice.toString("latin1");
  }
  return fallback;
}

export function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
