import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Cloud, Folder, FolderPlus, HardDrive, Link2, LoaderCircle, Lock, LogOut, Search, Server, Unplug, Upload } from 'lucide-react';
import { photoKey, retryPhotos, sources, usePickerThumb } from '../photos';
import { signIn, signOut, useDriveAuth } from '../photos/driveAuth';
import { driveSource } from '../photos/driveSource';
import { disconnectFolder, fsAccessSupported, requestFolderAccess, storeUploadedFiles } from '../photos/localSource';
import { PhotoError, type BrowseFolder, type BrowseResult } from '../photos/PhotoSource';
import type { LinkedFolder, PhotoRef, PhotoSourceId } from '../types';
import { Modal } from './Modal';
import { useToast } from './Toasts';

// Remember where the user was, so picking photos for several people in a row is quick.
let lastTab: PhotoSourceId = 'local';
let lastLocalFolder: string | undefined;
let lastDriveFolder: string | undefined;

const TABS: { id: PhotoSourceId; name: string; icon: typeof Cloud }[] = [
  { id: 'local', name: 'Local folder', icon: HardDrive },
  { id: 'gdrive', name: 'Google Drive', icon: Cloud },
  { id: 'server', name: 'Personal server', icon: Server },
];

/** single: pick one photo · multi: tick several · folder: link the folder being viewed */
export type PickerMode = 'single' | 'multi' | 'folder';

/** The folder currently open in a browser tab (undefined at a source's top level or in search results). */
interface OpenFolder {
  source: PhotoSourceId;
  folderId: string;
  name: string;
  images: PhotoRef[];
}

interface PickerCtx {
  mode: PickerMode;
  selected: Map<string, PhotoRef>;
  toggle: (p: PhotoRef) => void;
  pick: (p: PhotoRef) => void;
  pickMany: (ps: PhotoRef[]) => void;
  setOpenFolder: (f: OpenFolder | undefined) => void;
}
const PickerContext = createContext<PickerCtx | null>(null);
const usePicker = () => useContext(PickerContext)!;

interface PickerProps {
  mode?: PickerMode;
  onPick?: (p: PhotoRef) => void;
  /** multi mode: the ticked photos, in the order they were ticked. */
  onPickMany?: (ps: PhotoRef[]) => void;
  /** folder mode */
  onPickFolder?: (f: LinkedFolder, images: PhotoRef[]) => void;
  onClose: () => void;
  /** The person's name: the Drive tab looks for a folder with this name first. */
  hint?: string;
  /** Open on this source (e.g. the one the current photo came from). */
  initialSource?: PhotoSourceId;
}

const TITLES: Record<PickerMode, string> = { single: 'Choose a photo', multi: 'Add photos', folder: 'Link a folder' };

