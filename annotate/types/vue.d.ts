import type { DesignlessOptions, AnnotateSourceOptions } from './next';
/** A Vite plugin (enforce: 'pre') that stamps marker attributes in .vue templates in development. */
declare function designlessAnnotateVue(options?: Pick<DesignlessOptions, 'enabled' | 'root'>): {
  name: string;
  enforce: 'pre';
  configResolved(config: { root?: string }): void;
  transform(code: string, id: string): { code: string; map: null } | null;
};
declare namespace designlessAnnotateVue {
  /** Annotate one .vue source; undefined when nothing changed. */
  function annotateVueSource(content: string, opts?: AnnotateSourceOptions): string | undefined;
}
export = designlessAnnotateVue;
