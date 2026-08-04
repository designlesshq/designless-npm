/*
 * What reaches the Image component, drawn as the readme draws it.
 *
 * React Native gives a network image no size of its own. An Image whose
 * source carries no width and height, under no style that supplies them,
 * lays out at nothing and paints nothing: no error, no warning, no broken
 * image, just a mark that is not there. The address can be perfectly
 * correct and answer 200 the whole time.
 *
 * So these assert on the props that reach the component, not on the
 * address, which is checked elsewhere.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadPackage, snapshotFrom, cleanupBrands } from "./harness.mjs";

/* A brand holds timers, so none of them outlives the test that made it. */
afterEach(cleanupBrands);

function mounted() {
  const loaded = loadPackage({ dev: false });
  const brand = loaded.api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json", []),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  loaded.provide(brand);
  return { brand, api: loaded.api };
}

test("a mark asked for in points is drawn at those points", () => {
  const { brand, api } = mounted();
  /* The readme's own example. */
  const props = api.BrandImage({ role: "logo-symbol", pt: 40 }).props;
  assert.equal(props.source.width, 40);
  assert.equal(props.source.height, 40);
  assert.match(props.source.uri, /logo-symbol\.png\?appearance=dark&size=128/);
  brand.destroy();
});

test("a mark asked for at an exact size is drawn at that many pixels", () => {
  /* The screen in the harness is 3x, so 128 pixels is 42.67 points. */
  const { brand, api } = mounted();
  const props = api.BrandImage({ role: "logo-symbol", size: 128 }).props;
  assert.equal(props.source.width, 42.67);
  assert.equal(props.source.height, 42.67);
  brand.destroy();
});

test("a style with a size of its own is left in front", () => {
  const { brand, api } = mounted();
  const props = api.BrandImage({
    role: "logo-symbol",
    pt: 40,
    style: { width: 100, height: 100 },
  }).props;
  assert.deepEqual(props.style, { width: 100, height: 100 });
  brand.destroy();
});

test("a mark asked for no particular size carries none", () => {
  /*
   * Nothing to infer from, so nothing is invented. This is the one case
   * where the caller has to say, and the readme says so.
   */
  const { brand, api } = mounted();
  const props = api.BrandImage({ role: "logo-symbol" }).props;
  assert.equal(props.source.width, undefined);
  assert.equal(props.source.height, undefined);
  assert.equal(typeof props.source.uri, "string");
  brand.destroy();
});

test("the hook says what to do when there is no provider above it", () => {
  const loaded = loadPackage({ dev: false });
  assert.throws(
    () => loaded.api.BrandImage({ role: "logo-symbol", pt: 40 }),
    /DesignlessProvider/,
  );
});
