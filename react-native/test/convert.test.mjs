/*
 * The conversion table, checked against a captured payload.
 *
 * Every assertion here is a row of the table in convert/theme.ts, and
 * several of them exist because getting the row wrong produces something
 * that looks fine and reads wrong: a line box a point and a half tall, a
 * border style that arrives as NaN, a shadow with a layer this platform
 * cannot draw silently included in the numbers.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadPackage, snapshotFrom, fixture, cleanupBrands } from "./harness.mjs";

/* A brand holds timers, so none of them outlives the test that made it. */
afterEach(cleanupBrands);

function themeFor(fixtureName = "tokens.dark.json", present = []) {
  const { api, warnings } = loadPackage({ dev: true });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom(fixtureName, present),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  return { brand, theme: brand.tokens(), warnings, api };
}

test("a snapshot gives a theme before anything is awaited", () => {
  const { brand, theme } = themeFor();
  assert.equal(brand.status, "restored");
  assert.ok(theme, "the theme is there on the first frame");
  assert.equal(theme.appearance, "dark");
  brand.destroy();
});

test("colours pass through, flattened to dotted keys", () => {
  const { brand, theme } = themeFor();
  assert.equal(theme.color["bg.page"], "#060608");
  assert.equal(theme.color["text.primary"], "#E8E4DE");
  assert.equal(theme.color["bg.surface"], "#1A1614");
  brand.destroy();
});

test("the light payload really is a different set of colours", () => {
  const dark = themeFor("tokens.dark.json");
  const light = themeFor("tokens.light.json");
  assert.equal(dark.theme.color["bg.page"], "#060608");
  assert.equal(light.theme.color["bg.page"], "#ddd3c4");
  assert.notEqual(
    dark.theme.color["text.primary"],
    light.theme.color["text.primary"],
  );
  dark.brand.destroy();
  light.brand.destroy();
});

test("spacing is rem and size is px, in the same payload", () => {
  const { brand, theme } = themeFor();
  /* 1.000rem against a root of 16 */
  assert.equal(theme.space["4"], 16);
  assert.equal(theme.space["0"], 0);
  assert.equal(theme.space["md"], 24);
  /* 24px stays 24, and would be 384 if the group were read as rem */
  assert.equal(theme.size["icon.md"], 24);
  assert.equal(theme.size["control.height"], 41);
  brand.destroy();
});

test("radius converts, including the very large one", () => {
  const { brand, theme } = themeFor();
  assert.equal(theme.radius["md"], 10);
  assert.equal(theme.radius["full"], 9999);
  brand.destroy();
});

test("opacity and stacking order are plain numbers", () => {
  const { brand, theme } = themeFor();
  assert.equal(theme.opacity["hover"], 0.9);
  assert.equal(theme.opacity["disabled"], 0.4);
  assert.equal(theme.zIndex["modal"], 1300);
  brand.destroy();
});

test("border widths become numbers and the style stays a word", () => {
  const { brand, theme } = themeFor();
  assert.equal(theme.border["width.1"], 1);
  assert.equal(theme.border["focus.width"], 2);
  assert.equal(
    theme.border["style.default"],
    "solid",
    "a group-wide number conversion would make this NaN",
  );
  brand.destroy();
});

test("shadows drop the inner layer and say how many they dropped", () => {
  const { brand, theme } = themeFor();
  const md = theme.shadow["md"];
  assert.equal(md.shadowOffset.width, 0);
  assert.equal(md.shadowOffset.height, 4);
  assert.equal(md.shadowRadius, 3);
  assert.equal(md.shadowOpacity, 0.21);
  assert.equal(md.shadowColor, "rgb(0, 0, 0)");
  assert.equal(md.elevation, 7);
  assert.equal(md.__droppedLayers, 1, "every shadow here carries an inner layer");
  assert.deepEqual(Object.keys(theme.shadow["none"]), []);
  brand.destroy();
});

test("shadows carry no drop count outside a development build", () => {
  const { api } = loadPackage({ dev: false });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json"),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  assert.equal(brand.tokens().shadow["md"].__droppedLayers, undefined);
  brand.destroy();
});

test("motion becomes milliseconds and curves", () => {
  const { brand, theme } = themeFor();
  assert.equal(theme.motion.duration["normal"], 270);
  assert.equal(theme.motion.duration["fast"], 152);
  const easing = theme.motion.easing["default"];
  assert.equal(typeof easing, "function");
  assert.equal(easing.points.join(","), "0.25,0.1,0.25,1");
  brand.destroy();
});

