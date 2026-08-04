/*
 * Every platform global this package touches, reached in one place.
 *
 * React Native provides fetch, XMLHttpRequest, the timers, console and
 * __DEV__ as globals, but which of them are typed depends on the React
 * Native version a customer has installed. Reading them off globalThis
 * with a narrow local shape keeps this package compiling against every
 * version in the supported range, and keeps the guards in one file
 * instead of scattered through the client.
 */

/** The slice of a fetch Response this package reads. */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: {
    get(name: string): string | null;
    /**
     * Optional because the shape of a Response's headers is not the same
     * on every React Native version, and nothing here may assume it.
     */
    forEach?(visit: (value: string, name: string) => void): void;
  };
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<HttpResponse>;

/** The slice of XMLHttpRequest the event-stream reader drives. */
export interface XhrLike {
  readyState: number;
  status: number;
  responseText: string;
  onreadystatechange: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string, async?: boolean): void;
  setRequestHeader(name: string, value: string): void;
  send(body?: unknown): void;
  abort(): void;
}

export type XhrConstructor = new () => XhrLike;

/** setTimeout returns a number in browsers and an object in some hosts. */
export type TimerHandle = unknown;

interface GlobalShape {
  fetch?: FetchLike;
  XMLHttpRequest?: XhrConstructor;
  __DEV__?: boolean;
  console?: { warn?: (message: string) => void };
  setTimeout?: (handler: () => void, ms: number) => TimerHandle;
  clearTimeout?: (handle: TimerHandle) => void;
}

function host(): GlobalShape {
  return globalThis as unknown as GlobalShape;
}

/** The platform fetch, or null when the host has none. */
export function getFetch(): FetchLike | null {
  const found = host().fetch;
  return typeof found === "function" ? found : null;
}

/** The platform XMLHttpRequest, or null when the host has none. */
export function getXhr(): XhrConstructor | null {
  const found = host().XMLHttpRequest;
  return typeof found === "function" ? found : null;
}

/** True in a development build. False in release and outside React Native. */
export function isDev(): boolean {
  return host().__DEV__ === true;
}

/** Warn once about something a developer can fix. Silent in release builds. */
export function devWarn(message: string): void {
  if (!isDev()) return;
  const c = host().console;
  if (c && typeof c.warn === "function") c.warn("Designless: " + message);
}

export function later(handler: () => void, ms: number): TimerHandle {
  const set = host().setTimeout;
  return set ? set(handler, ms) : null;
}

export function cancel(handle: TimerHandle): void {
  const clear = host().clearTimeout;
  if (clear && handle !== null && handle !== undefined) clear(handle);
}
