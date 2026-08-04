/*
 * Which font name comes out, for every combination that matters.
 *
 * A brand says two things about its type: an ordered list of families per
 * role, and the font list naming the family it actually publishes for
 * that role. The rows below are every way those two can agree, disagree
 * or be missing, and what each one should put on the screen.
 *
 * Three of them end in the platform font, and each ends there for a
 * different reason. Telling those reasons apart is the whole point: one
 * of them is a build to fix, one is a request to retry, and one is the
 * brand getting exactly what it published.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadPackage, snapshotFrom, fixture, cleanupBrands } from "./harness.mjs";

/* A brand holds timers, so none of them outlives the test that made it. */
afterEach(cleanupBrands);

const INTER = ["Inter-Regular", "Inter-SemiBold"];
const EVERYTHING = [
  "Inter-Regular",
  "Inter-SemiBold",
  "EBGaramond-Regular",
  "EBGaramond-SemiBold",
  "JetBrainsMono-Regular",
  "JetBrainsMono-SemiBold",
];

function brandWith(tokensFixture, present) {
  const { api, warnings } = loadPackage({ dev: true });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom(tokensFixture, present),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  return { brand, theme: brand.tokens(), warnings };
}

/*
 * Two of the three token fixtures are captures, one is not, and which is
 * which decides what a failure here means.
 *
 * tokens.dark.json, tokens.light.json and tokens.ios.json were pulled
 * from https://cdn.designless.app/r/_designless/tokens.json on
 * 2026-08-04, with ?appearance= and ?platform= as the names say. A
 * failure against one of those is a report about the live surface.
 *
 * tokens.system-first.json is NOT a capture. It was one, until the server
 * stopped answering that way: its body and mono lists open with a system
 * name and its display list names a family the brand does not publish.
 * Both shapes are still legal, a brand can still ask for the platform
 * font on any role, and the walk still has to handle them. So the file is
 * kept for the shapes and renamed so it stops claiming to be iOS. A
 * failure against it is a report about this package only.
 */

test("every role's list on the captured payloads opens with the family the brand publishes", () => {
  /*
   * The agreement this asserts is the server's, not this package's, and
   * it is asserted from here because this is where breaking it costs
   * something: a native app registers a face by the name fonts.json
   * gives it, and can only reach that face if a token stack names it
   * too. Nothing about a mismatch is visible at runtime. The app renders
   * in the platform font and carries the unused file in its binary.
   *
   * It was broken until 2026-08-04. fonts.json advertised EB Garamond
   * for display while the stack asked for Garamond, and the ios payload
   * replaced the body stack with -apple-system outright, naming no brand
   * face at all. This test is what would have caught it from this side.
   */
  const published = fixture("fonts.json").families;
  for (const name of ["tokens.dark.json", "tokens.light.json", "tokens.ios.json"]) {
    const stacks = fixture(name).tokens.typography.fontFamily;
    for (const family of published) {
      for (const role of family.roles) {
        const stack = stacks[role];
        assert.ok(stack, `${name}: no ${role} stack to check`);
        const head = stack.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
        assert.equal(
          head,
          family.family,
          `${name}: the ${role} list opens with "${head}" while fonts.json ` +
            `publishes "${family.family}" for that role, so the face the app ` +
            `registers is never asked for`,
        );
      }
    }
  }
});

test("a captured iOS payload keeps the native stack behind the brand family", () => {
  /* The brand family goes in FRONT of the platform's own stack, it does
   * not replace it. An app whose font registration failed still lands on
   * SF Pro rather than on a web stack it has no files for. */
  const ios = fixture("tokens.ios.json").tokens.typography.fontFamily;
  assert.match(ios.body, /^Inter,/);
  assert.ok(
    ios.body.includes("-apple-system"),
    `the iOS body list dropped its native fallback: ${ios.body}`,
  );
  assert.match(ios.mono, /^'JetBrains Mono',/);
  assert.ok(ios.mono.includes("Menlo"), `the iOS mono list lost its tail: ${ios.mono}`);
});

test("the hand-held payload opens its body list with a system name", () => {
  /* The premise every system-font case below depends on. If this file
   * ever stops having that shape, those tests pass without exercising
   * anything, so it is asserted once here rather than assumed four
   * times. */
  const held = fixture("tokens.system-first.json").tokens.typography.fontFamily;
  assert.match(held.body, /^-apple-system,/);
  assert.equal(
    /Inter/.test(held.body),
    false,
    "a list that opens with a system name names no brand face at all",
  );
  assert.match(held.display, /^'Garamond',/);
  assert.equal(
    /EB Garamond/.test(held.display),
    false,
    "the display list has to name something other than the published family",
  );
});

