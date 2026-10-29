export type PhotoSourceId = 'local' | 'gdrive' | 'server';

/** A photo is always a reference into a source, never a copied file. */
export interface PhotoRef {
  source: PhotoSourceId;
  /** Drive file ID, local `<folderId>/<relative path>` (or `idb:<blobId>`), or server ID. */
  ref: string;
}

export type SocialPlatform =
  | 'instagram'
  | 'reddit'
  | 'linkedin'
  | 'x'
  | 'facebook'
  | 'youtube'
  | 'github'
  | 'website'
  | 'other';

export interface SocialLink {
  platform: SocialPlatform;
  url: string;
  /** Display name for `other` links, e.g. "Behance". */
  title?: string;
}

/** A folder whose photos show in a person's gallery, read live from the source. */
export interface LinkedFolder {
  source: PhotoSourceId;
  /** The id the source's browse() takes. */
  folderId: string;
  name: string;
}

export interface Person {
  id: string;
  name: string;
  /** Cover photo: shown on the card and first in the gallery. */
  photo?: PhotoRef;
  /** Extra photos picked one by one (never includes the cover). */
  photos?: PhotoRef[];
  /** Optional linked folder; its photos join the gallery automatically. */
  folder?: LinkedFolder;
  /** Photo shown as the background of this person's right-hand panel. */
  panelBg?: PhotoRef;
  /** Marked photos, shown small at the bottom of the panel, in the order they were marked. */
  marked?: PhotoRef[];
  labelIds: string[];
  socialLinks: SocialLink[];
  /** Pinned people always come first in the grid. */
  pinned?: boolean;
  bio?: string;
  /** No longer shown or edited; kept so older data and exports still load. */
  location?: string;
  nationality?: string;
  /** Stored as a birth year (worked out from the age entered) so the age shown stays current. */
  birthYear?: number;
  /** No longer shown or edited; kept so older data and exports still load. */
  email?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LabelGroup {
  id: string;
  name: string;
  order: number;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  /** Labels without a group are listed as "Ungrouped". */
  groupId?: string;
}

/** Export file shape — also the personal server's API contract in v2. */
export interface ExportFile {
  app: 'people-portfolio';
  version: 1;
  exportedAt: string;
  labelGroups: LabelGroup[];
  labels: Label[];
  people: Person[];
}

export type SortKey = 'name-asc' | 'name-desc' | 'added-desc' | 'added-asc' | 'photos-desc' | 'photos-asc';
/** Filter by whether a person has any photo. */
export type PhotoFilter = 'any' | 'with' | 'without';
export type MatchMode = 'any' | 'all';
