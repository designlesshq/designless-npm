/*
 * DOM harness for the built CJS bundle (dist/index.cjs). The bundle runs
 * inside a node:vm sandbox with a minimal window and document, so script
 * injection, dedupe, the ready poll, the failure path, and the server
 * placeholder are all tested without adding any DOM dependency.
 * Build first: npm run build (the package test script does this).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const bundlePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "index.cjs",
);
const BUNDLE = readFileSync(bundlePath, "utf8");

const DEFAULT_SRC = "https://cdn.designless.app/designless.js";

/* Minimal element stub for head and script tags. */
class StubElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.src = "";
    this.async = false;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const at = this.children.indexOf(child);
    if (at !== -1) this.children.splice(at, 1);
    child.parentNode = null;
    return child;
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  emit(type) {
    (this.listeners[type] || []).forEach((fn) => fn({ type }));
  }
}

/*
 * Boot the built bundle in a fresh sandbox. server: true boots without
 * window and document, the way a server bundle sees the module.
 */
function boot({ server = false, existingScripts = [] } = {}) {
  const timers = [];
  const sandbox = {
    module: { exports: {} },
    setInterval: (fn, ms) => {
      const id = setInterval(fn, ms);
      timers.push(id);
      return id;
    },
    clearInterval: (id) => clearInterval(id),
    console,
  };
  sandbox.exports = sandbox.module.exports;
  let head = null;
  if (!server) {
    head = new StubElement("head");
    for (const script of existingScripts) head.appendChild(script);
    sandbox.window = {};
    sandbox.document = {
      head,
      createElement: (tag) => new StubElement(tag),
      getElementsByTagName: (tag) =>
        String(tag).toLowerCase() === "script"
          ? head.children.filter((child) => child.tagName === "SCRIPT")
          : [],
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(BUNDLE, sandbox, { filename: "index.cjs" });
  return {
    api: sandbox.module.exports,
    sandbox,
    head,
    cleanup: () => timers.forEach((id) => clearInterval(id)),
  };
}

function headScripts(head) {
  return head.children.filter((child) => child.tagName === "SCRIPT");
}

test("injects the script once with brand, key, async, and the default src", async (t) => {
  const { api, sandbox, head, cleanup } = boot();
  t.after(cleanup);
  const promise = api.loadDesignless({ publicId: "r_one", key: "pk_live" });
  const scripts = headScripts(head);
  assert.equal(scripts.length, 1, "one script tag lands in head");
  const script = scripts[0];
  assert.equal(script.src, DEFAULT_SRC);
  assert.equal(script.async, true);
  assert.equal(script.getAttribute("data-brand"), "r_one");
  assert.equal(script.getAttribute("data-key"), "pk_live");

  const fake = { marker: "designless" };
  sandbox.window.designless = fake;
  script.emit("load");
  assert.equal(await promise, fake, "resolves with the window api");
});

test("second call shares the first promise and injects nothing new", async (t) => {
  const { api, sandbox, head, cleanup } = boot();
  t.after(cleanup);
  const first = api.loadDesignless({ publicId: "r_dupe" });
  const second = api.loadDesignless({ publicId: "r_dupe" });
  assert.equal(first, second, "module singleton hands back the same promise");
  assert.equal(headScripts(head).length, 1, "still a single script tag");

  sandbox.window.designless = { marker: "one" };
  headScripts(head)[0].emit("load");
  assert.equal(await first, await second);
});

test("adopts an existing script tag with the same src", async (t) => {
  const existing = new StubElement("script");
  existing.setAttribute("src", DEFAULT_SRC);
  existing.src = DEFAULT_SRC;
  const { api, sandbox, head, cleanup } = boot({
    existingScripts: [existing],
  });
  t.after(cleanup);
  const promise = api.loadDesignless({ publicId: "r_embed" });
  assert.equal(headScripts(head).length, 1, "no second tag next to the embed");
  assert.equal(headScripts(head)[0], existing, "the embed tag is reused");

  sandbox.window.designless = { marker: "embed" };
  existing.emit("load");
  assert.equal((await promise).marker, "embed");
});

test("the poll resolves when the api appears without a load event", async (t) => {
  const { api, sandbox, cleanup } = boot();
  t.after(cleanup);
  const promise = api.loadDesignless({ publicId: "r_poll" });
  sandbox.window.designless = { marker: "poll" };
  const winner = await Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("poll never resolved")), 2000),
    ),
  ]);
  assert.equal(winner.marker, "poll");
});

