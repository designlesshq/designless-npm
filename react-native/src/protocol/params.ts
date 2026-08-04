/*
 * The parameter vocabulary the brand address grammar accepts, as types.
 *
 * The size list is closed. Asking for a size that is not on it is answered
 * with a 400 and a message naming the accepted values, so the list is a
 * compile-time union here: a typo fails the build instead of the request.
 */

/** Light or dark. Always sent, never left to a default. */
export type Appearance = "light" | "dark";

/** The image formats the asset addresses serve. */
export type AssetFormat = "png" | "svg";

/** Every size a brand mark is served at. */
export const ASSET_SIZES = [
  16, 32, 48, 64, 128, 192, 256, 512, 1024,
] as const;

/** One rung of the size list. */
export type AssetSize = (typeof ASSET_SIZES)[number];

/** Where brands are served from. */
export const DEFAULT_BASE_URL = "https://cdn.designless.app";

/** True when the number is a rung of the size list. */
export function isAssetSize(value: number): value is AssetSize {
  for (let i = 0; i < ASSET_SIZES.length; i += 1) {
    if (ASSET_SIZES[i] === value) return true;
  }
  return false;
}
