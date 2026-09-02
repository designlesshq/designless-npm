/** The package entry: the frozen contract constants and the engine factories by name. Build tools import their engine by subpath. */
import type { MARKER_VERSION as MarkerVersion, ATTR as Attr } from './contract';
import type designlessAnnotateBabel from './babel';
import type * as next from './next';
export declare const MARKER_VERSION: typeof MarkerVersion;
export declare const ATTR: typeof Attr;
export declare const babel: typeof designlessAnnotateBabel;
/** The Next entry module (its `withDesignless` is the wrapper). */
export declare const withDesignless: typeof next;
