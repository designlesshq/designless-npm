/*
 * What a refusal is called, and how many times it is repeated.
 *
 * Two things ride on the code. An app branches on it, so a refusal it
 * could act on must not arrive under the name of a connection it can only
 * wait out. And the retry loop reads it: anything called "network" is
 * asked for again, which is the right answer for a dropped connection and
 * the wrong one for a surface that has just said there have been too many
 * requests. Counting the requests is the only way to see that, so these
 * count them.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadPackage, fixture, jsonResponse, routedFetch, cleanupBrands } from "./harness.mjs";

/* A brand holds timers, so none of them outlives the test that made it. */
afterEach(cleanupBrands);

const HEADERS = {
  "x-brand-hash": "aaaa",
  "x-brand-semver": "1.0.1",
  "x-brand-version": "2",
};

/** Answer every address with one status, and count what was asked. */
function refusing(status, body = { error: "no" }, headers = {}) {
  return routedFetch([["", jsonResponse(body, headers, status)]]);
}

async function askOnce(status, body, headers) {
  const fetchImpl = refusing(status, body, headers);
  const { api } = loadPackage({ dev: false, fetch: fetchImpl });
  const brand = api.createBrand({
    publicId: "_designless",
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  let error = null;
  try {
    await brand.refresh();
  } catch (cause) {
    error = cause;
  }
  brand.destroy();
  /* Three addresses go out together, so the count is per address. */
  const tokens = fetchImpl.calls.filter((url) => url.includes("tokens.json"));
  return { error, tokensRequests: tokens.length };
}

test("every refusal the surface has a word for gets its own code", async () => {
  const expected = [
    [400, "bad_request"],
    [401, "unauthorized"],
    [402, "plan"],
    [403, "forbidden"],
    [404, "not_found"],
    [429, "too_many_requests"],
    [501, "not_implemented"],
    [409, "refused"],
    [503, "server"],
  ];
  for (const [status, code] of expected) {
    const { error } = await askOnce(status);
    assert.ok(error, "a refusal reaches the caller that asked by hand");
    assert.equal(error.code, code, "status " + status);
    assert.equal(error.status, status);
  }
});

test("a refusal is asked for once, and a server fault is asked for again", async () => {
  for (const status of [400, 401, 402, 403, 404, 409, 429, 501]) {
    const { tokensRequests } = await askOnce(status);
    assert.equal(
      tokensRequests,
      1,
      "status " +
        status +
        " is an answer, and asking again makes 429 worse and the rest slower",
    );
  }
  for (const status of [500, 502, 503]) {
    const { tokensRequests } = await askOnce(status);
    assert.equal(tokensRequests, 3, "status " + status + " is worth another go");
  }
});

test("what the server said survives into the error", async () => {
  const { error } = await askOnce(402, { message: "This brand is not served." });
  assert.equal(error.detail, "This brand is not served.");
  assert.equal(error.message, "This brand is not served.");
});

test("how long the server asked to be left alone is carried, in ms", async () => {
  const { error } = await askOnce(429, { error: "slow down" }, {
    "retry-after": "120",
  });
  assert.equal(error.code, "too_many_requests");
  assert.equal(error.retryAfterMs, 120000);
});

test("no retry-after is null, not a guess", async () => {
  const { error } = await askOnce(429);
  assert.equal(error.retryAfterMs, null);
});

test("a refusal is said out loud in a development build", async () => {
  for (const [status, pattern] of [
    [401, /was refused/],
    [403, /was refused/],
    [429, /asked this app to slow down/],
    [404, /there is no brand at/],
  ]) {
    const { api, warnings } = loadPackage({
      dev: true,
      fetch: refusing(status),
    });
    const brand = api.createBrand({
      publicId: "_designless",
      appearance: "dark",
      live: { enabled: false },
    });
    await brand.init();
    assert.match(warnings.join(" "), pattern, "status " + status);
    brand.destroy();
  }
});

test("init never rejects, whatever the answer was", async () => {
  for (const status of [401, 429, 500]) {
    const { api } = loadPackage({ dev: false, fetch: refusing(status) });
    const brand = api.createBrand({
      publicId: "_designless",
      appearance: "dark",
      autoInit: false,
      live: { enabled: false },
    });
    const settled = await brand.init();
    assert.equal(settled, "failed", "status " + status);
    assert.equal(brand.tokens(), null);
    brand.destroy();
  }
});

test("every status the published grammar names has a code of its own", async () => {
  /*
   * The grammar in fixtures/protocol.v1.json is the surface's own
   * document, captured. Anything it names is a status this package will
   * be handed, so each one has to arrive as something an app can branch
   * on rather than under the name of a lost connection. A status added to
   * the grammar and not to the table below fails here, which is the point:
   * the alternative is finding out from a customer.
   */
  const grammar = fixture("protocol.v1.json");
  const named = Object.keys(grammar.status);
  assert.equal(named.length > 0, true, "the grammar names statuses");
  const seen = {};
  for (const status of named) {
    const { error, tokensRequests } = await askOnce(Number(status));
    assert.notEqual(error.code, "network", "status " + status);
    assert.equal(
      seen[error.code],
      undefined,
      "status " + status + " shares a code with status " + seen[error.code],
    );
    seen[error.code] = status;
    assert.equal(tokensRequests, 1, "status " + status + " is an answer");
  }
});

test("a body that is not json is a malformed answer, not a network one", async () => {
  const fetchImpl = routedFetch([
    ["tokens.json", jsonResponse("<!doctype html>", HEADERS)],
    ["fonts.json", jsonResponse(fixture("fonts.json"), HEADERS)],
    ["context.json", jsonResponse({ capabilities: [] })],
  ]);
  const { api } = loadPackage({ dev: false, fetch: fetchImpl });
  const brand = api.createBrand({
    publicId: "_designless",
    appearance: "dark",
    autoInit: false,
    live: { enabled: false },
  });
  let error = null;
  try {
    await brand.refresh();
  } catch (cause) {
    error = cause;
  }
  assert.equal(error.code, "malformed");
  assert.equal(
    fetchImpl.calls.filter((url) => url.includes("tokens.json")).length,
    1,
    "an answer that arrived and did not read is not asked for again",
  );
  brand.destroy();
});
