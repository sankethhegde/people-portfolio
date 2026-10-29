import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Cloud, Folder, FolderPlus, HardDrive, LoaderCircle, Lock, Search } from 'lucide-react';
import { useData } from '../lib/data';
import { bulkAddPeople, newPerson } from '../lib/store';
import { retryPhotos, sources } from '../photos';
import { signIn, useDriveAuth } from '../photos/driveAuth';
import { driveSource } from '../photos/driveSource';
import { fsAccessSupported, requestFolderAccess } from '../photos/localSource';
import { PhotoError, type BrowseResult } from '../photos/PhotoSource';
import type { Person, PhotoSourceId } from '../types';
import { LabelInput } from './LabelInput';
import { Modal } from './Modal';
import { useToast } from './Toasts';

/*
 * FR-24 bulk add. Two ways to read a folder:
 * - one person per subfolder: folder name = person, first image inside = photo (fits "a folder per person")
 * - one person per photo: file name (without extension) = person
 */

type Mode = 'subfolders' | 'photos';

interface Candidate {
  name: string;
  photoRef?: string;
  /** Subfolder mode: the person's own folder, linked so all its photos show. */
  folder?: { id: string; name: string };
  exists: boolean;
}

const PREVIEW_LIMIT = 200;
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const SCAN_CONCURRENCY = 4;

