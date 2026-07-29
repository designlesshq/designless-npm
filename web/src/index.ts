/*
 * Typed loader for designless.js.
 *
 * Call loadDesignless once, await the handle, use the brand. The loader
 * injects the script tag exactly once per page, reuses a tag that is
 * already present with the same src, and resolves when window.designless
 * is ready. On a server it resolves to a placeholder that only errors
 * when one of its methods is called, so importing this package in server
 * rendered code never crashes a build.
 *
 * The api shape below mirrors the shipped runtime in
 * packages/designless-js/src/index.ts. Keep the two in step.
 */

/** Default script location. Always serves the latest version. */
export const DEFAULT_SCRIPT_URL = "https://cdn.designless.app/designless.js";

/** How often the loader checks for the api while the script loads. */
const READY_POLL_MS = 50;

/** Version identity of the loaded brand. */
export interface BrandVersion {
  hash: string | null;
  semver: string | null;
}

/** Options for DesignlessApi.load, the brand switch verb. */
export interface BrandLoadOptions {
  publicId: string;
  /** Reserved for a future publishable key. Stored, never sent in this version. */
  key?: string;
  /** Origin override. Defaults to the script origin, then to the default host. */
  base?: string;
}

/**
 * Options for the asset URL builder. The runtime accepts plain strings here;
 * these unions deliberately narrow the type to the values the asset endpoint
 * serves, so typos fail at compile time instead of returning a broken URL.
 */
export interface AssetOptions {
  format?: "svg" | "png";
  appearance?: "light" | "dark";
}

/** The api that designless.js exposes on window.designless. */
export interface DesignlessApi {
  /**
   * Promise of the resolved brand token tree, cached in memory. The runtime
   * types this Promise<unknown> (a raw response.json()); the served body is
   * always a JSON object, so this deliberately narrows to a record.
   */
  tokens(): Promise<Record<string, unknown>>;
  /** URL of a brand asset by role, for example "logo-symbol". */
  asset(role: string, options?: AssetOptions): string;
  /** Live brand updates. Pair with unsubscribe to stop them. */
  subscribe(callback: (update: BrandVersion) => void): void;
  /** Stops live updates and clears every subscriber. */
  unsubscribe(): void;
  /** Switches to another brand. loadDesignless handles the first load. */
  load(options: BrandLoadOptions): void;
  /** Version of the loaded brand, or null before the first response. */
  readonly version: BrandVersion | null;
}

/** Options accepted by loadDesignless. */
export interface LoadDesignlessOptions {
  /** The public id of the brand to load. */
  publicId: string;
  /** Reserved for a future publishable key. Passed through as data-key. */
  key?: string;
  /** Script location override. Defaults to DEFAULT_SCRIPT_URL. */
  scriptUrl?: string;
}

declare global {
  interface Window {
    designless?: DesignlessApi;
  }
}

const SERVER_MESSAGE =
  "designless.js runs in the browser. This call happened during server " +
  "rendering. Move the call into browser code, such as a client component " +
  "or an effect.";

let browserHandle: Promise<DesignlessApi> | null = null;
let serverHandle: DesignlessApi | null = null;

/*
 * Server placeholder. Importing the package and calling loadDesignless are
 * both safe on a server; only calling a method on the handle errors, and
 * it errors with a message that says where the call belongs.
 */
function createServerHandle(): DesignlessApi {
  const fail = (): never => {
    throw new Error(SERVER_MESSAGE);
  };
  return {
    tokens: () => Promise.reject(new Error(SERVER_MESSAGE)),
    asset: fail,
    subscribe: fail,
    unsubscribe: fail,
    load: fail,
    version: null,
  };
}

/* Find a script tag that already points at the loader src. */
function findScript(src: string): HTMLScriptElement | null {
  const scripts = document.getElementsByTagName("script");
  for (let i = 0; i < scripts.length; i += 1) {
    const candidate = scripts[i];
    if (candidate.src === src || candidate.getAttribute("src") === src) {
      return candidate;
    }
  }
  return null;
}

/* Inject the script tag. data-brand makes the script load the brand itself. */
function injectScript(
  src: string,
  publicId: string,
  key?: string,
): HTMLScriptElement {
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  script.setAttribute("data-brand", publicId);
  if (key) script.setAttribute("data-key", key);
  const parent = document.head || document.body || document.documentElement;
  parent.appendChild(script);
  return script;
}

/*
 * Resolve when window.designless is ready. The poll covers a script tag
 * that finished loading before this loader attached its listeners; the
 * load listener covers the common path without waiting a poll cycle.
 */
function waitForApi(
  src: string,
  publicId: string,
  key?: string,
): Promise<DesignlessApi> {
  return new Promise<DesignlessApi>((resolve, reject) => {
    const ready = window.designless;
    if (ready) {
      resolve(ready);
      return;
    }
    const existing = findScript(src);
    const script = existing || injectScript(src, publicId, key);
    const injected = !existing;
    let settled = false;
    const timer = setInterval(() => {
      const api = window.designless;
      if (api) settle(() => resolve(api));
    }, READY_POLL_MS);
    function settle(finish: () => void): void {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      finish();
    }
    /* A failed injected tag is removed so a retry can inject a fresh one. */
    function dropInjected(): void {
      if (injected && script.parentNode) script.parentNode.removeChild(script);
    }
    script.addEventListener("load", () => {
      const api = window.designless;
      if (api) {
        settle(() => resolve(api));
        return;
      }
      dropInjected();
      settle(() =>
        reject(
          new Error(
            "The script at " +
              src +
              " loaded, but it is not designless.js. Check the scriptUrl option.",
          ),
        ),
      );
    });
    script.addEventListener("error", () => {
      dropInjected();
      settle(() =>
        reject(
          new Error(
            "Could not load " +
              src +
              ". Check the network connection and the script URL, then call loadDesignless again.",
          ),
        ),
      );
    });
  });
}

/**
 * Load designless.js and resolve with the brand api.
 *
 * The script tag is injected once per page no matter how many times this
 * is called; every call shares one promise. A script tag that is already
 * on the page with the same src is reused. A failed load rejects with a
 * clear Error and a later call starts over.
 */
export function loadDesignless(
  options: LoadDesignlessOptions,
): Promise<DesignlessApi> {
  if (typeof window === "undefined") {
    if (!serverHandle) serverHandle = createServerHandle();
    return Promise.resolve(serverHandle);
  }
  const publicId = options && options.publicId ? options.publicId.trim() : "";
  if (!publicId) {
    return Promise.reject(
      new Error(
        'Pass the brand public id: loadDesignless({ publicId: "r_XXX" }).',
      ),
    );
  }
  if (browserHandle) return browserHandle;
  const src = options.scriptUrl || DEFAULT_SCRIPT_URL;
  const pending = waitForApi(src, publicId, options.key);
  browserHandle = pending;
  /* A failed load clears the singleton so the next call can retry. */
  pending.catch(() => {
    if (browserHandle === pending) browserHandle = null;
  });
  return pending;
}
