/*
 * What theme.appearance is allowed to say.
 *
 * It is a label on a set of colours, and an app reads it to decide things
 * the colours cannot decide for it: a status bar style, a keyboard, a map
 * tile set. So the one thing it may never do is describe an appearance
 * other than the one the values beside it actually are.
 *
 * Two ways it used to. A copy taken at build time holds one appearance,
 * and a device on the other one was painted those colours under the
 * device's label. And moving between appearances relabelled what was on
 * screen at the moment of asking, rather than when the new values landed,
 * so every theme read between the two was a light payload calling itself
 * dark. Neither throws, and both look exactly like a working app.
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

/* A brand holds timers, so none of them outlives the test that made it. */
afterEach(cleanupBrands);

const HEADERS = {
  "x-brand-hash": "aaaa",
  "x-brand-semver": "1.0.1",
  "x-brand-version": "2",
};

const DARK_PAGE = "#060608";
const LIGHT_PAGE = "#ddd3c4";

function serving(tokensFixture, headers = HEADERS) {
  return routedFetch([
    ["tokens.json", jsonResponse(fixture(tokensFixture), headers)],
    ["fonts.json", jsonResponse(fixture("fonts.json"), headers)],
    ["context.json", jsonResponse({ capabilities: [] })],
  ]);
}

test("a snapshot taken in the other appearance is labelled what it is", async () => {
  /*
   * The device is dark and the copy in the build is light, which is the
   * default the snapshot command writes. The first frame is light either
   * way, because a light brand beats no brand at all. What must not
   * happen is the theme calling those light colours dark.
   */
  const { api, warnings } = loadPackage({ dev: true });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.light.json", [], { appearance: "light" }),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  const theme = brand.tokens();
  assert.equal(theme.color["bg.page"], LIGHT_PAGE, "the snapshot is painted");
  assert.equal(
    theme.appearance,
    "light",
    "and it says which colours these are, not which ones were asked for",
  );
  assert.match(warnings.join(" "), /taken in light and this device is on dark/);
  brand.destroy();
});

test("a snapshot in the appearance asked for says nothing about it", () => {
  const { api, warnings } = loadPackage({ dev: true });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json", [], { appearance: "dark" }),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  assert.equal(brand.tokens().appearance, "dark");
  assert.equal(
    /taken in/.test(warnings.join(" ")),
    false,
    "there is nothing to warn about when they match",
  );
  brand.destroy();
});

test("the fetch for the device's appearance replaces the snapshot", async () => {
  const { api } = loadPackage({ dev: false, fetch: serving("tokens.dark.json") });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.light.json", [], { appearance: "light" }),
    appearance: "dark",
    live: { enabled: false },
  });
  assert.equal(brand.tokens().appearance, "light", "before the answer");
  await brand.init();
  await settle();
  assert.equal(brand.tokens().appearance, "dark");
  assert.equal(brand.tokens().color["bg.page"], DARK_PAGE);
  brand.destroy();
});

test("moving appearance relabels nothing until the new values land", async () => {
  /*
   * The request is in flight, or has failed, and until it answers the only
   * colours in hand are the old ones. Saying they are the new appearance
   * makes a wrong screen unreadable to the app looking at it.
   */
  let answer = null;
  const fetchImpl = routedFetch([
    ["tokens.json", () => answer || jsonResponse({ error: "no" }, {}, 500)],
    ["fonts.json", jsonResponse(fixture("fonts.json"), HEADERS)],
    ["context.json", jsonResponse({ capabilities: [] })],
  ]);
  const { api } = loadPackage({ dev: false, fetch: fetchImpl });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json", [], { appearance: "dark" }),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });

  brand.setAppearance("light");
  assert.equal(
    brand.tokens().appearance,
    "dark",
    "the values on screen are still the dark ones, so the label is too",
  );
  assert.equal(brand.tokens().color["bg.page"], DARK_PAGE);

  await settle(8);
  assert.equal(
    brand.tokens().appearance,
    "dark",
    "the fetch failed, so there is nothing new to describe",
  );
  assert.equal(brand.tokens().color["bg.page"], DARK_PAGE);

  answer = jsonResponse(fixture("tokens.light.json"), HEADERS);
  await brand.refresh();
  await settle();
  assert.equal(brand.tokens().appearance, "light");
  assert.equal(brand.tokens().color["bg.page"], LIGHT_PAGE);
  brand.destroy();
});

test("the appearance asked for is the one the request carries", async () => {
  const fetchImpl = serving("tokens.light.json");
  const { api } = loadPackage({ dev: false, fetch: fetchImpl });
  const brand = api.createBrand({
    publicId: "_designless",
    appearance: "dark",
    live: { enabled: false },
  });
  await brand.init();
  brand.setAppearance("light");
  await settle();
  const asked = fetchImpl.calls.filter((url) => url.includes("tokens.json"));
  assert.equal(
    asked.some((url) => url.includes("appearance=dark")),
    true,
  );
  assert.equal(
    asked.some((url) => url.includes("appearance=light")),
    true,
  );
  brand.destroy();
});

test("the address and the label never disagree about which appearance is live", async () => {
  /*
   * theme.appearance waits for the payload, on purpose: relabelling the
   * colours on screen is worse than being one beat behind. The address a
   * mark is drawn from was not given the same treatment, so it moved at
   * the moment of asking. Between the two, an app painted dark colours
   * and drew a light mark on them.
   *
   * Offline the window never closes, which is what makes it worth a test
   * rather than a note: every request fails, the theme stays dark
   * for good, and the mark stayed light for good.
   */
  const { api } = loadPackage({
    dev: false,
    fetch: async () => {
      throw new Error("offline");
    },
  });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json", [], { appearance: "dark" }),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });

  assert.equal(brand.tokens().appearance, "dark");
  assert.match(brand.asset("logo-symbol", { size: 128 }), /appearance=dark/);

  brand.setAppearance("light");
  await settle();

  assert.equal(
    brand.tokens().appearance,
    "dark",
    "nothing landed, so the colours are still the dark ones",
  );
  assert.match(
    brand.asset("logo-symbol", { size: 128 }),
    /appearance=dark/,
    "and the mark belongs to the colours beside it, not to what was asked for",
  );

  assert.match(
    brand.asset("logo-symbol", { size: 128, appearance: "light" }),
    /appearance=light/,
    "an appearance asked for explicitly is still a statement and is honoured",
  );
  brand.destroy();
});

test("the address moves once the payload for the new appearance lands", async () => {
  const { api } = loadPackage({ dev: false, fetch: serving("tokens.light.json") });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json", [], { appearance: "dark" }),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  assert.match(brand.asset("logo-symbol", { size: 128 }), /appearance=dark/);

  brand.setAppearance("light");
  await settle();

  assert.equal(brand.tokens().appearance, "light");
  assert.match(brand.asset("logo-symbol", { size: 128 }), /appearance=light/);
  brand.destroy();
});
