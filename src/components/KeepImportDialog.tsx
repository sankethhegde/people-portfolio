import { useMemo, useState } from 'react';
import { ExternalLink, FolderOpen, Images, Link2, LoaderCircle, Pin, Search } from 'lucide-react';
import { useData } from '../lib/data';
import { db } from '../db';
import { scanKeepFolder, type KeepCandidate, type KeepScan } from '../lib/keepImport';
import { bulkAddPeople, findOrCreateLabel, labelFullName, newPerson, savePerson, setPinned } from '../lib/store';
import { fsAccessSupported, pickFolder } from '../photos/localSource';
import type { Label, LabelGroup, Person, PhotoRef } from '../types';
import { Modal } from './Modal';
import { useToast } from './Toasts';

const LIST_LIMIT = 400;

/** What a re-import would add to someone already in the directory. */
interface MergeDiff {
  photos: PhotoRef[];
  links: Person['socialLinks'];
  labels: string[];
  notes?: string;
}
const emptyDiff = (d: MergeDiff) => !d.photos.length && !d.links.length && !d.labels.length && !d.notes;

// Local photo refs differ when a new export is unzipped to another folder; the file name doesn't.
const photoId = (p: PhotoRef) => (p.source === 'local' ? `local:${p.ref.split('/').pop()!.toLowerCase()}` : `${p.source}:${p.ref}`);
const linkId = (url: string) => url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

function mergeDiff(
  person: Person,
  c: KeepCandidate,
  labelMap: Map<string, Label>,
  groupMap: Map<string, LabelGroup>,
  withLabels: boolean,
): MergeDiff {
  const havePhotos = new Set([person.photo, ...(person.photos ?? [])].filter((p): p is PhotoRef => !!p).map(photoId));
  const haveLinks = new Set(person.socialLinks.map((l) => linkId(l.url)));
  const haveLabels = new Set(
    person.labelIds.map((id) => labelMap.get(id)).filter((l): l is Label => !!l).map((l) => labelFullName(l, groupMap).toLowerCase()),
  );
  // Only note lines that aren't already in their notes (Keep notes grow over time).
  const haveLines = new Set((person.bio ?? '').split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean));
  const newLines = (c.notes ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !haveLines.has(l.toLowerCase()));
  return {
    photos: c.photos.filter((p) => !havePhotos.has(photoId(p))),
    links: c.links.filter((l) => !haveLinks.has(linkId(l.url))),
    labels: withLabels ? c.labels.filter((n) => !haveLabels.has(n.toLowerCase())) : [],
    notes: newLines.length ? newLines.join('\n') : undefined,
  };
}

function describe(d: MergeDiff): string {
  const parts = [];
  if (d.photos.length) parts.push(`+${d.photos.length} photo${d.photos.length === 1 ? '' : 's'}`);
  if (d.links.length) parts.push(`+${d.links.length} link${d.links.length === 1 ? '' : 's'}`);
  if (d.labels.length) parts.push(`+${d.labels.length} label${d.labels.length === 1 ? '' : 's'}`);
  if (d.notes) parts.push('+notes');
  return parts.join(', ');
}
const NO_LABEL = '\u0000none';

/**
 * Import people from a Google Keep export (Google Takeout). One note = one person:
 * title → name, attached images → photos, links → social links, other text → notes, Keep labels → labels.
 */
