/*
 * The brand: five verbs, and the machinery that keeps them answerable.
 *
 * The five verbs keep the names they have elsewhere, so nothing here is
 * renamed to suit React Native. What changes is everything underneath:
 * where the last copy is kept, how the live channel is read, and which of
 * the published values this platform can actually draw.
 *
 * Nothing in this file imports React. A brand can be created once at the
 * top of a module and used by code that never renders anything.
 */

import { AppState, Appearance as SystemAppearance, Image } from "react-native";

import type { Appearance, AssetFormat, AssetSize } from "../protocol/params";
import { DEFAULT_BASE_URL } from "../protocol/params";
import {
  assetUrl,
  contextUrl,
  eventsUrl,
  fontsUrl,
  tokensUrl,
} from "../protocol/address";
import type { AddressOptions } from "../protocol/address";
import { getJson } from "../protocol/request";
import { BrandError } from "../protocol/errors";
import type { BrandVersion } from "../protocol/version";
import {
  UNKNOWN_VERSION,
  sameVersion,
  versionFromFrame,
} from "../protocol/version";
import type {
  ContextPayload,
  FontsPayload,
  TokensPayload,
} from "../protocol/payloads";
import { isGroup } from "../protocol/payloads";
import { openEventStream } from "../protocol/stream";
import type { StreamHandle } from "../protocol/stream";
import { buildTheme } from "../convert/theme";
import type { BrandTheme } from "../convert/theme";
import { resolveFamily } from "../convert/family";
import type { FaceLookup, FamilyResolution } from "../convert/family";
import { createManifest } from "../fonts/manifest";
import type { FontManifest } from "../fonts/manifest";
import { createRegistry } from "../fonts/registry";
import { createMissingFontReporter } from "../fonts/assert";
import { sizeForPoints } from "../assets/ladder";
import { afterFailure, afterRestore, afterSuccess } from "./status";
import type { BrandStatus } from "./status";
import type { StorageAdapter } from "./storage";
import { readQuietly, storageKey, writeQuietly } from "./storage";
import type { BrandSnapshot } from "./snapshot";
import { SNAPSHOT_SCHEMA, isSnapshot, warnIfStale } from "./snapshot";
import { cancel, devWarn, later } from "../platform/globals";

/** Which faces this build was set up to contain. */
export interface FontPolicy {
  /**
   * The text roles this app expects to find in its binary.
   *   "body"  the body role only. The default.
   *   "all"   every role the brand publishes.
   *   "none"  no brand faces, so every role uses the platform font.
   * This is a declaration, not an action. React Native cannot add a font
   * at runtime, so this says what to expect, and tells the font command
   * what to write.
   */
  roles?: "body" | "all" | "none";
  /**
   * Faces present in this binary, by PostScript name. The font command
   * writes this into the snapshot, so it is rarely set by hand.
   *
   * Setting it takes over from the snapshot completely, including when it
   * is set to an empty list, which says this build has no brand faces in
   * it. A development build says so when that contradicts the snapshot,
   * because the two together are the one combination that turns every
   * face off and looks like it was configured on purpose.
   */
  present?: string[];
}

export interface LivePolicy {
  /** Default true. */
  enabled?: boolean;
  /**
   * "next-foreground"  fetch on change, apply when the app next comes
   *                    forward. The default, because a screen that
   *                    restyles under someone mid-tap is worse than one
   *                    that restyles between two things they were doing.
   * "immediate"        apply as soon as it lands.
   */
  activate?: "next-foreground" | "immediate";
  /** How often to ask when the channel will not hold. Default 300000. */
  pollMs?: number;
}

export interface BrandOptions {
  /** The public id of the brand. */
  publicId: string;
  /**
   * Publishable key. Held, not sent: nothing on the brand addresses needs
   * one today, and keeping the option means adding one later is not a
   * breaking change.
   */
  publishableKey?: string;
  /** Origin override. */
  baseUrl?: string;
  /**
   * A copy taken at build time, imported like any other json file. With
   * one, the first frame on a cold install is branded and works offline.
   */
  snapshot?: BrandSnapshot;
  /** Any key-value store the app already has. Survives restarts. */
  storage?: StorageAdapter;
  /**
   * Light or dark. Leave it out and the brand follows the device, and
   * keeps following it. Set it and the brand stays where you put it.
   */
  appearance?: Appearance;
  /** The root size a rem is measured against. Default 16. */
  remBase?: number;
  fonts?: FontPolicy;
  live?: LivePolicy;
  /** Give up on one request after this long. Default 10000. */
  fetchTimeoutMs?: number;
  /** Call init() yourself when false. Default true. */
  autoInit?: boolean;
}