export function PhotoPicker({ mode = 'single', onPick, onPickMany, onPickFolder, onClose, hint, initialSource }: PickerProps) {
  const [tab, setTab] = useState<PhotoSourceId>(initialSource && initialSource !== 'server' ? initialSource : lastTab);
  const [selected, setSelected] = useState<Map<string, PhotoRef>>(() => new Map());
  const [openFolder, setOpenFolder] = useState<OpenFolder>();
  const choose = (t: PhotoSourceId) => {
    setTab(t);
    setOpenFolder(undefined);
    if (t !== 'server') lastTab = t;
  };

  const ctx: PickerCtx = {
    mode,
    selected,
    toggle: (p) =>
      setSelected((prev) => {
        const next = new Map(prev);
        const k = photoKey(p);
        if (next.has(k)) next.delete(k);
        else next.set(k, p);
        return next;
      }),
    pick: (p) => onPick?.(p),
    pickMany: (ps) => onPickMany?.(ps),
    setOpenFolder,
  };

  const n = selected.size;
  const footer =
    mode === 'multi' ? (
      <>
        {openFolder && openFolder.images.length > 0 && (
          <button type="button" className="btn" onClick={() => onPickMany?.(openFolder.images)}>
            Add all {openFolder.images.length.toLocaleString()} in “{openFolder.name}”
          </button>
        )}
        <span className="grow" />
        <button type="button" className="btn btn-primary" disabled={!n} onClick={() => onPickMany?.([...selected.values()])}>
          Add {n ? n.toLocaleString() : ''} {n === 1 ? 'photo' : 'photos'}
        </button>
      </>
    ) : mode === 'folder' ? (
      <>
        <span className="muted small grow">
          {openFolder
            ? `${openFolder.images.length.toLocaleString()} photos in this folder now; new ones will show up automatically.`
            : 'Open the person’s folder, then link it.'}
        </span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!openFolder}
          onClick={() => openFolder && onPickFolder?.({ source: openFolder.source, folderId: openFolder.folderId, name: openFolder.name }, openFolder.images)}
        >
          <Link2 size={16} /> Link {openFolder ? `“${openFolder.name}”` : 'folder'}
        </button>
      </>
    ) : undefined;

  return (
    <Modal title={TITLES[mode]} onClose={onClose} wide footer={footer}>
      <PickerContext.Provider value={ctx}>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button type="button"
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? 'tab-active' : ''}`}
            onClick={() => choose(t.id)}
          >
            <t.icon size={16} /> {t.name}
          </button>
        ))}
      </div>
      {tab === 'local' && <LocalBrowser />}
      {tab === 'gdrive' && <DriveBrowser hint={hint} />}
      {tab === 'server' && (
        <div className="empty-state small">
          <p>
            <strong>Personal server</strong> is planned for v2.
          </p>
        </div>
      )}
      </PickerContext.Provider>
    </Modal>
  );
}

// ---------------------------------------------------------------- shared pieces

function Crumbs({ root, path, onOpen }: { root: string; path: BrowseFolder[]; onOpen: (id?: string) => void }) {
  return (
    <nav className="crumbs" aria-label="Folder path">
      <button type="button" className="crumb" onClick={() => onOpen(undefined)}>
        {root}
      </button>
      {path.map((p) => (
        <span key={p.id} className="crumb-wrap">
          <ChevronRight size={14} className="muted" />
          <button type="button" className="crumb" onClick={() => onOpen(p.id)}>
            {p.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

function FolderGrid({
  source,
  result,
  onOpen,
  emptyText = 'No images or folders here.',
}: {
  source: PhotoSourceId;
  result: BrowseResult;
  onOpen: (id: string) => void;
  emptyText?: string;
}) {
  return (
    <div className="picker-grid">
      {result.folders.map((f) => (
        <button type="button" key={f.id} className="picker-folder" onClick={() => onOpen(f.id)}>
          <Folder size={28} />
          <span>{f.name}</span>
        </button>
      ))}
      {result.images.map((img) => (
        <PickerImage key={img.ref} source={source} imgRef={img.ref} name={img.name} />
      ))}
      {!result.folders.length && !result.images.length && <p className="muted picker-empty">{emptyText}</p>}
    </div>
  );
}

function PickerImage({ source, imgRef, name }: { source: PhotoSourceId; imgRef: string; name: string }) {
  const { mode, selected, toggle, pick } = usePicker();
  const ref: PhotoRef = { source, ref: imgRef };
  const ticked = mode === 'multi' && selected.has(photoKey(ref));
  const onPick = () => (mode === 'multi' ? toggle(ref) : mode === 'single' ? pick(ref) : undefined);
  // Only fetch and decode the thumbnail once the tile scrolls into view.
  const el = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setVisible(true), io.disconnect()), { rootMargin: '200px' });
    io.observe(el.current!);
    return () => io.disconnect();
  }, []);
  return (
    <button
      type="button"
      ref={el}
      className={`picker-image ${ticked ? 'picker-image-on' : ''} ${mode === 'folder' ? 'picker-image-static' : ''}`}
      onClick={onPick}
      title={name}
      aria-pressed={mode === 'multi' ? ticked : undefined}
      tabIndex={mode === 'folder' ? -1 : undefined}
    >
      {visible ? <Thumb source={source} imgRef={imgRef} name={name} /> : <div className="skeleton" />}
      {mode === 'multi' && <span className={`card-check ${ticked ? 'on' : ''}`}>{ticked && <Check size={14} strokeWidth={3} />}</span>}
      <span className="picker-name">{name}</span>
    </button>
  );
}

function Thumb({ source, imgRef, name }: { source: PhotoSourceId; imgRef: string; name: string }) {
  const { url, status } = usePickerThumb(source, imgRef);
  if (status === 'ok') return <img src={url} alt={name} />;
  if (status === 'loading') return <div className="skeleton" />;
  return <div className="picker-broken">Can’t preview</div>;
}

/** Reports the folder a browser is showing, so the footer can offer "Add all" / "Link". */
function useReportOpenFolder(source: PhotoSourceId, folderId: string | undefined, result: BrowseResult | null, usable: boolean) {
  const { setOpenFolder } = usePicker();
  useEffect(() => {
    if (!usable || !folderId || !result || result.needsPermission) return setOpenFolder(undefined);
    setOpenFolder({
      source,
      folderId,
      name: result.path[result.path.length - 1]?.name ?? 'this folder',
      images: result.images.map((i) => ({ source, ref: i.ref })),
    });
  }, [source, folderId, result, usable, setOpenFolder]);
}

const Loading = () => (
  <div className="empty-state small">
    <LoaderCircle size={24} className="spin" />
  </div>
);

// ---------------------------------------------------------------- Google Drive

function DriveBrowser({ hint }: { hint?: string }) {
  const auth = useDriveAuth();
  const toast = useToast();
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [folderId, setFolderId] = useState<string | undefined>(lastDriveFolder);
  const [query, setQuery] = useState(hint?.trim() ?? '');
  const [searched, setSearched] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Shared with me" is a view, not a folder, so it can't be linked or added from as a whole.
  useReportOpenFolder('gdrive', folderId, result, !loading && searched === null && folderId !== 'shared');

  const run = useCallback(async (fn: () => Promise<BrowseResult>) => {
    setLoading(true);
    setError(null);
    try {
      setResult(await fn());
    } catch (e) {
      // A 401 flips auth.signedIn and shows the sign-in card; anything else is shown here.
      if (!(e instanceof PhotoError && e.kind === 'needs-permission')) setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const open = useCallback(
    (id?: string) => {
      setSearched(null);
      setFolderId(id);
      lastDriveFolder = id;
      run(() => driveSource.browse(id));
    },
    [run],
  );

  const search = useCallback(
    (text: string) => {
      if (!text.trim()) return open(undefined);
      setSearched(text.trim());
      setFolderId(undefined);
      run(() => driveSource.searchFolders(text));
    },
    [open, run],
  );

  // On sign-in: look for the person's folder by name, else go back to where the user was.
  useEffect(() => {
    if (!auth.signedIn) return;
    if (hint?.trim() && !lastDriveFolder) search(hint);
    else open(lastDriveFolder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.signedIn]);

  const connect = async (chooseAccount = false) => {
    try {
      if (await signIn({ chooseAccount })) retryPhotos();
    } catch (e) {
      toast((e as Error).message, { kind: 'error' });
    }
  };

  if (!auth.configured) {
    return (
      <div className="empty-state small">
        <Cloud size={28} />
        <p>
          Google Drive isn’t set up yet. Add <code>VITE_GOOGLE_CLIENT_ID</code> to <code>.env.local</code> and restart the dev server.
        </p>
      </div>
    );
  }

  if (!auth.signedIn) {
    return (
      <div className="empty-state small">
        <Cloud size={28} />
        <p>{auth.account ? 'Your Google Drive session has ended.' : 'Sign in to pick photos from Google Drive (read-only).'}</p>
        <div className="row-gap">
          <button type="button" className="btn btn-primary" onClick={() => connect()} disabled={auth.busy}>
            {auth.busy ? <LoaderCircle size={16} className="spin" /> : <Cloud size={16} />}
            {auth.account?.email ? `Continue as ${auth.account.email}` : 'Sign in with Google'}
          </button>
          {auth.account && (
            <button type="button" className="btn btn-ghost" onClick={() => connect(true)} disabled={auth.busy}>
              Use another account
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="picker">
      <form
        className="picker-bar"
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
      >
        <div className="search grow">
          <Search size={16} className="search-icon" />
          <input
            className="input search-input"
            type="search"
            placeholder="Find a folder by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find a Drive folder"
          />
        </div>
        <button className="btn btn-sm" type="submit">
          Find
        </button>
        <span className="drive-account" title={auth.account?.email}>
          {auth.account?.email}
        </span>
        <button
          type="button"
          className="icon-btn"
          title="Sign out of Google Drive"
          aria-label="Sign out of Google Drive"
          onClick={async () => {
            await signOut();
            setResult(null);
            lastDriveFolder = undefined;
            toast('Signed out of Google Drive');
          }}
        >
          <LogOut size={16} />
        </button>
      </form>

      {searched !== null ? (
        <nav className="crumbs" aria-label="Folder path">
          <button type="button" className="crumb" onClick={() => open(undefined)}>
            Drive
          </button>
          <span className="crumb-wrap">
            <ChevronRight size={14} className="muted" />
            <span className="crumb-text">Folders matching “{searched}”</span>
          </span>
        </nav>
      ) : (
        <Crumbs root="Drive" path={result?.path ?? []} onOpen={open} />
      )}

      {error && <p className="notice notice-error">{error}</p>}
      {loading ? (
        <Loading />
      ) : (
        result && (
          <FolderGrid
            source="gdrive"
            result={result}
            onOpen={open}
            emptyText={searched !== null ? `No folders named like “${searched}”. Browse My Drive instead.` : 'No images or folders here.'}
          />
        )
      )}
      {folderId === undefined && searched === null && !loading && (
        <p className="hint">Tip: name each person’s Drive folder after them and the picker finds it automatically.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- local folders

function LocalBrowser() {
  const toast = useToast();
  const { mode, pick, pickMany } = usePicker();
  const [folderId, setFolderId] = useState<string | undefined>(lastLocalFolder);
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const supported = fsAccessSupported();
  useReportOpenFolder('local', folderId, result, true);

  const load = useCallback(async (id?: string) => {
    setError(null);
    try {
      const r = await sources.local.browse(id);
      setResult(r);
      setFolderId(id);
      lastLocalFolder = id;
    } catch {
      // Folder moved or deleted since last time: fall back to the list of folders.
      if (id) return load(undefined);
      setError('Could not read the folder.');
    }
  }, []);

  useEffect(() => {
    load(folderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    if (await sources.local.connect()) {
      const r = await sources.local.browse();
      setResult(r);
      // Open the folder just added (the last one).
      const added = r.folders[r.folders.length - 1];
      if (added) load(added.id);
    }
  }

  async function allow() {
    const rootId = folderId?.split('/')[0];
    if (rootId && (await requestFolderAccess(rootId))) {
      retryPhotos();
      load(folderId);
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const stored = await storeUploadedFiles(mode === 'multi' ? [...files] : [files[0]]);
    const refs = stored.map((f) => ({ source: 'local' as const, ref: f.ref }));
    if (mode === 'multi') pickMany(refs);
    else pick(refs[0]);
  }

  return (
    <div className="picker">
      <div className="picker-bar">
        <Crumbs root="Folders" path={result?.path ?? []} onOpen={load} />
        <div className="row-gap">
          {supported && (
            <button type="button" className="btn btn-sm" onClick={connect}>
              <FolderPlus size={15} /> Connect folder
            </button>
          )}
          {mode !== 'folder' && (
            <>
              <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()} title="Copies the file into this browser">
                <Upload size={15} /> Upload {mode === 'multi' ? 'files' : 'file'}
              </button>
              <input ref={fileInput} type="file" accept="image/*" multiple={mode === 'multi'} hidden onChange={(e) => upload(e.target.files)} />
            </>
          )}
        </div>
      </div>

      {!supported && (
        <p className="notice">
          This browser can’t open local folders (Chrome or Edge can). Use <strong>Upload file</strong> — the photo is copied into this
          browser’s storage.
        </p>
      )}
      {error && <p className="notice notice-error">{error}</p>}

      {result && !folderId && (
        <div className="picker-grid">
          {result.folders.map((f) => (
            <div key={f.id} className="picker-folder-wrap">
              <button type="button" className="picker-folder" onClick={() => load(f.id)}>
                <Folder size={28} />
                <span>{f.name}</span>
              </button>
              <button type="button"
                className="icon-btn picker-unplug"
                title="Disconnect folder"
                aria-label={`Disconnect ${f.name}`}
                onClick={async () => {
                  await disconnectFolder(f.id);
                  toast(`Disconnected “${f.name}”`);
                  load(undefined);
                }}
              >
                <Unplug size={14} />
              </button>
            </div>
          ))}
          {!result.folders.length && supported && (
            <div className="empty-state small">
              <p>No folders connected yet.</p>
              <button type="button" className="btn btn-primary" onClick={connect}>
                <FolderPlus size={16} /> Connect a photo folder
              </button>
            </div>
          )}
        </div>
      )}

      {result && folderId && result.needsPermission && (
        <div className="empty-state small">
          <Lock size={28} />
          <p>The browser needs your permission again to read this folder.</p>
          <button type="button" className="btn btn-primary" onClick={allow}>
            Allow access
          </button>
        </div>
      )}

      {result && folderId && !result.needsPermission && <FolderGrid source="local" result={result} onOpen={load} />}
    </div>
  );
}
