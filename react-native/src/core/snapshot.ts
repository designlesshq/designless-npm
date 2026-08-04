/*
 * The build-time copy that makes the first frame branded.
 *
 * React Native core has no way to read storage synchronously, so on a cold
 * install with no network there is nothing to paint with. A snapshot fixes
 * that: it is imported like any other json file, so it is already in memory
 * before the first render, and the app opens in its own colours offline.
 *
 * The obvious risk is that it goes stale, which would quietly turn a
 * published brand change into something that needs an app release. Three
 * things close that. The file records when it was taken. A development
 * build says so when it is old. And the snapshot command has a check mode
 * that fails a build when the committed file no longer matches what is
 * published, which is the part that belongs in continuous integration.
 */

import type { TokensPayload, FontsPayload } from "../protocol/payloads";
import type { BrandVersion } from "../protocol/version";
import { devWarn } from "../platform/globals";

export const SNAPSHOT_SCHEMA = "designless-native-snapshot/v1";

/** Warn about a snapshot older than this, in development only. */
export const SNAPSHOT_STALE_DAYS = 30;

export interface BrandSnapshot {
  $schema: string;
  publicId: string;
  /** When the snapshot was taken, as an ISO timestamp. */
  fetchedAt: string;
  /**
   * The appearance the copy was taken in.
   *
   * A plain string and not the light/dark union on purpose: the file this
   * describes is imported from json, where every string widens, and a
   * union here fails the build on the one line the readme tells everyone
   * to write. isSnapshot below is what actually decides whether a file is
   * one of these, and it has never read this field.
   */
  appearance: string;
  version: BrandVersion;
  tokens: TokensPayload;
  fonts: FontsPayload | null;
  /**
   * PostScript names of the faces written into the app binary, as the
   * font command found them. Empty in a copy saved to storage: what is in
   * the binary is a fact about the build, and a saved copy outlives the
   * build that wrote it.
   */
  fontsPresent: string[];
}

export function isSnapshot(value: unknown): value is BrandSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record["$schema"] !== SNAPSHOT_SCHEMA) return false;
  const tokens = record["tokens"];
  if (!tokens || typeof tokens !== "object") return false;
  if (!(tokens as Record<string, unknown>)["tokens"]) return false;
  return typeof record["publicId"] === "string";
}

export function snapshotAgeDays(snapshot: BrandSnapshot): number | null {
  const taken = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(taken)) return null;
  return Math.floor((Date.now() - taken) / 86400000);
}

/** Say something once when a committed snapshot has drifted out of date. */
export function warnIfStale(snapshot: BrandSnapshot): void {
  const age = snapshotAgeDays(snapshot);
  if (age === null || age < SNAPSHOT_STALE_DAYS) return;
  devWarn(
    "the brand snapshot in this build is " +
      String(age) +
      " days old, so the first frame may open in older colours before the " +
      "current ones arrive. Refresh it with: npx designless-snapshot",
  );
}
