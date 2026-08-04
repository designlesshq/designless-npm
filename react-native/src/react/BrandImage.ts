/*
 * A brand mark, drawn at a size the brand is actually served at.
 *
 * Pass pt and the size is worked out from the screen density and rounded
 * up to the next size on the list. Pass size and that exact size is asked
 * for, checked when the app is built rather than when the request goes
 * out. Either way the mark follows the appearance the brand is on, so it
 * changes with the rest of the screen instead of staying behind.
 */

import { createElement } from "react";
import type { ReactElement } from "react";
import { Image } from "react-native";
import type { ImageProps } from "react-native";

import { useBrandAsset } from "./hooks";
import type { AssetParams } from "../core/brand";
import type { Appearance, AssetFormat, AssetSize } from "../protocol/params";

/*
 * "role" is taken over from the Image props on purpose.
 *
 * React Native's own role prop is the web-compatible alias for
 * accessibilityRole, and leaving it in place intersects it with this one,
 * which narrows the brand role to React Native's list of accessibility
 * roles. "logo-symbol" is not on that list, so the prop this component
 * exists for stops compiling. accessibilityRole is untouched and is the
 * one to reach for.
 */
export type BrandImageProps = Omit<ImageProps, "source" | "role"> & {
  /** The mark to draw, for example "logo-symbol". */
  role: string;
  /** A size from the list. */
  size?: AssetSize;
  /** A size in points, rounded up to the next size on the list. */
  pt?: number;
  /** Overrides the appearance this brand is on. */
  appearance?: Appearance;
  /** Default "png". */
  format?: AssetFormat;
};

export function BrandImage(props: BrandImageProps): ReactElement {
  const { role, size, pt, appearance, format, ...rest } = props;
  const params = (
    pt === undefined ? { size, appearance, format } : { pt, appearance, format }
  ) as AssetParams;
  const source = useBrandAsset(role, params);
  return createElement(Image, { ...rest, source });
}
