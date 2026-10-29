import { Cake, ChevronLeft, ChevronRight, ImageMinus, Pencil, Pin, PinOff, StickyNote, Trash2, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useData } from '../lib/data';
import { useIsNarrow } from '../lib/useMediaQuery';
import { linkTitle } from '../lib/social';
import { ageFromBirthYear, deletePerson, setPanelBackground, setPinned } from '../lib/store';
import { signIn } from '../photos/driveAuth';
import { folderIdOfRef } from '../photos/localSource';
import { allowFolder } from '../lib/access';
import { retryPhotos } from '../photos';
import type { Person, PhotoRef } from '../types';
import { Flag } from './Flag';
import { KeepExportDialog } from './KeepExportDialog';
import { LabelChip } from './LabelChip';
import { PanelShell } from './PanelShell';
import { ConfirmDialog } from './Modal';
import { PersonEditor } from './PersonEditor';
import { PanelAvatar, PersonPhotos } from './PersonPhoto';
import { MarkedStrip } from './MarkedStrip';
import { SocialIcon } from './SocialIcon';
import { useToast } from './Toasts';

interface Props {
  person: Person;
  isNew: boolean;
  editing: boolean;
  onEdit: () => void;
  onEditDone: (id?: string) => void;
  onClose: () => void;
  onLabelClick: (labelId: string) => void;
  /** Hides Edit and Delete (FR-52). */
  viewOnly: boolean;
  /** Position in the current filtered order, for Previous / Next (FR-14). */
  nav?: { index: number; total: number; onPrev: () => void; onNext: () => void };
}

export function DetailPanel({ person, isNew, editing, onEdit, onEditDone, onClose, onLabelClick, viewOnly, nav }: Props) {
  if (editing && !viewOnly) {
    return (
      <PanelShell label="Edit person">
        <button className="icon-btn panel-close" aria-label="Close panel" onClick={onClose}>
          <X size={18} />
        </button>
        {/* key: switching people remounts the editor with a fresh draft */}
        <PersonEditor key={person.id} initial={person} isNew={isNew} onDone={onEditDone} />
      </PanelShell>
    );
  }
  return <PersonView person={person} onEdit={onEdit} onClose={onClose} onLabelClick={onLabelClick} viewOnly={viewOnly} nav={nav} />;
}