export type UpdateReason =
  | "init"
  | "restore"
  | "stream"
  | "poll"
  | "foreground"
  | "refresh"
  | "appearance"
  /** The font list arrived after the first paint, so text changed. */
  | "fonts";

export interface BrandUpdate {
  version: BrandVersion;
  status: BrandStatus;
  reason: UpdateReason;
  /** False when a change arrived but is waiting for the next foreground. */
  applied: boolean;
}

interface AssetBase {
  /** Default "png". React Native cannot draw a vector without help. */
  format?: AssetFormat;
  /** Default: whichever appearance this brand is on. Never left off. */
  appearance?: Appearance;
}

/**
 * Ask for a size from the list, or ask in points and let the size be
 * worked out. Asking both ways at once does not compile.
 */
export type AssetParams =
  | (AssetBase & { size?: AssetSize; pt?: undefined })
  | (AssetBase & { pt: number; size?: undefined });

export interface Brand {
  /** 1. Settle the first copy. Idempotent, and never rejects offline. */
  init(): Promise<BrandStatus>;
  /** 2. The theme. Already there when a snapshot was supplied. */
  tokens(): BrandTheme | null;
  /** 3. Where a brand mark lives. */
  asset(role: string, params?: AssetParams): string;
  /**
   * 4. The published faces, with this build folded in.
   *
   * Always a manifest, never null. Before any font list has been read it
   * is an empty one -- families is [], faceFor answers undefined -- which
   * is the same answer a brand that publishes no faces gives, and is what
   * every caller would have had to write the null branch to do anyway.
   */
  fonts(): FontManifest;
  /** 5. Changes. Returns the function that stops them. */
  subscribe(listener: (update: BrandUpdate) => void): () => void;

  readonly status: BrandStatus;
  readonly version: BrandVersion | null;

  /** What this brand offers that this package knows how to reach. */
  capabilities(): string[];
  /**
   * Ask now, and apply what comes back. Unlike init, this one rejects
   * with a BrandError when it fails: the app asked for it, so the app is
   * told why it did not happen.
   */
  refresh(): Promise<void>;
  /** Move to the other appearance and fetch it. */
  setAppearance(next: Appearance): void;
  /** Warm the image cache. Resolves false instead of throwing. */
  prefetchAsset(role: string, params?: AssetParams): Promise<boolean>;
  /** Close the channel, cancel the timers, drop the listeners. */
  destroy(): void;
}

/**
 * The capabilities this package knows an address for.
 *
 * A brand describes what it offers, and the grammar says where things
 * live. Those are two different documents and only the second one is ever
 * used to build a request. Anything advertised without an address this
 * package can reach is dropped here rather than offered and then failed.
 */
const ADDRESSABLE = ["tokens", "assets", "fonts", "events"];

const HEARTBEAT_GRACE_MS = 75000;
const RECONNECT_CEILING_MS = 300000;
const FAILURES_BEFORE_POLLING = 5;
const DEFAULT_POLL_MS = 300000;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRY_MS = 3000;

/**
 * React Native changed how a listener is detached partway through the
 * range this package supports. Newer versions hand back a subscription,
 * older ones hand back nothing.
 */
function detacher(result: unknown): () => void {
  if (result && typeof (result as { remove?: unknown }).remove === "function") {
    return (): void => {
      (result as { remove: () => void }).remove();
    };
  }
  if (typeof result === "function") return result as () => void;
  return (): void => {
    /* Nothing to detach on this version. */
  };
}

