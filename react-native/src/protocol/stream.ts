/*
 * A reader for the live channel.
 *
 * React Native has no EventSource, and its fetch is layered over
 * XMLHttpRequest so a response body is never a stream. XMLHttpRequest
 * itself does deliver text progressively: readyState 3 fires again and
 * again while responseText grows. Reading the new tail on each fire and
 * cutting frames off it is the whole client.
 *
 * The channel sends a keep-alive comment every few seconds. Comments carry
 * no meaning, but they do prove the connection is alive, so any arriving
 * bytes count as activity and reset the watchdog.
 */

import { getXhr } from "../platform/globals";

export interface StreamFrame {
  /** The frame name, or null when the frame did not carry one. */
  event: string | null;
  /** The frame body, with multiple data lines joined by newlines. */
  data: string | null;
}

export interface StreamHandlers {
  /** A complete frame arrived. */
  onFrame(frame: StreamFrame): void;
  /** The channel asked for a reconnect delay, in milliseconds. */
  onRetry(ms: number): void;
  /** Any bytes arrived, keep-alive comments included. */
  onActivity(): void;
  /** The connection ended, for any reason. */
  onClose(): void;
}

export interface StreamHandle {
  close(): void;
}

/**
 * Cut whole frames off a buffer. Frames are separated by a blank line.
 * Returns the frames found and whatever tail did not form a frame yet.
 */
export function cutFrames(buffer: string): {
  frames: string[];
  rest: string;
} {
  const normalised = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalised.split("\n\n");
  const rest = parts.pop();
  return { frames: parts, rest: rest === undefined ? "" : rest };
}

/**
 * Read one frame. Lines that start with a colon are comments and carry no
 * value; the channel uses them as its keep-alive.
 *
 * The comment skip below is belt and braces: a comment line splits into an
 * empty field name, which matches none of the three fields, so it would be
 * dropped anyway. It stays because it is what the format says, and because
 * the two lines that make it redundant are not lines a future change is
 * obliged to keep.
 */
export function readFrame(raw: string): {
  frame: StreamFrame | null;
  retryMs: number | null;
} {
  let event: string | null = null;
  let retryMs: number | null = null;
  const dataLines: string[] = [];
  let sawField = false;
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.charAt(0) === ":") continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.charAt(0) === " ") value = value.slice(1);
    if (field === "event") {
      event = value;
      sawField = true;
    } else if (field === "data") {
      dataLines.push(value);
      sawField = true;
    } else if (field === "retry") {
      const ms = Number(value);
      if (Number.isFinite(ms) && ms > 0) retryMs = ms;
      sawField = true;
    }
    /* An id field would let a reconnect resume. The channel sends none. */
  }
  if (!sawField) return { frame: null, retryMs };
  if (event === null && dataLines.length === 0) return { frame: null, retryMs };
  return {
    frame: { event, data: dataLines.length ? dataLines.join("\n") : null },
    retryMs,
  };
}

/** Open the live channel. Returns a handle whose close stops everything. */
export function openEventStream(
  url: string,
  handlers: StreamHandlers,
): StreamHandle | null {
  const Xhr = getXhr();
  if (!Xhr) return null;

  const request = new Xhr();
  let consumed = 0;
  let buffer = "";
  let closed = false;

  const finish = (): void => {
    if (closed) return;
    closed = true;
    request.onreadystatechange = null;
    request.onerror = null;
    request.onabort = null;
    handlers.onClose();
  };

  const drain = (): void => {
    const whole = request.responseText || "";
    if (whole.length <= consumed) return;
    buffer += whole.slice(consumed);
    consumed = whole.length;
    handlers.onActivity();
    const cut = cutFrames(buffer);
    buffer = cut.rest;
    for (let i = 0; i < cut.frames.length; i += 1) {
      const read = readFrame(cut.frames[i]);
      if (read.retryMs !== null) handlers.onRetry(read.retryMs);
      if (read.frame) handlers.onFrame(read.frame);

    }
  };

  request.onreadystatechange = (): void => {
    if (closed) return;
    if (request.readyState === 3) {
      drain();
      return;
    }
    if (request.readyState === 4) {
      drain();
      finish();
    }
  };
  request.onerror = finish;
  request.onabort = finish;

  try {
    request.open("GET", url, true);
    request.setRequestHeader("accept", "text/event-stream");
    request.send();
  } catch {
    finish();
    return null;
  }

  return {
    close(): void {
      if (closed) return;
      closed = true;
      request.onreadystatechange = null;
      request.onerror = null;
      request.onabort = null;
      try {
        request.abort();
      } catch {
        /* Aborting a request that already ended is not a problem. */
      }
    },
  };
}
