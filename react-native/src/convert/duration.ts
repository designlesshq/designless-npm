/* Durations, in milliseconds. Both css time units are accepted. */

const DURATION = /^(-?(?:\d+\.?\d*|\.\d+))(ms|s)$/;

export function toDuration(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const match = DURATION.exec(raw.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return match[2] === "s" ? Math.round(value * 1000) : Math.round(value);
}
