import { db, nowIso, uid } from '../db';
import type { Label, LabelGroup, Person, PhotoRef } from '../types';
import { pickColor } from './colors';

const norm = (s: string) => s.trim().replace(/\s+/g, ' ');
const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;

// ---------------- people ----------------

/** Age today from a stored birth year (may be one high before the birthday, as only the year is known). */
export const ageFromBirthYear = (year: number) => new Date().getFullYear() - year;

export function newPerson(): Person {
  const t = nowIso();
  return { id: uid(), name: '', labelIds: [], socialLinks: [], createdAt: t, updatedAt: t };
}

export async function savePerson(p: Person) {
  await db.people.put({ ...p, name: norm(p.name), updatedAt: nowIso() });
}

const refKey = (p: PhotoRef) => `${p.source}:${p.ref}`;

/**
 * Makes `ref` the cover. The old cover stays in the gallery as a picked photo, unless the linked
 * folder already shows it (it would appear twice otherwise).
 */
export function withCover(person: Person, ref: PhotoRef, folderImages: PhotoRef[]): Pick<Person, 'photo' | 'photos'> {
  const inFolder = new Set(folderImages.map(refKey));
  const rest = (person.photos ?? []).filter((p) => refKey(p) !== refKey(ref));
  const old = person.photo && refKey(person.photo) !== refKey(ref) && !inFolder.has(refKey(person.photo)) ? [person.photo] : [];
  return { photo: ref, photos: [...old, ...rest] };
}

/** Sets the cover straight away (from the photo view). Returns undo. */
export async function setCoverPhoto(person: Person, ref: PhotoRef, folderImages: PhotoRef[]): Promise<() => Promise<void>> {
  const before = { photo: person.photo, photos: person.photos };
  await savePerson({ ...person, ...withCover(person, ref, folderImages) });
  return async () => {
    const current = await db.people.get(person.id);
    if (current) await savePerson({ ...current, ...before });
  };
}

/** Sets (or clears, with undefined) the panel background photo. Returns undo. */
export async function setPanelBackground(person: Person, ref: PhotoRef | undefined): Promise<() => Promise<void>> {
  const before = person.panelBg;
  await db.people.update(person.id, { panelBg: ref });
  return async () => {
    await db.people.update(person.id, { panelBg: before });
  };
}

/** Marks or unmarks one photo (newest last). Doesn't touch updatedAt. Returns the new state and undo. */
export async function toggleMarked(person: Person, ref: PhotoRef): Promise<{ marked: boolean; undo: () => Promise<void> }> {
  const before = (await db.people.get(person.id))?.marked ?? [];
  const had = before.some((p) => refKey(p) === refKey(ref));
  const next = had ? before.filter((p) => refKey(p) !== refKey(ref)) : [...before, ref];
  await db.people.update(person.id, { marked: next.length ? next : undefined });
  return {
    marked: !had,
    undo: async () => {
      await db.people.update(person.id, { marked: before.length ? before : undefined });
    },
  };
}

/** Pins or unpins without touching updatedAt (it isn't an edit to the person). */
export async function setPinned(id: string, pinned: boolean) {
  await db.people.update(id, { pinned: pinned || undefined });
}

/** Deletes and returns an undo function. */
export async function deletePerson(id: string): Promise<() => Promise<void>> {
  const before = await db.people.get(id);
  await db.people.delete(id);
  return async () => {
    if (before) await db.people.put(before);
  };
}

// ---------------- label groups ----------------

export async function findOrCreateGroup(name: string): Promise<LabelGroup> {
  const n = norm(name);
  const existing = (await db.groups.toArray()).find((g) => same(g.name, n));
  if (existing) return existing;
  const order = (await db.groups.count()) + 1;
  const g: LabelGroup = { id: uid(), name: n, order };
  await db.groups.add(g);
  return g;
}

export async function renameGroup(id: string, name: string) {
  const n = norm(name);
  if (!n) throw new Error('Group name can’t be empty');
  const clash = (await db.groups.toArray()).find((g) => g.id !== id && same(g.name, n));
  if (clash) throw new Error(`A group called “${clash.name}” already exists`);
  await db.groups.update(id, { name: n });
}

/** Deleting a group keeps its labels; they become ungrouped. */
export async function deleteGroup(id: string) {
  await db.transaction('rw', db.groups, db.labels, async () => {
    await db.labels.where('groupId').equals(id).modify((l) => {
      delete l.groupId;
    });
    await db.groups.delete(id);
  });
}

// ---------------- labels ----------------

/**
 * Parses "Group: Label" or "Label" and returns the existing label or a newly created one.
 * Label names are unique within their group.
 */