test("the brand face wins when the build contains it", () => {
  const { brand, theme } = brandWith("tokens.dark.json", INTER);
  const style = theme.text({ family: "body", weight: "heading" });
  assert.equal(style.fontFamily, "Inter-SemiBold");
  assert.equal(
    style.fontWeight,
    undefined,
    "a weight beside a resolved face invites a bold face being thickened again",
  );
  brand.destroy();
});

test("the iOS payload resolves to the brand's own faces, not the platform's", () => {
  /*
   * The whole point of the platform arm carrying the brand family. An
   * iPhone build that registered Inter and EB Garamond gets them; before
   * 2026-08-04 the same build got SF Pro on body and SF Mono on mono,
   * with the registered files sitting unused in the binary.
   *
   * Driven through the resolver rather than read off the fixture,
   * because naming the family and reaching the face are two different
   * things and only the second one puts type on a screen.
   */
  const { brand, theme, warnings } = brandWith("tokens.ios.json", EVERYTHING);
  assert.equal(theme.text({ family: "body" }).fontFamily, "Inter-Regular");
  assert.equal(
    theme.text({ family: "display", weight: "heading" }).fontFamily,
    "EBGaramond-SemiBold",
  );
  assert.equal(theme.text({ family: "mono" }).fontFamily, "JetBrainsMono-Regular");
  assert.equal(
    warnings.filter((l) => l.includes("role uses")).length,
    0,
    "nothing was missing, so nothing is reported",
  );
  brand.destroy();
});

test("a missing face falls back to the entry the brand named next", () => {
  const { brand, theme, warnings } = brandWith("tokens.dark.json", []);
  const style = theme.text({ family: "body", weight: "heading" });
  assert.equal(style.fontFamily, undefined, "the platform font is used");
  assert.equal(style.fontWeight, "600", "weight is the only lever left");
  const said = warnings.join(" ");
  assert.match(said, /"body" role uses "Inter"/);
  assert.match(said, /designless-fonts/);
  brand.destroy();
});

test("the missing face is reported once per role, not once per call", () => {
  const { brand, theme, warnings } = brandWith("tokens.dark.json", []);
  theme.text({ family: "body" });
  theme.text({ family: "body" });
  theme.text({ family: "body" });
  const said = warnings.filter((line) => line.includes('"body" role'));
  assert.equal(said.length, 1);
  brand.destroy();
});

test("nothing is said outside a development build", () => {
  const { api } = loadPackage({ dev: false });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json", []),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  brand.tokens().text({ family: "body" });
  brand.destroy();
});

test("a list opening with a system name stops there, whatever is bundled", () => {
  const { brand, theme, warnings } = brandWith("tokens.system-first.json", EVERYTHING);
  const style = theme.text({ family: "body", weight: "heading" });
  assert.equal(style.fontFamily, undefined);
  assert.equal(style.fontWeight, "600");
  assert.equal(
    warnings.filter((line) => line.includes("role uses")).length,
    0,
    "nothing was missing: the brand asked for the platform font",
  );
  brand.destroy();
});

test("a bundled face is used even when the list never names it", () => {
  /*
   * The display list here reads Garamond, Palatino, Book Antiqua, serif,
   * and none of those is the family the brand publishes, which is EB
   * Garamond. The list is a browser's list. The font list is the fact,
   * and it says EB Garamond fills the display role, so the file this
   * build carries is used rather than thrown away for a serif.
   *
   * This used to run against a real capture, because the server used to
   * send exactly that disagreement. It does not any more, so the case
   * runs against the hand-held payload instead. The disagreement is
   * still reachable — a brand can name any family it likes in a stack —
   * and this is the behaviour that keeps it from costing anything.
   */
  const { brand, theme, warnings } = brandWith("tokens.system-first.json", EVERYTHING);
  const display = theme.text({ family: "display", weight: "heading" });
  assert.equal(display.fontFamily, "EBGaramond-SemiBold");
  assert.equal(
    display.fontWeight,
    undefined,
    "the face carries its own weight",
  );
  assert.equal(
    warnings.filter((line) => line.includes('"display" role')).length,
    0,
    "nothing was missing, so nothing is reported",
  );
  brand.destroy();
});

