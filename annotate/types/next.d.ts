/** Options for annotating one source file in place. */
export interface AnnotateSourceOptions { filename?: string; root?: string; enabled?: boolean }
/** Options every engine accepts: markers are on in development unless disabled; `root` fixes the repo root the markers are relative to. */
export interface DesignlessOptions {
  enabled?: boolean;
  root?: string;
  /** Force a specific SWC plugin candidate (advanced; normally chosen by trying). */
  runner?: number;
}
/**
 * Wrap a Next config so the Designless marker plugin runs in development.
 * Returns the config untouched when markers are off or no plugin matches this
 * Next version, so `next dev` and `next build` start either way.
 */
export declare function withDesignless<T extends Record<string, unknown> = Record<string, unknown>>(nextConfig?: T, options?: DesignlessOptions): T;
export declare function resolveProjectRoot(base: Record<string, unknown>, options?: DesignlessOptions): string;
export declare function selectPlugin(projectRoot: string, options?: DesignlessOptions): { spec: string; rel: string } | null;
export declare function chooseCandidate(bindings: unknown, projectRoot: string): { spec: string; rel: string } | null;
export declare function findSwcBinary(projectRoot: string): string | null;
export declare function stampsUnder(bindings: unknown, wasmPath: string, projectRoot: string): boolean;
export declare const CANDIDATES: ReadonlyArray<{ spec: string; rel: string }>;
