/*
 * Which font name to hand React Native.
 *
 * A brand publishes two things about its type, and both have to be read.
 *
 * The first is an ordered list of families for each role, the same way a
 * stylesheet does: a preferred name, then fallbacks, usually ending in a
 * generic. The second is the font list, which names the family the brand
 * publishes for each role and the file for every face in it.
 *
 * The list is a preference. The font list is the fact. So the list is
 * walked first, and if nothing on it can be honoured the role's own
 * published family is used before giving up. A build can carry the right
 * file, have the brand name that role, and still have a list that never
 * mentions it, because a list written for a browser names what browsers
 * already have. Reading only the list throws that file away and says
 * nothing about it.
 *
 * One case is not a failure and gets its own answer: a list that opens
 * with a system name is the brand asking for the platform font. It has
 * not run out, so the role's own family is not substituted for it.
 *
 * A face is always named by its PostScript name, never by its family. A
 * family name only ever finds the regular weight in it: the semibold face
 * of a family is registered under its own family name, and the record
 * that would group the two together is not one the platforms resolve on.
 * Asking for the family and setting a weight beside it renders regular
 * and warns about nothing.
 */

/** Names that mean "use the platform font". */
const SYSTEM_NAMES = [
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "-apple-system",
  "blinkmacsystemfont",
  "sf pro text",
  "sf pro display",
  "sf mono",
  "sfmono-regular",
  "menlo",
  "monaco",
  "courier",
  "courier new",
  "segoe ui",
  "roboto",
  "roboto mono",
  "helvetica",
  "helvetica neue",
  "arial",
];

/** The two styles a published face can be in. */
export type FaceStyle = "normal" | "italic";

export interface FaceRef {
  postscriptName: string;
  weight: number;
  style: FaceStyle;
}

export interface FaceLookup {
  /** The best face in this family for a weight, or null when unknown. */
  find(family: string, weight: number, style?: FaceStyle): FaceRef | null;
  /**
   * True when the brand publishes a family under this name, whatever it
   * publishes in it. Asked instead of find() wherever the question is
   * whether a name belongs to the brand, because find() answers for one
   * weight and a family is not absent just because a weight is.
   */
  hasFamily(family: string): boolean;
  /** The family this brand publishes for a role, or null. */
  familyForRole(role: string): string | null;
  /**
   * Every role this brand publishes a family for.
   *
   * Asked so a role the brand does not publish can be told apart from a
   * role that was misspelled. Both end on the platform font and they need
   * different things done about them, and only one of them is a fault.
   */
  publishedRoles(): string[];
  /** True when this face is in the app binary. */
  isPresent(postscriptName: string): boolean;
  /** True when there is no published font list to check against. */
  isEmpty(): boolean;
}

/**
 * Why the answer is what it is. "absent", "unknown" and "far" are worth
 * saying out loud, because each is something a developer can fix. The
 * other three are the brand getting exactly what it published.
 */
export type FamilyOutcome =
  /** A published face, and this build contains it. */
  | "face"
  /** The brand asked for the platform font. */
  | "platform"
  /** There is no published font list to check against. */
  | "unknown"
  /** The brand publishes no face for this role. */
  | "unpublished"
  /** The brand publishes one and this build does not contain it. */
  | "absent"
  /**
   * The brand publishes a family for this role and nothing in it sits
   * near the weight that was asked for. The file is in the build and
   * still cannot be used, which reads as no reason at all unless it is
   * said, so it is not folded in with "unpublished".
   */
  | "far";

export interface FamilyResolution {
  /** The name to pass to React Native, or null for the platform font. */
  postscriptName: string | null;
  /** The style of the face that was found, when one was. */
  style: FaceStyle | null;
  /**
   * The published family this answer is about, when there is one worth
   * naming. For "face" it is the family the answering face came from;
   * for "absent" it is a family this build does not contain; for "far"
   * it is one the build does contain and cannot use at this weight. Null
   * whenever there is nothing to point at.
   */
  family: string | null;
  outcome: FamilyOutcome;
  /** The weight that was asked for. */
  askedWeight: number;
  /** The style that was asked for. */
  askedStyle: FaceStyle;
  /**
   * The weight of the face that answered, when one did.
   *
   * Not always the one asked for. A family is allowed to answer from a
   * nearby weight, and a weight is deliberately not set beside a resolved
   * face, so nothing downstream can tell that a substitution happened.
   * Carrying both numbers is what lets it be said out loud.
   */
  weight: number | null;
}