test("the same role says so out loud when the build lacks the face", () => {
  const { brand, theme, warnings } = brandWith("tokens.dark.json", INTER);
  const display = theme.text({ family: "display", weight: "heading" });
  assert.equal(display.fontFamily, undefined, "the platform font is used");
  assert.equal(display.fontWeight, "600");
  const said = warnings.join(" ");
  assert.match(
    said,
    /"display" role uses "EB Garamond"/,
    "the family named is the one the brand publishes, not one off the list",
  );
  brand.destroy();
});

test("asking for the platform font is not overridden, and is per role", () => {
  /*
   * A brand asking for the platform font has not run out of options, so
   * the role's own family is not put in front of what it asked for. The
   * same payload asks for it on two roles and not on the third, so the
   * answer has to be worked out a role at a time.
   */
  const { brand, theme, warnings } = brandWith("tokens.system-first.json", EVERYTHING);
  assert.equal(theme.text({ family: "body" }).fontFamily, undefined);
  assert.equal(theme.text({ family: "mono" }).fontFamily, undefined);
  assert.equal(
    theme.text({ family: "display", weight: "heading" }).fontFamily,
    "EBGaramond-SemiBold",
    "this role never asked for the platform font",
  );
  assert.equal(warnings.filter((l) => l.includes("role uses")).length, 0);
  brand.destroy();
});

test("the mono list does resolve, because the names match", () => {
  const { brand, theme } = brandWith("tokens.dark.json", EVERYTHING);
  assert.equal(
    theme.text({ family: "mono", weight: "normal" }).fontFamily,
    "JetBrainsMono-Regular",
  );
  brand.destroy();
});

test("a weight with no face of its own takes the nearest, heavier on a tie", () => {
  const { brand, theme } = brandWith("tokens.dark.json", INTER);
  /* The published medium weight is 500 and only 400 and 600 exist. */
  assert.equal(
    theme.text({ family: "body", weight: "medium" }).fontFamily,
    "Inter-SemiBold",
  );
  brand.destroy();
});

test("the font list answers the same question the same way", () => {
  const { brand, theme } = brandWith("tokens.dark.json", INTER);
  const manifest = brand.fonts();
  assert.equal(manifest.format, "ttf");
  assert.equal(manifest.faceFor("body", 600), "Inter-SemiBold");
  assert.equal(manifest.faceFor("body", 400), "Inter-Regular");
  assert.equal(manifest.faceFor("display", 400), undefined);
  assert.equal(
    manifest.faceFor("body", 600),
    theme.text({ family: "body", weight: "heading" }).fontFamily,
    "the list and the style are read off one index, so they cannot differ",
  );
  assert.equal(manifest.present().sort().join(","), INTER.slice().sort().join(","));
  const missing = manifest.missing().map((face) => face.postscriptName).sort();
  assert.equal(
    missing.join(","),
    "EBGaramond-Regular,EBGaramond-SemiBold,JetBrainsMono-Regular,JetBrainsMono-SemiBold",
  );
  brand.destroy();
});

test("every face in the manifest carries a registration name and a file", () => {
  const { brand } = brandWith("tokens.dark.json", EVERYTHING);
  const manifest = brand.fonts();
  assert.equal(manifest.families.length, 3);
  for (const family of manifest.families) {
    assert.ok(family.roles.length > 0, family.family + " names a role");
    for (const face of family.faces) {
      assert.match(face.postscriptName, /^[A-Za-z]+-[A-Za-z]+$/);
      assert.match(face.url, /\.ttf$/);
      assert.equal(typeof face.weight, "number");
    }
  }
  brand.destroy();
});

test("a family name is never what comes out", () => {
  /*
   * The semibold file registers under its own family name, and the record
   * that would group it with the regular is not one the platforms resolve
   * on. So there is no family that contains both weights, and asking for
   * one by family and setting a weight beside it renders the regular.
   */
  const { brand, theme } = brandWith("tokens.dark.json", EVERYTHING);
  const names = [
    theme.text({ family: "body", weight: "normal" }).fontFamily,
    theme.text({ family: "body", weight: "bold" }).fontFamily,
    theme.text({ family: "mono", weight: "bold" }).fontFamily,
  ];
  for (const name of names) {
    assert.ok(name.includes("-"), name + " is a registration name");
    assert.notEqual(name, "Inter");
    assert.notEqual(name, "JetBrains Mono");
  }
  brand.destroy();
});

/*
 * Below: the shapes a captured payload cannot show, built by changing one
 * thing about a real one. Each is a way to end up on the platform font
 * that used to happen in silence.
 */

