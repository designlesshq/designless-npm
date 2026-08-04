/* An address, in the shape the Image component wants. */

export interface ImageSource {
  uri: string;
  width?: number;
  height?: number;
}

export function toImageSource(uri: string, points?: number): ImageSource {
  if (points === undefined || !Number.isFinite(points)) return { uri };
  return { uri, width: points, height: points };
}
