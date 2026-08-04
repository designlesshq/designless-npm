/*
 * One error type for every way a brand request can fail.
 *
 * The serve surfaces answer failures in three shapes: a plain-text sentence
 * that names the accepted values, a JSON object with an "error" code and a
 * "message", and a shorter JSON object with only an "error". Normalising
 * them here means an app writes one catch and reads one field, and the
 * server's own words always survive into `detail`.
 */

import type { HttpResponse } from "../platform/globals";

/*
 * Every error carries exactly one of these, and which one it is decides
 * two things: what an app can branch on, and whether the request is worth
 * making again. So the list has no fall-through category that means both
 * "something came back" and "nothing did": "network" is only ever the
 * second, and every answer with a status has a code of its own.
 */
export type BrandErrorCode =
  | "not_found"
  | "bad_request"
  | "plan"
  | "not_implemented"
  /** The request was refused because it was not recognised. */
  | "unauthorized"
  /** The request was recognised and still not allowed. */
  | "forbidden"
  /** Too many requests. Asking again straight away makes it worse. */
  | "too_many_requests"
  /** Refused for a reason this package has no more specific word for. */
  | "refused"
  /** The surface failed rather than refused, so it is worth asking again. */
  | "server"
  | "timeout"
  /** Nothing came back at all. */
  | "network"
  | "malformed";

export class BrandError extends Error {
  /** HTTP status, or null when the request never got a response. */
  readonly status: number | null;
  /** A stable code to branch on. */
  readonly code: BrandErrorCode;
  /** The address that failed. */
  readonly url: string;
  /** What the server said, in its own words. Empty when it said nothing. */
  readonly detail: string;
  /**
   * How long the server asked to be left alone, in milliseconds, when it
   * said. Null when it said nothing, which is most of the time.
   */
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    options: {
      status?: number | null;
      code: BrandErrorCode;
      url: string;
      detail?: string;
      retryAfterMs?: number | null;
    },
  ) {
    super(message);
    this.name = "BrandError";
    this.status = options.status === undefined ? null : options.status;
    this.code = options.code;
    this.url = options.url;
    this.detail = options.detail || "";
    this.retryAfterMs =
      options.retryAfterMs === undefined ? null : options.retryAfterMs;
    /* Keeps instanceof working when this class is downlevelled. */
    Object.setPrototypeOf(this, BrandError.prototype);
  }
}

/*
 * Every answer that came back with a status gets a code that says so.
 *
 * Falling through to "network" would be wrong twice. It tells an app that
 * a refusal it could act on was a connection it can only wait out, and it
 * is the code the retry loop treats as worth trying again, so a client
 * that was told to slow down asks three times instead of once.
 *
 * 501 is the one status above 500 that is not a fault. The address is
 * reserved and answers deliberately, so it is an answer like any other.
 */
function codeForStatus(status: number): BrandErrorCode {
  if (status === 400) return "bad_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 402) return "plan";
  if (status === 404) return "not_found";
  if (status === 429) return "too_many_requests";
  if (status === 501) return "not_implemented";
  if (status >= 500) return "server";
  return "refused";
}

/**
 * How long the server asked to be left alone. The header carries either a
 * count of seconds or a date, and both are in use.
 */
export function retryAfterMs(raw: string | null): number | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return seconds < 0 ? null : seconds * 1000;
  const at = Date.parse(text);
  if (!Number.isFinite(at)) return null;
  const wait = at - Date.now();
  return wait > 0 ? wait : 0;
}

/** Pull the server's own words out of whichever encoding it used. */
export function readDetail(body: string): string {
  const text = body.trim();
  if (!text) return "";
  if (text.charAt(0) !== "{") return text;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const message = parsed["message"];
    if (typeof message === "string" && message) return message;
    const error = parsed["error"];
    if (typeof error === "string" && error) return error;
  } catch {
    /* Not JSON after all. The raw text is still the best answer. */
  }
  return text;
}

/** Build the error for a response that came back but was not a success. */
export async function errorFromResponse(
  response: HttpResponse,
  url: string,
): Promise<BrandError> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    /* A body that will not read is not worth failing over. */
  }
  const detail = readDetail(body);
  const code = codeForStatus(response.status);
  let asked: string | null = null;
  try {
    asked = response.headers.get("retry-after");
  } catch {
    /* Not every host's headers answer for a name that is not there. */
  }
  const message = detail
    ? detail
    : "The brand request to " + url + " failed with status " + response.status + ".";
  return new BrandError(message, {
    status: response.status,
    code,
    url,
    detail,
    retryAfterMs: retryAfterMs(asked),
  });
}

/** The request never completed: no network, or it ran out of time. */
export function transportError(
  url: string,
  reason: "timeout" | "network",
  cause?: unknown,
): BrandError {
  const message =
    reason === "timeout"
      ? "The brand request to " + url + " ran out of time."
      : "The brand request to " + url + " could not reach the network.";
  const detail = cause instanceof Error ? cause.message : "";
  return new BrandError(message, { status: null, code: reason, url, detail });
}
