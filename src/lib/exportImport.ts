import { db, nowIso, setMeta } from '../db';
import type { ExportFile, Label, LabelGroup, Person, PhotoSourceId, SocialPlatform } from '../types';
import { PLATFORMS } from './social';

export const LAST_EXPORT_KEY = 'lastExportAt';

export async function buildExport(): Promise<ExportFile> {
  const [labelGroups, labels, people] = await Promise.all([
    db.groups.orderBy('order').toArray(),
    db.labels.toArray(),
    db.people.orderBy('name').toArray(),
  ]);
  return { app: 'people-portfolio', version: 1, exportedAt: nowIso(), labelGroups, labels, people };
}

export async function downloadExport() {
  const data = await buildExport();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `people-${data.exportedAt.slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  await setMeta(LAST_EXPORT_KEY, data.exportedAt);
  return data;
}

// ---------------- validation (NFR-09: validate before writing) ----------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => v === undefined || isStr(v);
const SOURCES: PhotoSourceId[] = ['local', 'gdrive', 'server'];
const PLATFORM_IDS = PLATFORMS.map((p) => p.id) as string[];

/** Parses and checks an export file. Throws an Error whose message is shown to the user. */
export function parseImport(text: string): ExportFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file isn’t valid JSON.');
  }
  if (!isObj(data) || data.app !== 'people-portfolio') throw new Error('This isn’t a People export file.');
  if (data.version !== 1) throw new Error(`Unsupported export version: ${String(data.version)}.`);
  const { labelGroups, labels, people } = data;
  if (!Array.isArray(labelGroups) || !Array.isArray(labels) || !Array.isArray(people)) {
    throw new Error('The file is missing people, labels or label groups.');
  }

  const fail = (what: string, i: number, why: string): never => {
    throw new Error(`${what} #${i + 1} is invalid: ${why}.`);
  };

  labelGroups.forEach((g, i) => {
    if (!isObj(g) || !isStr(g.id) || !isStr(g.name) || typeof g.order !== 'number') fail('Label group', i, 'needs id, name and order');
  });
  const groupIds = new Set((labelGroups as LabelGroup[]).map((g) => g.id));

  labels.forEach((l, i) => {
    if (!isObj(l) || !isStr(l.id) || !isStr(l.name) || !isStr(l.color)) fail('Label', i, 'needs id, name and color');
    const lab = l as unknown as Label;
    if (!/^#[0-9a-f]{6}$/i.test(lab.color)) fail('Label', i, 'color must be a hex like #4f46e5');
    if (lab.groupId !== undefined && !groupIds.has(lab.groupId)) fail('Label', i, 'refers to a missing group');
  });
  const labelIds = new Set((labels as Label[]).map((l) => l.id));

  people.forEach((p, i) => {
    if (!isObj(p) || !isStr(p.id) || !isStr(p.name) || !p.name.trim()) fail('Person', i, 'needs id and name');
    const per = p as unknown as Person;
    if (!Array.isArray(per.labelIds) || !per.labelIds.every((id) => labelIds.has(id))) fail('Person', i, 'has unknown labels');
    if (!Array.isArray(per.socialLinks)) fail('Person', i, 'socialLinks must be a list');
    per.socialLinks.forEach((s) => {
      if (!isObj(s) || !PLATFORM_IDS.includes(s.platform as SocialPlatform) || !isStr(s.url) || !s.url.startsWith('https://')) {
        fail('Person', i, `has a bad social link (${JSON.stringify(s)})`);
      }
    });
    if (per.pinned !== undefined && typeof per.pinned !== 'boolean') fail('Person', i, 'pinned must be true or false');
    const isRef = (r: unknown) => isObj(r) && SOURCES.includes(r.source as PhotoSourceId) && isStr(r.ref);
    if (per.photo !== undefined && !isRef(per.photo)) fail('Person', i, 'has a bad photo reference');
    if (per.photos !== undefined && (!Array.isArray(per.photos) || !per.photos.every(isRef))) fail('Person', i, 'has a bad photo list');
    if (per.marked !== undefined && (!Array.isArray(per.marked) || !per.marked.every(isRef))) fail('Person', i, 'has a bad marked-photo list');
    if (per.panelBg !== undefined && !isRef(per.panelBg)) fail('Person', i, 'has a bad panel background');
    if (
      per.folder !== undefined &&
      (!isObj(per.folder) || !SOURCES.includes(per.folder.source) || !isStr(per.folder.folderId) || !isStr(per.folder.name))
    ) {
      fail('Person', i, 'has a bad linked folder');
    }
    if (!optStr(per.bio) || !optStr(per.location) || !optStr(per.email) || !optStr(per.nationality)) {
      fail('Person', i, 'bio, location, nationality and email must be text');
    }
    if (per.birthYear !== undefined && !(Number.isInteger(per.birthYear) && per.birthYear > 1850 && per.birthYear <= new Date().getFullYear())) {
      fail('Person', i, 'birthYear must be a year');
    }
    if (!isStr(per.createdAt) || !isStr(per.updatedAt)) fail('Person', i, 'needs createdAt and updatedAt');
  });

  return data as unknown as ExportFile;
}

export type ImportMode = 'merge' | 'replace';

/** Writes the import and returns an undo function that restores the previous data exactly. */
export async function applyImport(file: ExportFile, mode: ImportMode): Promise<() => Promise<void>> {
  const snapshot = await buildExport();
  await db.transaction('rw', db.people, db.labels, db.groups, async () => {
    if (mode === 'replace') {
      await Promise.all([db.people.clear(), db.labels.clear(), db.groups.clear()]);
    }
    await db.groups.bulkPut(file.labelGroups);
    await db.labels.bulkPut(file.labels);
    await db.people.bulkPut(file.people);
  });
  return () => restore(snapshot);
}

async function restore(snapshot: ExportFile) {
  await db.transaction('rw', db.people, db.labels, db.groups, async () => {
    await Promise.all([db.people.clear(), db.labels.clear(), db.groups.clear()]);
    await db.groups.bulkPut(snapshot.labelGroups);
    await db.labels.bulkPut(snapshot.labels);
    await db.people.bulkPut(snapshot.people);
  });
}

/** Clears people, labels and groups (folders and the thumbnail cache stay). Returns undo. */
export async function clearAllData(): Promise<() => Promise<void>> {
  const snapshot = await buildExport();
  await db.transaction('rw', db.people, db.labels, db.groups, async () => {
    await Promise.all([db.people.clear(), db.labels.clear(), db.groups.clear()]);
  });
  return () => restore(snapshot);
}
