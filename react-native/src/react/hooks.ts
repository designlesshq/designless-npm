/*
 * The hooks.
 *
 * Each one subscribes for itself rather than leaning on the provider to
 * re-render the tree. A memoised subtree does not re-render when its
 * parent does, and a screen that keeps last week's colours because it sat
 * behind a React.memo is a bug nobody would think to look for.
 */

import { useContext, useEffect, useMemo, useState } from "react";

import { BrandContext } from "./provider";
import type { Brand } from "../core/brand";
import type { AssetParams } from "../core/brand";
import type { BrandTheme } from "../convert/theme";
import type { TextSpec, TextStyle } from "../convert/text";
import type { ImageSource } from "../assets/source";
import { toImageSource } from "../assets/source";
import { pointsForSize } from "../assets/ladder";

/** The brand from the nearest provider. */
export function useBrand(): Brand {
  const brand = useContext(BrandContext);
  if (!brand) {
    throw new Error(
      "No brand found. Wrap the app in <DesignlessProvider publicId=\"r_XXX\">.",
    );
  }
  return brand;
}

/** Re-render this component whenever the brand changes. */
function useBrandTick(brand: Brand): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const stop = brand.subscribe(() => {
      setTick((value) => value + 1);
    });
    return stop;
  }, [brand]);
  return tick;
}

/** The theme, or null before there is one. */
export function useBrandTheme(): BrandTheme | null {
  const brand = useBrand();
  useBrandTick(brand);
  return brand.tokens();
}

/** A text style built from the brand. Empty before there is a theme. */
export function useBrandText(spec: TextSpec): TextStyle {
  const theme = useBrandTheme();
  const key = JSON.stringify(spec);
  return useMemo(() => {
    if (!theme) return {};
    return theme.text(spec);
    /* The spec is compared by value so a fresh object literal is free. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, key]);
}

/**
 * How big to draw a mark, in points.
 *
 * React Native gives a network image no size of its own, so a source with
 * no width and height beside it occupies nothing and shows nothing. A
 * request in points already says how big it is. A request for an exact
 * size is in pixels, and is drawn at the points that put one image pixel
 * on one screen pixel. A style on the component overrides either.
 */
function drawnAtPoints(params?: AssetParams): number | undefined {
  if (!params) return undefined;
  if (params.pt !== undefined) return params.pt;
  if (params.size !== undefined) return pointsForSize(params.size);
  return undefined;
}

/** The image source for a brand mark, sized so it draws. */
export function useBrandAsset(
  role: string,
  params?: AssetParams,
): ImageSource {
  const brand = useBrand();
  const tick = useBrandTick(brand);
  const key = JSON.stringify(params || {});
  return useMemo(() => {
    return toImageSource(brand.asset(role, params), drawnAtPoints(params));
    /*
     * The tick is in the list because the address depends on state the
     * brand holds and none of the other three describe: which appearance
     * the brand is painting. Subscribing and then leaving the tick out is
     * the same as not subscribing at all, and it shipped that way: the
     * component re-rendered on every change and handed back the address
     * it was first built with, so a dark mark stayed on a light page.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand, role, key, tick]);
}

/**
 * Styles built from the brand, rebuilt when it changes.
 *
 * StyleSheet.create at the top of a file reads the theme once, when the
 * file is first imported, and never looks again. Anything built from
 * brand values has to be built inside a render that a change can
 * invalidate, which is what this does.
 */
export function useThemedStyles<T>(
  factory: (theme: BrandTheme) => T,
): T | null {
  const theme = useBrandTheme();
  return useMemo(() => {
    if (!theme) return null;
    return factory(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}
