import { db, nowIso, uid, type FolderRecord } from '../db';
import {
  IMAGE_EXT,
  makeThumbnail,
  PhotoError,
  type Availability,
  type BrowseFolder,
  type BrowseResult,
  type PhotoSource,
} from './PhotoSource';

/*
 * Local photos.
 * - Chrome/Edge: File System Access API. Refs are `<folderId>/<relative/path.jpg>`; the folder handle
 *   lives in IndexedDB and the browser asks to re-grant access in each new session.
 * - Other browsers: files picked with a file input are copied into IndexedDB. Refs are `idb:<blobId>`.
 */

const IDB_PREFIX = 'idb:';
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const fsAccessSupported = () => typeof window.showDirectoryPicker === 'function';

async function permission(handle: FileSystemHandle, request: boolean): Promise<PermissionState> {
  if (!handle.queryPermission) return 'granted';
  const state = await handle.queryPermission({ mode: 'read' });
  if (state === 'granted' || !request || !handle.requestPermission) return state;
  return handle.requestPermission({ mode: 'read' });
}

function splitRef(ref: string): { folderId: string; parts: string[] } {
  const [folderId, ...parts] = ref.split('/').filter(Boolean);
  return { folderId, parts };
}

async function getFolder(folderId: string): Promise<FolderRecord> {
  const rec = await db.folders.get(folderId);
  if (!rec) throw new PhotoError('missing', 'Folder is no longer connected');
  return rec;
}

function toPhotoError(err: unknown): PhotoError {
  if (err instanceof PhotoError) return err;
  const name = (err as DOMException)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new PhotoError('needs-permission', 'Folder access needs to be re-granted');
  }
  return new PhotoError('missing', 'Photo not found');
}

// ---- folders whose disk isn't reachable (unplugged external drive, disconnected network share) ----
const unreachable = new Map<string, string>(); // folderId → name
const unreachableListeners = new Set<() => void>();
let unreachableSnapshot: { id: string; name: string }[] = [];
function setReachable(folder: { id: string; name: string }, ok: boolean) {
  if (ok === !unreachable.has(folder.id)) return;
  if (ok) unreachable.delete(folder.id);
  else unreachable.set(folder.id, folder.name);
  unreachableSnapshot = [...unreachable].map(([id, name]) => ({ id, name }));
  unreachableListeners.forEach((l) => l());
}
export const subscribeUnreachable = (l: () => void) => (unreachableListeners.add(l), () => unreachableListeners.delete(l));
export const getUnreachable = () => unreachableSnapshot;

/** Can the folder itself be read? False when its disk is unplugged. */
async function rootReachable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    await handle.values().next();
    return true;
  } catch (err) {
    // A permission problem isn't a missing disk.
    const name = (err as DOMException)?.name;
    return name === 'NotAllowedError' || name === 'SecurityError';
  }
}

/** Re-checks unreachable folders; returns true if any came back. */
export async function recheckUnreachable(): Promise<boolean> {
  let back = false;
  for (const id of [...unreachable.keys()]) {
    const rec = await db.folders.get(id);
    if (!rec) {
      setReachable({ id, name: '' }, true);
      continue;
    }
    if (await rootReachable(rec.handle)) {
      setReachable(rec, true);
      back = true;
    }
  }
  return back;
}

/** Turns a failed read into "missing" or, when the whole folder is gone, "offline". */
async function classify(folder: FolderRecord, err: unknown): Promise<PhotoError> {
  const e = toPhotoError(err);
  if (e.kind !== 'missing') return e;
  if (await rootReachable(folder.handle)) {
    setReachable(folder, true);
    return e;
  }
  setReachable(folder, false);
  return new PhotoError('offline', `“${folder.name}” isn’t reachable — is the disk connected?`);
}

async function walkDir(root: FileSystemDirectoryHandle, parts: string[]) {
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p);
  return dir;
}

async function readFile(ref: string): Promise<Blob> {
  if (ref.startsWith(IDB_PREFIX)) {
    const rec = await db.blobs.get(ref.slice(IDB_PREFIX.length));
    if (!rec) throw new PhotoError('missing', 'Photo not found');
    return rec.blob;
  }
  const { folderId, parts } = splitRef(ref);
  const folder = await getFolder(folderId);
  if ((await permission(folder.handle, false)) !== 'granted') {
    if (!lockedSnapshot.some((f) => f.id === folder.id)) void refreshLocked();
    throw new PhotoError('needs-permission', `Access to “${folder.name}” needs to be re-granted`);
  }
  try {
    const dir = await walkDir(folder.handle, parts.slice(0, -1));
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    const file = await fh.getFile();
    setReachable(folder, true);
    return file;
  } catch (err) {
    throw await classify(folder, err);
  }
}

