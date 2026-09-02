/** The frozen marker contract every reader can rely on. */
export declare const MARKER_VERSION: 'annotate/v1';
export declare const ATTR: Readonly<{
  FILE: 'data-source-file';
  LINE: 'data-source-line';
  SELECTABLE: 'data-selectable';
  VERSION: 'data-designless';
}>;
/** True for a host element name (a lowercase intrinsic tag), false for a component. */
export declare function isHostElement(name: string): boolean;
/** The repo-relative POSIX path of a file under a root; '' when it is not under it. */
export declare function toRepoRelative(root: string, filename: string): string;
/** The marker attributes stamped on an element: file, line, selectable, version. */
export declare function markerAttributes(relFile: string, line: number): Record<string, string>;
