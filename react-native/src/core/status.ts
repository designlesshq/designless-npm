/*
 * Five states, and the only moves between them.
 *
 *   cold      nothing yet. There is no theme to read.
 *   restored  a build-time snapshot or a stored copy is in use. It has
 *             not been checked against the server this run.
 *   ready     a copy fetched this run is in use.
 *   stale     there was a copy, the last fetch failed, and the old copy
 *             is still being served.
 *   failed    there was no copy and the fetch failed. Still no theme.
 *
 * A brand that cannot reach the network is a degraded brand, not an
 * exception, so nothing here throws. The status is how an app finds out.
 */

export type BrandStatus = "cold" | "restored" | "ready" | "stale" | "failed";

export function afterRestore(current: BrandStatus): BrandStatus {
  return current === "cold" || current === "failed" ? "restored" : current;
}

export function afterSuccess(): BrandStatus {
  return "ready";
}

export function afterFailure(current: BrandStatus): BrandStatus {
  if (current === "restored" || current === "ready" || current === "stale") {
    return "stale";
  }
  return "failed";
}

/** True when there is a theme to read in this state. */
export function hasTheme(status: BrandStatus): boolean {
  return status === "restored" || status === "ready" || status === "stale";
}