function brandShaped(tokens, present, fonts) {
  const { api, warnings } = loadPackage({ dev: true });
  const snapshot = snapshotFrom("tokens.dark.json", present);
  if (tokens) snapshot.tokens = tokens;
  if (fonts !== undefined) snapshot.fonts = fonts;
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot,
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  return { brand, theme: brand.tokens(), warnings };
}

test("no font list at all is said out loud, not passed over", () => {
  const { brand, theme, warnings } = brandShaped(null, EVERYTHING, null);
  const style = theme.text({ family: "body", weight: "heading" });
  assert.equal(style.fontFamily, undefined);
  assert.equal(style.fontWeight, "600");
  assert.match(warnings.join(" "), /font list for this brand has not been read/);
  brand.destroy();
});

/*
 * This test used to assert the opposite: that a role the brand publishes
 * no face for said nothing at all. That was deliberate and it was wrong,
 * and it is being changed on purpose rather than relaxed.
 *
 * The reasoning it was written on holds -- a brand need not publish a
 * mono face, and being told off for it would be noise. What it missed is
 * that the same code path is reached by a role that was misspelled, and
 * at the moment of reaching it the two are indistinguishable. In practice
 * the misspelling is the common one, because a brand publishes exactly
 * body, display and mono and a developer types one of those from memory.
 * Measured before the change: theme.text({ family: "caption" }) returned
 * a style in the platform font with no warning of any kind.
 *
 * So the line names the roles the brand does publish. That answers the
 * developer who mistyped and the developer who did not, in one sentence,
 * and accuses neither.
 */
test("a role the brand publishes no face for names the ones it does", () => {
  const fonts = fixture("fonts.json");
  fonts.families = fonts.families.filter((f) => f.family === "Inter");
  const { brand, theme, warnings } = brandShaped(null, ["Inter-Regular"], fonts);
  assert.equal(theme.text({ family: "display" }).fontFamily, undefined);
  const said = warnings.filter((line) => line.includes('"display"'));
  assert.equal(said.length, 1, "said once");
  assert.match(said[0], /publishes no face for the "display" role/);
  assert.match(
    said[0],
    /The roles it publishes are "body"/,
    "and names what it does publish, which is what tells a typo from a gap",
  );
  assert.doesNotMatch(
    said[0],
    /designless-fonts/,
    "nothing is missing from the build, so nothing is downloaded to fix it",
  );
  brand.destroy();
});

test("a misspelled role is answered with the roles that exist", () => {
  /* The common case the line above exists for. "caption" is not a text
   * role at all, and before this it produced a platform-font style in
   * silence. */
  const { brand, theme, warnings } = brandShaped(null, EVERYTHING);
  const style = theme.text({ family: "caption" });
  assert.equal(style.fontFamily, undefined);
  const said = warnings.filter((line) => line.includes('"caption"'));
  assert.equal(said.length, 1);
  assert.match(said[0], /The roles it publishes are .*"body"/);
  brand.destroy();
});

test("a brand face whose name is also a system name is still reached", () => {
  const tokens = fixture("tokens.dark.json");
  tokens.tokens.typography.fontFamily.body = "Roboto, -apple-system, sans-serif";
  const fonts = fixture("fonts.json");
  fonts.families[0].family = "Roboto";
  fonts.families[0].faces[0].postscriptName = "Roboto-Regular";
  fonts.families[0].faces[1].postscriptName = "Roboto-SemiBold";
  const { brand, theme } = brandShaped(
    tokens,
    ["Roboto-Regular", "Roboto-SemiBold"],
    fonts,
  );
  assert.equal(
    theme.text({ family: "body", weight: "heading" }).fontFamily,
    "Roboto-SemiBold",
    "the file is in the build, so the name on the list is not a full stop",
  );
  brand.destroy();
});

test("a face too far from the asked-for weight is not substituted", () => {
  const fonts = fixture("fonts.json");
  /* One heavy face and nothing else, which is the case that renders body
   * copy bold and leaves no way to ask for anything lighter. */
  fonts.families[0].faces = [
    {
      weight: 700,
      style: "normal",
      postscriptName: "Inter-Bold",
      src: { ttf: "https://cdn.designless.app/fonts/inter/700.ttf" },
    },
  ];
  const { brand, theme, warnings } = brandShaped(null, ["Inter-Bold"], fonts);
  const body = theme.text({ family: "body", weight: "normal" });
  assert.equal(body.fontFamily, undefined, "400 is three steps from 700");
  assert.equal(body.fontWeight, "400");
  assert.match(
    warnings.join(" "),
    /no face close enough to the weight/,
    "the file is in the build and cannot be used, which is the one case " +
      "that looks like no reason at all unless it is said",
  );
  assert.equal(
    theme.text({ family: "body", weight: "heading" }).fontFamily,
    "Inter-Bold",
    "600 is close enough to read as the same voice",
  );
  brand.destroy();
});