test("resolves at once when the api is already on the page", async (t) => {
  const { api, sandbox, head, cleanup } = boot();
  t.after(cleanup);
  sandbox.window.designless = { marker: "present" };
  const resolved = await api.loadDesignless({ publicId: "r_ready" });
  assert.equal(resolved.marker, "present");
  assert.equal(headScripts(head).length, 0, "no script tag is injected");
});

test("a failed load rejects clearly, removes the tag, and allows a retry", async (t) => {
  const { api, sandbox, head, cleanup } = boot();
  t.after(cleanup);
  const promise = api.loadDesignless({ publicId: "r_fail" });
  const script = headScripts(head)[0];
  script.emit("error");
  await assert.rejects(promise, /Could not load https:\/\/cdn\.designless\.app/);
  assert.equal(headScripts(head).length, 0, "failed tag left the document");

  const retry = api.loadDesignless({ publicId: "r_fail" });
  assert.notEqual(retry, promise, "the retry is a fresh attempt");
  const fresh = headScripts(head);
  assert.equal(fresh.length, 1, "the retry injects a fresh tag");
  sandbox.window.designless = { marker: "retry" };
  fresh[0].emit("load");
  assert.equal((await retry).marker, "retry");
});

test("a script that loads without providing the api rejects", async (t) => {
  const { api, head, cleanup } = boot();
  t.after(cleanup);
  const promise = api.loadDesignless({
    publicId: "r_wrong",
    scriptUrl: "https://example.com/not-designless.js",
  });
  const script = headScripts(head)[0];
  assert.equal(script.src, "https://example.com/not-designless.js");
  script.emit("load");
  await assert.rejects(promise, /not designless\.js/);
});

test("scriptUrl points the tag at the pinned channel", async (t) => {
  const { api, sandbox, head, cleanup } = boot();
  t.after(cleanup);
  const pinned = "https://cdn.designless.app/designless/v1.js";
  const promise = api.loadDesignless({ publicId: "r_pin", scriptUrl: pinned });
  const script = headScripts(head)[0];
  assert.equal(script.src, pinned);
  sandbox.window.designless = { marker: "pin" };
  script.emit("load");
  assert.equal((await promise).marker, "pin");
});

test("an empty publicId rejects without touching the singleton", async (t) => {
  const { api, sandbox, head, cleanup } = boot();
  t.after(cleanup);
  await assert.rejects(api.loadDesignless({ publicId: "" }), /publicId/);
  assert.equal(headScripts(head).length, 0, "nothing injected");

  const promise = api.loadDesignless({ publicId: "r_after" });
  assert.equal(headScripts(head).length, 1, "a valid call still works");
  sandbox.window.designless = { marker: "after" };
  headScripts(head)[0].emit("load");
  assert.equal((await promise).marker, "after");
});

test("on a server the module boots and loadDesignless resolves", async (t) => {
  const { api, cleanup } = boot({ server: true });
  t.after(cleanup);
  const handle = await api.loadDesignless({ publicId: "r_ssr" });
  assert.equal(handle.version, null, "version reads as null, no throw");
  const again = await api.loadDesignless({ publicId: "r_ssr" });
  assert.equal(handle, again, "one placeholder per module");
});

test("server placeholder errors only when a verb is called", async (t) => {
  const { api, cleanup } = boot({ server: true });
  t.after(cleanup);
  const handle = await api.loadDesignless({ publicId: "r_ssr" });
  await assert.rejects(handle.tokens(), /browser/);
  assert.throws(() => handle.asset("logo-symbol"), /browser/);
  assert.throws(() => handle.subscribe(() => {}), /browser/);
  assert.throws(() => handle.unsubscribe(), /browser/);
  assert.throws(() => handle.load({ publicId: "r_ssr" }), /browser/);
});