export async function findOrCreateLabel(input: string): Promise<Label | null> {
  const raw = norm(input);
  if (!raw) return null;
  let groupId: string | undefined;
  let name = raw;
  const colon = raw.indexOf(':');
  if (colon > 0 && colon < raw.length - 1) {
    const groupName = norm(raw.slice(0, colon));
    name = norm(raw.slice(colon + 1));
    if (groupName && name) groupId = (await findOrCreateGroup(groupName)).id;
    else name = raw;
  }
  const existing = (await db.labels.toArray()).find((l) => l.groupId === groupId && same(l.name, name));
  if (existing) return existing;
  const label: Label = { id: uid(), name, color: pickColor(`${groupId ?? ''}/${name}`), groupId };
  await db.labels.add(label);
  return label;
}

export async function updateLabel(id: string, changes: Partial<Pick<Label, 'name' | 'color' | 'groupId'>>) {
  const current = await db.labels.get(id);
  if (!current) return;
  const next = { ...current, ...changes };
  next.name = norm(next.name);
  if (!next.name) throw new Error('Label name can’t be empty');
  const clash = (await db.labels.toArray()).find(
    (l) => l.id !== id && l.groupId === next.groupId && same(l.name, next.name),
  );
  if (clash) throw new Error(`“${clash.name}” already exists in that group`);
  if (!next.groupId) delete next.groupId;
  await db.labels.put(next);
}

/** Removes the label everywhere. Returns an undo function. */
export async function deleteLabel(id: string): Promise<() => Promise<void>> {
  const label = await db.labels.get(id);
  const affected = await db.people.where('labelIds').equals(id).toArray();
  await db.transaction('rw', db.labels, db.people, async () => {
    await db.people.where('labelIds').equals(id).modify((p) => {
      p.labelIds = p.labelIds.filter((x) => x !== id);
    });
    await db.labels.delete(id);
  });
  return async () => {
    await db.transaction('rw', db.labels, db.people, async () => {
      if (label) await db.labels.put(label);
      await db.people.bulkPut(affected);
    });
  };
}

/** "Group: Name" for display in inputs and filters. */
export function labelFullName(label: Label, groups: Map<string, LabelGroup>) {
  const g = label.groupId ? groups.get(label.groupId) : undefined;
  return g ? `${g.name}: ${label.name}` : label.name;
}

/** Moves every person from `fromId` to `intoId`, then deletes `fromId`. Returns undo. */
export async function mergeLabel(fromId: string, intoId: string): Promise<() => Promise<void>> {
  if (fromId === intoId) throw new Error('Pick a different label to merge into');
  const from = await db.labels.get(fromId);
  const affected = await db.people.where('labelIds').equals(fromId).toArray();
  await db.transaction('rw', db.labels, db.people, async () => {
    await db.people.where('labelIds').equals(fromId).modify((p) => {
      p.labelIds = [...new Set(p.labelIds.map((id) => (id === fromId ? intoId : id)))];
    });
    await db.labels.delete(fromId);
  });
  return async () => {
    await db.transaction('rw', db.labels, db.people, async () => {
      if (from) await db.labels.put(from);
      await db.people.bulkPut(affected);
    });
  };
}

// ---------------- bulk ----------------

/** Adds or removes one label on many people. Returns the number changed and an undo. */
export async function bulkSetLabel(
  personIds: string[],
  labelId: string,
  add: boolean,
): Promise<{ changed: number; undo: () => Promise<void> }> {
  const before = (await db.people.bulkGet(personIds)).filter((p): p is Person => !!p);
  const changedPeople = before.filter((p) => p.labelIds.includes(labelId) !== add);
  const t = nowIso();
  await db.people.bulkPut(
    changedPeople.map((p) => ({
      ...p,
      labelIds: add ? [...p.labelIds, labelId] : p.labelIds.filter((id) => id !== labelId),
      updatedAt: t,
    })),
  );
  return {
    changed: changedPeople.length,
    undo: async () => {
      await db.people.bulkPut(changedPeople);
    },
  };
}

export async function bulkDeletePeople(ids: string[]): Promise<() => Promise<void>> {
  const before = (await db.people.bulkGet(ids)).filter((p): p is Person => !!p);
  await db.people.bulkDelete(ids);
  return async () => {
    await db.people.bulkPut(before);
  };
}

/** Creates people in one go (bulk add). Returns undo. */
export async function bulkAddPeople(people: Person[]): Promise<() => Promise<void>> {
  await db.people.bulkAdd(people);
  const ids = people.map((p) => p.id);
  return async () => {
    await db.people.bulkDelete(ids);
  };
}
