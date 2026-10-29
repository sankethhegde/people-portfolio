import { useEffect, useState, useSyncExternalStore } from 'react';
import { db, getMeta, setMeta } from '../db';
import type { LinkedFolder, Person, PhotoRef, PhotoSourceId } from '../types';
import { driveSource } from './driveSource';
import { localSource } from './localSource';
import { PhotoError, type Availability, type PhotoSource } from './PhotoSource';

/** Sources not built yet still appear (disabled) in the picker. */
const placeholder = (id: PhotoSourceId, name: string): PhotoSource => {
  const fail = () => Promise.reject(new PhotoError('unsupported', `${name} is not available yet`));
  return {
    id,
    name,
    isSupported: () => false,
    connect: () => Promise.resolve(false),
    browse: () => Promise.resolve({ path: [], folders: [], images: [] }),
    getThumbnail: fail,
    getFull: fail,
    isAvailable: () => Promise.resolve('missing'),
  };
};

export const sources: Record<PhotoSourceId, PhotoSource> = {
  local: localSource,
  gdrive: driveSource,
  server: placeholder('server', 'Personal server'), // v2
};

export const photoKey = (p: PhotoRef) => `${p.source}:${p.ref}`;

// ---- photos known to be gone from their source (persisted, so the badge survives reloads) ----
// v2: earlier builds also flagged undecodable formats and network errors as "missing"; those marks are dropped.
const MISSING_KEY = 'missingPhotos.v2';
db.meta.delete('missingPhotos').catch(() => {});
let missing = new Set<string>();
let missingVersion = 0;
const missingListeners = new Set<() => void>();
getMeta<string[]>(MISSING_KEY).then((keys) => keys?.length && setMissing(new Set([...keys, ...missing])));

function setMissing(next: Set<string>) {
  missing = next;
  missingVersion++;
  missingListeners.forEach((l) => l());
  setMeta(MISSING_KEY, [...next]);
}
function markMissing(key: string, isMissing: boolean) {
  if (missing.has(key) === isMissing) return;
  const next = new Set(missing);
  if (isMissing) next.add(key);
  else next.delete(key);
  setMissing(next);
}
const subscribeMissing = (l: () => void) => (missingListeners.add(l), () => missingListeners.delete(l));

export function useIsPhotoMissing(photo?: PhotoRef): boolean {
  useSyncExternalStore(subscribeMissing, () => missingVersion);
  return !!photo && missing.has(photoKey(photo));
}

/** Snapshot for filtering: the set changes identity whenever it changes. */
export function useMissingPhotos(): Set<string> {
  useSyncExternalStore(subscribeMissing, () => missingVersion);
  return missing;
}

/** Asks each source whether the photos still exist. Returns counts by result. */
export async function checkPhotos(
  photos: PhotoRef[],
  onProgress?: (done: number, total: number) => void,
): Promise<Record<Availability, number>> {
  const counts: Record<Availability, number> = { ok: 0, missing: 0, 'needs-permission': 0, offline: 0 };
  const next = new Set(missing);
  let done = 0;
  let i = 0;
  const worker = async () => {
    while (i < photos.length) {
      const p = photos[i++];
      let a: Availability;
      try {
        a = await sources[p.source].isAvailable(p.ref);
      } catch {
        a = 'needs-permission'; // network or quota trouble: unknown, so don't flag as missing
      }
      counts[a]++;
      if (a === 'missing') next.add(photoKey(p));
      else if (a === 'ok') next.delete(photoKey(p));
      onProgress?.(++done, photos.length);
    }
  };
  await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));
  setMissing(next);
  return counts;
}

/**
 * missing: gone from its source · needs-permission: sign in / re-grant folder access ·
 * unsupported: the browser can't decode the format (e.g. HEIC in Chrome) · error: anything else (network, Drive 403…)
 */
export type PhotoStatus = 'none' | 'loading' | 'ok' | 'missing' | 'needs-permission' | 'unsupported' | 'offline' | 'error';

// ---- retry epoch: bumped after folder access is re-granted so failed photos try again ----
let epoch = 0;
const epochListeners = new Set<() => void>();
export function retryPhotos() {
  epoch++;
  failed.clear();
  epochListeners.forEach((l) => l());
}
const useEpoch = () =>
  useSyncExternalStore(
    (l) => (epochListeners.add(l), () => epochListeners.delete(l)),
    () => epoch,
  );

// ---- thumbnails: memory URL cache → IndexedDB cache → source ----
const thumbUrls = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const failed = new Map<string, PhotoStatus>();

// A few at a time, so scrolling a big grid doesn't decode hundreds of images at once.
const MAX_CONCURRENT = 4;
let running = 0;
const queue: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((r) => queue.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    queue.shift()?.();
  }
}

const THUMB_PX = 400;
const FULL_PX = 1600;

/**
 * Reads a preview image as a Blob so it can be cached. Returns null when the host doesn't send CORS
 * headers (then the URL can still be shown in an <img>); after the first such refusal it stops trying.
 */
