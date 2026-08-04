/*
 * Which faces this app binary contains.
 *
 * React Native has no way to add a font at runtime. Core exposes no
 * registration call, no path to the platform font managers, and no place
 * on disk to stage a download. So the set of usable faces is fixed when
 * the app is built, and this is the record of it.
 *
 * The list is written by the font command at build time and travels in
 * the snapshot, so nothing has to be kept in step by hand.
 */

export interface FontRegistry {
  has(postscriptName: string): boolean;
  list(): string[];
}

export function createRegistry(present: string[] | undefined): FontRegistry {
  const names = present ? present.slice() : [];
  /* Null prototype for the same reason as the manifest indexes: a
   * PostScript name is data, and "constructor" must not answer true. */
  const index: { [name: string]: true } = Object.create(null);
  for (let i = 0; i < names.length; i += 1) index[names[i]] = true;
  return {
    has(postscriptName: string): boolean {
      return index[postscriptName] === true;
    },
    list(): string[] {
      return names.slice();
    },
  };
}