export interface FamilyRequest {
  /** A text role: "body", "display" or "mono". */
  role: string;
  /** The list of families the brand published for that role. */
  stack: unknown;
  weight: number;
  /** Defaults to "normal". */
  style?: FaceStyle;
}

/** Split a published list into plain family names. */
export function parseStack(stack: unknown): string[] {
  if (typeof stack !== "string") return [];
  const out: string[] = [];
  const parts = stack.split(",");
  for (let i = 0; i < parts.length; i += 1) {
    const name = parts[i].trim().replace(/^['"]/, "").replace(/['"]$/, "").trim();
    if (name) out.push(name);
  }
  return out;
}

export function isSystemName(name: string): boolean {
  const lower = name.toLowerCase();
  for (let i = 0; i < SYSTEM_NAMES.length; i += 1) {
    if (SYSTEM_NAMES[i] === lower) return true;
  }
  return false;
}

function platformFont(
  outcome: FamilyOutcome,
  family: string | null,
  asked: { weight: number; style: FaceStyle },
): FamilyResolution {
  return {
    postscriptName: null,
    style: null,
    family,
    outcome,
    askedWeight: asked.weight,
    askedStyle: asked.style,
    weight: null,
  };
}

function found(
  face: FaceRef,
  family: string,
  asked: { weight: number; style: FaceStyle },
): FamilyResolution {
  return {
    postscriptName: face.postscriptName,
    style: face.style,
    family,
    outcome: "face",
    askedWeight: asked.weight,
    askedStyle: asked.style,
    weight: face.weight,
  };
}

/**
 * A system name only ends the walk when the brand publishes no family
 * under that exact name. Some brand faces are called Roboto, or
 * Helvetica Neue, and a build carrying one of those files should reach
 * it rather than be stopped by its name.
 *
 * The question is whether the brand publishes the name at all, not
 * whether it publishes it at some weight. Asking at a weight makes a
 * family the brand publishes only in bold read as a request for the
 * platform font, which is the one outcome that says nothing: "far" is
 * reported and "platform" is not, and this is the difference between
 * them.
 */
function endsTheWalk(name: string, lookup: FaceLookup): boolean {
  if (!isSystemName(name)) return false;
  return !lookup.hasFamily(name);
}

export function resolveFamily(
  request: FamilyRequest,
  lookup: FaceLookup,
): FamilyResolution {
  const style: FaceStyle = request.style || "normal";
  const asked = { weight: request.weight, style };
  const names = parseStack(request.stack);
  let missingFamily: string | null = null;
  let askedForPlatform = false;

  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    if (endsTheWalk(name, lookup)) {
      /*
       * A list that opens with a system name is a brand asking for the
       * platform font. A list that reaches one only after naming real
       * families has run out, and the role's own published family is
       * still worth trying.
       */
      askedForPlatform = i === 0;
      break;
    }
    const face = lookup.find(name, request.weight, style);
    if (!face) continue;
    if (lookup.isPresent(face.postscriptName)) return found(face, name, asked);
    if (missingFamily === null) missingFamily = name;
  }

  if (askedForPlatform) return platformFont("platform", null, asked);

  /* Nothing on the list could be honoured, so ask what the brand publishes. */
  const declared = lookup.familyForRole(request.role);
  if (declared) {
    const face = lookup.find(declared, request.weight, style);
    if (face) {
      if (lookup.isPresent(face.postscriptName)) return found(face, declared, asked);
      return platformFont("absent", missingFamily || declared, asked);
    }
    /*
     * The role has a family and the family has nothing near this weight.
     * Naming it costs one line and saves the hour spent looking for a
     * missing file that was never missing.
     */
    if (missingFamily !== null) return platformFont("absent", missingFamily, asked);
    return platformFont("far", declared, asked);
  }

  if (missingFamily !== null) return platformFont("absent", missingFamily, asked);
  if (lookup.isEmpty()) return platformFont("unknown", null, asked);
  return platformFont("unpublished", null, asked);
}
