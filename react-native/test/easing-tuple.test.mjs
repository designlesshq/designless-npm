/*
 * A cubic-bezier arrives two ways, and both are the same curve.
 *
 * DTCG models `cubicBezier` as `[x1, y1, x2, y2]`. The engine is moving its
 * easing tokens onto that shape, because the four control points ARE the
 * value and `cubic-bezier(...)` is one rendering of them. Every capsule
 * served the string form until now, and a stylesheet always carries it, so
 * this package must read both: a released version of it will meet a payload
 * from before that change and one from after, and cannot know which.
 *
 * WHY THIS IS WORTH A FILE RATHER THAN A LINE.
 *
 * `toEasing` returned null for anything that was not a string, and null is
 * not an error a caller sees. `flatEasings` in convert/theme.ts does:
 *
 *     const easing = toEasing(value);
 *     if (easing) out[key] = easing;
 *
 * so the key is dropped and the app animates with React Native's defaults
 * instead of the brand's curves. Nothing throws, nothing logs, and the result
 * is indistinguishable from a brand that declared no easing at all. That is
 * the failure this keeps out: not a crash, a quiet reversion to generic
 * motion, in a package published to npm.
 *
 * Tested through the public surface, like the rest of the suite. `toEasing`
 * is internal, and the thing worth pinning is that a brand's curve reaches
 * `theme.motion.easing`, not that a helper returns non-null.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { loadPackage, snapshotFrom, cleanupBrands } from "./harness.mjs";

afterEach(cleanupBrands);

/**
 * A snapshot whose `motion.easing` is whatever is passed in, so one test can
 * serve the tuple form and another the string form from the same fixture.
 *
 * `snapshotFrom` wraps the tokens fixture in the snapshot envelope, and the
 * fixture itself nests its tree under `tokens`, so the curves live at
 * `snapshot.tokens.tokens.motion.easing`. Read off the fixture rather than
 * assumed: the first draft of this file mutated one level too shallow, every
 * test got a null theme, and it read as the widening not working.
 */
function themeWithEasing(easing) {
  const snapshot = snapshotFrom("tokens.dark.json");
  const tree = snapshot.tokens.tokens;
  tree.motion = { ...tree.motion, easing };
  const { api } = loadPackage({ dev: true });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot,
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  return { brand, theme: brand.tokens() };
}

test("a tuple reaches theme.motion.easing as the same curve the string gives", () => {
  const tuple = themeWithEasing({ default: [0.25, 0.1, 0.25, 1] });
  const string = themeWithEasing({ default: "cubic-bezier(0.25, 0.1, 0.25, 1)" });

  const fromTuple = tuple.theme.motion.easing["default"];
  const fromString = string.theme.motion.easing["default"];

  assert.equal(typeof fromTuple, "function", "the tuple form produced no easing");
  assert.equal(
    fromTuple.points.join(","),
    fromString.points.join(","),
    "the tuple and the string are the same four control points and must " +
      "produce the same curve",
  );

  tuple.brand.destroy();
  string.brand.destroy();
});

test("the string form still resolves, for payloads from before the change", () => {
  const { brand, theme } = themeWithEasing({
    default: "cubic-bezier(0.4, 0, 1, 1)",
    named: "ease-in-out",
    flat: "linear",
  });
  for (const key of ["default", "named", "flat"]) {
    assert.equal(
      typeof theme.motion.easing[key],
      "function",
      `${key} stopped resolving; older payloads would lose their curves`,
    );
  }
  brand.destroy();
});

test("distinct tuples give distinct curves", () => {
  // Guards a widening that accepts arrays and then ignores them, which would
  // satisfy the first test if both collapsed onto one default.
  const { brand, theme } = themeWithEasing({
    a: [0.25, 0.1, 0.25, 1],
    b: [0.4, 0, 1, 1],
  });
  assert.notEqual(
    theme.motion.easing["a"].points.join(","),
    theme.motion.easing["b"].points.join(","),
    "two different curves resolved to the same easing",
  );
  brand.destroy();
});

test("an overshooting tuple is accepted, because CSS accepts it", () => {
  // y outside [0,1] is legal and is how a spring reads. Rejecting it would
  // drop exactly the emphasized curves the engine derives at high energy.
  const { brand, theme } = themeWithEasing({ spring: [0.34, 1.56, 0.64, 1] });
  assert.equal(
    typeof theme.motion.easing["spring"],
    "function",
    "an overshooting curve was rejected",
  );
  brand.destroy();
});

test("a malformed tuple drops the key rather than shipping a broken curve", () => {
  // Dropping is the honest outcome for something that is not a curve: the app
  // falls back to a default. A NaN-carrying easing would corrupt an animation
  // instead, which is worse than absent.
  const { brand, theme } = themeWithEasing({
    short: [0.25, 0.1, 0.25],
    long: [0.25, 0.1, 0.25, 1, 0],
    stringy: [0.25, "0.1", 0.25, 1],
    empty: [],
    good: [0.25, 0.1, 0.25, 1],
  });
  for (const key of ["short", "long", "stringy", "empty"]) {
    assert.equal(
      theme.motion.easing[key],
      undefined,
      `${key} produced an easing from a malformed tuple`,
    );
  }
  assert.equal(
    typeof theme.motion.easing["good"],
    "function",
    "a valid tuple beside malformed ones was also dropped",
  );
  brand.destroy();
});
