/*
 * What a mounted component does when the brand moves under it.
 *
 * Every other test in this suite calls a component once and reads what
 * came back. That proves a first render and nothing else, and a first
 * render is the one case where a memo cannot be wrong. The failure a memo
 * actually has is holding last render's value after its dependencies
 * moved, and it looks like a working app: no error, no warning, just a
 * screen that is one appearance behind the one it is sitting on.
 *
 * That shipped. useBrandAsset subscribed to the brand and then dropped
 * the subscription's value on the floor, so its memo listed the brand,
 * the role and the params, none of which change when the appearance does.
 * A dark mark stayed on a light page, which is the exact thing the
 * appearance rule in protocol/address.ts exists to prevent, inverted.
 *
 * So these mount, change something, and read again.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadPackage,
  fixture,
  jsonResponse,
  routedFetch,
  settle,
  snapshotFrom,
  cleanupBrands,
} from "./harness.mjs";

afterEach(cleanupBrands);

const HEADERS = {
  "x-brand-hash": "aaaa",
  "x-brand-semver": "1.0.1",
  "x-brand-version": "2",
};

/** Serves the light payload, which is what an appearance change asks for. */
function servingLight() {
  return routedFetch([
    ["tokens.json", jsonResponse(fixture("tokens.light.json"), HEADERS)],
    ["fonts.json", jsonResponse(fixture("fonts.json"), HEADERS)],
    ["context.json", jsonResponse({ capabilities: [] })],
  ]);
}

function darkBrand(options = {}) {
  const loaded = loadPackage({ dev: false, fetch: servingLight(), ...options });
  const brand = loaded.api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json", [], { appearance: "dark" }),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  loaded.provide(brand);
  return { brand, loaded };
}

test("the harness holds a memoised value across a render, and lets go of it", async () => {
  /*
   * A guard on the guard. Every assertion below is only worth something
   * if useMemo actually honours its dependency array, and the stub it
   * replaced did not. So the harness is made to demonstrate both halves
   * on a hook of the package's own: the same value back when nothing
   * moved, a different one when the theme did.
   *
   * Identity is the assertion rather than contents, because a memo that
   * recomputes every render returns equal contents and a fresh object,
   * which is exactly the difference being tested.
   */
  const { brand, loaded } = darkBrand();
  const style = loaded.mount(() => loaded.api.useBrandText({ size: "md" }));
  const first = style.output;

  style.rerender();
  assert.equal(style.renders, 2, "the component rendered a second time");
  assert.equal(
    style.output,
    first,
    "and nothing it depends on moved, so the memo handed back the same object",
  );

  brand.setAppearance("light");
  await settle();

  assert.notEqual(
    style.output,
    first,
    "a new theme landed, so the memo let go of the old value",
  );
});

test("a mark follows the appearance the brand moved to", async () => {
  const { brand, loaded } = darkBrand();

  const image = loaded.mount(() =>
    loaded.api.BrandImage({ role: "logo-symbol", size: 128 }),
  );
  assert.match(
    image.output.props.source.uri,
    /appearance=dark/,
    "the first render is on the appearance the brand started on",
  );

  brand.setAppearance("light");
  await settle();

  assert.equal(
    brand.tokens().appearance,
    "light",
    "the payload landed, so the theme is light",
  );
  assert.match(
    brand.asset("logo-symbol", { size: 128 }),
    /appearance=light/,
    "and the brand itself answers light",
  );
  assert.match(
    image.output.props.source.uri,
    /appearance=light/,
    "so the mark on screen must be light too, or a light mark sits on a " +
      "dark page. This is the assertion the old harness could not make.",
  );
});

test("a mark that is pinned to an appearance stays pinned", async () => {
  /*
   * The other direction. An explicitly requested appearance is a
   * statement, and following the brand past it would make the prop
   * useless.
   */
  const { brand, loaded } = darkBrand();
  const image = loaded.mount(() =>
    loaded.api.BrandImage({ role: "logo-symbol", size: 128, appearance: "dark" }),
  );
  assert.match(image.output.props.source.uri, /appearance=dark/);

  brand.setAppearance("light");
  await settle();

  assert.match(
    image.output.props.source.uri,
    /appearance=dark/,
    "a pinned mark does not move",
  );
});

test("a text style follows a change in the brand", async () => {
  const { brand, loaded } = darkBrand();
  const style = loaded.mount(() => loaded.api.useBrandText({ size: "md" }));
  const first = style.output.fontSize;
  assert.equal(typeof first, "number");

  brand.setAppearance("light");
  await settle();

  assert.equal(
    style.output.fontSize,
    brand.tokens().text({ size: "md" }).fontSize,
    "the style a mounted component holds is the one the theme now builds",
  );
});

test("styles built from the theme are rebuilt when it changes", async () => {
  const { brand, loaded } = darkBrand();
  const styles = loaded.mount(() =>
    loaded.api.useThemedStyles((theme) => ({ page: { backgroundColor: theme.color["bg.page"] } })),
  );
  const before = styles.output.page.backgroundColor;

  brand.setAppearance("light");
  await settle();

  const after = styles.output.page.backgroundColor;
  assert.notEqual(
    after,
    before,
    "a light payload landed, so the page colour cannot still be the dark one",
  );
  assert.equal(after, brand.tokens().color["bg.page"]);
});

test("unmounting drops the subscription", async () => {
  const { brand, loaded } = darkBrand();
  const image = loaded.mount(() =>
    loaded.api.BrandImage({ role: "logo-symbol", size: 128 }),
  );
  const rendersBefore = image.renders;
  image.unmount();

  brand.setAppearance("light");
  await settle();

  assert.equal(
    image.renders,
    rendersBefore,
    "a component that is gone does not render again",
  );
});
