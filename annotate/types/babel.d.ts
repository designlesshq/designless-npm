import type { DesignlessOptions } from './next';
/** A Babel plugin factory: stamps marker attributes on host JSX elements in development. */
declare function designlessAnnotateBabel(babel: { types: unknown }, options?: Pick<DesignlessOptions, 'enabled'>): { name: string; visitor: Record<string, unknown> };
export = designlessAnnotateBabel;
