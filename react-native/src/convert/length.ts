/*
 * Lengths, converted one leaf at a time.
 *
 * Units are not uniform per group. The spacing scale is served in rem, the
 * size scale in px, border widths in px, radii in rem, and a few values are
 * bare numbers. Anything that walks a whole group and applies one rule to
 * it will corrupt half of what it touches, so every leaf is inspected on
 * its own and anything unrecognised is handed back untouched.
 *
 * Values in em are refused here. An em is relative to the font size of the
 * text it applies to, and React Native wants an absolute number. The one
 * place that knows the font size is the text builder, so that is the only
 * place em is allowed to become a number.
 */

/** The root font size a rem is measured against. */
export const DEFAULT_REM_BASE = 16;

const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))(rem|px|em|%)?$/;

export interface LengthReading {
  value: number;
  unit: "rem" | "px" | "em" | "%" | "none";
}

/** Read a length without converting it. Returns null when it is not one. */
export function readLength(raw: unknown): LengthReading | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { value: raw, unit: "none" } : null;
  }
  if (typeof raw !== "string") return null;
  const match = LENGTH.exec(raw.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2];
  if (unit === "rem" || unit === "px" || unit === "em" || unit === "%") {
    return { value, unit };
  }
  return { value, unit: "none" };
}

/**
 * A length in points, or null when the value is not one this platform can
 * use as an absolute number.
 */
export function toLength(raw: unknown, remBase: number): number | null {
  const reading = readLength(raw);
  if (!reading) return null;
  if (reading.unit === "rem") return round(reading.value * remBase);
  if (reading.unit === "px") return round(reading.value);
  if (reading.unit === "none") return round(reading.value);
  /* em and % stay relative. Only the text builder can resolve them. */
  return null;
}

/** An em value as a plain multiplier, or null when the value is not em. */
export function toEm(raw: unknown): number | null {
  const reading = readLength(raw);
  if (!reading) return null;
  if (reading.unit === "em") return reading.value;
  return null;
}

/** A bare ratio such as a line height, or null. */
export function toRatio(raw: unknown): number | null {
  const reading = readLength(raw);
  if (!reading) return null;
  return reading.unit === "none" ? reading.value : null;
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}
