import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useMemo } from 'react';
import { db } from '../db';
import type { Label, LabelGroup, Person } from '../types';

export interface AppData {
  loaded: boolean;
  people: Person[];
  labels: Label[];
  groups: LabelGroup[];
  labelMap: Map<string, Label>;
  groupMap: Map<string, LabelGroup>;
  /** Number of people carrying each label id. */
  labelCounts: Map<string, number>;
}

const EMPTY: never[] = [];

export function useAppDataQuery(): AppData {
  const people = useLiveQuery(() => db.people.toArray());
  const labels = useLiveQuery(() => db.labels.toArray());
  const groups = useLiveQuery(() => db.groups.orderBy('order').toArray());

  return useMemo(() => {
    const labelCounts = new Map<string, number>();
    for (const p of people ?? EMPTY) for (const id of p.labelIds) labelCounts.set(id, (labelCounts.get(id) ?? 0) + 1);
    return {
      loaded: people !== undefined && labels !== undefined && groups !== undefined,
      people: people ?? EMPTY,
      labels: labels ?? EMPTY,
      groups: groups ?? EMPTY,
      labelMap: new Map((labels ?? EMPTY).map((l) => [l.id, l])),
      groupMap: new Map((groups ?? EMPTY).map((g) => [g.id, g])),
      labelCounts,
    };
  }, [people, labels, groups]);
}

export const DataContext = createContext<AppData | null>(null);

export function useData(): AppData {
  const d = useContext(DataContext);
  if (!d) throw new Error('useData outside DataContext');
  return d;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Labels grouped for display: groups in their order, then "Ungrouped". Labels sorted by name. */
export function groupedLabels(labels: Label[], groups: LabelGroup[]) {
  const out: { group?: LabelGroup; labels: Label[] }[] = groups.map((g) => ({ group: g, labels: [] }));
  const idx = new Map(groups.map((g, i) => [g.id, i]));
  const ungrouped: Label[] = [];
  for (const l of labels) {
    const i = l.groupId ? idx.get(l.groupId) : undefined;
    if (i === undefined) ungrouped.push(l);
    else out[i].labels.push(l);
  }
  if (ungrouped.length) out.push({ labels: ungrouped });
  for (const g of out) g.labels.sort((a, b) => collator.compare(a.name, b.name));
  return out;
}
