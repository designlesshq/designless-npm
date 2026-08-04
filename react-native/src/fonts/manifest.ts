/*
 * The published font list, with the app binary folded into it.
 *
 * This does not download anything and it does not register anything. It
 * answers one question well: given a role and a weight, what is the exact
 * name to hand React Native. Getting that name from anywhere else is the
 * mistake described at the top of family.ts.
 *
 * The index the walk reads is built here and handed out beside the list,
 * so there is exactly one index of families in the package. There were
 * two, and the answer a caller got depended on which one it happened to
 * be holding.
 */

import type { FontsPayload, FontFacePayload } from "../protocol/payloads";
import type {
  FaceLookup,
  FaceRef,
  FaceStyle,
  FamilyResolution,
} from "../convert/family";
import { resolveFamily } from "../convert/family";
import type { FontRegistry } from "./registry";

export interface FontFace {
  weight: number;
  style: FaceStyle;
  /** The only name a platform resolves a registered face on. */
  postscriptName: string;
  /** Where the file for this platform lives. */
  url: string;
}

export interface FontFamily {
  family: string;
  roles: string[];
  faces: FontFace[];
}

export interface FontManifest {
  families: FontFamily[];
  /** The file format this platform wants. */
  format: string;
  /**
   * The name to hand React Native for a role and weight, or undefined
   * when the answer is the platform font. It is a PostScript name and
   * never a family name, which is why it is not called family().
   */
  faceFor(role: string, weight?: number | string): string | undefined;
  /** Faces this app binary contains. */
  present(): string[];
  /** Faces the brand publishes that this app binary does not contain. */
  missing(): FontFace[];
}

/**
 * How far from the asked-for weight a face may sit and still be used.
 *
 * Without a limit, a family with one heavy face answers every request
 * with it, so body copy renders bold and there is no lever left to
 * correct it: a weight is deliberately not set beside a resolved face.
 * Two steps is close enough to read as the same voice.
 */
const MAX_WEIGHT_GAP = 200;

function faceUrl(face: FontFacePayload, format: string): string {
  const src = face.src || {};
  const exact = src[format];
  if (typeof exact === "string" && exact) return exact;
  const keys = Object.keys(src);
  return keys.length ? src[keys[0]] : "";
}

/** Nearest available weight in one style. A tie goes to the heavier face. */
function closest(
  faces: FontFace[],
  weight: number,
  style: FaceStyle,
): FontFace | null {
  let best: FontFace | null = null;
  let bestGap = Infinity;
  for (let i = 0; i < faces.length; i += 1) {
    const face = faces[i];
    if (face.style !== style) continue;
    const gap = Math.abs(face.weight - weight);
    if (gap > MAX_WEIGHT_GAP) continue;
    if (gap < bestGap || (gap === bestGap && best !== null && face.weight > best.weight)) {
      best = face;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * The best face for a weight and a style.
 *
 * A family with nothing in the asked-for style is answered from the other
 * one rather than not at all. That only arises when a brand publishes a
 * role in a single style, in which case the substitution is what it
 * published.
 */
function nearest(
  faces: FontFace[],
  weight: number,
  style: FaceStyle,
): FontFace | null {
  const exact = closest(faces, weight, style);
  if (exact) return exact;
  return closest(faces, weight, style === "normal" ? "italic" : "normal");
}

export interface ManifestOptions {
  registry: FontRegistry;
  /** The list of families the brand published for a role, when known. */
  stackFor?: (role: string) => unknown;
}

export interface ManifestBundle {
  manifest: FontManifest;
  /** The index the walk reads. The same one the list answers from. */
  lookup: FaceLookup;
}

export function createManifest(
  payload: FontsPayload | null,
  options: ManifestOptions,
): ManifestBundle {
  const format =
    payload && payload.formats && payload.formats["native"]
      ? payload.formats["native"]
      : "ttf";

  const families: FontFamily[] = [];
  /*
   * No prototype on either index.
   *
   * The keys are family names and role names off a served payload, so a
   * brand that publishes a face called "constructor" (or a stack that
   * names one, which needs no brand at all) reaches Object.prototype
   * through a plain object literal and gets a function back where a
   * FontFamily was expected. The next line reads .faces off it, and
   * text() throws inside render. Measured: a stack of
   * "constructor, Inter, sans-serif" took down the only supported way to
   * build a text style. A null prototype has no keys to reach.
   */
  const byFamily: { [lower: string]: FontFamily } = Object.create(null);
  const byRole: { [role: string]: FontFamily } = Object.create(null);

  const source = payload && payload.families ? payload.families : [];
  for (let i = 0; i < source.length; i += 1) {
    const entry = source[i];
    const faces: FontFace[] = [];
    const rawFaces = entry.faces || [];
    for (let j = 0; j < rawFaces.length; j += 1) {
      const face = rawFaces[j];
      faces.push({
        weight: face.weight,
        style: face.style === "italic" ? "italic" : "normal",
        postscriptName: face.postscriptName,
        url: faceUrl(face, format),
      });
    }
    const family: FontFamily = {
      family: entry.family,
      roles: entry.roles ? entry.roles.slice() : [],
      faces,
    };
    families.push(family);
    byFamily[entry.family.toLowerCase()] = family;
    for (let j = 0; j < family.roles.length; j += 1) {
      /* The first family named for a role wins, so order is the answer. */
      if (!byRole[family.roles[j]]) byRole[family.roles[j]] = family;
    }
  }

  const lookup: FaceLookup = {
    find(name: string, weight: number, style?: FaceStyle): FaceRef | null {
      const family = byFamily[name.toLowerCase()];
      if (!family) return null;
      const face = nearest(family.faces, weight, style || "normal");
      return face
        ? {
            postscriptName: face.postscriptName,
            weight: face.weight,
            style: face.style,
          }
        : null;
    },
    hasFamily(name: string): boolean {
      return byFamily[name.toLowerCase()] !== undefined;
    },
    familyForRole(role: string): string | null {
      const family = byRole[role];
      return family ? family.family : null;
    },
    publishedRoles(): string[] {
      return Object.keys(byRole);
    },
    isPresent(postscriptName: string): boolean {
      return options.registry.has(postscriptName);
    },
    isEmpty(): boolean {
      return families.length === 0;
    },
  };

  const manifest: FontManifest = {
    families,
    format,
    faceFor(role: string, weight?: number | string): string | undefined {
      const target = weight === undefined ? 400 : Number(weight) || 400;
      const resolved = resolveFamily(
        {
          role,
          stack: options.stackFor ? options.stackFor(role) : undefined,
          weight: target,
        },
        lookup,
      );
      return resolved.postscriptName === null
        ? undefined
        : resolved.postscriptName;
    },
    present(): string[] {
      return options.registry.list();
    },
    missing(): FontFace[] {
      const out: FontFace[] = [];
      for (let i = 0; i < families.length; i += 1) {
        const faces = families[i].faces;
        for (let j = 0; j < faces.length; j += 1) {
          if (!options.registry.has(faces[j].postscriptName)) out.push(faces[j]);
        }
      }
      return out;
    },
  };

  return { manifest, lookup };
}

export type { FamilyResolution };