export function KeepImportDialog({ onClose }: { onClose: () => void }) {
  const { people, labelMap, groupMap } = useData();
  const toast = useToast();
  const [scan, setScan] = useState<KeepScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unticked, setUnticked] = useState<Set<string>>(() => new Set());
  const [q, setQ] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  const [includeArchived, setIncludeArchived] = useState(true);
  /** People already in the directory: leave them, or add what's new in Keep. */
  const [existingMode, setExistingMode] = useState<'update' | 'skip'>('update');
  const [importLabels, setImportLabels] = useState(true);
  const [copyPins, setCopyPins] = useState(true);
  const [busy, setBusy] = useState(false);

  // Match notes to people by name (first person with that name).
  const byName = useMemo(() => {
    const m = new Map<string, Person>();
    for (const p of people) {
      const k = p.name.trim().toLowerCase();
      if (!m.has(k)) m.set(k, p);
    }
    return m;
  }, [people]);
  const existingOf = (c: KeepCandidate) => byName.get(c.name.toLowerCase());
  const isExisting = (c: KeepCandidate) => !!existingOf(c);
  const diffOf = (c: KeepCandidate) => {
    const p = existingOf(c);
    return p ? mergeDiff(p, c, labelMap, groupMap, importLabels) : undefined;
  };

  async function choose() {
    setError(null);
    const folder = await pickFolder();
    if (!folder) return;
    setScanning(true);
    try {
      const s = await scanKeepFolder(folder);
      setScan(s);
      // Notes without any name can't become people; start them unticked.
      setUnticked(new Set(s.candidates.filter((c) => !c.name).map((c) => c.file)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  const keepLabels = useMemo(() => [...new Set(scan?.candidates.flatMap((c) => c.labels) ?? [])].sort(), [scan]);

  // What the list shows (filters only narrow the view; ticks are kept per note).
  const shown = useMemo(() => {
    if (!scan) return [];
    const term = q.trim().toLowerCase();
    return scan.candidates.filter(
      (c) =>
        (includeArchived || !c.archived) &&
        (!term || c.name.toLowerCase().includes(term)) &&
        (!labelFilter || (labelFilter === NO_LABEL ? c.labels.length === 0 : c.labels.includes(labelFilter))),
    );
  }, [scan, q, labelFilter, includeArchived]);

  // Pinned in Keep, already in the directory, not yet pinned here.
  const pinsForExisting = useMemo(() => {
    if (!scan) return 0;
    const pinnedNames = new Set(scan.candidates.filter((c) => c.pinned).map((c) => c.name.toLowerCase()));
    return people.filter((p) => !p.pinned && pinnedNames.has(p.name.trim().toLowerCase())).length;
  }, [scan, people]);

  const ticked = shown.filter((c) => c.name && !unticked.has(c.file));
  const toImport = ticked.filter((c) => !isExisting(c));
  const toUpdate = existingMode === 'update' ? ticked.filter((c) => isExisting(c) && !emptyDiff(diffOf(c)!)) : [];

  const tickAll = (on: boolean) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      for (const c of shown) if (c.name) (on ? next.delete(c.file) : next.add(c.file));
      return next;
    });

  async function runImport() {
    setBusy(true);
    try {
      // Keep labels → labels here ("Group: Label" names land in a group, as when typed).
      const labelIds = new Map<string, string>();
      if (importLabels) {
        for (const name of new Set([...toImport, ...toUpdate].flatMap((c) => c.labels))) {
          const l = await findOrCreateLabel(name);
          if (l) labelIds.set(name, l.id);
        }
      }
      const created: Person[] = toImport.map((c) => {
        const base = newPerson();
        const [cover, ...rest] = c.photos;
        return {
          ...base,
          name: c.name,
          photo: cover,
          photos: rest.length ? rest : undefined,
          socialLinks: c.links,
          bio: c.notes,
          labelIds: [...new Set(c.labels.map((n) => labelIds.get(n)).filter((id): id is string => !!id))],
          pinned: (copyPins && c.pinned) || undefined,
          createdAt: c.createdAt ?? base.createdAt,
        };
      });
      const undoCreate = created.length ? await bulkAddPeople(created) : undefined;

      // Re-import: add what's new to people already here; keep their old versions for Undo.
      const before: Person[] = [];
      let addedPhotos = 0;
      for (const c of toUpdate) {
        const p = existingOf(c)!;
        const current = (await db.people.get(p.id)) ?? p;
        const d = mergeDiff(current, c, labelMap, groupMap, importLabels);
        if (emptyDiff(d)) continue;
        before.push(current);
        addedPhotos += d.photos.length;
        const [first, ...rest] = d.photos;
        await savePerson({
          ...current,
          photo: current.photo ?? first,
          photos: [...(current.photos ?? []), ...(current.photo ? d.photos : rest)].length
            ? [...(current.photos ?? []), ...(current.photo ? d.photos : rest)]
            : undefined,
          socialLinks: [...current.socialLinks, ...d.links],
          labelIds: [...new Set([...current.labelIds, ...d.labels.map((n) => labelIds.get(n)).filter((id): id is string => !!id)])],
          bio: d.notes ? [current.bio?.trim(), d.notes].filter(Boolean).join('\n') : current.bio,
        });
      }
      const undo =
        undoCreate || before.length
          ? async () => {
              await undoCreate?.();
              if (before.length) await db.people.bulkPut(before);
            }
          : undefined;
      // People imported earlier: copy pins from Keep to them too.
      let pinnedExisting = 0;
      if (copyPins && scan) {
        const pinnedNames = new Set(scan.candidates.filter((c) => c.pinned).map((c) => c.name.toLowerCase()));
        for (const p of people) {
          if (!p.pinned && pinnedNames.has(p.name.trim().toLowerCase())) {
            await setPinned(p.id, true);
            pinnedExisting++;
          }
        }
      }
      onClose();
      const photos = created.reduce((n, p) => n + (p.photo ? 1 : 0) + (p.photos?.length ?? 0), 0);
      const parts = [];
      const n = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
      if (created.length) parts.push(`Imported ${n(created.length, 'person', 'people')} with ${n(photos, 'photo', 'photos')}`);
      if (before.length) parts.push(`updated ${n(before.length, 'person', 'people')} (+${n(addedPhotos, 'photo', 'photos')})`);
      if (pinnedExisting) parts.push(`pinned ${pinnedExisting} already imported`);
      toast(parts.length ? `${parts.join(', ')} from Keep` : 'Nothing to import', undo ? { undo } : undefined);
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Import from Google Keep"
      onClose={onClose}
      wide
      footer={
        scan ? (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={(!toImport.length && !toUpdate.length && !(copyPins && pinsForExisting > 0)) || busy} onClick={runImport}>
              {busy ? <LoaderCircle size={16} className="spin" /> : null}
              {toImport.length || toUpdate.length
                ? [
                    toImport.length && `Import ${toImport.length.toLocaleString()} new`,
                    toUpdate.length && `${toImport.length ? 'update' : 'Update'} ${toUpdate.length.toLocaleString()}`,
                  ]
                    .filter(Boolean)
                    .join(' and ')
                : `Pin ${pinsForExisting} already imported`}
            </button>
          </>
        ) : undefined
      }
    >
      {!scan ? (
        <div className="keep-intro">
          <p>
            Keep stays exactly as it is: Google Takeout makes a <strong>copy</strong> of your notes and their photos, and this imports
            from that copy.
          </p>
          <ol className="keep-steps">
            <li>
              Open{' '}
              <a href="https://takeout.google.com/" target="_blank" rel="noopener noreferrer">
                Google Takeout <ExternalLink size={12} />
              </a>
              , click <strong>Deselect all</strong>, tick only <strong>Keep</strong>, then <strong>Next step → Create export</strong>.
            </li>
            <li>Download the zip when Google emails you (usually a few minutes).</li>
            <li>
              Unzip it into a folder you’ll <strong>keep</strong>, e.g. <code>Pictures\Keep export</code>. The photos are used from
              there, not copied, so don’t delete it afterwards.
            </li>
            <li>Choose that folder below. Each note becomes one person.</li>
            <li>
              <strong>Importing again later?</strong> Unzip the new export into the <em>same</em> folder (replace the files). People already
              here get any new photos, links, labels and notes added; nothing is duplicated.
            </li>
          </ol>
          {fsAccessSupported() ? (
            <button type="button" className="btn btn-primary" onClick={choose} disabled={scanning}>
              {scanning ? <LoaderCircle size={16} className="spin" /> : <FolderOpen size={16} />} {scanning ? 'Reading notes…' : 'Choose the export folder'}
            </button>
          ) : (
            <p className="notice">Importing from Keep needs Chrome or Edge (it reads the export folder directly).</p>
          )}
          {error && <p className="notice notice-error">{error}</p>}
        </div>
      ) : (
        <>
          <p className="muted small">
            From <strong>{scan.folderName}</strong>: {scan.candidates.length.toLocaleString()} notes
            {scan.trashedSkipped > 0 && `, ${scan.trashedSkipped} in Keep’s trash skipped`}
            {scan.unreadable > 0 && `, ${scan.unreadable} unreadable`}.
          </p>
          <div className="keep-filters">
            <div className="search grow">
              <Search size={16} className="search-icon" />
              <input className="input search-input" type="search" placeholder="Find a note" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {keepLabels.length > 0 && (
              <select className="input select" value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} aria-label="Keep label">
                <option value="">All Keep labels</option>
                {keepLabels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
                <option value={NO_LABEL}>No label</option>
              </select>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => tickAll(true)}>
              Tick all shown
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => tickAll(false)}>
              Untick all shown
            </button>
          </div>

          <ul className="keep-list">
            {shown.slice(0, LIST_LIMIT).map((c) => {
              const dup = isExisting(c);
              const diff = dup && existingMode === 'update' ? diffOf(c) : undefined;
              const skipped = !c.name || (dup && (existingMode === 'skip' || emptyDiff(diff!)));
              return (
                <li key={c.file} className={skipped ? 'skipped' : ''}>
                  <label className="keep-row">
                    <input
                      type="checkbox"
                      disabled={skipped}
                      checked={!skipped && !unticked.has(c.file)}
                      onChange={(e) =>
                        setUnticked((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.delete(c.file);
                          else next.add(c.file);
                          return next;
                        })
                      }
                    />
                    <span className="keep-name">{c.name || <em className="muted">(no name)</em>}</span>
                    <span className="keep-meta">
                      {c.photos.length > 0 && (
                        <span title="Photos">
                          <Images size={13} /> {c.photos.length}
                        </span>
                      )}
                      {c.links.length > 0 && (
                        <span title={c.links.map((l) => l.url).join('\n')}>
                          <Link2 size={13} /> {c.links.length}
                        </span>
                      )}
                      {c.missingPhotos > 0 && <span className="warn" title="Listed in the note but not in the export folder">{c.missingPhotos} photo missing</span>}
                      {c.labels.map((l) => (
                        <span key={l} className="keep-label">
                          {l}
                        </span>
                      ))}
                      {c.pinned && (
                        <span title="Pinned in Keep">
                          <Pin size={13} />
                        </span>
                      )}
                      {c.archived && <span className="muted">archived</span>}
                      {dup &&
                        (diff && !emptyDiff(diff) ? (
                          <span className="keep-update" title="Already here; these will be added">
                            update: {describe(diff)}
                          </span>
                        ) : (
                          <span className="muted">{existingMode === 'update' ? 'already up to date' : 'already added'}</span>
                        ))}
                    </span>
                  </label>
                </li>
              );
            })}
            {shown.length > LIST_LIMIT && <li className="muted small">…and {(shown.length - LIST_LIMIT).toLocaleString()} more (use the search to find them)</li>}
            {shown.length === 0 && <li className="muted">No notes match.</li>}
          </ul>

          <div className="keep-options">
            <span className="keep-mode" role="radiogroup" aria-label="People already in the directory">
              People already here:
              <label>
                <input type="radio" checked={existingMode === 'update'} onChange={() => setExistingMode('update')} /> add what’s new in Keep
              </label>
              <label>
                <input type="radio" checked={existingMode === 'skip'} onChange={() => setExistingMode('skip')} /> skip
              </label>
            </span>
            <label>
              <input type="checkbox" checked={importLabels} onChange={(e) => setImportLabels(e.target.checked)} /> Bring Keep labels over as labels
            </label>
            <label>
              <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> Include archived notes
            </label>
            <label>
              <input type="checkbox" checked={copyPins} onChange={(e) => setCopyPins(e.target.checked)} /> Pin people pinned in Keep
              {pinsForExisting > 0 && ` (incl. ${pinsForExisting} already imported)`}
            </label>
          </div>
        </>
      )}
    </Modal>
  );
}
