import type { FolderRecord } from '../db';
import type { PhotoRef, SocialLink } from '../types';
import { detectPlatform, validateUrl } from './social';

/*
 * Google Keep → people, from a Google Takeout export (Keep has no API for personal accounts).
 * Takeout writes one JSON file per note into a "Keep" folder, next to the note's attached images.
 * Keep itself is never touched; photos stay in the export folder and are referenced from there.
 */

/** The parts of a Takeout Keep note we use. */
interface KeepNote {
  title?: string;
  textContent?: string;
  listContent?: { text?: string }[];
  labels?: { name?: string }[];
  attachments?: { filePath?: string; mimetype?: string }[];
  annotations?: { url?: string; source?: string }[];
  isTrashed?: boolean;
  isArchived?: boolean;
  isPinned?: boolean;
  createdTimestampUsec?: number;
}

export interface KeepCandidate {
  /** The note's file name, for the preview. */
  file: string;
  name: string;
  photos: PhotoRef[];
  /** Attached images listed in the note but not found in the folder. */
  missingPhotos: number;
  links: SocialLink[];
  notes?: string;
  labels: string[];
  archived: boolean;
  pinned: boolean;
  createdAt?: string;
}

export interface KeepScan {
  folderName: string;
  candidates: KeepCandidate[];
  trashedSkipped: number;
  unreadable: number;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i;
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;

/** Finds the folder holding the notes: the chosen folder itself, or Keep/ or Takeout/Keep/ inside it. */
async function findKeepDir(root: FileSystemDirectoryHandle): Promise<{ dir: FileSystemDirectoryHandle; prefix: string[] }> {
  const tryPath = async (parts: string[]) => {
    let d = root;
    for (const p of parts) d = await d.getDirectoryHandle(p);
    return d;
  };
  for (const parts of [[], ['Keep'], ['Takeout', 'Keep']]) {
    try {
      const dir = await tryPath(parts);
      for await (const e of dir.values()) {
        if (e.kind === 'file' && e.name.endsWith('.json')) return { dir, prefix: parts };
      }
    } catch {
      /* not this layout */
    }
  }
  throw new Error('No Keep notes found. Pick the folder that contains the “Keep” folder from Google Takeout (or the Keep folder itself).');
}

/** Takeout sometimes lists "photo.jpeg" when the file on disk is "photo.jpg"; match on the base name too. */
function resolveFile(listed: string, files: Set<string>, byBase: Map<string, string>): string | undefined {
  const name = listed.split('/').pop()!;
  if (files.has(name)) return name;
  return byBase.get(name.replace(/\.[^.]+$/, '').toLowerCase());
}

function cleanUrl(raw: string): string {
  // Trailing punctuation from prose ("…see instagram.com/x.") isn't part of the link.
  let u = raw.replace(/[.,;:!?]+$/, '');
  // Links must be https here (NFR-05); the big platforms all serve https.
  if (u.startsWith('http://')) u = 'https://' + u.slice(7);
  return u;
}

export async function scanKeepFolder(folder: FolderRecord): Promise<KeepScan> {
  const { dir, prefix } = await findKeepDir(folder.handle);
  const files = new Set<string>();
  const byBase = new Map<string, string>();
  const jsonFiles: FileSystemFileHandle[] = [];
  for await (const e of dir.values()) {
    if (e.kind !== 'file') continue;
    files.add(e.name);
    if (e.name.endsWith('.json')) jsonFiles.push(e as FileSystemFileHandle);
    else if (IMAGE_EXT.test(e.name)) byBase.set(e.name.replace(/\.[^.]+$/, '').toLowerCase(), e.name);
  }

  const refFor = (file: string): PhotoRef => ({ source: 'local', ref: [folder.id, ...prefix, file].join('/') });
  const candidates: KeepCandidate[] = [];
  let trashedSkipped = 0;
  let unreadable = 0;

  for (const fh of jsonFiles) {
    let note: KeepNote;
    try {
      note = JSON.parse(await (await fh.getFile()).text());
    } catch {
      unreadable++;
      continue;
    }
    if (typeof note !== 'object' || note === null || !('textContent' in note || 'title' in note || 'listContent' in note)) {
      continue; // not a note (Takeout also writes other JSON, e.g. Labels)
    }
    if (note.isTrashed) {
      trashedSkipped++;
      continue;
    }

    // Photos
    const photos: PhotoRef[] = [];
    let missingPhotos = 0;
    for (const a of note.attachments ?? []) {
      if (!a.filePath || !(a.mimetype?.startsWith('image/') || IMAGE_EXT.test(a.filePath))) continue;
      const f = resolveFile(a.filePath, files, byBase);
      if (f) photos.push(refFor(f));
      else missingPhotos++;
    }

    // Links: Keep's link previews plus any URL written in the text or checklist
    const text = [note.textContent ?? '', ...(note.listContent ?? []).map((l) => l.text ?? '')].join('\n');
    const urls = [...(note.annotations ?? []).map((a) => a.url ?? ''), ...(text.match(URL_RE) ?? [])].map(cleanUrl);
    const seen = new Set<string>();
    const links: SocialLink[] = [];
    for (const url of urls) {
      const key = url.replace(/\/+$/, '').toLowerCase();
      if (!url || seen.has(key) || validateUrl(url)) continue;
      seen.add(key);
      links.push({ platform: detectPlatform(url) ?? 'website', url });
    }

    // Everything else in the note becomes notes; URLs are already links.
    const lines = text
      .split('\n')
      .map((line) => line.replace(URL_RE, '').trim())
      .filter(Boolean);
    // Untitled note: its first line is the name, so it isn't repeated in the notes.
    const title = note.title?.trim();
    const name = (title || lines[0] || '').slice(0, 120);
    const notes = (title ? lines : lines.slice(1)).join('\n');
    candidates.push({
      file: fh.name,
      name,
      photos,
      missingPhotos,
      links,
      notes: notes || undefined,
      labels: (note.labels ?? []).map((l) => l.name?.trim() ?? '').filter(Boolean),
      archived: !!note.isArchived,
      pinned: !!note.isPinned,
      createdAt: note.createdTimestampUsec ? new Date(note.createdTimestampUsec / 1000).toISOString() : undefined,
    });
  }

  candidates.sort((a, b) => a.name.localeCompare(b.name));
  return { folderName: [folder.name, ...prefix].join(' / '), candidates, trashedSkipped, unreadable };
}
