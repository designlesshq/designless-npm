/* Easing curves, mapped onto the animation curves React Native ships. */

import { Easing } from "react-native";

export type EasingFunction = (value: number) => number;

const BEZIER = /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/;

const NAMED: { [name: string]: [number, number, number, number] } = {
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

/** An easing function, or null when the value is not a curve. */
export function toEasing(raw: unknown): EasingFunction | null {
  /*
   * A cubic-bezier arrives two ways, and both are the same curve.
   *
   * DTCG models `cubicBezier` as `[x1, y1, x2, y2]`, and the engine is moving
   * its easing tokens onto that shape: the four control points ARE the value,
   * and `cubic-bezier(...)` is one rendering of them. The string form is what
   * every capsule served until now and what a stylesheet always carries, so
   * both keep working — a version of this package must read a payload from
   * before the change and one from after.
   *
   * Reading the tuple first is not an optimisation. Without it the guard below
   * returns null for an array, which is not an error a caller sees: `flatEasings`
   * simply drops the key, and an app animates with React Native's defaults
   * instead of the brand's curves. Silent, and indistinguishable from a brand
   * that declared no easing at all.
   */
  if (Array.isArray(raw)) {
    if (raw.length !== 4) return null;
    for (let i = 0; i < 4; i += 1) {
      if (typeof raw[i] !== "number" || !Number.isFinite(raw[i])) return null;
    }
    return Easing.bezier(raw[0], raw[1], raw[2], raw[3]);
  }
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "linear") return Easing.linear;
  const named = NAMED[text];
  if (named) return Easing.bezier(named[0], named[1], named[2], named[3]);
  const match = BEZIER.exec(text);
  if (!match) return null;
  const points: number[] = [];
  for (let i = 1; i <= 4; i += 1) {
    const value = Number(match[i].trim());
    if (!Number.isFinite(value)) return null;
    points.push(value);
  }
  return Easing.bezier(points[0], points[1], points[2], points[3]);
}
