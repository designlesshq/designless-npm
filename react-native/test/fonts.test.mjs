/*
 * Where the two font facts come from, and what happens when one is late.
 *
 * There are two, and they arrive by different routes. Which faces the
 * brand publishes is fetched. Which faces are in the app binary is
 * settled when the app is built. Getting either of them wrong puts every
 * string on the screen in the platform font, and neither failure throws,
 * so each one is checked here rather than trusted.
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

const INTER = ["Inter-Regular", "Inter-SemiBold"];
const NEW_HEADERS = {
  "x-brand-hash": "aaaa",
  "x-brand-semver": "1.0.1",
  "x-brand-version": "2",
};
/*
 * The same three values under a prefix this package has never heard of,
 * beside unrelated headers a real answer carries. The serve surface has
 * renamed these before and will again, and the package is not supposed to
 * need a release to keep reading them.
 */
const RENAMED_HEADERS = {
  "x-served-by": "somewhere",
  /* A storage layer's own hash, which is not the published brand and must
   * not be mistaken for it. */
  "x-goog-hash": "crc32c=AAAAAA==",
  "x-something-else-hash": "aaaa",
  "x-something-else-semver": "1.0.1",
  "x-something-else-version": "2",
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("the version is read whatever prefix it is carried under", async () => {
  for (const headers of [NEW_HEADERS, RENAMED_HEADERS]) {
    const { api } = loadPackage({
      dev: false,
      fetch: routedFetch([
        ["tokens.json", jsonResponse(fixture("tokens.dark.json"), headers)],
        ["fonts.json", jsonResponse(fixture("fonts.json"), headers)],
        ["context.json", jsonResponse({ capabilities: [] })],
      ]),
    });
    const brand = api.createBrand({
      publicId: "_designless",
      appearance: "dark",
      live: { enabled: false },
    });
    await brand.init();
    /* Compared field by field: the bundle runs in its own realm, so an
     * object it built is never reference-equal to one built out here. */
    assert.equal(brand.version.hash, "aaaa");
    assert.equal(brand.version.semver, "1.0.1");
    assert.equal(brand.version.version, 2);
    brand.destroy();
  }
});

test("a font list that fails is named, asked for again, and lands", async () => {
  let attempts = 0;
  const fetchImpl = routedFetch([
    [
      "fonts.json",
      () => {
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ error: "Not found" }, {}, 404)
          : jsonResponse(fixture("fonts.json"), NEW_HEADERS);
      },
    ],
    ["tokens.json", jsonResponse(fixture("tokens.dark.json"), NEW_HEADERS)],
    ["context.json", jsonResponse({ capabilities: [] })],
  ]);
  const { api, warnings } = loadPackage({ dev: true, fetch: fetchImpl });
  const brand = api.createBrand({
    publicId: "_designless",
    appearance: "dark",
    fonts: { present: INTER },
    live: { enabled: false },
  });
  const reasons = [];
  brand.subscribe((update) => {
    reasons.push(update.reason);
  });
  await brand.init();
  await settle();

  assert.equal(
    brand.tokens().text({ family: "body", weight: "heading" }).fontFamily,
    undefined,
    "with no list there is nothing to resolve a role against",
  );
  assert.match(warnings.join(" "), /font list for this brand could not be read/);

  /* The first retry is two seconds out. */
  await wait(2400);
  assert.equal(attempts, 2, "it asked again on its own");
  assert.equal(
    brand.tokens().text({ family: "body", weight: "heading" }).fontFamily,
    "Inter-SemiBold",
  );
  assert.equal(
    reasons.indexOf("fonts") !== -1,
    true,
    "text changed after the first paint, so anything built from it is told",
  );
  brand.destroy();
});