test("the touch target is passed through and questioned, not raised", () => {
  const { brand, theme, warnings } = themeFor();
  assert.equal(theme.spacing.touchTargetMin, 32);
  const said = warnings.join(" ");
  assert.match(said, /touch target is 32/);
  assert.match(said, /44/);
  assert.match(said, /48/);
  brand.destroy();
});

test("the safe area is a published length, and it is zero here", () => {
  const { brand, theme } = themeFor();
  assert.equal(theme.spacing.safeArea.top, 0);
  assert.equal(theme.spacing.safeArea.bottom, 0);
  brand.destroy();
});

test("component values keep their shape and their kinds", () => {
  const { brand, theme } = themeFor();
  const nav = theme.component.nav;
  /* 0.625rem */
  assert.equal(nav.item.padding.x, 10);
  /* a colour is left exactly as published */
  assert.equal(nav.bg.hover, "#221e18");
  /* 2px on a border side */
  assert.equal(nav.item.active.borderLeft.width, 2);
  /* a weight arrives as a json number and stays one */
  assert.equal(nav.badge.font.weight, 500);
  /* an enum is not a length */
  assert.equal(nav.section.label.textTransform, "uppercase");
  assert.equal(theme.component.breadcrumb.separator.content, "/");
  brand.destroy();
});

test("a component line height stays a string, because it is a multiple", () => {
  const { brand, theme } = themeFor();
  assert.equal(
    theme.component.text.font.lineHeight,
    "1.51",
    "converting this to 1.51 would give a line box one and a half points tall",
  );
  assert.equal(
    theme.component.nav.section.label.letterSpacing,
    "0.028em",
    "an em is relative to the font size, so it cannot be a number here",
  );
  brand.destroy();
});

test("a shadow inside a component is converted like any other shadow", () => {
  const { brand, theme } = themeFor();
  const card = theme.component.card.shadow.md;
  assert.equal(typeof card, "object");
  assert.equal(card.shadowRadius, 3);
  assert.equal(typeof theme.component.button.transition.easing, "function");
  assert.equal(theme.component.button.transition.duration, 152);
  brand.destroy();
});

test("no style objects are invented for component values", () => {
  const { brand, theme } = themeFor();
  const item = theme.component.nav.item;
  assert.equal(item.paddingHorizontal, undefined);
  assert.equal(item.borderLeftWidth, undefined);
  assert.ok(item.padding.x !== undefined, "the published names are kept");
  brand.destroy();
});

test("text is the only exit for typography, and it resolves the ratios", () => {
  const { brand, theme } = themeFor();
  assert.equal(theme.typography, undefined, "typography is not exposed raw");
  const style = theme.text({
    size: "md",
    line: "normal",
    tracking: "wide",
    weight: "heading",
  });
  /* 0.910rem against a root of 16 */
  assert.equal(style.fontSize, 14.56);
  /* 14.56 times the published multiple of 1.51 */
  assert.equal(style.lineHeight, 21.99);
  /* 14.56 times 0.028em */
  assert.equal(style.letterSpacing, 0.41);
  brand.destroy();
});

test("text defaults to the middle size and the normal weight", () => {
  const { brand, theme } = themeFor();
  const style = theme.text({});
  assert.equal(style.fontSize, 14.56);
  assert.equal(style.fontWeight, "400");
  assert.equal(style.lineHeight, undefined, "a line height is asked for, not assumed");
  brand.destroy();
});

test("the payload is kept exactly as it was served", () => {
  const { brand, theme } = themeFor();
  const served = fixture("tokens.dark.json");
  assert.deepEqual(theme.served, served);
  assert.equal(theme.served.tokens.typography.lineHeight.normal, "1.51");
  assert.equal(theme.served.tokens.space["4"], "1.000rem");
  brand.destroy();
});

test("the appearance in the payload envelope is not what the theme reports", () => {
  /*
   * The captured payload for the default request is labelled light and
   * carries dark values. This package answers from the request it made,
   * which is why appearance is always sent and the label never read.
   */
  const { brand, theme } = themeFor("tokens.dark.json");
  assert.equal(theme.appearance, "dark");
  brand.destroy();
});

test("a different root size moves every rem and no px", () => {
  const { api } = loadPackage({ dev: false });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json"),
    appearance: "dark",
    remBase: 10,
    autoInit: false,
    live: { enabled: false },
  });
  const theme = brand.tokens();
  assert.equal(theme.space["4"], 10);
  assert.equal(theme.size["icon.md"], 24);
  brand.destroy();
});
