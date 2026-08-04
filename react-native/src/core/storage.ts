/*
 * Somewhere to keep the last copy between launches.
 *
 * React Native core has no storage, so this package does not pick one.
 * It takes whatever the app already uses. The shape below is the one
 * every key-value store on this platform already has, or is two lines
 * away from having.
 *
 * Without one, a build-time snapshot still gives a branded first frame,
 * and without either the first frame is unbranded. Both are stated in the
 * readme rather than left to be discovered.
 */

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function storageKey(publicId: string, appearance: string): string {
  return "designless:" + publicId + ":" + appearance;
}

/** Read without letting a broken store take the app down with it. */
export async function readQuietly(
  storage: StorageAdapter,
  key: string,
): Promise<string | null> {
  try {
    return await storage.getItem(key);
  } catch {
    return null;
  }
}

/** Write without letting a full disk take the app down with it. */
export async function writeQuietly(
  storage: StorageAdapter,
  key: string,
  value: string,
): Promise<void> {
  try {
    await storage.setItem(key, value);
  } catch {
    /* A copy that could not be saved costs one cold start, not a crash. */
  }
}
