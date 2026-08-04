/*
 * The one supported way to build a text style.
 *
 * Two of the values a brand publishes for text are relative, and React
 * Native wants both of them absolute. A line height is published as a
 * multiple of the font size. A letter spacing is published in em, which
 * is also a multiple of the font size. React Native reads both as points.
 *
 * Handing either of those numbers straight through is the quiet failure
 * this file exists to prevent: a line height of 1.51 is a line box one and
 * a half points tall, which is unreadable, and it throws nothing. So both
 * are multiplied by the resolved font size here, and nowhere else, and
 * neither is published as a number anywhere in the theme.
 */

import { toEm, toLength, toRatio, round } from "./length";
import type { FamilyResolution } from "./family";
import type { TokenNode } from "../protocol/payloads";
import { isGroup } from "../protocol/payloads";

/** What to ask for. Every field names a key the brand publishes. */
export interface TextSpec {
  /** A key of the published text sizes, such as "md". Defaults to "md". */
  size?: string;
  /** A key of the published line heights, such as "normal". */
  line?: string;
  /** A text role: "body", "display" or "mono". Defaults to "body". */
  family?: string;
  /** A key of the published weights, such as "heading". */
  weight?: string;
  /** A key of the published letter spacings, such as "wide". */
  tracking?: string;
}

/**
 * The weights React Native has a name for.
 *
 * Narrowed to exactly these because React Native's own style type is this
 * union and nothing wider. A plain string does not go into a Text
 * component in a TypeScript app, and this is the only supported way to
 * build a text style, so a wider type here has no way out.
 */
export type TextWeight =
  | "normal"
  | "bold"
  | "100"
  | "200"
  | "300"
  | "400"
  | "500"
  | "600"
  | "700"
  | "800"
  | "900";

/** The style React Native accepts. */
export interface TextStyle {
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  fontFamily?: string;
  fontWeight?: TextWeight;
}

const WEIGHT_NAMES: TextWeight[] = [
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
];

/**
 * The nearest weight React Native has a name for.
 *
 * A brand may publish a weight off the hundreds, and a name React Native
 * does not know is dropped rather than approximated, which puts the text
 * back at regular with nothing said.
 */
function weightName(weight: number): TextWeight {
  const step = Math.round(weight / 100);
  const clamped = step < 1 ? 1 : step > 9 ? 9 : step;
  return WEIGHT_NAMES[clamped - 1];
}

export interface TextContext {
  typography: TokenNode | undefined;
  remBase: number;
  resolve(role: string, weight: number): FamilyResolution;
  /**
   * Called for every resolution, not only the ones that ended on the
   * platform font. A face that answered from a weight or a style other
   * than the one asked for is applied and looks applied, so the decision
   * about whether it is worth saying belongs to the reporter, which is
   * the only thing that knows what has already been said.
   */
  onResolved(role: string, resolution: FamilyResolution): void;
}

function pick(group: TokenNode | undefined, key: string): TokenNode | undefined {
  if (!isGroup(group)) return undefined;
  /*
   * Own keys only. The group is parsed from a served payload and the key
   * comes from a caller, so "constructor" or "toString" would otherwise
   * answer from Object.prototype and hand a function to a converter that
   * is expecting a token.
   */
  if (!Object.prototype.hasOwnProperty.call(group, key)) return undefined;
  return group[key];
}

const DEFAULT_SIZE_KEY = "md";
const DEFAULT_WEIGHT_KEY = "normal";
const DEFAULT_ROLE = "body";
const FALLBACK_SIZE = 16;

export function buildText(spec: TextSpec, context: TextContext): TextStyle {
  const typography = context.typography;
  const sizeKey = spec.size || DEFAULT_SIZE_KEY;
  const role = spec.family || DEFAULT_ROLE;

  const rawSize = pick(pick(typography, "fontSize"), sizeKey);
  const fontSize = toLength(rawSize, context.remBase);
  const resolvedSize = fontSize === null ? FALLBACK_SIZE : fontSize;

  const style: TextStyle = { fontSize: resolvedSize };

  const rawWeight = pick(
    pick(typography, "fontWeight"),
    spec.weight || DEFAULT_WEIGHT_KEY,
  );
  const weight =
    typeof rawWeight === "number"
      ? rawWeight
      : typeof rawWeight === "string" && Number.isFinite(Number(rawWeight))
        ? Number(rawWeight)
        : 400;

  const stack = pick(pick(typography, "fontFamily"), role);
  const resolution = context.resolve(role, weight);
  if (resolution.postscriptName) {
    /*
     * A weight beside a resolved face is not set. The face already carries
     * its weight, and asking for one on top of it invites the platform to
     * thicken an already bold face.
     */
    style.fontFamily = resolution.postscriptName;
  } else {
    style.fontWeight = weightName(weight);
  }
  /*
   * Reported either way. Every way of ending up on the platform font is
   * quiet, which is exactly why it is worth hearing about, and so is a
   * face that answered from a weight or a style nobody asked for.
   */
  context.onResolved(role, resolution);
  /* The stack itself is never emitted: React Native takes one name. */
  void stack;

  if (spec.line) {
    const ratio = toRatio(pick(pick(typography, "lineHeight"), spec.line));
    if (ratio !== null) style.lineHeight = round(resolvedSize * ratio);
  }

  if (spec.tracking) {
    const raw = pick(pick(typography, "letterSpacing"), spec.tracking);
    const em = toEm(raw);
    if (em !== null) {
      style.letterSpacing = round(resolvedSize * em);
    } else {
      /* A plain 0 has no unit and needs no scaling. */
      const flat = toRatio(raw);
      if (flat !== null) style.letterSpacing = round(flat);
    }
  }

  return style;
}
