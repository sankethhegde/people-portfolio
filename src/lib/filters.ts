import type { MatchMode, Person, PhotoFilter, PhotoRef, SortKey } from '../types';

export interface FilterState {
  q: string;
  labelIds: string[];
  mode: MatchMode;
  sort: SortKey;
  /** Only people whose photo is known to be missing. */
  missingOnly: boolean;
  /** Has any photo / has none. */
  photos: PhotoFilter;
}

export const DEFAULT_FILTERS: FilterState = { q: '', labelIds: [], mode: 'any', sort: 'name-asc', missingOnly: false, photos: 'any' };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function applyFilters(
  people: Person[],
  f: FilterState,
  isMissing: (p: PhotoRef) => boolean = () => false,
  /** Photo count per person (cover + picked + linked folder when known). */
  countOf: (p: Person) => number = (p) => (p.photo ? 1 : 0) + (p.photos?.length ?? 0),
  /** True when the person's linked folder hasn't been counted yet. */
  folderUncounted: (p: Person) => boolean = (p) => !!p.folder,
): Person[] {
  // Someone with a linked folder whose size isn't known yet is treated as having photos.
  const hasPhotos = (p: Person) => countOf(p) > 0 || folderUncounted(p);
  const terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const wanted = f.labelIds;
  const out = people.filter((p) => {
    if (f.missingOnly && !(p.photo && isMissing(p.photo))) return false;
    if (f.photos === 'with' && !hasPhotos(p)) return false;
    if (f.photos === 'without' && hasPhotos(p)) return false;
    if (terms.length) {
      const hay = `${p.name} ${p.bio ?? ''}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    if (wanted.length) {
      const has = (id: string) => p.labelIds.includes(id);
      if (f.mode === 'all' ? !wanted.every(has) : !wanted.some(has)) return false;
    }
    return true;
  });
  // Count once per person, not once per comparison.
  const counts = new Map<Person, number>();
  if (f.sort.startsWith('photos')) for (const p of out) counts.set(p, countOf(p));
  const byChosenSort = {
    'name-asc': (a: Person, b: Person) => collator.compare(a.name, b.name),
    'name-desc': (a: Person, b: Person) => collator.compare(b.name, a.name),
    'added-desc': (a: Person, b: Person) => b.createdAt.localeCompare(a.createdAt),
    'added-asc': (a: Person, b: Person) => a.createdAt.localeCompare(b.createdAt),
    'photos-desc': (a: Person, b: Person) => counts.get(b)! - counts.get(a)! || collator.compare(a.name, b.name),
    'photos-asc': (a: Person, b: Person) => counts.get(a)! - counts.get(b)! || collator.compare(a.name, b.name),
  }[f.sort];
  // Pinned people first, each group in the chosen order.
  return out.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || byChosenSort(a, b));
}

// ---- URL sync (FR-43): ?q=…&labels=id,id&match=all&sort=…&missing=1 ----
const SORTS: SortKey[] = ['name-asc', 'name-desc', 'added-desc', 'added-asc', 'photos-desc', 'photos-asc'];

export function readFiltersFromUrl(): FilterState {
  const s = new URLSearchParams(location.search);
  const sort = s.get('sort') as SortKey;
  return {
    q: s.get('q') ?? '',
    labelIds: (s.get('labels') ?? '').split(',').filter(Boolean),
    mode: s.get('match') === 'all' ? 'all' : 'any',
    sort: SORTS.includes(sort) ? sort : DEFAULT_FILTERS.sort,
    missingOnly: s.get('missing') === '1',
    photos: s.get('photos') === 'with' ? 'with' : s.get('photos') === 'without' ? 'without' : 'any',
  };
}

export function writeFiltersToUrl(f: FilterState) {
  const s = new URLSearchParams();
  if (f.q) s.set('q', f.q);
  if (f.labelIds.length) s.set('labels', f.labelIds.join(','));
  if (f.mode === 'all' && f.labelIds.length > 1) s.set('match', 'all');
  if (f.sort !== DEFAULT_FILTERS.sort) s.set('sort', f.sort);
  if (f.missingOnly) s.set('missing', '1');
  if (f.photos !== 'any') s.set('photos', f.photos);
  const qs = s.toString();
  const url = location.pathname + (qs ? `?${qs}` : '') + location.hash;
  if (url !== location.pathname + location.search + location.hash) history.replaceState(null, '', url);
}
