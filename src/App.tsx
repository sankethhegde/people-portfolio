import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  CheckSquare,
  Cloud,
  Download,
  HardDriveDownload,
  EllipsisVertical,
  Eraser,
  Eye,
  FolderInput,
  ImageOff,
  Keyboard,
  StickyNote,
  Lock,
  Monitor,
  Moon,
  Pencil,
  Plus,
  Search,
  Sun,
  Tags,
  Unplug,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { getMeta } from './db';
import { DataContext, useAppDataQuery, useData } from './lib/data';
import { allowFolder } from './lib/access';
import { useAutoBackup } from './lib/autoBackup';
import { clearAllData, downloadExport, LAST_EXPORT_KEY } from './lib/exportImport';
import { applyFilters, readFiltersFromUrl, writeFiltersToUrl, type FilterState } from './lib/filters';
import { setPrefs, usePrefs, type Motion, type Theme } from './lib/prefs';
import { useIsNarrow } from './lib/useMediaQuery';
import { addSamplePeople } from './lib/sample';
import { newPerson } from './lib/store';
import { checkPhotos, countLinkedFolders, linkedFolderKey, photoCount, photoKey, retryPhotos, uncountedFolders, useFolderCounts, useMissingPhotos } from './photos';
import { signIn, useDriveAuth } from './photos/driveAuth';
import {
  getUnreachable,
  recheckUnreachable,
  getLocked,
  refreshLocked,
  subscribeLocked,
  subscribeUnreachable,
} from './photos/localSource';
import type { Person, SortKey } from './types';
import { BulkAddDialog } from './components/BulkAddDialog';
import { BulkBar } from './components/BulkBar';
import { DetailPanel, usePhotoAccess } from './components/DetailPanel';
import { FilterBar } from './components/FilterBar';
import { BackupDialog } from './components/BackupDialog';
import { ImportDialog } from './components/ImportDialog';
import { KeepImportDialog } from './components/KeepImportDialog';
import { LabelManager } from './components/LabelManager';
import { ConfirmDialog, Modal } from './components/Modal';
import { PersonGrid } from './components/PersonGrid';
import { ThemeToggle } from './components/ThemeToggle';
import { PersonPhotos } from './components/PersonPhoto';
import { ToastProvider, useToast } from './components/Toasts';
import { animateView } from './lib/motion';

const BACKUP_DAYS = 30;

/** Animation styles offered in the menu: value, button text, tooltip. */
const MOTION_OPTIONS: [Motion, string, string][] = [
  ['simple', 'Simple', 'Simple: the card grows into the photos; quick and quiet'],
  ['spring', 'Spring', 'Spring: bouncy grow, photos and details cascade in one by one'],
  ['flip', 'Flip', 'Flip: the card turns over in 3D; the panel swings in like a door'],
  ['zoom', 'Zoom', 'Zoom: the page zooms past you with a depth blur'],
  ['reveal', 'Reveal', 'Reveal: a circle wipes open from the card or photo you clicked'],
];

export default function App() {
  const data = useAppDataQuery();
  return (
    <DataContext.Provider value={data}>
      <ToastProvider>
        <Directory />
      </ToastProvider>
    </DataContext.Provider>
  );
}

type Dialog = 'labels' | 'import' | 'clear' | 'bulk-add' | 'shortcuts' | 'keep' | 'backup' | null;

