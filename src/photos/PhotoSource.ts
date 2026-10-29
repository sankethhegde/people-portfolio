import type { PhotoSourceId } from '../types';

export interface BrowseFolder {
  /** Opaque id passed back into `browse()`. */
  id: string;
  name: string;
}

export interface BrowseImage {
  /** The value stored in `PhotoRef.ref`. */
  ref: string;
  name: string;
}

export interface BrowseResult {
  /** Breadcrumb trail from the source root to this folder (empty at the root). */
  path: BrowseFolder[];
  folders: BrowseFolder[];
  images: BrowseImage[];
  /** Set when the folder needs the user to re-grant access before it can be listed. */
  needsPermission?: boolean;
}

/** offline: the whole folder/disk can't be reached right now (e.g. an unplugged external drive). */
export type Availability = 'ok' | 'missing' | 'needs-permission' | 'offline';

/**
 * Every photo source implements this; the UI never knows where a photo came from.
 * Adding the personal server in v2 means writing one more of these — no UI changes.
 */
export interface PhotoSource {
  id: PhotoSourceId;
  name: string;
  /** False when the browser can't use this source at all. */
  isSupported(): boolean;
  /** Sign in or pick a folder. Must be called from a user gesture. */
  connect(): Promise<boolean>;
  browse(folderId?: string): Promise<BrowseResult>;
  /** Small image (~300 px) for cards. Throws PhotoError on failure. */
  getThumbnail(ref: string): Promise<Blob>;
  /** Full image for the detail panel. Throws PhotoError on failure. */
  getFull(ref: string): Promise<Blob>;
  isAvailable(ref: string): Promise<Availability>;
  /**
   * Optional: a URL of a ready-made preview (JPEG) about `size` px on its long side, usable directly in <img>.
   * Much cheaper than downloading the original, and works for formats the browser can't decode (HEIC).
   * Resolves to null when the source has no preview for this photo.
   */
  previewUrl?(ref: string, size: number): Promise<string | null>;
}

export class PhotoError extends Error {
  constructor(
    public kind: 'missing' | 'needs-permission' | 'unsupported' | 'offline',
    message: string,
  ) {
    super(message);
  }
}

export const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i;

/** Resize to fit within `max` px, as WEBP. HEIC only works where the browser can decode it. */
export async function makeThumbnail(blob: Blob, max = 300): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new PhotoError('unsupported', 'This browser cannot decode the image');
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
}
