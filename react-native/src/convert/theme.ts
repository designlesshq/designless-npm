/*
 * The mapping table: served brand values in, a React Native theme out.
 *
 * Everything the conversion has to be careful about is written down here,
 * next to the line that does it, because this is the file a maintainer
 * opens when a value looks wrong.
 *
 *   colours        pass through, flattened to dotted keys
 *   space          rem, so multiplied by the root size
 *   radius         rem. The full radius is a very large number by design
 *   size           px, in the same payload as the rem groups above
 *   opacity        bare numbers
 *   zIndex         bare numbers. There is no z-index here; use for order
 *   border         mixed. Widths in px, and a style that is the word solid
 *   shadow         css shadow lists, minus the parts this platform lacks
 *   motion         durations in ms, easing as curves
 *   spacing        a touch target and a safe area, both discussed below
 *   component      structure kept, lengths converted, the rest left alone
 *   typography     reachable only through text(), for the reason in text.ts
 */

import { toLength, round, DEFAULT_REM_BASE } from "./length";
import { toDuration } from "./duration";
import { toEasing } from "./easing";
import type { EasingFunction } from "./easing";
import { toShadow } from "./shadow";
import type { ShadowStyle } from "./shadow";
import { buildText } from "./text";
import type { TextSpec, TextStyle } from "./text";
import type { FamilyResolution } from "./family";
import type { TokensPayload, TokenNode } from "../protocol/payloads";
import { isGroup } from "../protocol/payloads";
import type { Appearance } from "../protocol/params";
import { devWarn, isDev } from "../platform/globals";

/** The platform minimums a brand's own touch target is compared against. */
export const IOS_TOUCH_TARGET = 44;
export const ANDROID_TOUCH_TARGET = 48;

export interface SpacingTokens {
  /**
   * The brand's smallest touch target, in points, exactly as published.
   * A brand may publish a number smaller than the platform minimum, which
   * is 44 on iOS and 48 on Android. It is not raised here: raising it
   * would be inventing an intention the brand did not express. In a
   * development build a warning says so once.
   */
  touchTargetMin: number | null;
  /**
   * A published length, not a device measurement. It knows nothing about
   * a notch, a rounded corner or a home indicator. If the app already
   * reads real insets from the system, prefer those.
   */
  safeArea: { top: number | null; bottom: number | null };
}

export interface BrandTheme {
  /** Which appearance this theme was fetched for. */
  appearance: Appearance;
  /** Flattened to dotted keys: "bg.page", "text.primary". */
  color: { [key: string]: string };
  space: { [key: string]: number };
  radius: { [key: string]: number };
  size: { [key: string]: number };
  opacity: { [key: string]: number };
  zIndex: { [key: string]: number };
  /** Widths as numbers, styles as the words the brand published. */
  border: { [key: string]: number | string };
  shadow: { [key: string]: ShadowStyle };
  motion: {
    duration: { [key: string]: number };
    easing: { [key: string]: EasingFunction };
  };
  spacing: SpacingTokens;
  /** Component values, structure kept. No style objects are invented. */
  component: { [key: string]: unknown };
  /** The only supported way to build a text style. */
  text(spec: TextSpec): TextStyle;
  /**
   * The payload exactly as it was served: css strings, ratios and em.
   * Reach for this when the theme above does not carry what you need, and
   * read the notes in the readme first. The values here are not points.
   */
  served: TokensPayload;
}

export interface ThemeOptions {
  appearance: Appearance;
  remBase?: number;
  resolveFamily(role: string, weight: number): FamilyResolution;
  /**
   * Called for every family resolution a text style makes, whatever it
   * resolved to. What is worth warning about is the reporter's decision,
   * not this file's.
   */
  onResolved(role: string, resolution: FamilyResolution): void;
}

function flatten(
  node: TokenNode | undefined,
  prefix: string,
  // Widened from `string | number` because a leaf can now be a composite: a
  // `cubicBezier` tuple, or a `shadow` object or array. Every visitor already
  // takes `unknown` at its own boundary (`toEasing`, `toDuration`, `toLength`,
  // `toShadow` all narrow internally and return null for what they cannot
  // read), so widening here hands them the value instead of walking past it.
  visit: (key: string, value: unknown) => void,
  /*
   * Optional: does this node hold a VALUE rather than more tokens?
   *
   * `isGroup` cannot answer that for a composite OBJECT. It correctly stops at
   * an array, so a `cubicBezier` tuple reaches its converter, but a DTCG
   * `shadow` is an object of named parts and is indistinguishable from a group
   * by shape alone — walking it emits `shadow.md.offsetX` and friends, and
   * `toShadow` never sees a shadow.
   *
   * The caller knows what its own type looks like and `flatten` does not, so
   * the test comes from the caller. Without one the behaviour is exactly what
   * it was.
   */
  isValue?: (node: TokenNode) => boolean,
): void {
  if (node === undefined) return;
  if (!isGroup(node) || (isValue !== undefined && isValue(node))) {
    visit(prefix, node);
    return;
  }
  const keys = Object.keys(node);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    flatten(node[key], prefix ? prefix + "." + key : key, visit, isValue);
  }
}

function flatStrings(node: TokenNode | undefined): { [key: string]: string } {
  const out: { [key: string]: string } = {};
  flatten(node, "", (key, value) => {
    out[key] = String(value);
  });
  return out;
}

function flatLengths(
  node: TokenNode | undefined,
  remBase: number,
): { [key: string]: number } {
  const out: { [key: string]: number } = {};
  flatten(node, "", (key, value) => {
    const length = toLength(value, remBase);
    if (length !== null) out[key] = length;
  });
  return out;
}

