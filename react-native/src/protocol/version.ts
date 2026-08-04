/*
 * Which published brand a payload came from.
 *
 * The same three values arrive two ways: on the response headers of any
 * fetch, and inside the first frame of the live channel. Using one shape
 * for both means a change that arrives over the stream and a change found
 * by a refetch compare directly, and repeats cost nothing to ignore.
 */

import type { HttpResponse } from "../platform/globals";

export interface BrandVersion {
  /** Changes whenever anything about the published brand changes. */
  hash: string | null;
  /** The published version number, as text. */
  semver: string | null;
  /** The published version count. */
  version: number | null;
}

export const UNKNOWN_VERSION: BrandVersion = {
  hash: null,
  semver: null,
  version: null,
};

/**
 * The names these three values are carried under.
 *
 * All three arrive together under one prefix, so the prefix is found on
 * the response rather than pinned here. The name below is the one to
 * expect; a response that carries the three under any other prefix is
 * read just as well, which means a rename on the serve surface does not
 * need a release of this package to follow it.
 */
const PREFIX = "x-brand-";
const HASH = "hash";
const SEMVER = "semver";
const VERSION = "version";

/** Every header name on a response, lowercased. Empty when it will not say. */
function headerNames(response: HttpResponse): string[] {
  const names: string[] = [];
  const headers = response.headers;
  if (typeof headers.forEach !== "function") return names;
  headers.forEach((_value: string, name: string): void => {
    names.push(String(name).toLowerCase());
  });
  return names;
}

/**
 * The prefix this response carries the three values under.
 *
 * A hash header alone is not enough to go on. Storage and proxy layers
 * put their own hashes on an answer, and taking one of those for the
 * published version would compare a checksum against a brand and refetch
 * on every request. All three arrive together, so all three are what is
 * looked for.
 */
function prefixOn(response: HttpResponse): string {
  if (response.headers.get(PREFIX + HASH) !== null) return PREFIX;
  const suffix = "-" + HASH;
  const names = headerNames(response);
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    if (name.slice(0, 2) !== "x-") continue;
    if (name.slice(name.length - suffix.length) !== suffix) continue;
    const prefix = name.slice(0, name.length - HASH.length);
    if (response.headers.get(prefix + SEMVER) === null) continue;
    if (response.headers.get(prefix + VERSION) === null) continue;
    return prefix;
  }
  return PREFIX;
}

export function versionFromHeaders(response: HttpResponse): BrandVersion {
  const prefix = prefixOn(response);
  const raw = response.headers.get(prefix + VERSION);
  const parsed = raw === null ? NaN : Number(raw);
  return {
    hash: response.headers.get(prefix + HASH),
    semver: response.headers.get(prefix + SEMVER),
    version: Number.isFinite(parsed) ? parsed : null,
  };
}

/** Read the three values out of a live-channel frame body. */
export function versionFromFrame(data: string): BrandVersion | null {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const hash = parsed["hash"];
    const semver = parsed["semver"];
    const version = parsed["version"];
    return {
      hash: typeof hash === "string" ? hash : null,
      semver: typeof semver === "string" ? semver : null,
      version: typeof version === "number" ? version : null,
    };
  } catch {
    return null;
  }
}

/** True when two payloads came from the same published brand. */
export function sameVersion(a: BrandVersion | null, b: BrandVersion | null): boolean {
  if (!a || !b) return false;
  if (a.hash && b.hash) return a.hash === b.hash;
  return a.version !== null && a.version === b.version;
}
