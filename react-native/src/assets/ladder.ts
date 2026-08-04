/*
 * Picking a size off the list.
 *
 * The sizes a mark is served at are a closed list, and asking for anything
 * else is answered with a 400. A layout, though, works in points and does
 * not know the list exists. So a size in points is multiplied by the
 * screen density and rounded up to the next size on the list. Up, never
 * down: a mark drawn smaller than the space it fills is soft, and nobody
 * notices a few extra pixels.
 */

import { PixelRatio } from "react-native";
import { ASSET_SIZES } from "../protocol/params";
import type { AssetSize } from "../protocol/params";

/** The next size at or above a pixel count. */
export function snapPixels(pixels: number): AssetSize {
  for (let i = 0; i < ASSET_SIZES.length; i += 1) {
    if (ASSET_SIZES[i] >= pixels) return ASSET_SIZES[i];
  }
  return ASSET_SIZES[ASSET_SIZES.length - 1];
}

function screenDensity(density?: number): number {
  return density === undefined || !Number.isFinite(density) || density <= 0
    ? PixelRatio.get()
    : density;
}

/** The size to ask for when a layout wants this many points. */
export function sizeForPoints(points: number, density?: number): AssetSize {
  return snapPixels(Math.ceil(points * screenDensity(density)));
}

/**
 * The height and width in points at which a mark served at this many
 * pixels draws one image pixel per screen pixel.
 *
 * A layout that asked for an exact size still has to be told how big to
 * draw it: React Native gives a network image no size of its own, so an
 * image with neither a style nor a size on its source occupies nothing
 * and shows nothing.
 */
export function pointsForSize(pixels: number, density?: number): number {
  const points = pixels / screenDensity(density);
  return Math.round(points * 100) / 100;
}