export const localSource: PhotoSource = {
  id: 'local',
  name: 'Local folder',
  isSupported: () => true,

  async connect() {
    if (!fsAccessSupported()) return false;
    try {
      const handle = await window.showDirectoryPicker!({ mode: 'read', id: 'people-photos' });
      // Re-use the record if this exact folder is already connected.
      for (const f of await db.folders.toArray()) {
        if (await f.handle.isSameEntry(handle)) return true;
      }
      await db.folders.add({ id: uid(), name: handle.name, handle, addedAt: nowIso() });
      return true;
    } catch {
      return false; // user cancelled
    }
  },

  async browse(folderId?: string): Promise<BrowseResult> {
    if (!folderId) {
      const folders = (await db.folders.toArray()).map((f) => ({ id: f.id, name: f.name }));
      return { path: [], folders, images: [] };
    }
    const { folderId: rootId, parts } = splitRef(folderId);
    const root = await getFolder(rootId);
    const path: BrowseFolder[] = [{ id: rootId, name: root.name }];
    parts.forEach((p, i) => path.push({ id: [rootId, ...parts.slice(0, i + 1)].join('/'), name: p }));

    if ((await permission(root.handle, false)) !== 'granted') {
      return { path, folders: [], images: [], needsPermission: true };
    }
    const folders: BrowseFolder[] = [];
    const images: { ref: string; name: string }[] = [];
    try {
      const dir = await walkDir(root.handle, parts);
      for await (const entry of dir.values()) {
        if (entry.name.startsWith('.')) continue;
        const id = [rootId, ...parts, entry.name].join('/');
        if (entry.kind === 'directory') folders.push({ id, name: entry.name });
        else if (IMAGE_EXT.test(entry.name)) images.push({ ref: id, name: entry.name });
      }
    } catch (err) {
      throw await classify(root, err);
    }
    setReachable(root, true);
    folders.sort((a, b) => collator.compare(a.name, b.name));
    images.sort((a, b) => collator.compare(a.name, b.name));
    return { path, folders, images };
  },

  async getThumbnail(ref) {
    return makeThumbnail(await readFile(ref));
  },

  getFull: readFile,

  async isAvailable(ref): Promise<Availability> {
    try {
      await readFile(ref);
      return 'ok';
    } catch (err) {
      const kind = toPhotoError(err).kind;
      return kind === 'needs-permission' || kind === 'offline' ? kind : 'missing';
    }
  },
};

/**
 * Lets the user pick a folder and connects it (or finds it if already connected).
 * Returns the folder record, or null if cancelled / unsupported. Call from a click handler.
 */
export async function pickFolder(): Promise<FolderRecord | null> {
  if (!fsAccessSupported()) return null;
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker!({ mode: 'read', id: 'people-import' });
  } catch {
    return null; // cancelled
  }
  for (const f of await db.folders.toArray()) {
    if (await f.handle.isSameEntry(handle)) return f;
  }
  const rec: FolderRecord = { id: uid(), name: handle.name, handle, addedAt: nowIso() };
  await db.folders.add(rec);
  return rec;
}

/**
 * Ask the browser to re-grant read access to ONE folder. Call from a click handler: Chrome allows one
 * permission prompt per click, so a second request in the same click fails (it returns false, never throws).
 */
export async function requestFolderAccess(folderId: string): Promise<boolean> {
  let ok = false;
  try {
    const folder = await getFolder(folderId);
    ok = (await permission(folder.handle, true)) === 'granted';
  } catch {
    ok = false;
  }
  await refreshLocked();
  return ok;
}

// ---- folders Chrome needs a click to read again (a new browser session), kept live for banners ----
let lockedSnapshot: { id: string; name: string }[] = [];
const lockedListeners = new Set<() => void>();
export const subscribeLocked = (l: () => void) => (lockedListeners.add(l), () => lockedListeners.delete(l));
export const getLocked = () => lockedSnapshot;
export async function refreshLocked() {
  const next = (await foldersNeedingAccess()).map((f) => ({ id: f.id, name: f.name }));
  if (next.map((f) => f.id).join() === lockedSnapshot.map((f) => f.id).join()) return;
  lockedSnapshot = next;
  lockedListeners.forEach((l) => l());
}

/** The connected-folder id a local photo ref lives in (undefined for photos copied into the browser). */
export const folderIdOfRef = (ref: string) => (ref.startsWith(IDB_PREFIX) ? undefined : ref.split('/')[0]);

/** Connected folders whose access has lapsed (a new browser session). */
export async function foldersNeedingAccess(): Promise<FolderRecord[]> {
  const out: FolderRecord[] = [];
  for (const f of await db.folders.toArray()) {
    if ((await permission(f.handle, false)) !== 'granted') out.push(f);
  }
  return out;
}

export async function disconnectFolder(folderId: string) {
  await db.folders.delete(folderId);
}

/** Fallback: copy picked files into IndexedDB. Returns refs in the same order. */
export async function storeUploadedFiles(files: File[]): Promise<{ ref: string; name: string }[]> {
  const out: { ref: string; name: string }[] = [];
  for (const file of files) {
    const id = uid();
    await db.blobs.add({ id, name: file.name, blob: file });
    out.push({ ref: IDB_PREFIX + id, name: file.name });
  }
  return out;
}

/** Display name of a ref's file, e.g. "Asha Rao.jpg". */
export function localRefName(ref: string): string {
  return ref.split('/').pop() ?? ref;
}
