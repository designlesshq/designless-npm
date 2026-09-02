import type { DesignlessOptions, AnnotateSourceOptions } from './next';
/** An Astro integration that stamps marker attributes in .astro files in development. */
declare function designlessAnnotateAstro(options?: Pick<DesignlessOptions, 'enabled' | 'root'>): { name: string; hooks: Record<string, unknown> };
declare namespace designlessAnnotateAstro {
  function annotateAstroSource(content: string, opts?: AnnotateSourceOptions): Promise<string | undefined>;
  /** The Vite plugin the integration installs, for hosts that wire Vite directly. */
  function vitePlugin(options?: Pick<DesignlessOptions, 'enabled' | 'root'>): { name: string; transform(code: string, id: string): Promise<{ code: string; map: null } | null> };
}
export = designlessAnnotateAstro;
