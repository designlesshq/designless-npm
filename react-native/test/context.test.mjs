/*
 * What a brand says it offers, and what this package will admit to.
 *
 * Two documents, and only one of them is ever used to build a request.
 * The discovery document describes; the published grammar addresses. So
 * anything advertised that this package has no address for is dropped
 * here rather than offered to an app and then failed at the moment it is
 * reached for.
 *
 * The discovery document is also the one thing on the wire that is purely
 * a description, so failing to read it must change no status: an app with
 * a theme in hand does not become a degraded app because a list it never
 * needed did not arrive.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadPackage, fixture, jsonResponse, routedFetch, settle, cleanupBrands } from "./harness.mjs";

/* A brand holds timers, so none of them outlives the test that made it. */
afterEach(cleanupBrands);

const HEADERS = {
  "x-brand-hash": "aaaa",
  "x-brand-semver": "1.0.1",
  "x-brand-version": "2",
};

function serving(context) {
  return routedFetch([
    ["tokens.json", jsonResponse(fixture("tokens.dark.json"), HEADERS)],
    ["fonts.json", jsonResponse(fixture("fonts.json"), HEADERS)],
    ["context.json", context],
  ]);
}

async function brandWith(context) {
  const { api } = loadPackage({ dev: false, fetch: serving(context) });
  const brand = api.createBrand({
    publicId: "_designless",
    appearance: "dark",
    live: { enabled: false },
  });
  await brand.init();
  await settle();
  return brand;
}

test("what a brand offers is read from its own discovery document", async () => {
  const brand = await brandWith(jsonResponse(fixture("context.json")));
  /* Compared as text: the bundle runs in its own realm, so an array it
   * built is never reference-equal to one built out here. */
  assert.equal(
    brand.capabilities().sort().join(","),
    "assets,events,fonts,tokens",
  );
  brand.destroy();
});

test("anything advertised with no address here is not offered to the app", async () => {
  /*
   * Built in the test rather than captured, because the point is a name
   * this package has never had an address for, whatever it turns out to
   * be. Offering it and then failing at the moment it is reached for is
   * the outcome being ruled out.
   */
  const advertised = fixture("context.json");
  advertised.capabilities = advertised.capabilities.concat([
    { name: "something-this-package-has-no-address-for", auth: "none" },
  ]);
  const brand = await brandWith(jsonResponse(advertised));
  assert.equal(
    brand.capabilities().indexOf("something-this-package-has-no-address-for"),
    -1,
  );
  assert.equal(brand.capabilities().length, 4);
  brand.destroy();
});

test("the list is a copy, so an app cannot edit what the brand said", async () => {
  const brand = await brandWith(jsonResponse(fixture("context.json")));
  brand.capabilities().push("invented");
  assert.equal(brand.capabilities().indexOf("invented"), -1);
  brand.destroy();
});

test("a discovery document that fails changes no status and no theme", async () => {
  const brand = await brandWith(jsonResponse({ error: "no" }, {}, 500));
  assert.equal(brand.status, "ready", "the theme arrived, so the brand is ready");
  assert.ok(brand.tokens(), "and it is still there");
  assert.equal(brand.capabilities().length, 0);
  brand.destroy();
});

test("addresses are built from the grammar, never routed from the document", async () => {
  /*
   * The document carries urls of its own. Following those would make
   * every request depend on a description rather than on the published
   * grammar, so a brand that describes itself oddly could send an app
   * somewhere it never agreed to go.
   */
  const misleading = fixture("context.json");
  misleading.fetch = {
    tokens: { url: "https://somewhere-else.example/tokens.json" },
    fonts: { url: "https://somewhere-else.example/fonts.json" },
    events: { url: "https://somewhere-else.example/events" },
  };
  const fetchImpl = serving(jsonResponse(misleading));
  const { api } = loadPackage({ dev: false, fetch: fetchImpl });
  const brand = api.createBrand({
    publicId: "_designless",
    appearance: "dark",
    live: { enabled: false },
  });
  await brand.init();
  await settle();
  assert.equal(
    fetchImpl.calls.some((url) => url.includes("somewhere-else.example")),
    false,
    "nothing is ever routed from the document",
  );
  assert.equal(
    brand.asset("logo-symbol").indexOf("https://cdn.designless.app/r/_designless/"),
    0,
  );
  brand.destroy();
});