let previewFetchAllowed: boolean | undefined;
async function fetchPreview(url: string): Promise<Blob | null> {
  if (previewFetchAllowed === false) return null;
  try {
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) return null;
    previewFetchAllowed = true;
    return await r.blob();
  } catch {
    previewFetchAllowed = false;
    return null;
  }
}

function loadThumb(photo: PhotoRef): Promise<string> {
  const key = photoKey(photo);
  const hit = thumbUrls.get(key);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const src = sources[photo.source];
      const cached = await db.thumbs.get(key);
      let blob = cached?.blob;
      if (!blob && src.previewUrl) {
        // Prefer the source's ready-made preview: a few KB instead of the original photo.
        const preview = await limited(() => src.previewUrl!(photo.ref, THUMB_PX));
        if (preview) {
          blob = (await fetchPreview(preview)) ?? undefined;
          if (!blob) {
            // The preview host doesn't allow reading it from script: show it directly (not cached offline).
            thumbUrls.set(key, preview);
            return preview;
          }
        }
      }
      if (!blob) {
        blob = await limited(() => src.getThumbnail(photo.ref));
        markMissing(key, false);
      }
      await db.thumbs.put({ key, blob, cachedAt: Date.now() });
      const url = URL.createObjectURL(blob);
      thumbUrls.set(key, url);
      return url;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

function statusOf(err: unknown, key?: string): PhotoStatus {
  if (err instanceof PhotoError) return err.kind;
  // Not a known case: keep the details in the console for diagnosis, and don't flag the photo as missing.
  console.warn('[photos] could not load', key ?? '', err);
  return 'error';
}

export function useThumbnail(photo?: PhotoRef): { url?: string; status: PhotoStatus } {
  const ep = useEpoch();
  const key = photo ? photoKey(photo) : '';
  const [state, setState] = useState<{ key: string; url?: string; status: PhotoStatus }>(() => ({
    key,
    url: thumbUrls.get(key),
    status: !photo ? 'none' : thumbUrls.has(key) ? 'ok' : failed.get(key) ?? 'loading',
  }));

  useEffect(() => {
    if (!photo) return setState({ key, status: 'none' });
    const known = thumbUrls.get(key);
    if (known) return setState({ key, url: known, status: 'ok' });
    if (failed.has(key)) return setState({ key, status: failed.get(key)! });
    let alive = true;
    setState({ key, status: 'loading' });
    loadThumb(photo).then(
      (url) => alive && setState({ key, url, status: 'ok' }),
      (err) => {
        const s = statusOf(err, key);
        // Only "missing" is remembered across reloads. Locked or failed photos are retried later.
        if (s === 'missing') markMissing(key, true);
        if (s === 'missing' || s === 'unsupported') failed.set(key, s);
        if (alive) setState({ key, status: s });
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ep]);

  return state.key === key ? state : { status: photo ? 'loading' : 'none' };
}

// ---- full images: small LRU of object URLs ----
const FULL_KEEP = 8;
const fullUrls = new Map<string, string>();

export function useFullPhoto(photo?: PhotoRef): { url?: string; status: PhotoStatus } {
  const ep = useEpoch();
  const key = photo ? photoKey(photo) : '';
  const [state, setState] = useState<{ key: string; url?: string; status: PhotoStatus }>({
    key: '',
    status: 'none',
  });

  useEffect(() => {
    if (!photo) return setState({ key, status: 'none' });
    const hit = fullUrls.get(key);
    if (hit) {
      fullUrls.delete(key);
      fullUrls.set(key, hit); // refresh LRU position
      return setState({ key, url: hit, status: 'ok' });
    }
    let alive = true;
    setState({ key, status: 'loading' });
    const src = sources[photo.source];
    const load = async (): Promise<string> => {
      const preview = src.previewUrl ? await src.previewUrl(photo.ref, FULL_PX) : null;
      return preview ?? URL.createObjectURL(await src.getFull(photo.ref));
    };
    load().then(
      (url) => {
        fullUrls.set(key, url);
        while (fullUrls.size > FULL_KEEP) {
          const [oldKey, oldUrl] = fullUrls.entries().next().value!;
          fullUrls.delete(oldKey);
          if (oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
        }
        markMissing(key, false);
        if (alive) setState({ key, url, status: 'ok' });
      },
      (err) => {
        const s = statusOf(err, key);
        if (s === 'missing') markMissing(key, true);
        if (alive) setState({ key, status: s });
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ep]);

  return state.key === key ? state : { status: photo ? 'loading' : 'none' };
}

/** Thumbnail for an arbitrary ref (used by the photo picker; same cache). */
export const usePickerThumb = (source: PhotoSourceId, ref: string) => useThumbnail({ source, ref });

// ---- galleries: cover + picked photos + a linked folder's photos ----

export type FolderStatus = 'none' | 'loading' | 'ok' | 'needs-permission' | 'missing' | 'unsupported' | 'offline' | 'error';

const folderCache = new Map<string, PhotoRef[]>();

/** Lists a linked folder's images (cached for the session; re-read after sign-in or re-grant). */
export function useFolderImages(folder?: LinkedFolder): { images: PhotoRef[]; status: FolderStatus } {
  const ep = useEpoch();
  const key = folder ? `${folder.source}:${folder.folderId}` : '';
  const [state, setState] = useState<{ key: string; images: PhotoRef[]; status: FolderStatus }>({ key: '', images: [], status: 'none' });

  useEffect(() => {
    if (!folder) return setState({ key, images: [], status: 'none' });
    const hit = folderCache.get(key);
    if (hit) return setState({ key, images: hit, status: 'ok' });
    let alive = true;
    setState({ key, images: [], status: 'loading' });
    sources[folder.source].browse(folder.folderId).then(
      (r) => {
        if (r.needsPermission) return alive && setState({ key, images: [], status: 'needs-permission' });
        const images = r.images.map((img) => ({ source: folder.source, ref: img.ref }));
        folderCache.set(key, images);
        setFolderCount(key, images.length);
        if (alive) setState({ key, images, status: 'ok' });
      },
      (err) => alive && setState({ key, images: [], status: statusOf(err, key) }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ep]);

  return state.key === key ? state : { images: [], status: folder ? 'loading' : 'none' };
}

/** Forget a folder's cached listing (e.g. after linking it, to pick up the latest files). */
export const refreshFolder = (folder: LinkedFolder) => folderCache.delete(`${folder.source}:${folder.folderId}`);

/** Every photo of a person in display order, without duplicates. */
export function galleryOf(person: Person, folderImages: PhotoRef[] = []): PhotoRef[] {
  const seen = new Set<string>();
  const out: PhotoRef[] = [];
  for (const p of [person.photo, ...(person.photos ?? []), ...folderImages]) {
    if (!p) continue;
    const k = photoKey(p);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

export function useGallery(person: Person) {
  const folder = useFolderImages(person.folder);
  return { photos: galleryOf(person, folder.images), folderImages: folder.images, folderStatus: folder.status };
}

// ---- photo counts (for sorting / filtering by photos) ----
// A linked folder's size is only known once it has been read, so counts are remembered across visits.

const COUNTS_KEY = 'folderCounts';
let folderCounts = new Map<string, number>();
let countsVersion = 0;
let countsSaveTimer: number | undefined;
const countListeners = new Set<() => void>();
getMeta<Record<string, number>>(COUNTS_KEY).then((saved) => {
  if (!saved) return;
  folderCounts = new Map([...Object.entries(saved), ...folderCounts]);
  countsVersion++;
  countListeners.forEach((l) => l());
});

export const linkedFolderKey = (f: LinkedFolder) => `${f.source}:${f.folderId}`;

function setFolderCount(key: string, n: number) {
  if (folderCounts.get(key) === n) return;
  folderCounts = new Map(folderCounts).set(key, n);
  countsVersion++;
  countListeners.forEach((l) => l());
  clearTimeout(countsSaveTimer);
  countsSaveTimer = window.setTimeout(() => setMeta(COUNTS_KEY, Object.fromEntries(folderCounts)), 1000);
}

/** Known linked-folder sizes; changes identity when any count changes. */
export function useFolderCounts(): Map<string, number> {
  useSyncExternalStore(
    (l) => (countListeners.add(l), () => countListeners.delete(l)),
    () => countsVersion,
  );
  return folderCounts;
}

/**
 * How many photos a person has: cover + picked photos + their linked folder (when its size is known).
 * A cover taken from the linked folder isn't counted twice.
 */
export function photoCount(p: Person, counts: Map<string, number>): number {
  const picked = new Map<string, PhotoRef>();
  for (const ph of [p.photo, ...(p.photos ?? [])]) if (ph) picked.set(photoKey(ph), ph);
  if (!p.folder) return picked.size;
  const inFolder = counts.get(linkedFolderKey(p.folder));
  if (inFolder === undefined) return picked.size;
  const f = p.folder;
  const alsoInFolder = [...picked.values()].filter((ph) =>
    ph.source !== f.source
      ? false
      : ph.source === 'local'
        ? ph.ref.startsWith(f.folderId + '/') && !ph.ref.slice(f.folderId.length + 1).includes('/')
        : ph === p.photo, // Drive: a cover usually comes from the person's folder
  ).length;
  return Math.max(picked.size, picked.size + inFolder - alsoInFolder);
}

/** Linked folders whose size isn't known yet. */
export const uncountedFolders = (people: Person[], counts: Map<string, number>) =>
  people.filter((p) => p.folder && !counts.has(linkedFolderKey(p.folder))).length;

/** Reads every linked folder (a few at a time) to learn its size. Returns how many couldn't be read. */
export async function countLinkedFolders(people: Person[], onProgress?: (done: number, total: number) => void): Promise<number> {
  const folders = [...new Map(people.filter((p) => p.folder).map((p) => [linkedFolderKey(p.folder!), p.folder!])).values()];
  let i = 0;
  let done = 0;
  let failedCount = 0;
  const worker = async () => {
    while (i < folders.length) {
      const f = folders[i++];
      try {
        const r = await sources[f.source].browse(f.folderId);
        if (r.needsPermission) failedCount++;
        else setFolderCount(linkedFolderKey(f), r.images.length);
      } catch {
        failedCount++;
      }
      onProgress?.(++done, folders.length);
    }
  };
  await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));
  return failedCount;
}