test("what is in the binary comes from the build, never from storage", async () => {
  /*
   * A copy in storage outlives the build that saved it. A build that once
   * shipped a face and later dropped it would otherwise restore a claim
   * that is no longer true, and every string would silently miss.
   */
  const saved = JSON.stringify(snapshotFrom("tokens.dark.json", INTER));
  const store = { getItem: async () => saved, setItem: async () => {} };
  const { api } = loadPackage({ dev: false });
  const brand = api.createBrand({
    publicId: "_designless",
    storage: store,
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  await settle();
  assert.equal(brand.fonts().present().length, 0);
  assert.equal(
    brand.tokens().text({ family: "body", weight: "heading" }).fontFamily,
    undefined,
  );
  brand.destroy();
});

test("the fonts option says what the build contains, with no snapshot", async () => {
  const saved = JSON.stringify(snapshotFrom("tokens.dark.json", []));
  const store = { getItem: async () => saved, setItem: async () => {} };
  const { api } = loadPackage({ dev: false });
  const brand = api.createBrand({
    publicId: "_designless",
    storage: store,
    fonts: { present: INTER },
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  await settle();
  assert.equal(brand.fonts().present().sort().join(","), INTER.join(","));
  assert.equal(
    brand.tokens().text({ family: "body", weight: "heading" }).fontFamily,
    "Inter-SemiBold",
  );
  brand.destroy();
});

test("an empty fonts option beside a snapshot that records faces is said out loud", async () => {
  /*
   * The most expensive way to configure this package, and the easiest to
   * arrive at by copying an options block. An empty list is a statement,
   * so it is honoured, and it silently overrules a snapshot the font
   * command wrote names into: every role falls to the platform font and
   * the warning that would have said so is switched off by the same list.
   */
  const { api, warnings } = loadPackage({ dev: true });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json", INTER),
    fonts: { present: [] },
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  assert.equal(brand.fonts().present().length, 0, "the option is honoured");
  assert.match(warnings.join(" "), /fonts.present was set to an empty list/);
  assert.match(warnings.join(" "), /records 2 of them/);
  brand.destroy();
});

test("a build set up with no faces at all is not warned about", async () => {
  const { api, warnings } = loadPackage({ dev: true });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json", INTER),
    fonts: { roles: "none", present: [] },
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  assert.equal(
    /fonts.present was set to an empty list/.test(warnings.join(" ")),
    false,
    "it was said on purpose, so saying it back is noise",
  );
  brand.destroy();
});

test("with no fonts option the snapshot's list is what the build has", async () => {
  const { api } = loadPackage({ dev: false });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json", INTER),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  assert.equal(brand.fonts().present().sort().join(","), INTER.join(","));
  assert.equal(
    brand.tokens().text({ family: "body", weight: "heading" }).fontFamily,
    "Inter-SemiBold",
  );
  brand.destroy();
});

test("the command named when a face is missing is the one that adds it", async () => {
  const { api, warnings } = loadPackage({ dev: true });
  const brand = api.createBrand({
    publicId: "_designless",
    snapshot: snapshotFrom("tokens.dark.json", []),
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  brand.tokens().text({ family: "body", weight: "heading" });
  assert.match(warnings.join(" "), /npx designless-fonts --roles=body/);
  brand.destroy();
});

test("a saved copy carries the brand, and no claim about the binary", async () => {
  const written = [];
  const store = {
    getItem: async () => null,
    setItem: async (key, value) => {
      written.push(JSON.parse(value));
    },
  };
  const { api } = loadPackage({
    dev: false,
    fetch: routedFetch([
      ["tokens.json", jsonResponse(fixture("tokens.dark.json"), NEW_HEADERS)],
      ["fonts.json", jsonResponse(fixture("fonts.json"), NEW_HEADERS)],
      ["context.json", jsonResponse({ capabilities: [] })],
    ]),
  });
  const brand = api.createBrand({
    publicId: "_designless",
    storage: store,
    fonts: { present: INTER },
    appearance: "dark",
    live: { enabled: false },
  });
  await brand.init();
  await settle();
  assert.equal(written.length > 0, true);
  const copy = written[written.length - 1];
  assert.equal(copy.tokens.tokens.color.bg.page !== undefined, true);
  assert.equal(copy.fonts.families.length, 3);
  assert.equal(copy.fontsPresent.length, 0);
  brand.destroy();
});
