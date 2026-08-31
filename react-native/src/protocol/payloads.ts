/*
 * The served payloads, typed loosely on purpose.
 *
 * A brand grows new token groups over time, and a client that insists on
 * an exact shape breaks on the day a brand gains one. Every group is a
 * nested record of strings and numbers, so that is what these types say,
 * and the reader below is the thing that turns a path into a value safely.
 */

/**
 * A token group, nested to any depth, or a value at a leaf.
 *
 * `TokenValue[]` is the DTCG composite form: `cubicBezier` is
 * `[x1, y1, x2, y2]`, and `shadow` is an object or an array of them. An array
 * is a VALUE, not a group — see `isGroup`, which is where treating it as one
 * did real damage.
 */
export type TokenValue = string | number | boolean | null;
export type TokenNode =
  | TokenValue
  | TokenValue[]
  | { [key: string]: TokenNode }[]
  | { [key: string]: TokenNode };

export interface TokensPayload {
  $schema?: string;
  version?: string;
  /**
   * The appearance this payload describes. Not read by this package: every
   * request names the appearance it wants, so the request is already the
   * answer, and reading it back adds a second source for one fact.
   */
  appearance?: string;
  tokens: { [group: string]: TokenNode };
}

export interface FontFacePayload {
  weight: number;
  style: string;
  postscriptName: string;
  src: { [format: string]: string };
}

export interface FontFamilyPayload {
  family: string;
  roles: string[];
  faces: FontFacePayload[];
}

export interface FontsPayload {
  $schema?: string;
  version?: string;
  formats: { [target: string]: string };
  families: FontFamilyPayload[];
}

export interface CapabilityPayload {
  name: string;
  auth?: string;
  description?: string;
}

export interface CompositionPayload {
  name: string;
  url: string;
  width?: number;
  height?: number;
}

export interface ContextPayload {
  $schema?: string;
  public_id?: string;
  version?: string;
  capabilities?: CapabilityPayload[];
  assets?: { role: string; formats?: string[]; variants?: string[] }[];
  compositions?: CompositionPayload[];
  appearance?: string[];
}

/** True when the value is a nested group rather than a leaf. */
export function isGroup(node: TokenNode | undefined): node is {
  [key: string]: TokenNode;
} {
  /*
   * AN ARRAY IS A VALUE, NOT A GROUP.
   *
   * This read `typeof node === "object" && node !== null`, and an array
   * satisfies both. So a DTCG composite — `cubicBezier` as `[x1,y1,x2,y2]`,
   * `shadow` as an array of layers — was walked as though its indices were
   * token names. `flatten` in convert/theme.ts descended into
   * `motion.easing.default` and emitted `motion.easing.default.0`,
   * `motion.easing.default.1` and so on as separate numeric tokens, so
   * `toEasing` never saw the curve at all and the app fell back to React
   * Native's default motion.
   *
   * Nothing threw. A brand's curves simply stopped arriving, which is
   * indistinguishable from a brand that declared none.
   */
  return typeof node === "object" && node !== null && !Array.isArray(node);
}