test("a family published only in italic is reachable rather than invisible", () => {
  const fonts = fixture("fonts.json");
  for (const face of fonts.families[0].faces) face.style = "italic";
  const { brand, theme } = brandShaped(null, INTER, fonts);
  assert.equal(
    theme.text({ family: "body", weight: "heading" }).fontFamily,
    "Inter-SemiBold",
    "one style is what the brand published, so it is what gets used",
  );
  brand.destroy();
});

test("a system-named family the brand publishes is reached at every weight", () => {
  /*
   * The walk stops at a system name only when the brand publishes nothing
   * under it. Asking that question at a fixed weight instead of asking it
   * of the name makes a family published only in one weight read as a
   * request for the platform font, and a request for the platform font is
   * the one outcome that is never reported. The file is in the build, the
   * brand names it, and nothing on the screen or in the console says why
   * it is not being used.
   */
  const tokens = fixture("tokens.dark.json");
  tokens.tokens.typography.fontFamily.body = "Roboto, sans-serif";
  const fonts = fixture("fonts.json");
  fonts.families[0].family = "Roboto";
  fonts.families[0].faces = [
    {
      weight: 700,
      style: "normal",
      postscriptName: "Roboto-Bold",
      src: { ttf: "https://cdn.designless.app/fonts/roboto/700.ttf" },
    },
  ];
  const { brand, theme, warnings } = brandShaped(tokens, ["Roboto-Bold"], fonts);

  assert.equal(
    theme.text({ family: "body", weight: "heading" }).fontFamily,
    "Roboto-Bold",
    "the brand publishes this name, so its own name is not a full stop",
  );
  const body = theme.text({ family: "body", weight: "normal" });
  assert.equal(body.fontFamily, undefined, "400 is three steps from 700");
  assert.match(
    warnings.join(" "),
    /no face close enough to the weight/,
    "the weight is why, and it is said rather than passed off as the " +
      "brand having asked for the platform font",
  );
  brand.destroy();
});

/*
 * Below: a face answered, and it was not the one that was asked for.
 *
 * These are the quietest failures in the package. A substituted face is
 * applied, looks applied, and carries no weight beside it to argue with,
 * so body copy renders in Light or in italic and the only evidence is
 * that it looks slightly wrong.
 */

test("a weight answered from a nearby face is said out loud", () => {
  /* Inter publishes 400 and 600. Asking for 500 lands on one of them. */
  const { brand, theme, warnings } = brandShaped(null, EVERYTHING);
  const style = theme.text({ family: "body", weight: "medium" });
  assert.ok(
    style.fontFamily === "Inter-SemiBold" || style.fontFamily === "Inter-Regular",
    "a face answered: " + String(style.fontFamily),
  );
  assert.equal(
    style.fontWeight,
    undefined,
    "and no weight is set beside it, which is why nothing else could tell",
  );
  const said = warnings.filter((line) => line.includes("weight 500"));
  assert.equal(said.length, 1, "said once: " + warnings.join(" | "));
  assert.match(said[0], /"body" role was asked for weight 500/);
  assert.match(
    said[0],
    /"Inter" publishes 600/,
    "the family that answered is named, not just the number it answered with",
  );
  brand.destroy();
});

test("a weight the family publishes says nothing", () => {
  const { brand, theme, warnings } = brandShaped(null, EVERYTHING);
  assert.equal(
    theme.text({ family: "body", weight: "heading" }).fontFamily,
    "Inter-SemiBold",
  );
  assert.equal(
    warnings.filter((line) => line.includes("asked for weight")).length,
    0,
    "600 was asked for and 600 answered, so there is nothing to say",
  );
  brand.destroy();
});

