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
 * Pick the layer React Native can actually draw, and shape it.
 *
 * Extracted so the string path and the composite path cannot drift: React
 * Native renders ONE shadow, so a multi-layer shadow has to choose, and inset
 * layers are dropped because there is no inner-shadow primitive. That decision
 * belongs in one place regardless of which form the value arrived in.
 */
function shadowFromLayers(layers: Layer[], includeDropCount: boolean): ShadowStyle | null {
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

/**
 * The same Layer, read from a DTCG composite instead of a CSS string.
 *
 * `readLayer` above parses `0 4px 6px -1px rgba(...)` positionally. A DTCG
 * shadow names its parts instead — `{ offsetX, offsetY, blur, spread, color,
 * inset }` — so the fields go straight into the same slots and everything
 * downstream (layer selection, inset dropping, alpha splitting) is untouched.
 *
 * Order matters and is CSS's, not the object's: offsetX, offsetY, blur,
 * spread. `numbers` is positional for the consumers below, so reading the
 * object's own key order would put spread where blur belongs whenever an
 * author wrote the fields in a different sequence.
 *
 * Returns null for anything without both offsets, matching `readLayer`'s
 * `numbers.length < 2` rule: a layer that names no position is not a shadow.
 */
function layerFromComposite(raw: unknown): Layer | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as { [key: string]: unknown };

  const length = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v !== "string") return null;
    const text = v.trim();
    if (!NUMBER.test(text)) return null;
    const n = Number(text.replace(/(px|rem)$/, ""));
    return Number.isFinite(n) ? n : null;
  };

  const x = length(obj.offsetX);
  const y = length(obj.offsetY);
  if (x === null || y === null) return null;

  const numbers: number[] = [x, y];
  const blur = length(obj.blur);
  const spread = length(obj.spread);
  // Spread sits after blur positionally, so a spread with no blur needs a zero
  // written into blur's slot. Same rule the CSS emitter follows.
  if (blur !== null) numbers.push(blur);
  else if (spread !== null) numbers.push(0);
  if (spread !== null) numbers.push(spread);

  const color = typeof obj.color === "string" ? obj.color : null;
  return { inset: obj.inset === true, numbers, color };
}

/**
 * A shadow style, or null when the value is not a shadow. The value "none"
 * is a shadow, and it converts to an empty style.
 */
export function toShadow(raw: unknown, includeDropCount: boolean): ShadowStyle | null {
  const layers: Layer[] = [];

  /*
   * A shadow arrives two ways, and both are the same shadow.
   *
   * DTCG models `shadow` as an object of named parts, or an array of them for
   * a layered shadow. Every capsule served the CSS string until now and a
   * stylesheet always carries it, so both keep working: a released version of
   * this package will meet a payload from before that change and one from
   * after, and cannot know which.
   *
   * Without this the string guard below returns null, which is not an error a
   * caller sees — the key is dropped and the component renders with no
   * elevation at all, indistinguishable from a brand that declared none. Same
   * silent shape the easing curves had.
   *
   * An empty array is a deliberate "no shadow", matching what the string
   * "none" already means here.
   */
  if (Array.isArray(raw) || (raw !== null && typeof raw === "object")) {
    const pieces = Array.isArray(raw) ? raw : [raw];
    if (!pieces.length) return {};
    for (let i = 0; i < pieces.length; i += 1) {
      // A layer already in CSS-string form inside an array stays readable,
      // because the conversion lands token by token rather than all at once.
      const layer = typeof pieces[i] === "string"
        ? readLayer((pieces[i] as string).trim())
        : layerFromComposite(pieces[i]);
      if (!layer) return null;
      if (layer.numbers.length < 2) return null;
      layers.push(layer);
    }
    return shadowFromLayers(layers, includeDropCount);
  }

  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  if (text === "none") return {};
  const pieces = splitLayers(text);
  for (let i = 0; i < pieces.length; i += 1) {
    const layer = readLayer(pieces[i]);
    if (!layer) return null;
    if (layer.numbers.length < 2) return null;
    layers.push(layer);
  }
  if (!layers.length) return null;
  return shadowFromLayers(layers, includeDropCount);
}
