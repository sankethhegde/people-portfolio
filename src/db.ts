import Dexie, { type Table } from 'dexie';
import type { Label, LabelGroup, Person } from './types';

/** A connected local folder (File System Access API handle survives in IndexedDB). */
export interface FolderRecord {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  addedAt: string;
}

/** Fallback storage for browsers without the File System Access API. */
export interface BlobRecord {
  id: string;
  name: string;
  blob: Blob;
}

/** Thumbnail cache, keyed by `${source}:${ref}`. */
export interface ThumbRecord {
  key: string;
  blob: Blob;
  cachedAt: number;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

class PeopleDB extends Dexie {
  people!: Table<Person, string>;
  labels!: Table<Label, string>;
  groups!: Table<LabelGroup, string>;
  folders!: Table<FolderRecord, string>;
  blobs!: Table<BlobRecord, string>;
  thumbs!: Table<ThumbRecord, string>;
  meta!: Table<MetaRecord, string>;

  constructor() {
    super('people-portfolio');
    this.version(1).stores({
      people: 'id, name, createdAt, updatedAt, *labelIds',
      labels: 'id, name, groupId',
      groups: 'id, name, order',
      folders: 'id',
      blobs: 'id',
      thumbs: 'key',
      meta: 'key',
    });
  }
}

export const db = new PeopleDB();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
