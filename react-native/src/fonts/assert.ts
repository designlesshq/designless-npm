/*
 * The development check for text that did not get what it asked for.
 *
 * A face that is not in the app binary produces text in the platform
 * font. Nothing throws, nothing logs, and the screen looks plausible. On
 * a platform where fonts cannot be added after the build, that is the
 * single most expensive thing to discover late, so it is said out loud
 * the first time a role needs a face this build cannot give it.
 *
 * Every way of reaching it is reported, not only the one where a named
 * family turned out to be missing. The quiet ones are a build with no
 * faces in it at all, a font list that never arrived, and a family that
 * is in the build but publishes nothing near the weight being asked for.
 * Each says something different, because what to do about them differs.
 *
 * Two more are reported that used to say nothing, and both are the same
 * mistake one rung up from the one this file was written for.
 *
 * The first is a substitution. A family is allowed to answer a weight it
 * does not publish from a nearby one, and a style it does not publish
 * from the other one, and a weight is deliberately not set beside a
 * resolved face. So a family publishing only Light answers a request for
 * Medium with Light, and a family publishing only italics renders all
 * body copy in italic. Both look like a font that was applied. Saying
 * "renders regular and warns about nothing" is the failure this package
 * exists to avoid, and answering from two steps away silently is that
 * failure with the numbers changed.
 *
 * The second is a role the brand publishes nothing for. That is not a
 * fault on its own -- a brand need not publish a mono face -- but it is
 * indistinguishable, at the moment it happens, from a role that was
 * misspelled, and in practice the misspelling is the common one. So the
 * roles the brand does publish are named beside it, which answers both
 * readings in one line and accuses neither.
 *
 * A brand that asked for the platform font is getting exactly what it
 * published, and says nothing.
 */

import { devWarn, isDev } from "../platform/globals";
import type { FamilyResolution } from "../convert/family";

export interface MissingFontReporter {
  report(role: string, resolution: FamilyResolution): void;
  /** Roles that have already been reported. */
  reported(): string[];
  /** Forget what has been said, for when the font list changes. */
  reset(): void;
}

export interface ReporterContext {
  /**
   * The roles the brand publishes a family for, asked at the moment of
   * reporting rather than captured. The font list arrives after the
   * reporter is built and can be replaced later, so a captured list
   * would name the wrong roles for the whole of startup.
   */
  publishedRoles?(): string[];
}

function list(names: string[]): string {
  if (names.length === 0) return "none";
  if (names.length === 1) return '"' + names[0] + '"';
  const quoted = names.map((name) => '"' + name + '"');
  return quoted.slice(0, -1).join(", ") + " and " + quoted[quoted.length - 1];
}

export function createMissingFontReporter(
  wantedRoles: string,
  context: ReporterContext = {},
): MissingFontReporter {
  /*
   * Null prototype: the keys are built from role names off a served
   * payload, and "constructor" answering true would silence a real
   * warning for the one role nobody would think to check.
   */
  let seen: { [key: string]: true } = Object.create(null);

  function once(key: string, message: string): void {
    if (!isDev()) return;
    if (seen[key]) return;
    seen[key] = true;
    devWarn(message);
  }

  /**
   * The command that actually adds this role's face.
   *
   * Not the one the build already ran. A build set up with --roles=body
   * that is missing its display face is told to run --roles=body again,
   * which downloads body again and changes nothing, and the warning then
   * repeats for the life of the project. The flag has to cover the role
   * that is missing.
   */
  function addCommand(role: string): string {
    const covers = wantedRoles === "all" || role === "body";
    return "npx designless-fonts --roles=" + (covers ? wantedRoles : "all");
  }

  return {
    report(role: string, resolution: FamilyResolution): void {
      if (resolution.outcome === "face") {
        /* A face answered. The only thing left to say is whether it is
         * the one that was asked for. */
        const gaveWeight = resolution.weight;
        if (gaveWeight !== null && gaveWeight !== resolution.askedWeight) {
          once(
            "weight:" + role + ":" + String(resolution.askedWeight),
            'the "' +
              role +
              '" role was asked for weight ' +
              String(resolution.askedWeight) +
              ' and "' +
              (resolution.family || "the brand") +
              '" publishes ' +
              String(gaveWeight) +
              ", so that face is being used. It is not thickened or " +
              "thinned to match. Publish the weight you want, or ask for " +
              "one this family has.",
          );
        }
        if (resolution.style !== null && resolution.style !== resolution.askedStyle) {
          once(
            "style:" + role + ":" + resolution.askedStyle,
            'the "' +
              role +
              '" role was asked for ' +
              resolution.askedStyle +
              ' and "' +
              (resolution.family || "the brand") +
              '" publishes only ' +
              resolution.style +
              ", so every string in this role is " +
              resolution.style +
              ". Publish an upright face for it if that is not what you meant.",
          );
        }
        return;
      }
      if (resolution.outcome === "unknown") {
        once(
          "unknown",
          "the font list for this brand has not been read, so text is in " +
            "the platform font. That is usually one failed request during " +
            "startup, and it is asked for again.",
        );
        return;
      }
      if (resolution.outcome === "far") {
        once(
          "far:" + role,
          'the "' +
            role +
            '" role uses "' +
            (resolution.family || "its own face") +
            '", and that family publishes no face close enough to the ' +
            "weight being asked for, so the platform font is being used " +
            "instead. Ask for a weight the brand publishes for this role.",
        );
        return;
      }
      if (resolution.outcome === "unpublished") {
        const known = context.publishedRoles ? context.publishedRoles() : [];
        /* Nothing published at all is already covered by "unknown" and by
         * the empty-build warning, and repeating it here would be noise. */
        if (known.length === 0) return;
        once(
          "unpublished:" + role,
          'this brand publishes no face for the "' +
            role +
            '" role, so that text is in the platform font. The roles it ' +
            "publishes are " +
            list(known) +
            ". If one of those is the one you meant, the name is the fix.",
        );
        return;
      }
      if (resolution.outcome !== "absent") return;
      const family = resolution.family || "its own face";
      const suggestion =
        wantedRoles === "none"
          ? "This build was set up without brand faces, so this is expected."
          : "Add it with: " + addCommand(role);
      once(
        "role:" + role,
        'the "' +
          role +
          '" role uses "' +
          family +
          '" and this build does not contain it, so the platform font is ' +
          "being used instead. " +
          suggestion,
      );
    },
    reported(): string[] {
      return Object.keys(seen);
    },
    reset(): void {
      seen = Object.create(null);
    },
  };
}