function systemAppearance(): Appearance {
  try {
    return SystemAppearance.getColorScheme() === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function createBrand(options: BrandOptions): Brand {
  const publicId = options.publicId ? String(options.publicId).trim() : "";
  if (!publicId) {
    throw new Error(
      'Pass the brand public id: createBrand({ publicId: "r_XXX" }).',
    );
  }

  const address: AddressOptions = {
    baseUrl: options.baseUrl || DEFAULT_BASE_URL,
    publicId,
  };
  const timeoutMs =
    options.fetchTimeoutMs === undefined
      ? DEFAULT_TIMEOUT_MS
      : options.fetchTimeoutMs;
  const followSystem = options.appearance === undefined;
  const fontPolicy = options.fonts || {};
  const wantedRoles = fontPolicy.roles || "body";
  const livePolicy = options.live || {};
  const liveEnabled = livePolicy.enabled !== false;
  const activate = livePolicy.activate || "next-foreground";
  const pollMs =
    livePolicy.pollMs === undefined ? DEFAULT_POLL_MS : livePolicy.pollMs;

  let appearance: Appearance = options.appearance || systemAppearance();
  /*
   * Which appearance the values now in the theme actually are.
   *
   * Not always the one above. A request in flight has already moved that
   * one, and a copy taken at build time was taken in whichever appearance
   * the command was run in. theme.appearance answers from here, so it
   * always describes the colours an app is about to paint with rather
   * than the ones it has asked for and not yet been given.
   */
  let painted: Appearance = appearance;
  let status: BrandStatus = "cold";
  let version: BrandVersion | null = null;
  let tokensPayload: TokensPayload | null = null;
  let fontsPayload: FontsPayload | null = null;
  let fontsLoaded = false;
  let fontsAttempts = 0;
  let fontsRetryTimer: unknown = null;
  let theme: BrandTheme | null = null;
  let capabilityNames: string[] = [];
  let destroyed = false;
  let pending: { payload: TokensPayload; version: BrandVersion } | null = null;

  const listeners: ((update: BrandUpdate) => void)[] = [];
  const reporter = createMissingFontReporter(wantedRoles, {
    /* Read through the mutable binding, not captured: rebuildManifest
     * replaces it whenever a new font list arrives. */
    publishedRoles: (): string[] => lookup.publishedRoles(),
  });

  /*
   * Which faces are in this binary, from whichever of the two build-time
   * sources said. The option is checked for having been set at all rather
   * than for being non-empty: an empty list is a statement that this build
   * carries no brand faces, and reading it as "nothing was said" would
   * quietly overrule a developer who meant it.
   *
   * The combination that costs the most is an empty option beside a
   * snapshot the font command wrote names into. That turns every face off,
   * looks deliberate, and produces text in the platform font with nothing
   * said about it, so it is the one case that is said out loud.
   */
  const snapshotPresent =
    options.snapshot && Array.isArray(options.snapshot.fontsPresent)
      ? options.snapshot.fontsPresent
      : undefined;
  const declaredPresent = Array.isArray(fontPolicy.present)
    ? fontPolicy.present
    : undefined;
  if (
    declaredPresent &&
    declaredPresent.length === 0 &&
    snapshotPresent &&
    snapshotPresent.length > 0 &&
    wantedRoles !== "none"
  ) {
    devWarn(
      "fonts.present was set to an empty list, so no brand face will be " +
        "used, but the snapshot in this build records " +
        String(snapshotPresent.length) +
        " of them. Remove fonts.present to use what the snapshot records, " +
        'or set fonts: { roles: "none" } if this build really has no ' +
        "brand faces.",
    );
  }
  const registry = createRegistry(
    declaredPresent === undefined ? snapshotPresent : declaredPresent,
  );

  /* ---- theme assembly -------------------------------------------------- */

  function stackFor(role: string): unknown {
    if (!tokensPayload || !tokensPayload.tokens) return undefined;
    const typography = tokensPayload.tokens["typography"];
    if (!isGroup(typography)) return undefined;
    const families = typography["fontFamily"];
    if (!isGroup(families)) return undefined;
    return families[role];
  }

  let bundle = createManifest(null, { registry, stackFor });
  let manifest: FontManifest = bundle.manifest;
  let lookup: FaceLookup = bundle.lookup;

  function rebuildManifest(): void {
    bundle = createManifest(fontsPayload, { registry, stackFor });
    manifest = bundle.manifest;
    lookup = bundle.lookup;
    /* A different list can change what a role resolves to, so what has
     * already been said about a role no longer holds. */
    reporter.reset();
  }

  function resolveFor(role: string, weight: number): FamilyResolution {
    return resolveFamily({ role, stack: stackFor(role), weight }, lookup);
  }

  function rebuildTheme(): void {
    if (!tokensPayload) {
      theme = null;
      return;
    }
    theme = buildTheme(tokensPayload, {
      appearance: painted,
      remBase: options.remBase,
      resolveFamily: resolveFor,
      onResolved: (role: string, resolution: FamilyResolution): void => {
        reporter.report(role, resolution);
      },
    });
  }

  function emit(reason: UpdateReason, applied: boolean): void {
    const update: BrandUpdate = {
      version: version || UNKNOWN_VERSION,
      status,
      reason,
      applied,
    };
    const copy = listeners.slice();
    for (let i = 0; i < copy.length; i += 1) {
      try {
        copy[i](update);
      } catch {
        /* One listener that throws does not stop the others. */
      }
    }
  }

  function apply(
    payload: TokensPayload,
    next: BrandVersion,
    reason: UpdateReason,
  ): void {
    tokensPayload = payload;
    version = next;
    /* This payload was fetched for the appearance the brand is on now. */
    painted = appearance;
    rebuildTheme();
    emit(reason, true);
  }

  function isForeground(): boolean {
    try {
      return AppState.currentState !== "background";
    } catch {
      return true;
    }
  }

  /**
   * A change that arrived on its own waits for the next foreground unless
   * the app asked for it immediately. A change the app asked for by hand,
   * and the very first copy, always land straight away.
   */
  function land(
    payload: TokensPayload,
    next: BrandVersion,
    reason: UpdateReason,
  ): void {
    const arrivedOnItsOwn = reason === "stream" || reason === "poll";
    if (arrivedOnItsOwn && activate === "next-foreground" && isForeground()) {
      pending = { payload, version: next };
      emit(reason, false);
      return;
    }
    status = afterSuccess();
    apply(payload, next, reason);
  }

  function activatePending(): void {
    if (!pending) return;
    const held = pending;
    pending = null;
    status = afterSuccess();
    apply(held.payload, held.version, "foreground");
  }

  /* ---- fetching -------------------------------------------------------- */

  async function fetchTokens(): Promise<{
    payload: TokensPayload;
    version: BrandVersion;
  }> {
    const url = tokensUrl(address, { appearance });
    const result = await getJson<TokensPayload>(url, { timeoutMs });
    return { payload: result.body, version: result.version };
  }

  /**
   * Read the font list.
   *
   * Without it every role falls to the platform font for the whole
   * session, which is the quietest and most expensive failure this
   * package has, so it is not swallowed. One failure is said out loud in
   * development and asked for again on its own schedule, because the
   * token cycle may not come round again on a brand that has not changed.
   */
  async function fetchFonts(): Promise<void> {
    try {
      const result = await getJson<FontsPayload>(fontsUrl(address), {
        timeoutMs,
      });
      fontsPayload = result.body;
      fontsLoaded = true;
      cancel(fontsRetryTimer);
      fontsRetryTimer = null;
      rebuildManifest();
      /* A list that lands late changes what text resolves to, so anything
       * already built from the theme has to be built again. */
      if (fontsAttempts > 0 && tokensPayload) {
        rebuildTheme();
        emit("fonts", true);
      }
    } catch {
      if (fontsLoaded || destroyed) return;
      if (fontsAttempts === 0) {
        devWarn(
          "the font list for this brand could not be read, so text is in " +
            "the platform font for now. Asking again.",
        );
      }
      scheduleFontsRetry();
    }
  }

  /** 2s, 8s, 30s, then stop asking and leave the warning standing. */
  const FONTS_RETRY_MS = [2000, 8000, 30000];

  function scheduleFontsRetry(): void {
    if (destroyed || fontsLoaded) return;
    const wait = FONTS_RETRY_MS[fontsAttempts];
    fontsAttempts += 1;
    if (wait === undefined) return;
    cancel(fontsRetryTimer);
    fontsRetryTimer = later(() => {
      fontsRetryTimer = null;
      void fetchFonts();
    }, wait);
  }

  function readCapabilities(payload: ContextPayload): string[] {
    const advertised = payload.capabilities || [];
    const out: string[] = [];
    for (let i = 0; i < advertised.length; i += 1) {
      if (ADDRESSABLE.indexOf(advertised[i].name) !== -1) {
        out.push(advertised[i].name);
      }
    }
    return out;
  }

  async function fetchContext(): Promise<void> {
    try {
      const result = await getJson<ContextPayload>(contextUrl(address), {
        timeoutMs,
      });
      capabilityNames = readCapabilities(result.body);
    } catch {
      /*
       * What a brand offers is a description. Failing to read it changes
       * nothing about what can be addressed, so it changes no status.
       */
    }
  }

  async function persist(
    payload: TokensPayload,
    next: BrandVersion,
  ): Promise<void> {
    if (!options.storage) return;
    const saved: BrandSnapshot = {
      $schema: SNAPSHOT_SCHEMA,
      publicId,
      fetchedAt: new Date().toISOString(),
      appearance,
      version: next,
      tokens: payload,
      fonts: fontsPayload,
      /*
       * Deliberately empty. Which faces are in the app binary is a fact
       * about the build, not about the last fetch, and storage outlives
       * builds: a copy saved by a version that shipped a face would
       * claim it in a version that dropped it. The build-time snapshot
       * and the fonts option are the only two things that may say.
       */
      fontsPresent: [],
    };
    await writeQuietly(
      options.storage,
      storageKey(publicId, appearance),
      JSON.stringify(saved),
    );
  }

  /**
   * Fetch and land one copy.
   *
   * Failure is reported through the status rather than thrown, because a
   * brand that cannot reach the network is a degraded brand and not an
   * exception. The one caller that does want the error is refresh(): the
   * app asked for it by hand, so it can be told why it did not happen.
   */
  async function load(
    reason: UpdateReason,
    rethrow?: boolean,
  ): Promise<BrandStatus> {
    const wanted = appearance;
    try {
      const results = await Promise.all([
        fetchTokens(),
        fetchFonts(),
        fetchContext(),
      ]);
      if (destroyed) return status;
      /* The appearance moved while this was in flight, so drop the answer. */
      if (wanted !== appearance) return status;
      const fetched = results[0];
      const changed = !sameVersion(version, fetched.version);
      if (changed || reason !== "poll") {
        land(fetched.payload, fetched.version, reason);
      } else {
        status = afterSuccess();
      }
      void persist(fetched.payload, fetched.version);
      return status;
    } catch (cause) {
      if (destroyed) return status;
      status = afterFailure(status);
      if (cause instanceof BrandError) {
        if (cause.code === "not_found") {
          devWarn(
            "there is no brand at " +
              cause.url +
              ". Check the public id passed to createBrand.",
          );
        } else if (
          cause.code === "unauthorized" ||
          cause.code === "forbidden"
        ) {
          /* Refused rather than unreachable, which reads the same on screen
           * and is fixed somewhere completely different. */
          devWarn(
            "the request for " +
              cause.url +
              " was refused, so this brand is not being served to this app. " +
              "Check the public id, and the key if this brand needs one.",
          );
        } else if (cause.code === "too_many_requests") {
          devWarn(
            "the brand surface asked this app to slow down, so this copy is " +
              "the one already in hand. It is not asked for again straight " +
              "away. Look at how often createBrand is being called, and at " +
              "live.pollMs.",
          );
        }
      }
      emit(reason, false);
      if (rethrow) throw cause;
      return status;
    }
  }

  /* ---- restoring ------------------------------------------------------- */

  /**
   * The appearance a saved copy was taken in, when it says something this
   * package understands. A copy that says nothing readable is treated as
   * the appearance the brand is on, which is what it was before this
   * field was read at all.
   */
  function appearanceOf(saved: BrandSnapshot): Appearance {
    if (saved.appearance === "light") return "light";
    if (saved.appearance === "dark") return "dark";
    return appearance;
  }

  function restore(saved: BrandSnapshot): void {
    /*
     * saved.fontsPresent is not read here on purpose. Which faces are in
     * the binary is settled by the build, through the fonts option or the
     * snapshot passed to createBrand, and a stored copy can outlive the
     * build that wrote it.
     */
    fontsPayload = saved.fonts;
    fontsLoaded = saved.fonts !== null;
    rebuildManifest();
    tokensPayload = saved.tokens;
    version = saved.version;
    /*
     * A copy carries one appearance, and it is whichever one it was taken
     * in. Painting it is still better than opening unbranded, so it is
     * painted and labelled honestly: theme.appearance says which colours
     * these are, so an app that sets a status bar or a keyboard from it
     * is not told the opposite of what is on the screen. The fetch that
     * is already in flight replaces them with the right ones.
     */
    painted = appearanceOf(saved);
    status = afterRestore(status);
    rebuildTheme();
  }

  async function restoreFromStorage(): Promise<void> {
    if (!options.storage || status !== "cold") return;
    const raw = await readQuietly(
      options.storage,
      storageKey(publicId, appearance),
    );
    if (!raw || destroyed || status !== "cold") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isSnapshot(parsed)) return;
    restore(parsed);
    emit("restore", true);
  }

  /* ---- the live channel ------------------------------------------------ */

  let stream: StreamHandle | null = null;
  let reconnectTimer: unknown = null;
  let watchdogTimer: unknown = null;
  let pollTimer: unknown = null;
  let retryMs = DEFAULT_RETRY_MS;
  let failures = 0;
  let polling = false;
  let sawFrame = false;

  function armWatchdog(): void {
    cancel(watchdogTimer);
    watchdogTimer = later(() => {
      /* Several keep-alives missed. The connection is gone but has not said so. */
      closeStream();
      scheduleReconnect();
    }, HEARTBEAT_GRACE_MS);
  }

  function closeStream(): void {
    if (stream) {
      stream.close();
      stream = null;
    }
    cancel(watchdogTimer);
    watchdogTimer = null;
  }

  function startPolling(): void {
    if (destroyed || !liveEnabled) return;
    cancel(pollTimer);
    pollTimer = later(() => {
      if (!isForeground()) {
        startPolling();
        return;
      }
      void load("poll").then(() => {
        startPolling();
      });
    }, pollMs);
  }

  function scheduleReconnect(): void {
    if (destroyed || !liveEnabled || polling || !isForeground()) return;
    cancel(reconnectTimer);
    failures += 1;
    if (failures >= FAILURES_BEFORE_POLLING) {
      polling = true;
      devWarn(
        "the live brand channel would not hold, so changes will be checked " +
          "periodically instead.",
      );
      startPolling();
      return;
    }
    const ceiling = Math.min(
      retryMs * Math.pow(2, failures - 1),
      RECONNECT_CEILING_MS,
    );
    reconnectTimer = later(() => {
      openStream();
    }, Math.floor(Math.random() * ceiling));
  }

  function openStream(): void {
    if (destroyed || !liveEnabled || polling) return;
    if (stream || !isForeground()) return;
    sawFrame = false;
    const handle = openEventStream(eventsUrl(address), {
      onActivity(): void {
        armWatchdog();
      },
      onRetry(ms: number): void {
        retryMs = ms;
      },
      onFrame(frame): void {
        sawFrame = true;
        failures = 0;
        if (!frame.data) return;
        const next = versionFromFrame(frame.data);
        if (!next) return;
        if (sameVersion(version, next)) return;
        if (pending && sameVersion(pending.version, next)) return;
        void load("stream");
      },
      onClose(): void {
        stream = null;
        cancel(watchdogTimer);
        watchdogTimer = null;
        if (sawFrame) failures = 0;
        scheduleReconnect();
      },
    });
    if (!handle) {
      /* No XMLHttpRequest on this host, so the channel is not available. */
      polling = true;
      startPolling();
      return;
    }
    stream = handle;
    armWatchdog();
  }

  function startLive(): void {
    if (!liveEnabled || destroyed) return;
    if (polling) {
      startPolling();
      return;
    }
    openStream();
  }

  function stopLive(): void {
    closeStream();
    cancel(reconnectTimer);
    reconnectTimer = null;
    cancel(pollTimer);
    pollTimer = null;
  }

  /* ---- appearance ------------------------------------------------------ */

  function changeAppearance(next: Appearance): void {
    if (destroyed || next === appearance) return;
    appearance = next;
    pending = null;
    /*
     * The theme is deliberately left alone until the new values land.
     * Rebuilding it here would relabel the colours the app is painting
     * with rather than change them, and a theme that says "dark" while
     * every colour in it is the light one is worse than a theme that has
     * not caught up yet: an app cannot tell it has not caught up. If the
     * fetch fails there is nothing to swap in, and the honest answer is
     * still the appearance these values really are.
     */
    void load("appearance");
  }

  /* ---- app state ------------------------------------------------------- */

  let wasBackground = false;

  const detachAppState = detacher(
    AppState.addEventListener("change", (next: string): void => {
      if (destroyed) return;
      if (next === "background") {
        /*
         * The system drops a held connection when the app leaves anyway,
         * and holding one spends battery on a heartbeat nobody reads.
         */
        wasBackground = true;
        stopLive();
        return;
      }
      if (next !== "active") return;
      if (!wasBackground) {
        startLive();
        return;
      }
      wasBackground = false;
      activatePending();
      /* The refetch is the guarantee. The channel is only the speed. */
      void load("foreground").then(() => {
        startLive();
      });
    }),
  );

  const detachAppearance = followSystem
    ? detacher(
        SystemAppearance.addChangeListener((): void => {
          if (destroyed) return;
          changeAppearance(systemAppearance());
        }),
      )
    : detacher(null);

  /* ---- assets ---------------------------------------------------------- */

  function resolveAsset(role: string, params?: AssetParams): string {
    const given: AssetParams = params || {};
    const format: AssetFormat = given.format || "png";
    /*
     * The mark follows `painted`, the same value theme.appearance answers
     * from, and not `appearance`, which has already moved to whatever was
     * asked for.
     *
     * The two are the same except between asking for an appearance and
     * being given it, and that window is not always short: a request that
     * fails offline never closes it. Reading `appearance` here meant the
     * address said light while every colour on the screen was still dark,
     * permanently, which is the same mismatch the appearance rule exists
     * to prevent. A mark belongs to the colours beside it.
     */
    const wanted: Appearance = given.appearance || painted;
    let size: AssetSize | null = null;
    if (given.size !== undefined) {
      size = given.size;
    } else if (given.pt !== undefined) {
      size = sizeForPoints(given.pt);
    }
    return assetUrl(address, role, { format, appearance: wanted, size });
  }

  /* ---- the brand ------------------------------------------------------- */

  let initPromise: Promise<BrandStatus> | null = null;

  const brand: Brand = {
    init(): Promise<BrandStatus> {
      if (destroyed) return Promise.resolve(status);
      if (initPromise) return initPromise;
      initPromise = load("init").then((result) => {
        startLive();
        return result;
      });
      return initPromise;
    },

    tokens(): BrandTheme | null {
      return theme;
    },

    asset(role: string, params?: AssetParams): string {
      return resolveAsset(role, params);
    },

    fonts(): FontManifest {
      return manifest;
    },

    subscribe(listener: (update: BrandUpdate) => void): () => void {
      listeners.push(listener);
      let live = true;
      return (): void => {
        if (!live) return;
        live = false;
        const at = listeners.indexOf(listener);
        if (at !== -1) listeners.splice(at, 1);
      };
    },

    get status(): BrandStatus {
      return status;
    },

    get version(): BrandVersion | null {
      return version;
    },

    capabilities(): string[] {
      return capabilityNames.slice();
    },

    async refresh(): Promise<void> {
      pending = null;
      await load("refresh", true);
    },

    setAppearance(next: Appearance): void {
      changeAppearance(next);
    },

    async prefetchAsset(role: string, params?: AssetParams): Promise<boolean> {
      try {
        const done = await Image.prefetch(resolveAsset(role, params));
        return done !== false;
      } catch {
        return false;
      }
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopLive();
      cancel(fontsRetryTimer);
      fontsRetryTimer = null;
      detachAppState();
      detachAppearance();
      listeners.length = 0;
    },
  };

  if (options.snapshot) {
    if (isSnapshot(options.snapshot)) {
      warnIfStale(options.snapshot);
      if (appearanceOf(options.snapshot) !== appearance) {
        devWarn(
          "the snapshot in this build was taken in " +
            options.snapshot.appearance +
            " and this device is on " +
            appearance +
            ", so the first frame opens in " +
            options.snapshot.appearance +
            " colours until the right ones arrive. A snapshot holds one " +
            "appearance. Take the other one too and pass whichever matches, " +
            "or pin the brand with appearance: \"" +
            options.snapshot.appearance +
            '".',
        );
      }
      restore(options.snapshot);
    } else {
      devWarn(
        "the snapshot passed to createBrand was not readable, so it was " +
          "ignored and the first frame will not be branded.",
      );
    }
  } else {
    void restoreFromStorage();
  }

  if (options.autoInit !== false) void brand.init();

  return brand;
}
