/*
 * @designless/react-native
 *
 * Your brand, served to a React Native app. Colours, type, spacing and
 * marks come from the brand you published, and change when you publish
 * again.
 *
 * Five verbs, which are the whole surface of this package. Other
 * Designless packages answer to the same names where their platform lets
 * them, and each one is shaped by what its platform can do:
 *
 *   init()                 settle the first copy
 *   tokens()               the theme
 *   asset(role, params)    where a brand mark lives
 *   fonts()                the published faces
 *   subscribe(listener)    changes
 *
 * Two things this package deliberately does not do. It carries no brand
 * values of its own, so a brand change never needs a release of this
 * package. And it does not add fonts at runtime, because React Native
 * has no way to: faces are written into the app at build time by the
 * font command, and the readme says what that costs.
 */

export { createBrand } from "./core/brand";
export type {
  Brand,
  BrandOptions,
  BrandUpdate,
  AssetParams,
  FontPolicy,
  LivePolicy,
  UpdateReason,
} from "./core/brand";

export type { BrandStatus } from "./core/status";
export { hasTheme } from "./core/status";

export type { BrandSnapshot } from "./core/snapshot";
export { SNAPSHOT_SCHEMA, isSnapshot, snapshotAgeDays } from "./core/snapshot";

export type { StorageAdapter } from "./core/storage";

export type { BrandTheme, SpacingTokens, ThemeOptions } from "./convert/theme";
export { IOS_TOUCH_TARGET, ANDROID_TOUCH_TARGET } from "./convert/theme";
export type { TextSpec, TextStyle, TextWeight } from "./convert/text";
export type { ShadowStyle } from "./convert/shadow";
export type { EasingFunction } from "./convert/easing";

export type { FontManifest, FontFamily, FontFace } from "./fonts/manifest";
export type { FontRegistry } from "./fonts/registry";

export type { Appearance, AssetFormat, AssetSize } from "./protocol/params";
export { ASSET_SIZES, DEFAULT_BASE_URL, isAssetSize } from "./protocol/params";
export type { BrandVersion } from "./protocol/version";
export type {
  TokensPayload,
  FontsPayload,
  ContextPayload,
  TokenNode,
} from "./protocol/payloads";
export { BrandError } from "./protocol/errors";
export type { BrandErrorCode } from "./protocol/errors";

export { sizeForPoints, snapPixels } from "./assets/ladder";
export type { ImageSource } from "./assets/source";

export { DesignlessProvider } from "./react/provider";
export type { DesignlessProviderProps } from "./react/provider";
export {
  useBrand,
  useBrandAsset,
  useBrandText,
  useBrandTheme,
  useThemedStyles,
} from "./react/hooks";
export { BrandImage } from "./react/BrandImage";
export type { BrandImageProps } from "./react/BrandImage";
