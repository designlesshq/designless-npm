/*
 * A shadow arrives two ways, and both are the same shadow.
 *
 * DTCG models `shadow` as an object of named parts, or an array of them for a
 * layered shadow. The engine has not converted yet — `none` at zero depth has
 * no composite representation and that decision is open — but the widening
 * lands first, deliberately: an SDK that cannot read the new form has to be
 * released BEFORE the engine emits it, not after, or every app on the old
 * version loses its elevation the moment a brand recompiles.
 *
 * WHAT THE FAILURE LOOKS LIKE, which is why this is a file and not a line.
 *
 * `toShadow` returned null for anything that was not a string. Null is not an
 * error a caller sees: the key is dropped and the component renders flat,
 * indistinguishable from a brand that declared no elevation. Same silent shape
 * the easing curves had before 0.1.1.
 *
 * Tested through the public surface like the rest of the suite. `toShadow` is
 * internal, and what matters is that a brand's elevation reaches
 * `theme.shadow`, not that a helper returns non-null.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

/*
 * The harness loads the package with stubbed modules, so the objects it hands
 * back do not share this realm's `Object.prototype`. `deepStrictEqual` compares
 * prototypes and rejects two identical-looking styles with `actual: {}` and
 * `expected: {}`, which reads as the conversion being broken when it is not.
 * Comparing the serialised form asks the question actually meant: are these the
 * same style?
 */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

import { loadPackage, snapshotFrom, cleanupBrands } from "./harness.mjs";

afterEach(cleanupBrands);

/** A snapshot whose `shadow` group is whatever is passed in. */
function themeWithShadow(shadow) {
  const snapshot = snapshotFrom("tokens.dark.json");
  snapshot.tokens.tokens.shadow = shadow;
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

test("a composite and its CSS string describe the same shadow", () => {
  const composite = themeWithShadow({
    md: { offsetX: "0", offsetY: "4px", blur: "6px", color: "rgba(0, 0, 0, 0.2)" },
  });
  const string = themeWithShadow({ md: "0 4px 6px rgba(0, 0, 0, 0.2)" });

  assert.ok(
    same(composite.theme.shadow["md"], string.theme.shadow["md"]),
    `the two forms disagree:\n  composite ${JSON.stringify(composite.theme.shadow["md"])}` +
      `\n  string    ${JSON.stringify(string.theme.shadow["md"])}`,
  );
  composite.brand.destroy();
  string.brand.destroy();
});

test("the string form still resolves, for payloads from before the change", () => {
  const { brand, theme } = themeWithShadow({
    sm: "0 1px 2px rgba(0, 0, 0, 0.14)",
    none: "none",
  });
  assert.ok(theme.shadow["sm"], "string form stopped resolving");
  assert.ok(same(theme.shadow["none"], {}), "\"none\" stopped meaning no shadow");
  brand.destroy();
});

test("a layered composite drops inset and keeps the first drop shadow", () => {
  // React Native draws ONE shadow and has no inner-shadow primitive, so the
  // inset highlight our dark shadows carry is dropped. Same rule the string
  // path already followed; this pins that the composite path shares it rather
  // than reimplementing it.
  const composite = themeWithShadow({
    md: [
      { offsetX: "0", offsetY: "4px", blur: "6px", color: "rgba(0, 0, 0, 0.21)" },
      { offsetX: "0", offsetY: "1px", blur: "0", color: "rgba(255, 255, 255, 0.05)", inset: true },
    ],
  });
  const string = themeWithShadow({
    md: "0 4px 6px rgba(0, 0, 0, 0.21), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
  });
  assert.ok(
    same(composite.theme.shadow["md"], string.theme.shadow["md"]),
    `the layered composite and its string form disagree:\n  composite ` +
      `${JSON.stringify(composite.theme.shadow["md"])}\n  string    ` +
      `${JSON.stringify(string.theme.shadow["md"])}`,
  );
  composite.brand.destroy();
  string.brand.destroy();
});

test("spread without blur lands in the right slot", () => {
  // `numbers` is positional, so a spread with no blur needs a zero written
  // into blur's place or the spread is read as blur and the radius is wrong.
  const withSpread = themeWithShadow({
    a: { offsetX: "0", offsetY: "2px", spread: "4px", color: "#000" },
  });
  const explicit = themeWithShadow({
    b: { offsetX: "0", offsetY: "2px", blur: "0", spread: "4px", color: "#000" },
  });
  assert.equal(
    withSpread.theme.shadow["a"].shadowRadius,
    explicit.theme.shadow["b"].shadowRadius,
    "spread was read as blur when blur was absent",
  );
  withSpread.brand.destroy();
  explicit.brand.destroy();
});

test("an empty array means no shadow, like the string \"none\"", () => {
  const { brand, theme } = themeWithShadow({ flat: [] });
  assert.ok(same(theme.shadow["flat"], {}), "an empty layer list should mean no shadow");
  brand.destroy();
});

test("a malformed composite drops the key rather than rendering a wrong shadow", () => {
  // A layer naming no position is not a shadow. Dropping lets the app fall
  // back; a half-read layer would render an elevation nobody authored.
  const { brand, theme } = themeWithShadow({
    noOffsets: { blur: "6px", color: "#000" },
    onlyX: { offsetX: "0", color: "#000" },
    notAnObject: 42,
    good: { offsetX: "0", offsetY: "4px", blur: "6px", color: "#000" },
  });
  for (const key of ["noOffsets", "onlyX", "notAnObject"]) {
    assert.equal(
      theme.shadow[key],
      undefined,
      `${key} produced a shadow from a malformed composite`,
    );
  }
  assert.ok(theme.shadow["good"], "a valid composite beside malformed ones was dropped");
  brand.destroy();
});

test("field order in the object does not change the shadow", () => {
  // The object names its parts, so authoring order is arbitrary. Reading key
  // order instead of CSS order would put spread where blur belongs.
  const a = themeWithShadow({
    x: { color: "#000", blur: "6px", offsetY: "4px", offsetX: "0" },
  });
  const b = themeWithShadow({
    x: { offsetX: "0", offsetY: "4px", blur: "6px", color: "#000" },
  });
  assert.ok(same(a.theme.shadow["x"], b.theme.shadow["x"]), "field order changed the result");
  a.brand.destroy();
  b.brand.destroy();
});
