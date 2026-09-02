import type { DesignlessOptions, AnnotateSourceOptions } from './next';
/** A Vite plugin (enforce: 'pre') that stamps marker attributes on host JSX in Qwik files in development. */
declare function designlessAnnotateQwik(options?: Pick<DesignlessOptions, 'enabled' | 'root'>): {
  name: string;
  enforce: 'pre';
  transform(code: string, id: string): { code: string; map: null } | null;
};
declare namespace designlessAnnotateQwik {
  function annotateQwikSource(content: string, opts?: AnnotateSourceOptions): string | undefined;
}
export = designlessAnnotateQwik;
