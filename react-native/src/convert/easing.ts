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