function Directory() {
  const data = useData();
  const toast = useToast();
  const { people, loaded } = data;

  // ---- filters (kept in the URL so a view can be bookmarked) ----
  const [filters, setFilters] = useState<FilterState>(readFiltersFromUrl);
  useEffect(() => writeFiltersToUrl(filters), [filters]);
  const deferred = useDeferredValue(filters);
  const missing = useMissingPhotos();
  const folderCounts = useFolderCounts();
  const visible = useMemo(
    () =>
      applyFilters(
        people,
        deferred,
        (ph) => missing.has(photoKey(ph)),
        (p) => photoCount(p, folderCounts),
        (p) => !!p.folder && !folderCounts.has(linkedFolderKey(p.folder)),
      ),
    [people, deferred, missing, folderCounts],
  );
  const uncounted = useMemo(() => uncountedFolders(people, folderCounts), [people, folderCounts]);
  const visibleIds = useMemo(() => visible.map((p) => p.id), [visible]);
  const missingCount = useMemo(() => people.filter((p) => p.photo && missing.has(photoKey(p.photo))).length, [people, missing]);

  // Drop label filters that point at deleted labels.
  useEffect(() => {
    if (!loaded) return;
    const live = filters.labelIds.filter((id) => data.labelMap.has(id));
    if (live.length !== filters.labelIds.length) setFilters((f) => ({ ...f, labelIds: live }));
  }, [loaded, data.labelMap, filters.labelIds]);

  // ---- selection / panel ----
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Person | null>(null); // a new, not-yet-saved person
  const selected = draft ?? people.find((p) => p.id === selectedId);
  const panelOpen = !!selected;
  const narrow = useIsNarrow();

  // Opening a person "opens" their card into the photo area; closing shrinks it back (lib/motion).
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const select = useCallback((id: string) => {
    animateView(
      () => {
        setDraft(null);
        setSelectedId(id);
        setEditing(false);
      },
      { fromCard: id },
    );
  }, []);
  const [lastViewedId, setLastViewedId] = useState<string>();
  const closePanel = useCallback(() => {
    animateView(
      () => {
        setDraft(null);
        setSelectedId((id) => {
          if (id) setLastViewedId(id);
          return undefined;
        });
        setEditing(false);
      },
      { toCard: selectedRef.current },
    );
  }, []);
  const addPerson = () => {
    const p = newPerson();
    setDraft(p);
    setSelectedId(p.id);
    setEditing(true);
  };

  // Once a new person's first autosave lands, it is a normal person.
  useEffect(() => {
    if (draft && people.some((p) => p.id === draft.id)) setDraft(null);
  }, [draft, people]);

  // ---- Previous / Next through the current filtered order (FR-14) ----
  const selectedIndex = selected && !draft ? visible.findIndex((p) => p.id === selected.id) : -1;
  const step = useCallback(
    (delta: number) => {
      const next = visible[selectedIndex + delta];
      if (selectedIndex >= 0 && next) select(next.id);
    },
    [visible, selectedIndex, select],
  );

  // ---- selection mode for bulk actions (FR-34) ----
  const { viewOnly, theme, motion } = usePrefs();
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const lastToggled = useRef<string | undefined>(undefined);
  const startSelecting = () => {
    closePanel();
    setChecked(new Set());
    setSelecting(true);
  };
  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setChecked(new Set());
  }, []);
  const toggleCheck = useCallback(
    (id: string, range: boolean) => {
      // Read the anchor now: the updater below may run later, after it has moved.
      const from = range && lastToggled.current ? visible.findIndex((p) => p.id === lastToggled.current) : -1;
      const to = visible.findIndex((p) => p.id === id);
      setChecked((prev) => {
        const next = new Set(prev);
        if (from >= 0 && to >= 0) {
          // Shift-click ticks everything between the last card and this one.
          const [a, b] = from < to ? [from, to] : [to, from];
          for (let i = a; i <= b; i++) next.add(visible[i].id);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastToggled.current = id;
    },
    [visible],
  );
  // Drop ticks for people who were deleted.
  useEffect(() => {
    if (!checked.size) return;
    const ids = new Set(people.map((p) => p.id));
    if ([...checked].some((id) => !ids.has(id))) setChecked(new Set([...checked].filter((id) => ids.has(id))));
  }, [people, checked]);
  useEffect(() => {
    if (viewOnly) stopSelecting();
  }, [viewOnly, stopSelecting]);

  // ---- keyboard (FR-06). Grid arrows live in PersonGrid; these are page-level. ----
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target instanceof HTMLElement ? e.target : document.body;
      const typing = t.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === 'Escape') {
        if (typing === searchRef.current && filters.q) return; // let Esc clear the search box natively
        if (selecting) stopSelecting();
        else if (panelOpen) closePanel();
        return;
      }
      if (typing) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === '?') {
        setDialog('shortcuts');
      } else if (panelOpen && !editing && !t.closest('[data-person-id]') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        step(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, closePanel, selecting, stopSelecting, editing, step, filters.q]);

  // ---- banners ----
  const lockedFolders = useSyncExternalStore(subscribeLocked, getLocked);
  const [lockedHidden, setLockedHidden] = useState(false);

  // Folders on a disk that isn't connected. Re-check every 15 s and on returning to the window,
  // so photos reappear on their own once the disk is plugged back in.
  const unreachable = useSyncExternalStore(subscribeUnreachable, getUnreachable);
  useEffect(() => {
    if (!unreachable.length) return;
    const check = async () => {
      if (await recheckUnreachable()) retryPhotos();
    };
    const t = window.setInterval(check, 15_000);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', check);
    };
  }, [unreachable.length]);
  const [backupDue, setBackupDue] = useState(false);
  const backup = useAutoBackup(() => toast('Automatic backup saved'));
  useEffect(() => {
    refreshLocked();
    // Re-check on returning to the window (Chrome may have been given access elsewhere).
    const onFocus = () => refreshLocked();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  useEffect(() => {
    if (!loaded || !people.length) return setBackupDue(false);
    getMeta<string>(LAST_EXPORT_KEY).then((last) => {
      const oldest = last ?? people.reduce((m, p) => (p.createdAt < m ? p.createdAt : m), people[0].createdAt);
      setBackupDue(Date.now() - new Date(oldest).getTime() > BACKUP_DAYS * 864e5);
    });
  }, [loaded, people]);

  // Drive tokens live in memory, so each new session needs one click to reconnect.
  const drive = useDriveAuth();
  const [driveBannerHidden, setDriveBannerHidden] = useState(false);
  const hasDrivePhotos = useMemo(() => people.some((p) => p.photo?.source === 'gdrive'), [people]);
  const showDriveBanner = drive.configured && !drive.signedIn && hasDrivePhotos && !driveBannerHidden;

  async function connectDrive() {
    try {
      if (await signIn()) retryPhotos();
    } catch (e) {
      toast((e as Error).message, { kind: 'error' });
    }
  }

  // ---- missing-photo check ----
  const [checking, setChecking] = useState<string | null>(null);
  async function runPhotoCheck() {
    const photos = people.flatMap((p) => [...(p.photo ? [p.photo] : []), ...(p.photos ?? [])]);
    if (!photos.length) return toast('Nobody has a photo yet');
    setChecking(`Checking photos… 0 / ${photos.length}`);
    const counts = await checkPhotos(photos, (done, total) => setChecking(`Checking photos… ${done} / ${total}`));
    if (people.some((p) => p.folder)) await countLinkedFolders(people);
    setChecking(null);
    const parts = [`${counts.missing} missing`];
    if (counts['needs-permission']) parts.push(`${counts['needs-permission']} couldn’t be checked (sign in to Drive or allow folder access)`);
    if (counts.offline) parts.push(`${counts.offline} on a disk that isn’t connected (not marked missing)`);
    toast(`Checked ${photos.length.toLocaleString()} photos: ${parts.join(', ')}`, {
      kind: counts['needs-permission'] || counts.offline ? 'error' : 'info',
    });
    if (counts.missing) setFilters((f) => ({ ...f, missingOnly: true }));
  }

  // One folder per click: Chrome only allows one permission prompt per click.
  async function grantFolder(f: { id: string; name: string }) {
    if (!(await allowFolder(f.id))) toast(`Chrome didn’t allow access to “${f.name}”. Try again and choose “Allow”.`, { kind: 'error' });
  }

  // ---- menu / dialogs ----
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  async function exportNow() {
    const d = await downloadExport();
    setBackupDue(false);
    toast(`Exported ${d.people.length.toLocaleString()} people`);
  }

  const menuItem = (icon: ReactNode, text: string, fn: () => void) => (
    <button
      role="menuitem"
      onClick={() => {
        setMenuOpen(false);
        fn();
      }}
    >
      {icon} {text}
    </button>
  );

  const isFiltered = filters.q.trim() !== '' || filters.labelIds.length > 0 || filters.missingOnly || filters.photos !== 'any';

  // Linked folders are counted when read; this reads the rest (for photo sorting / filtering).
  async function countFolders() {
    setChecking('Counting photos in linked folders…');
    const failed = await countLinkedFolders(people, (done, total) => setChecking(`Counting photos in linked folders… ${done} / ${total}`));
    setChecking(null);
    toast(failed ? `Counted; ${failed} folder${failed === 1 ? '' : 's'} couldn’t be read (sign in to Drive / allow folder access / connect the disk)` : 'Photo counts updated', {
      kind: failed ? 'error' : 'info',
    });
  }
  // A brand-new person being typed in has no photos to show yet; keep the grid visible for them.
  const showPhotos = !!selected && !selecting && !narrow && !draft;

  return (
    <div className={`app ${panelOpen ? 'with-panel' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <Users size={20} /> <span>People</span>
        </div>
        <div className="search">
          <Search size={16} className="search-icon" />
          <input
            ref={searchRef}
            className="input search-input"
            type="search"
            placeholder="Search names and notes"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            aria-label="Search"
          />
        </div>
        <select
          className="input select sort"
          value={filters.sort}
          onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as SortKey }))}
          aria-label="Sort"
        >
          <option value="name-asc">Name A–Z</option>
          <option value="name-desc">Name Z–A</option>
          <option value="added-desc">Newest first</option>
          <option value="added-asc">Oldest first</option>
          <option value="photos-desc">Most photos</option>
          <option value="photos-asc">Fewest photos</option>
        </select>
        <ThemeToggle />
        {viewOnly ? (
          <span className="viewonly-pill" title="Editing is turned off on this browser">
            <Eye size={13} /> View only
          </span>
        ) : (
          <button className="btn btn-cta" onClick={addPerson}>
            <Plus size={16} /> <span className="hide-sm">Add person</span>
          </button>
        )}
        <div className="menu" ref={menuRef}>
          <button className="icon-btn" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            <EllipsisVertical size={18} />
          </button>
          {menuOpen && (
            <div className="menu-list" role="menu">
              {!viewOnly && (
                <>
                  {menuItem(<FolderInput size={16} />, 'Bulk add from a folder…', () => setDialog('bulk-add'))}
                  {menuItem(<StickyNote size={16} />, 'Import from Google Keep…', () => setDialog('keep'))}
                  {menuItem(<CheckSquare size={16} />, 'Select people…', startSelecting)}
                  {menuItem(<Tags size={16} />, 'Manage labels', () => setDialog('labels'))}
                  <hr />
                </>
              )}
              {menuItem(<Download size={16} />, 'Export JSON', exportNow)}
              {menuItem(<HardDriveDownload size={16} />, backup.folder ? 'Automatic backup (on)…' : 'Automatic backup…', () => setDialog('backup'))}
              {!viewOnly && menuItem(<Upload size={16} />, 'Import JSON', () => setDialog('import'))}
              {menuItem(<ImageOff size={16} />, 'Check for missing photos', runPhotoCheck)}
              <hr />
              {viewOnly
                ? menuItem(<Pencil size={16} />, 'Turn on editing', () => setPrefs({ viewOnly: false }))
                : menuItem(<Eye size={16} />, 'View-only mode', () => {
                    setPrefs({ viewOnly: true });
                    setEditing(false);
                    toast('View-only: editing controls are hidden');
                  })}
              {menuItem(<Keyboard size={16} />, 'Keyboard shortcuts', () => setDialog('shortcuts'))}
              <div className="menu-label">Theme</div>
              <div className="theme-switch" role="radiogroup" aria-label="Theme">
                {(
                  [
                    ['system', Monitor, 'System'],
                    ['light', Sun, 'Light'],
                    ['dark', Moon, 'Dark'],
                  ] as const
                ).map(([value, Icon, label]) => (
                  <button
                    key={value}
                    role="radio"
                    aria-checked={theme === value}
                    aria-label={label}
                    className={`btn btn-sm ${theme === value ? 'btn-toggle-on' : ''}`}
                    onClick={() => setPrefs({ theme: value as Theme })}
                    title={label}
                  >
                    <Icon size={15} />
                  </button>
                ))}
              </div>
              <div className="menu-label">Animation</div>
              <div className="motion-switch" role="radiogroup" aria-label="Animation style">
                {MOTION_OPTIONS.map(([value, label, hint]) => (
                  <button
                    key={value}
                    role="radio"
                    aria-checked={motion === value}
                    className={`btn btn-sm ${motion === value ? 'btn-toggle-on' : ''}`}
                    onClick={() => setPrefs({ motion: value })}
                    title={hint}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {!viewOnly && (
                <>
                  <hr />
                  {menuItem(<Users size={16} />, 'Add 500 sample people', async () => {
                    await addSamplePeople(500);
                    toast('Added 500 sample people');
                  })}
                  {menuItem(<Eraser size={16} />, 'Clear all data…', () => setDialog('clear'))}
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {unreachable.length > 0 && (
        <div className="banner">
          <Unplug size={16} />
          <span>
            {unreachable.map((f) => `“${f.name}”`).join(', ')} isn’t connected (external disk unplugged?). Its photos will show again as soon
            as you reconnect it — nothing needs re-adding.
          </span>
          <button
            className="btn btn-sm"
            onClick={async () => {
              if (await recheckUnreachable()) retryPhotos();
              else toast('Still not connected');
            }}
          >
            Check again
          </button>
        </div>
      )}
      {lockedFolders.length > 0 && !lockedHidden && (
        <div className="banner banner-wrap">
          <Lock size={16} />
          <span>
            Chrome needs your OK again to read {lockedFolders.length === 1 ? 'this folder' : `these ${lockedFolders.length} folders`} (it asks once
            per session, one folder per click):
          </span>
          <span className="banner-buttons">
            {lockedFolders.map((f) => (
              <button key={f.id} className="btn btn-sm btn-primary" onClick={() => grantFolder(f)}>
                Allow “{f.name}”
              </button>
            ))}
          </span>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setLockedHidden(true)}>
            <X size={16} />
          </button>
        </div>
      )}
      {showDriveBanner && (
        <div className="banner">
          <Cloud size={16} />
          <span>Google Drive is signed out. Cached thumbnails still show; sign in to load full-size and new photos.</span>
          <button className="btn btn-sm" onClick={connectDrive} disabled={drive.busy}>
            {drive.account?.email ? `Continue as ${drive.account.email}` : 'Sign in'}
          </button>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setDriveBannerHidden(true)}>
            <X size={16} />
          </button>
        </div>
      )}
      {checking && (
        <div className="banner" role="status">
          <ImageOff size={16} />
          <span>{checking}</span>
        </div>
      )}
      {backup.needsClick && (
        <div className="banner">
          <HardDriveDownload size={16} />
          <span>
            A backup is due. Chrome needs one click to save it to “{backup.folder?.name}” (or the folder’s disk isn’t connected).
          </span>
          <button
            className="btn btn-sm"
            onClick={async () => {
              try {
                toast(`Backed up to ${await backup.backUpNow()}`);
              } catch (e) {
                toast((e as Error).message, { kind: 'error' });
              }
            }}
          >
            Back up now
          </button>
        </div>
      )}
      {backupDue && !backup.folder && (
        <div className="banner">
          <Download size={16} />
          <span>No backup in the last {BACKUP_DAYS} days. Turn on automatic backup so your data is safe.</span>
          <button className="btn btn-sm" onClick={() => setDialog('backup')}>
            Set up automatic backup
          </button>
          <button className="btn btn-sm btn-ghost" onClick={exportNow}>
            Export now
          </button>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setBackupDue(false)}>
            <X size={16} />
          </button>
        </div>
      )}

      <main className="main">
        {/* Desktop: a selected person's photos take over the main area; details sit in the panel. */}
        {showPhotos && selected ? (
          <section className="grid-area">
            <MainPhotos key={selected.id} person={selected} onBack={closePanel} />
          </section>
        ) : (
        <section className="grid-area">
          <FilterBar filters={filters} onChange={setFilters} resultCount={visible.length} total={people.length} missingCount={missingCount}
            uncountedFolders={uncounted}
            onCountFolders={countFolders}
          />
          {selecting && <BulkBar checkedIds={checked} visibleIds={visibleIds} onChange={setChecked} onDone={stopSelecting} />}
          {!loaded ? null : people.length === 0 ? (
            <div className="empty-state">
              <Users size={40} />
              <p>No people yet — add your first person.</p>
              {!viewOnly && (
                <div className="row-gap">
                  <button className="btn btn-primary" onClick={addPerson}>
                    <Plus size={16} /> Add person
                  </button>
                  <button className="btn" onClick={() => setDialog('bulk-add')}>
                    <FolderInput size={16} /> Bulk add from a folder
                  </button>
                  <button className="btn" onClick={() => setDialog('keep')}>
                    <StickyNote size={16} /> Import from Google Keep
                  </button>
                </div>
              )}
            </div>
          ) : visible.length === 0 ? (
            <div className="empty-state">
              <Search size={40} />
              <p>No matches.</p>
              {isFiltered && (
                <button className="btn" onClick={() => setFilters((f) => ({ ...f, q: '', labelIds: [], missingOnly: false, photos: 'any' }))}>
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <PersonGrid
              people={visible}
              selectedId={selectedId}
              onSelect={select}
              checkedIds={selecting ? checked : undefined}
              onToggleCheck={toggleCheck}
              revealId={lastViewedId}
            />
          )}
        </section>
        )}

        {selected && !selecting && (
          <DetailPanel
            viewOnly={viewOnly}
            nav={
              selectedIndex >= 0
                ? { index: selectedIndex, total: visible.length, onPrev: () => step(-1), onNext: () => step(1) }
                : undefined
            }
            person={selected}
            isNew={!!draft}
            editing={editing}
            onEdit={() => setEditing(true)}
            onEditDone={(id) => {
              setDraft(null);
              setEditing(false);
              if (id) setSelectedId(id);
              else closePanel();
            }}
            onClose={closePanel}
            onLabelClick={(id) =>
              setFilters((f) => (f.labelIds.includes(id) ? f : { ...f, labelIds: [...f.labelIds, id] }))
            }
          />
        )}
      </main>

      {dialog === 'labels' && <LabelManager onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'bulk-add' && <BulkAddDialog onClose={() => setDialog(null)} />}
      {dialog === 'keep' && <KeepImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'backup' && <BackupDialog backup={backup} onClose={() => setDialog(null)} />}
      {dialog === 'shortcuts' && (
        <Modal title="Keyboard shortcuts" onClose={() => setDialog(null)}>
          <dl className="shortcuts">
            <dt>
              <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd>
            </dt>
            <dd>Move between cards (Tab into the grid first)</dd>
            <dt>
              <kbd>Home</kbd> <kbd>End</kbd>
            </dt>
            <dd>First / last card</dd>
            <dt>
              <kbd>Enter</kbd>
            </dt>
            <dd>Open the focused card</dd>
            <dt>
              <kbd>←</kbd> <kbd>→</kbd>
            </dt>
            <dd>Previous / next person while the panel is open</dd>
            <dt>
              <kbd>Esc</kbd>
            </dt>
            <dd>Close the panel, dialog or selection</dd>
            <dt>
              <kbd>/</kbd>
            </dt>
            <dd>Search</dd>
            <dt>
              <kbd>Shift</kbd> + click
            </dt>
            <dd>Select a range of cards in selection mode</dd>
            <dt>
              <kbd>?</kbd>
            </dt>
            <dd>This list</dd>
          </dl>
        </Modal>
      )}
      {dialog === 'clear' && (
        <ConfirmDialog
          title="Clear all data?"
          message="Deletes every person, label and label group from this browser. Photos in your folders are not touched. Export first if you want a backup."
          confirmLabel="Clear everything"
          danger
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            setDialog(null);
            closePanel();
            const undo = await clearAllData();
            toast('All data cleared', { undo });
          }}
        />
      )}
    </div>
  );
}

/** The main-area photo view for one person (needs its own component for the access hook). */
function MainPhotos({ person, onBack }: { person: Person; onBack: () => void }) {
  const allowAccess = usePhotoAccess(person);
  return <PersonPhotos person={person} onBack={onBack} onNeedsPermission={allowAccess} />;
}
