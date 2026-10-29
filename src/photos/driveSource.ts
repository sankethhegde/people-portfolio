import { currentToken, invalidateToken } from './driveAuth';
import {
  makeThumbnail,
  PhotoError,
  type Availability,
  type BrowseFolder,
  type BrowseImage,
  type BrowseResult,
  type PhotoSource,
} from './PhotoSource';

/*
 * Google Drive photos. PhotoRef.ref is the Drive file ID; nothing else is stored.
 * Browse ids are a chain of folder ids from the starting point, e.g. "root/<id>/<id>",
 * so the breadcrumb can be rebuilt without asking Drive for parents.
 */

const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const MY_DRIVE = 'root';
const SHARED = 'shared';
const SEARCH = 'search';

const names = new Map<string, string>([
  [MY_DRIVE, 'My Drive'],
  [SHARED, 'Shared with me'],
]);

function authHeader(): HeadersInit {
  const t = currentToken();
  if (!t) throw new PhotoError('needs-permission', 'Sign in to Google Drive');
  return { Authorization: `Bearer ${t}` };
}

async function drive(path: string, params: Record<string, string> = {}): Promise<Response> {
  const url = `${API}/${path}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
  const r = await fetch(url, { headers: authHeader() });
  if (r.ok) return r;
  if (r.status === 401) {
    invalidateToken();
    throw new PhotoError('needs-permission', 'Google Drive session expired');
  }
  if (r.status === 404) throw new PhotoError('missing', 'Photo not found in Drive');
  throw new Error(`Google Drive error ${r.status}`);
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  trashed?: boolean;
  thumbnailLink?: string;
}

/*
 * Drive renders a JPEG preview of every photo (HEIC and RAW included). thumbnailLink points at it; the
 * link is signed and lasts a few hours, so it is kept in memory for the session only.
 */
const previewLinks = new Map<string, string>();

/** All pages of a files.list query. */
async function listAll(q: string, orderBy = 'folder,name_natural'): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = '';
  do {
    const params: Record<string, string> = {
      q,
      orderBy,
      pageSize: '1000',
      fields: 'nextPageToken, files(id, name, mimeType, thumbnailLink)',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
    };
    if (pageToken) params.pageToken = pageToken;
    const data = await (await drive('files', params)).json();
    out.push(...data.files);
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const IMAGES_OR_FOLDERS = `(mimeType = '${FOLDER}' or mimeType contains 'image/')`;

function split(files: DriveFile[], chain: string[]) {
  const folders: BrowseFolder[] = [];
  const images: BrowseImage[] = [];
  for (const f of files) {
    names.set(f.id, f.name);
    if (f.thumbnailLink) previewLinks.set(f.id, f.thumbnailLink);
    if (f.mimeType === FOLDER) folders.push({ id: [...chain, f.id].join('/'), name: f.name });
    else images.push({ ref: f.id, name: f.name });
  }
  return { folders, images };
}

async function folderName(id: string): Promise<string> {
  let n = names.get(id);
  if (!n) {
    n = (await (await drive(`files/${id}`, { fields: 'name', supportsAllDrives: 'true' })).json()).name as string;
    names.set(id, n);
  }
  return n;
}

async function download(ref: string): Promise<Blob> {
  const r = await drive(`files/${encodeURIComponent(ref)}`, { alt: 'media', supportsAllDrives: 'true' });
  return r.blob();
}

export const driveSource: PhotoSource & {
  searchFolders(text: string): Promise<BrowseResult>;
} = {
  id: 'gdrive',
  name: 'Google Drive',
  isSupported: () => !!import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim(),

  // Sign-in itself happens in driveAuth (it needs the click); this only reports the result.
  connect: async () => !!currentToken(),

  async browse(folderId?: string): Promise<BrowseResult> {
    if (!folderId) {
      return {
        path: [],
        folders: [
          { id: MY_DRIVE, name: names.get(MY_DRIVE)! },
          { id: SHARED, name: names.get(SHARED)! },
        ],
        images: [],
      };
    }
    const chain = folderId.split('/');
    const current = chain[chain.length - 1];
    const path: BrowseFolder[] = [];
    for (let i = 0; i < chain.length; i++) {
      if (chain[i] === SEARCH) continue;
      path.push({ id: chain.slice(0, i + 1).join('/'), name: await folderName(chain[i]) });
    }
    const q =
      current === SHARED
        ? `sharedWithMe and trashed = false and ${IMAGES_OR_FOLDERS}`
        : `${quote(current)} in parents and trashed = false and ${IMAGES_OR_FOLDERS}`;
    return { path, ...split(await listAll(q), chain) };
  },

  /** Folders whose name contains the text — finds a person's folder by their name. */
  async searchFolders(text: string): Promise<BrowseResult> {
    const q = `mimeType = '${FOLDER}' and trashed = false and name contains ${quote(text.trim())}`;
    const files = await listAll(q, 'name_natural');
    return { path: [], ...split(files, [SEARCH]) };
  },

  async previewUrl(ref, size) {
    let link = previewLinks.get(ref);
    if (!link) {
      const f = await (await drive(`files/${encodeURIComponent(ref)}`, { fields: 'thumbnailLink, trashed', supportsAllDrives: 'true' })).json();
      if (f.trashed) throw new PhotoError('missing', 'Photo is in the Drive trash');
      link = f.thumbnailLink as string | undefined;
      if (!link) return null;
      previewLinks.set(ref, link);
    }
    // The link ends in a size such as "=s220"; ask for the size we need instead.
    return /=s\d+(-c)?$/.test(link) ? link.replace(/=s\d+(-c)?$/, `=s${size}`) : `${link}=s${size}`;
  },

  // Fallback only (no preview available): downloads the original, which can be several MB.
  async getThumbnail(ref) {
    return makeThumbnail(await download(ref));
  },

  getFull: download,

  async isAvailable(ref): Promise<Availability> {
    try {
      const f = await (await drive(`files/${encodeURIComponent(ref)}`, { fields: 'id, trashed', supportsAllDrives: 'true' })).json();
      return f.trashed ? 'missing' : 'ok';
    } catch (err) {
      if (err instanceof PhotoError) return err.kind === 'needs-permission' ? 'needs-permission' : 'missing';
      throw err;
    }
  },
};
