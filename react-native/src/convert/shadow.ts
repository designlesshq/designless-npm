/*
 * Shadows, with the parts this platform cannot draw removed rather than
 * approximated.
 *
 * Two things are always lost. An inner shadow has no equivalent in React
 * Native at all, in any version, so those layers are dropped and counted.
 * A spread radius has no parameter on either platform, so it is discarded.
 *
 * The blur radius halves on the way in. A css blur is the full width of
 * the gradient; the iOS shadow radius is measured from the edge outward,
 * so half the css value is the match that looks right rather than twice
 * as soft as the brand asked for.
 */

export interface ShadowStyle {
  shadowColor?: string;
  shadowOffset?: { width: number; height: number };
  shadowRadius?: number;
  shadowOpacity?: number;
  elevation?: number;
  /** How many inner layers were dropped. Present only in development. */
  __droppedLayers?: number;
}

interface Layer {
  inset: boolean;
  numbers: number[];
  color: string | null;
}

/** Split on commas that are not inside brackets. */
function splitLayers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value.charAt(i);
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Split on spaces that are not inside brackets. */
function splitParts(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value.charAt(i);
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (/\s/.test(char) && depth === 0) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(px|rem)?$/;

function readLayer(raw: string): Layer | null {
  const parts = splitParts(raw);
  if (!parts.length) return null;
  let inset = false;
  const numbers: number[] = [];
  let color: string | null = null;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === "inset") {
      inset = true;
      continue;
    }
    const match = NUMBER.exec(part);
    if (match) {
      numbers.push(Number(part.replace(/(px|rem)$/, "")));
      continue;
    }
    if (color === null) color = part;
  }
  return { inset, numbers, color };
}

/** Pull the alpha out of an rgba colour, and give back the opaque form. */
function splitAlpha(color: string | null): { color: string; opacity: number } {
  if (!color) return { color: "#000000", opacity: 1 };
  const rgba = /^rgba?\(([^)]+)\)$/.exec(color.trim());
  if (rgba) {
    const parts = rgba[1].split(",").map((part) => part.trim());
    if (parts.length >= 4) {
      const alpha = Number(parts[3]);
      return {
        color: "rgb(" + parts[0] + ", " + parts[1] + ", " + parts[2] + ")",
        opacity: Number.isFinite(alpha) ? alpha : 1,
      };
    }
    return { color: color.trim(), opacity: 1 };
  }
  /* Eight-digit hex carries alpha in the last pair. */
  const hex8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(color.trim());
  if (hex8) {
    return {
      color: "#" + hex8[1],
      opacity: Math.round((parseInt(hex8[2], 16) / 255) * 100) / 100,
    };
  }
  return { color: color.trim(), opacity: 1 };
}

/**
 * A shadow style, or null when the value is not a shadow. The value "none"
 * is a shadow, and it converts to an empty style.
 */
export function toShadow(raw: unknown, includeDropCount: boolean): ShadowStyle | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  if (text === "none") return {};
  const layers: Layer[] = [];
  const pieces = splitLayers(text);
  for (let i = 0; i < pieces.length; i += 1) {
    const layer = readLayer(pieces[i]);
    if (!layer) return null;
    if (layer.numbers.length < 2) return null;
    layers.push(layer);
  }
  if (!layers.length) return null;

  let dropped = 0;
  let chosen: Layer | null = null;
  for (let i = 0; i < layers.length; i += 1) {
    if (layers[i].inset) {
      dropped += 1;
      continue;
    }
    if (!chosen) chosen = layers[i];
  }
  if (!chosen) {
    const empty: ShadowStyle = {};
    if (includeDropCount && dropped) empty.__droppedLayers = dropped;
    return empty;
  }

  const offsetX = chosen.numbers[0];
  const offsetY = chosen.numbers[1];
  const blur = chosen.numbers.length > 2 ? chosen.numbers[2] : 0;
  const paint = splitAlpha(chosen.color);
  const style: ShadowStyle = {
    shadowColor: paint.color,
    shadowOffset: { width: offsetX, height: offsetY },
    shadowRadius: Math.round((blur / 2) * 100) / 100,
    shadowOpacity: paint.opacity,
    elevation: Math.max(0, Math.round(Math.abs(offsetY) + blur / 2)),
  };
  if (includeDropCount && dropped) style.__droppedLayers = dropped;
  return style;
}