function flatMixed(
  node: TokenNode | undefined,
  remBase: number,
): { [key: string]: number | string } {
  const out: { [key: string]: number | string } = {};
  flatten(node, "", (key, value) => {
    const length = toLength(value, remBase);
    out[key] = length === null ? String(value) : length;
  });
  return out;
}

/**
 * A DTCG shadow composite, which `flatten` must hand over whole rather than
 * walk into. Both offsets are required by the format and by `toShadow`, so
 * their presence is what marks the object as a shadow rather than a group of
 * more shadows.
 */
function isShadowComposite(node: TokenNode): boolean {
  if (node === null || typeof node !== "object") return false;
  if (Array.isArray(node)) return true;
  const obj = node as { [key: string]: unknown };
  return "offsetX" in obj && "offsetY" in obj;
}

function flatShadows(node: TokenNode | undefined): { [key: string]: ShadowStyle } {
  const out: { [key: string]: ShadowStyle } = {};
  const dev = isDev();
  flatten(node, "", (key, value) => {
    const shadow = toShadow(value, dev);
    if (shadow) out[key] = shadow;
  }, isShadowComposite);
  return out;
}

function flatDurations(node: TokenNode | undefined): { [key: string]: number } {
  const out: { [key: string]: number } = {};
  flatten(node, "", (key, value) => {
    const ms = toDuration(value);
    if (ms !== null) out[key] = ms;
  });
  return out;
}

function flatEasings(node: TokenNode | undefined): {
  [key: string]: EasingFunction;
} {
  const out: { [key: string]: EasingFunction } = {};
  flatten(node, "", (key, value) => {
    const easing = toEasing(value);
    if (easing) out[key] = easing;
  });
  return out;
}

/*
 * Component values keep the shape they were served in. Lengths become
 * numbers, shadows and easing curves become the objects React Native
 * wants, and everything else is left exactly as published.
 *
 * Two leaves are deliberately left as strings. A line height under a
 * component is a multiple, not a measurement, and a letter spacing in em
 * is the same. Turning either into a number here would put an unusable
 * value somewhere it looks usable. Left as strings they are obvious.
 *
 * No style objects are assembled. The published names describe a border
 * side and a padding axis; guessing which React Native property each one
 * belongs to would be inventing intent. Numbers out, assembly left to
 * the app.
 */
function convertComponent(
  node: TokenNode | undefined,
  remBase: number,
  parentKey: string,
  leafKey: string,
  dev: boolean,
): unknown {
  if (node === undefined) return undefined;
  if (isGroup(node)) {
    const out: { [key: string]: unknown } = {};
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i += 1) {
      out[keys[i]] = convertComponent(
        node[keys[i]],
        remBase,
        leafKey,
        keys[i],
        dev,
      );
    }
    return out;
  }
  if (typeof node === "number") return node;
  if (leafKey === "lineHeight") return node;
  if (leafKey === "shadow" || parentKey === "shadow") {
    const shadow = toShadow(node, dev);
    return shadow === null ? node : shadow;
  }
  if (leafKey === "easing") {
    const easing = toEasing(node);
    return easing === null ? node : easing;
  }
  const ms = toDuration(node);
  if (ms !== null) return ms;
  const length = toLength(node, remBase);
  return length === null ? node : length;
}

function readSpacing(
  node: TokenNode | undefined,
  remBase: number,
): SpacingTokens {
  const flat = flatLengths(node, remBase);
  const touch =
    flat["touchTarget.min"] === undefined ? null : flat["touchTarget.min"];
  if (touch !== null && touch < ANDROID_TOUCH_TARGET) {
    devWarn(
      "this brand's smallest touch target is " +
        String(touch) +
        " points. iOS asks for at least " +
        String(IOS_TOUCH_TARGET) +
        " and Android for at least " +
        String(ANDROID_TOUCH_TARGET) +
        ". The published number is passed through unchanged.",
    );
  }
  return {
    touchTargetMin: touch,
    safeArea: {
      top: flat["safeArea.top"] === undefined ? null : flat["safeArea.top"],
      bottom:
        flat["safeArea.bottom"] === undefined ? null : flat["safeArea.bottom"],
    },
  };
}

export function buildTheme(
  payload: TokensPayload,
  options: ThemeOptions,
): BrandTheme {
  const remBase =
    options.remBase === undefined ? DEFAULT_REM_BASE : options.remBase;
  const groups = payload.tokens || {};
  const dev = isDev();

  const component = convertComponent(
    groups["component"],
    remBase,
    "",
    "component",
    dev,
  );

  const theme: BrandTheme = {
    appearance: options.appearance,
    color: flatStrings(groups["color"]),
    space: flatLengths(groups["space"], remBase),
    radius: flatLengths(groups["radius"], remBase),
    size: flatLengths(groups["size"], remBase),
    opacity: flatLengths(groups["opacity"], remBase),
    zIndex: flatLengths(groups["zIndex"], remBase),
    border: flatMixed(groups["border"], remBase),
    shadow: flatShadows(groups["shadow"]),
    motion: {
      duration: flatDurations(
        isGroup(groups["motion"]) ? groups["motion"]["duration"] : undefined,
      ),
      easing: flatEasings(
        isGroup(groups["motion"]) ? groups["motion"]["easing"] : undefined,
      ),
    },
    spacing: readSpacing(groups["spacing"], remBase),
    component: (component === undefined ? {} : component) as {
      [key: string]: unknown;
    },
    text(spec: TextSpec): TextStyle {
      return buildText(spec, {
        typography: groups["typography"],
        remBase,
        resolve: options.resolveFamily,
        onResolved: options.onResolved,
      });
    },
    served: payload,
  };
  return theme;
}

/** Exported for the size ladder, which rounds the same way. */
export { round };