function hostOf(url: string) {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** Sign in to Drive or re-grant the local folder, whichever this person's photos need. */
/**
 * Sign in to Drive or re-grant the local folder that `photo` (default: the cover, else the linked
 * folder) lives in. One folder per click — Chrome allows one permission prompt per click.
 */
export function usePhotoAccess(person: Person) {
  const toast = useToast();
  return useCallback(
    async (photo?: PhotoRef) => {
      const target: PhotoRef | undefined =
        photo ?? person.photo ?? (person.folder ? { source: person.folder.source, ref: person.folder.folderId } : undefined);
      if (!target) return;
      try {
        if (target.source === 'gdrive') {
          if (await signIn()) retryPhotos();
          return;
        }
        const folderId = folderIdOfRef(target.ref);
        if (folderId && !(await allowFolder(folderId))) toast('Chrome didn’t allow access to that folder. Try again and choose “Allow”.', { kind: 'error' });
      } catch (e) {
        toast((e as Error).message, { kind: 'error' });
      }
    },
    [person, toast],
  );
}

function PersonView({
  person,
  onEdit,
  onClose,
  onLabelClick,
  viewOnly,
  nav,
}: Pick<Props, 'person' | 'onEdit' | 'onClose' | 'onLabelClick' | 'viewOnly' | 'nav'>) {
  const { labelMap, groupMap } = useData();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [toKeep, setToKeep] = useState(false);

  const labels = person.labelIds.map((id) => labelMap.get(id)).filter((l) => !!l);

  const allowAccess = usePhotoAccess(person);
  // On phones the panel is a full-screen sheet, so the photos live inside it.
  const narrow = useIsNarrow();

  return (
    <PanelShell
      label={`Details for ${person.name}`}
      background={person.panelBg}
      footer={person.marked?.length ? <MarkedStrip key={person.id} person={person} viewOnly={viewOnly} /> : undefined}
    >
      <div className="panel-actions">
        {!viewOnly && (
          <>
            <button className="btn btn-sm" onClick={onEdit} title="Edit">
              <Pencil size={15} /> <span className="btn-label">Edit</span>
            </button>
            <button
              className={`btn btn-sm ${person.pinned ? 'btn-toggle-on' : ''}`}
              onClick={async () => {
                await setPinned(person.id, !person.pinned);
                toast(person.pinned ? `Unpinned ${person.name}` : `Pinned ${person.name} to the top`);
              }}
              title={person.pinned ? 'Unpin' : 'Always show this person first'}
            >
              {person.pinned ? <PinOff size={15} /> : <Pin size={15} />} <span className="btn-label">{person.pinned ? 'Unpin' : 'Pin'}</span>
            </button>
            <button className="btn btn-sm btn-ghost-danger" onClick={() => setConfirming(true)} title="Delete">
              <Trash2 size={15} /> <span className="btn-label">Delete</span>
            </button>
          </>
        )}
        <button className="icon-btn" onClick={() => setToKeep(true)} title="Copy to Google Keep" aria-label="Copy to Google Keep">
          <StickyNote size={17} />
        </button>
        {person.panelBg && !viewOnly && (
          <button
            className="icon-btn"
            title="Remove the panel background"
            aria-label="Remove the panel background"
            onClick={async () => {
              const undo = await setPanelBackground(person, undefined);
              toast('Panel background removed', { undo });
            }}
          >
            <ImageMinus size={17} />
          </button>
        )}
        <span className="grow" />
        {nav && nav.total > 1 && (
          <div className="panel-nav">
            <button className="icon-btn" aria-label="Previous person" title="Previous (←)" onClick={nav.onPrev} disabled={nav.index <= 0}>
              <ChevronLeft size={18} />
            </button>
            <span className="muted small" aria-live="polite">
              {(nav.index + 1).toLocaleString()} / {nav.total.toLocaleString()}
            </span>
            <button className="icon-btn" aria-label="Next person" title="Next (→)" onClick={nav.onNext} disabled={nav.index >= nav.total - 1}>
              <ChevronRight size={18} />
            </button>
          </div>
        )}
        <button className="icon-btn" aria-label="Close panel" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      {/* key: swap content in place when another card is selected */}
      <div className="panel-body" key={person.id}>
        <div className="panel-head">
          <PanelAvatar person={person} />
          <div className="panel-head-text">
            <h2 className="panel-name">{person.name}</h2>
            {(person.nationality || person.birthYear) && (
              <div className="panel-facts">
                {person.nationality && (
                  <span title="Nationality">
                    <Flag nationality={person.nationality} /> {person.nationality}
                  </span>
                )}
                {person.birthYear && (
                  <span title={`Born ${person.birthYear}`}>
                    <Cake size={14} /> {ageFromBirthYear(person.birthYear)} yrs
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {narrow && (
          <div className="panel-section">
            <PersonPhotos person={person} compact onNeedsPermission={allowAccess} />
          </div>
        )}

        {labels.length > 0 && (
          <section className="panel-section">
            <h3>Labels</h3>
            <div className="chip-wrap">
              {labels.map((l) => (
                <LabelChip
                  key={l.id}
                  label={l}
                  groupName={l.groupId ? groupMap.get(l.groupId)?.name : undefined}
                  onClick={() => onLabelClick(l.id)}
                  title="Filter the grid by this label"
                />
              ))}
            </div>
          </section>
        )}

        {/* Links as icons only; hover shows where it goes, click opens it in a new tab. */}
        {person.socialLinks.length > 0 && (
          <section className="panel-section">
            <h3>Links</h3>
            <div className="link-icons">
              {person.socialLinks.map((l, i) => (
                <a
                  key={i}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-icon-btn"
                  data-platform={l.platform}
                  title={`${linkTitle(l)} — ${hostOf(l.url)}`}
                  aria-label={`${linkTitle(l)}: ${hostOf(l.url)} (opens in a new tab)`}
                >
                  <SocialIcon platform={l.platform} size={22} />
                </a>
              ))}
            </div>
          </section>
        )}

        {person.bio && (
          <section className="panel-section">
            <h3>Notes</h3>
            <p className="bio">{person.bio}</p>
          </section>
        )}
      </div>

      {toKeep && <KeepExportDialog person={person} onClose={() => setToKeep(false)} />}
      {confirming && (
        <ConfirmDialog
          title="Delete person?"
          message={
            <>
              <strong>{person.name}</strong> will be removed from the directory. The photo itself is not touched.
            </>
          }
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            const undo = await deletePerson(person.id);
            onClose();
            toast(`Deleted ${person.name}`, { undo });
          }}
        />
      )}
    </PanelShell>
  );
}
