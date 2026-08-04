/*
 * The live channel: what it opens, what it does with what arrives, and
 * what happens on a host that cannot hold one.
 *
 * None of this is reachable from the package's own surface. It runs
 * itself, off a connection nothing awaits, so the only way to see it is
 * to give the bundle an XMLHttpRequest that replays a recorded stream and
 * then count what it asked for afterwards. The frames replayed here are
 * the ones in fixtures/events.frames.txt, captured from the real channel:
 * a retry field, one change, and the keep-alive comments that prove the
 * connection is alive without meaning anything.
 *
 * The cases that matter are the quiet ones. A change that does not cause
 * a refetch is an app that keeps last week's colours. A keep-alive read as
 * a change is a refetch every few seconds for the life of the session.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadPackage,
  fixture,
  fixtureText,
  jsonResponse,
  replayingXhr,
  routedFetch,
  settle,
  snapshotFrom,
  cleanupBrands,
} from "./harness.mjs";

/* A brand holds timers, so none of them outlives the test that made it. */
afterEach(cleanupBrands);

const FRAMES = fixtureText("events.frames.txt");
/** The hash inside the captured frame. */
const FRAME_HASH = "bb6633ba2c1566eda87141ee9b738c963d4fc5437ec12f9a93cc50ffd75c6619";

function headers(hash) {
  return {
    "x-brand-hash": hash,
    "x-brand-semver": "1.0.1",
    "x-brand-version": "2",
  };
}

function serving(hash) {
  return routedFetch([
    ["tokens.json", jsonResponse(fixture("tokens.dark.json"), headers(hash))],
    ["fonts.json", jsonResponse(fixture("fonts.json"), headers(hash))],
    ["context.json", jsonResponse({ capabilities: [] })],
  ]);
}

/** Cut the recording into pieces, the way a connection delivers it. */
function inChunks(text, size) {
  const out = [];
  for (let at = 0; at < text.length; at += size) out.push(text.slice(at, at + size));
  return out;
}

function tokenRequests(fetchImpl) {
  return fetchImpl.calls.filter((url) => url.includes("tokens.json")).length;
}

test("the channel is opened at the brand's own events address", async () => {
  const Replay = replayingXhr([]);
  const fetchImpl = serving("aaaa");
  const { api } = loadPackage({
    dev: false,
    fetch: fetchImpl,
    XMLHttpRequest: Replay,
  });
  const brand = api.createBrand({ publicId: "_designless", appearance: "dark" });
  await brand.init();
  await settle();
  assert.equal(Replay.opened.length, 1, "one connection, not one per fetch");
  assert.match(Replay.opened[0], /\/r\/_designless\/events$/);
  brand.destroy();
});

test("a frame naming a different brand is fetched, in pieces or whole", async () => {
  for (const chunks of [[FRAMES], inChunks(FRAMES, 7)]) {
    const fetchImpl = serving("aaaa");
    const { api } = loadPackage({
      dev: false,
      fetch: fetchImpl,
      XMLHttpRequest: replayingXhr(chunks),
    });
    const brand = api.createBrand({
      publicId: "_designless",
      appearance: "dark",
      live: { activate: "immediate" },
    });
    await brand.init();
    const before = tokenRequests(fetchImpl);
    await settle(12);
    assert.equal(
      tokenRequests(fetchImpl) > before,
      true,
      "a change on the channel is what makes the refetch happen",
    );
    brand.destroy();
  }
});

test("a frame naming the brand already in hand is not fetched again", async () => {
  /*
   * The channel repeats itself, and every repeat that turns into a fetch
   * is a request that changes nothing. The version in the frame is
   * compared against the one in hand before anything is asked for.
   */
  const fetchImpl = serving(FRAME_HASH);
  const { api } = loadPackage({
    dev: false,
    fetch: fetchImpl,
    XMLHttpRequest: replayingXhr([FRAMES]),
  });
  const brand = api.createBrand({
    publicId: "_designless",
    appearance: "dark",
    live: { activate: "immediate" },
  });
  await brand.init();
  const before = tokenRequests(fetchImpl);
  await settle(12);
  assert.equal(tokenRequests(fetchImpl), before);
  brand.destroy();
});