test("an upright request answered by an italic face is said out loud", () => {
  /*
   * A family that publishes only italics answers everything from them,
   * so every string in that role renders slanted. Before this it was
   * silent, and an app whose body copy is entirely italic looks like a
   * styling mistake somebody made on purpose.
   */
  const fonts = fixture("fonts.json");
  fonts.families[0].faces = [
    {
      weight: 400,
      style: "italic",
      postscriptName: "Inter-Italic",
      src: { ttf: "https://cdn.designless.app/fonts/inter/400i.ttf" },
    },
  ];
  const { brand, theme, warnings } = brandShaped(null, ["Inter-Italic"], fonts);
  assert.equal(theme.text({ family: "body" }).fontFamily, "Inter-Italic");
  const said = warnings.filter((line) => line.includes("publishes only italic"));
  assert.equal(said.length, 1, warnings.join(" | "));
  assert.match(said[0], /"body" role was asked for normal/);
  assert.match(said[0], /"Inter" publishes only italic/, "and names the family");
  brand.destroy();
});

test("a missing face is fixed by the command that would actually add it", () => {
  /*
   * The build declared roles: "body", and the face that is missing is the
   * display one. --roles=body downloads body again and changes nothing,
   * so the warning would have repeated for the life of the project.
   */
  const { api, warnings } = loadPackage({ dev: true });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json", ["Inter-Regular", "Inter-SemiBold"]),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
    fonts: { roles: "body" },
  });
  const tokens = brand.tokens();
  /* The display stack in the fixture names no family the brand publishes,
   * so the role's own published family is what is reached for. */
  assert.equal(tokens.text({ family: "display" }).fontFamily, undefined);
  const said = warnings.filter((line) => line.includes('"display"'));
  assert.equal(said.length, 1, warnings.join(" | "));
  assert.match(said[0], /npx designless-fonts --roles=all/);
  assert.doesNotMatch(
    said[0],
    /--roles=body/,
    "the flag the build already ran does not add the face that is missing",
  );
  brand.destroy();
});

test("a missing body face is fixed by the flag the build already uses", () => {
  const { api, warnings } = loadPackage({ dev: true });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json", []),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
    fonts: { roles: "body" },
  });
  assert.equal(brand.tokens().text({ family: "body" }).fontFamily, undefined);
  const said = warnings.filter((line) => line.includes('"body"'));
  assert.equal(said.length, 1, warnings.join(" | "));
  assert.match(said[0], /--roles=body/);
  brand.destroy();
});

test("a stack naming a key off Object.prototype resolves instead of throwing", () => {
  /*
   * The family index was an object literal, so a served stack naming
   * "constructor" or "__proto__" reached Object.prototype and handed back
   * something that is not a family. The next line read .faces off it and
   * text() threw, inside render, on remote data. Measured before the fix:
   * TypeError: Cannot read properties of undefined (reading 'length').
   */
  for (const hostile of ["constructor", "__proto__", "toString", "valueOf"]) {
    const tokens = fixture("tokens.dark.json");
    tokens.tokens.typography.fontFamily.body = hostile + ", Inter, sans-serif";
    const { brand, theme } = brandShaped(tokens, EVERYTHING);
    const style = theme.text({ family: "body" });
    assert.equal(
      style.fontFamily,
      "Inter-Regular",
      hostile + " is not a family this brand publishes, so the walk goes on",
    );
    brand.destroy();
  }
});

test("a role named off Object.prototype is answered, not thrown at", () => {
  const { brand, theme } = brandShaped(null, EVERYTHING);
  for (const hostile of ["constructor", "__proto__", "hasOwnProperty"]) {
    const style = theme.text({ family: hostile });
    assert.equal(style.fontFamily, undefined);
    assert.equal(typeof style.fontSize, "number");
  }
  brand.destroy();
});

test("a face present under a prototype key name is not claimed by accident", () => {
  /*
   * The other direction. The registry index was an object literal too,
   * so index["constructor"] answered from Object.prototype for a face
   * nobody built. Two things have to hold for that to be harmless: the
   * index has no prototype, and the presence check compares strictly to
   * true rather than to defined. Either alone is enough today, so this
   * catches losing BOTH, which is what a rewrite of the file would do.
   */
  const fonts = fixture("fonts.json");
  fonts.families[0].faces = [
    {
      weight: 400,
      style: "normal",
      postscriptName: "constructor",
      src: { ttf: "https://cdn.designless.app/fonts/inter/400.ttf" },
    },
  ];
  const { brand, theme, warnings } = brandShaped(null, [], fonts);
  assert.equal(
    theme.text({ family: "body" }).fontFamily,
    undefined,
    "no face was recorded for this build, so none is claimed",
  );
  assert.match(warnings.join(" "), /this build does not contain it/);
  brand.destroy();
});
