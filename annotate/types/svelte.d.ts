import type { DesignlessOptions } from './next';
/** A Svelte preprocessor that stamps marker attributes on host elements in development. */
declare function designlessAnnotateSvelte(options?: Pick<DesignlessOptions, 'enabled' | 'root'>): {
  name: string;
  markup(input: { content: string; filename?: string }): { code: string } | undefined;
};
export = designlessAnnotateSvelte;