/** "asha_rao-2024.jpg" → "asha rao 2024" */
export function nameFromFile(file: string) {
  return file.replace(/\.[^.]+$/, '').replace(/[_.\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function BulkAddDialog({ onClose }: { onClose: () => void }) {
  const { people } = useData();
  const toast = useToast();
  const auth = useDriveAuth();
  const [source, setSource] = useState<PhotoSourceId>('local');
  const [folderId, setFolderId] = useState<string>();
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>('subfolders');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [scanProgress, setScanProgress] = useState<string | null>(null);
  const [skipExisting, setSkipExisting] = useState(true);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [linkFolders, setLinkFolders] = useState(true);

  const existingNames = useMemo(() => new Set(people.map((p) => p.name.trim().toLowerCase())), [people]);

  const open = useCallback(
    async (id?: string, src: PhotoSourceId = source) => {
      setLoading(true);
      setError(null);
      setCandidates(null);
      try {
        const r = await sources[src].browse(id);
        setResult(r);
        setFolderId(id);
        // Default to the mode that fits what's inside.
        if (id) setMode(r.folders.length ? 'subfolders' : 'photos');
      } catch (e) {
        if (!(e instanceof PhotoError && e.kind === 'needs-permission')) setError((e as Error).message);
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [source],
  );

  useEffect(() => {
    if (source === 'local' || auth.signedIn) open(undefined, source);
    else setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, auth.signedIn]);

  async function searchDrive() {
    if (!searchText.trim()) return open(undefined);
    setLoading(true);
    setCandidates(null);
    try {
      setResult(await driveSource.searchFolders(searchText));
      setFolderId(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function scan() {
    if (!result) return;
    const out: Candidate[] = [];
    const mark = (name: string, photoRef?: string) => out.push({ name, photoRef, exists: existingNames.has(name.toLowerCase()) });
    if (mode === 'photos') {
      for (const img of result.images) mark(nameFromFile(img.name), img.ref);
    } else {
      const folders = result.folders;
      const found = new Array<Candidate | undefined>(folders.length);
      let next = 0;
      let done = 0;
      setScanProgress(`Reading folders… 0 / ${folders.length}`);
      const worker = async () => {
        while (next < folders.length) {
          const i = next++;
          const f = folders[i];
          let first: string | undefined;
          try {
            first = (await sources[source].browse(f.id)).images[0]?.ref;
          } catch {
            first = undefined; // unreadable folder: still add the person, without a photo
          }
          const name = f.name.trim();
          found[i] = { name, photoRef: first, folder: { id: f.id, name: f.name }, exists: existingNames.has(name.toLowerCase()) };
          setScanProgress(`Reading folders… ${++done} / ${folders.length}`);
        }
      };
      await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
      out.push(...found.filter((c): c is Candidate => !!c));
      setScanProgress(null);
    }
    setCandidates(out.filter((c) => c.name));
  }

  const toAdd = candidates?.filter((c) => !(skipExisting && c.exists)) ?? [];

  async function add() {
    const people: Person[] = toAdd.map((c) => ({
      ...newPerson(),
      name: c.name,
      labelIds,
      photo: c.photoRef ? { source, ref: c.photoRef } : undefined,
      folder: linkFolders && c.folder ? { source, folderId: c.folder.id, name: c.folder.name } : undefined,
    }));
    const undo = await bulkAddPeople(people);
    onClose();
    toast(`Added ${people.length.toLocaleString()} people`, { undo });
  }

  const connectDrive = async () => {
    try {
      if (await signIn()) retryPhotos();
    } catch (e) {
      toast((e as Error).message, { kind: 'error' });
    }
  };

  const insideFolder = !!folderId && !!result && !result.needsPermission;

  return (
    <Modal
      title="Bulk add people"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!toAdd.length} onClick={add}>
            Add {toAdd.length ? toAdd.length.toLocaleString() : ''} {toAdd.length === 1 ? 'person' : 'people'}
          </button>
        </>
      }
    >
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={source === 'local'} className={`tab ${source === 'local' ? 'tab-active' : ''}`} onClick={() => setSource('local')}>
          <HardDrive size={16} /> Local folder
        </button>
        {auth.configured && (
          <button type="button" role="tab" aria-selected={source === 'gdrive'} className={`tab ${source === 'gdrive' ? 'tab-active' : ''}`} onClick={() => setSource('gdrive')}>
            <Cloud size={16} /> Google Drive
          </button>
        )}
      </div>

      {source === 'gdrive' && !auth.signedIn ? (
        <div className="empty-state small">
          <p>Sign in to read folders from Google Drive.</p>
          <button type="button" className="btn btn-primary" onClick={connectDrive} disabled={auth.busy}>
            <Cloud size={16} /> {auth.account?.email ? `Continue as ${auth.account.email}` : 'Sign in with Google'}
          </button>
        </div>
      ) : (
        <>
          <p className="hint bulk-step">1. Open the folder that holds your people.</p>
          <div className="picker-bar">
            <nav className="crumbs" aria-label="Folder path">
              <button type="button" className="crumb" onClick={() => open(undefined)}>
                {source === 'local' ? 'Folders' : 'Drive'}
              </button>
              {result?.path.map((p) => (
                <span key={p.id} className="crumb-wrap">
                  <ChevronRight size={14} className="muted" />
                  <button type="button" className="crumb" onClick={() => open(p.id)}>
                    {p.name}
                  </button>
                </span>
              ))}
            </nav>
            {source === 'local' && fsAccessSupported() && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  if (await sources.local.connect()) open(undefined);
                }}
              >
                <FolderPlus size={15} /> Connect folder
              </button>
            )}
            {source === 'gdrive' && (
              <form
                className="row-gap"
                onSubmit={(e) => {
                  e.preventDefault();
                  searchDrive();
                }}
              >
                <div className="search">
                  <Search size={16} className="search-icon" />
                  <input className="input search-input" type="search" placeholder="Find a folder" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
                </div>
              </form>
            )}
          </div>

          {error && <p className="notice notice-error">{error}</p>}
          {loading && (
            <div className="empty-state small">
              <LoaderCircle size={24} className="spin" />
            </div>
          )}
          {!loading && result?.needsPermission && (
            <div className="empty-state small">
              <Lock size={24} />
              <p>The browser needs your permission again to read this folder.</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const root = folderId?.split('/')[0];
                  if (root && (await requestFolderAccess(root))) open(folderId);
                }}
              >
                Allow access
              </button>
            </div>
          )}
          {!loading && result && !result.needsPermission && !candidates && (
            <>
              <div className="bulk-folders">
                {result.folders.map((f) => (
                  <button type="button" key={f.id} className="bulk-folder" onClick={() => open(f.id)}>
                    <Folder size={16} /> <span>{f.name}</span>
                  </button>
                ))}
                {!result.folders.length && <p className="muted">No subfolders here.</p>}
              </div>
              {insideFolder && (
                <p className="muted small">
                  This folder: {plural(result.folders.length, 'subfolder')}, {plural(result.images.length, 'photo')}.
                </p>
              )}
            </>
          )}

          {insideFolder && !loading && (
            <>
              <p className="hint bulk-step">2. How should people be made from it?</p>
              <fieldset className="field radio-set">
                <label>
                  <input type="radio" checked={mode === 'subfolders'} disabled={!result!.folders.length} onChange={() => (setMode('subfolders'), setCandidates(null))} />
                  <span>
                    <strong>One person per subfolder</strong> — folder name as the name, its first photo as the photo
                  </span>
                </label>
                <label>
                  <input type="radio" checked={mode === 'photos'} disabled={!result!.images.length} onChange={() => (setMode('photos'), setCandidates(null))} />
                  <span>
                    <strong>One person per photo</strong> — the file name becomes the name
                  </span>
                </label>
              </fieldset>
              {!candidates && (
                <button type="button" className="btn" onClick={scan} disabled={!!scanProgress}>
                  {scanProgress ?? 'Preview people'}
                </button>
              )}
            </>
          )}

          {candidates && (
            <>
              <p className="hint bulk-step">3. Check the list, then add.</p>
              <label className="row-gap small">
                <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} /> Skip names already in the directory (
                {candidates.filter((c) => c.exists).length})
              </label>
              {mode === 'subfolders' && (
                <label className="row-gap small">
                  <input type="checkbox" checked={linkFolders} onChange={(e) => setLinkFolders(e.target.checked)} /> Link each subfolder, so all
                  its photos (and any you add later) show in that person’s gallery
                </label>
              )}
              <ul className="bulk-preview">
                {candidates.slice(0, PREVIEW_LIMIT).map((c, i) => (
                  <li key={i} className={skipExisting && c.exists ? 'skipped' : ''}>
                    <span className="grow">{c.name}</span>
                    {c.exists && <span className="muted small">already added</span>}
                    {!c.photoRef && <span className="muted small">no photo</span>}
                  </li>
                ))}
                {candidates.length > PREVIEW_LIMIT && <li className="muted">…and {(candidates.length - PREVIEW_LIMIT).toLocaleString()} more</li>}
              </ul>
              <div className="field">
                <span>Labels for everyone added (optional)</span>
                <LabelInput value={labelIds} onChange={setLabelIds} />
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
