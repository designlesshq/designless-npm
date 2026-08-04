/*
 * The only place in this package that builds an address.
 *
 * Two rules hold here, and they are the reason this file exists alone.
 *
 * First: appearance is always sent. Leaving it off does not mean "whatever
 * the device is set to". Token values and brand marks pick different
 * defaults when it is missing, so an app that omits it everywhere can end
 * up with a light mark sitting on a dark page. Sending it every time is the
 * whole fix.
 *
 * Second: the discovery document describes, the grammar addresses. What a
 * brand offers is read from context.json; where to get it is built from the
 * address templates. Nothing here is ever routed from a discovery list.
 *
 * Third: only parameters the published grammar names are sent. A request
 * built on an arrangement that is not written down is a request that can
 * stop working without anything having broken a promise.
 */

import type { Appearance, AssetFormat, AssetSize } from "./params";

export interface AddressOptions {
  baseUrl: string;
  publicId: string;
}

function root(options: AddressOptions): string {
  const base = options.baseUrl.replace(/\/+$/, "");
  return base + "/r/" + encodeURIComponent(options.publicId);
}

function withQuery(url: string, query: string[]): string {
  return query.length ? url + "?" + query.join("&") : url;
}

/** Resolved token values for one appearance. */
export function tokensUrl(
  options: AddressOptions,
  params: { appearance: Appearance },
): string {
  return withQuery(root(options) + "/tokens.json", [
    "appearance=" + params.appearance,
  ]);
}

/** The font manifest. */
export function fontsUrl(options: AddressOptions): string {
  return root(options) + "/fonts.json";
}

/** What this brand offers. */
export function contextUrl(options: AddressOptions): string {
  return root(options) + "/context.json";
}

/** The live channel. */
export function eventsUrl(options: AddressOptions): string {
  return root(options) + "/events";
}

/** A brand mark. */
export function assetUrl(
  options: AddressOptions,
  role: string,
  params: {
    format: AssetFormat;
    appearance: Appearance;
    size?: AssetSize | null;
  },
): string {
  const path =
    root(options) + "/assets/" + encodeURIComponent(role) + "." + params.format;
  const query = ["appearance=" + params.appearance];
  /* A size on a vector is meaningless, so it is not sent. */
  if (params.size && params.format !== "svg") {
    query.push("size=" + String(params.size));
  }
  return withQuery(path, query);
}
