/*
 * One JSON GET, with a time limit and a few retries.
 *
 * The time limit is a race against a timer rather than an abort signal.
 * AbortSignal.timeout is missing on the older half of the React Native
 * versions this package supports, and a request that hangs forever on a
 * captive portal is the exact case the limit is here for.
 *
 * Retries cover transport faults and server faults only. A 400 or a 404
 * is an answer, not a hiccup, and asking again just wastes the battery.
 * A 429 is the one where asking again is worse than wasteful: the surface
 * has just said there have been too many requests, and three more is the
 * wrong reply. It is left to the brand's own schedule instead.
 */

import { getFetch, later, cancel } from "../platform/globals";
import { BrandError, errorFromResponse, transportError } from "./errors";
import { versionFromHeaders } from "./version";
import type { BrandVersion } from "./version";

export interface Fetched<T> {
  body: T;
  version: BrandVersion;
}

export interface RequestOptions {
  /** Give up on a single attempt after this long. */
  timeoutMs: number;
  /** How many times to try in total, including the first. */
  attempts?: number;
}

/** 400ms, 1200ms, 3600ms, each with full jitter so clients do not sync up. */
function backoffMs(attempt: number): number {
  const ceiling = 400 * Math.pow(3, attempt);
  return Math.floor(Math.random() * ceiling);
}

/*
 * Read off the code, not the status.
 *
 * Every answer that came back carries a code that says what kind of
 * answer it was, so this is the whole list: nothing arrived, or the
 * surface failed rather than refused. Reading the status instead put 501
 * in here, which is an address answering deliberately that it is reserved,
 * and asking it twice more changes nothing but the battery.
 */
function worthRetrying(error: BrandError): boolean {
  return (
    error.code === "timeout" ||
    error.code === "network" ||
    error.code === "server"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    later(resolve, ms);
  });
}

async function attemptOnce<T>(
  url: string,
  timeoutMs: number,
): Promise<Fetched<T>> {
  const doFetch = getFetch();
  if (!doFetch) {
    throw transportError(url, "network");
  }
  let timer: unknown = null;
  let timedOut = false;
  const limit = new Promise<never>((_resolve, reject) => {
    timer = later(() => {
      timedOut = true;
      reject(transportError(url, "timeout"));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      doFetch(url, { headers: { accept: "application/json" } }),
      limit,
    ]);
    if (!response.ok) {
      throw await errorFromResponse(response, url);
    }
    const text = await response.text();
    let body: T;
    try {
      body = JSON.parse(text) as T;
    } catch (cause) {
      throw new BrandError(
        "The reply from " + url + " was not readable.",
        {
          status: response.status,
          code: "malformed",
          url,
          detail: cause instanceof Error ? cause.message : "",
        },
      );
    }
    return { body, version: versionFromHeaders(response) };
  } catch (cause) {
    if (cause instanceof BrandError) throw cause;
    if (timedOut) throw transportError(url, "timeout", cause);
    throw transportError(url, "network", cause);
  } finally {
    cancel(timer);
  }
}

/** Fetch and parse one JSON address, retrying only what is worth retrying. */
export async function getJson<T>(
  url: string,
  options: RequestOptions,
): Promise<Fetched<T>> {
  const attempts = options.attempts === undefined ? 3 : options.attempts;
  let last: BrandError | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await attemptOnce<T>(url, options.timeoutMs);
    } catch (cause) {
      const error =
        cause instanceof BrandError ? cause : transportError(url, "network", cause);
      last = error;
      if (!worthRetrying(error) || attempt === attempts - 1) throw error;
      await sleep(backoffMs(attempt));
    }
  }
  /* Unreachable: the loop either returns or throws. */
  throw last || transportError(url, "network");
}