test("keep-alive comments carry no change, so nothing is fetched", async () => {
  const fetchImpl = serving("aaaa");
  const { api } = loadPackage({
    dev: false,
    fetch: fetchImpl,
    XMLHttpRequest: replayingXhr([": hb\n\n", ": hb\n\n", ": hb\n\n"]),
  });
  const brand = api.createBrand({
    publicId: "_designless",
    appearance: "dark",
    live: { activate: "immediate" },
  });
  await brand.init();
  const before = tokenRequests(fetchImpl);
  await settle(12);
  assert.equal(tokenRequests(fetchImpl), before);
  brand.destroy();
});

test("a change waits for the next foreground by default", async () => {
  /*
   * The default, and the reason for it: a screen that restyles under
   * someone mid-tap is worse than one that restyles between two things
   * they were doing. The listener is told the change arrived and has not
   * been applied, which is the part an app can act on.
   */
  const fetchImpl = serving("aaaa");
  const { api } = loadPackage({
    dev: false,
    fetch: fetchImpl,
    XMLHttpRequest: replayingXhr([FRAMES]),
  });
  const brand = api.createBrand({ publicId: "_designless", appearance: "dark" });
  const held = [];
  brand.subscribe((update) => {
    if (update.reason === "stream") held.push(update.applied);
  });
  await brand.init();
  await settle(12);
  assert.equal(held.length > 0, true, "the change did arrive");
  assert.equal(
    held.indexOf(true),
    -1,
    "and none of it was applied while the app was in front",
  );
  brand.destroy();
});

test("a host with no XMLHttpRequest asks on a schedule instead", async () => {
  /*
   * Every React Native has one. A test host, a server render and the odd
   * embedded runtime do not, and falling silent there would mean a brand
   * change never arriving with nothing said about it.
   */
  const fetchImpl = serving("aaaa");
  const { api } = loadPackage({
    dev: false,
    fetch: fetchImpl,
    XMLHttpRequest: undefined,
  });
  const brand = api.createBrand({
    publicId: "_designless",
    appearance: "dark",
    live: { pollMs: 20 },
  });
  await brand.init();
  const before = tokenRequests(fetchImpl);
  await settle(20);
  assert.equal(
    tokenRequests(fetchImpl) > before,
    true,
    "the schedule is the fallback, and it has to actually run",
  );
  brand.destroy();
});

test("live: false opens nothing and asks for nothing on its own", async () => {
  const Replay = replayingXhr([FRAMES]);
  const fetchImpl = serving("aaaa");
  const { api } = loadPackage({
    dev: false,
    fetch: fetchImpl,
    XMLHttpRequest: Replay,
  });
  const brand = api.createBrand({
    publicId: "_designless",
    appearance: "dark",
    live: { enabled: false, pollMs: 20 },
  });
  await brand.init();
  const before = tokenRequests(fetchImpl);
  await settle(20);
  assert.equal(Replay.opened.length, 0);
  assert.equal(tokenRequests(fetchImpl), before);
  brand.destroy();
});

test("destroy closes the connection and stops the schedule", async () => {
  const fetchImpl = serving("aaaa");
  const { api } = loadPackage({
    dev: false,
    fetch: fetchImpl,
    XMLHttpRequest: undefined,
  });
  const brand = api.createBrand({
    publicId: "_designless",
    appearance: "dark",
    snapshot: snapshotFrom("tokens.dark.json"),
    live: { pollMs: 20 },
  });
  await brand.init();
  await settle(6);
  brand.destroy();
  const after = tokenRequests(fetchImpl);
  await settle(20);
  assert.equal(tokenRequests(fetchImpl), after, "nothing runs after destroy");
});
