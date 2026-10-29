import { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, FolderDown, LoaderCircle } from 'lucide-react';
import { useData } from '../lib/data';
import { linkTitle } from '../lib/social';
import { ageFromBirthYear, labelFullName } from '../lib/store';
import { photoKey, sources, useGallery } from '../photos';
import type { Person, PhotoRef } from '../types';
import { Modal } from './Modal';
import { LazyThumb } from './PhotoThumb';
import { useToast } from './Toasts';

/** How many photos to offer for one Keep note. */
const MAX_KEEP_PHOTOS = 49;

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
};

/** Windows-safe folder / file name. */
const safeName = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Person';

/**
 * Google Keep has no API for personal accounts, so this prepares a note for pasting:
 * the text to copy, and the chosen photos saved to a folder to drag into the note.
 */
export function KeepExportDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const { labelMap, groupMap } = useData();
  const toast = useToast();
  const { photos } = useGallery(person);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [copied, setCopied] = useState<'title' | 'body' | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const labels = person.labelIds
    .map((id) => labelMap.get(id))
    .filter((l) => !!l)
    .map((l) => labelFullName(l!, groupMap));

  const body = useMemo(() => {
    const facts = [person.nationality && `Nationality: ${person.nationality}`, person.birthYear && `Age: ${ageFromBirthYear(person.birthYear)}`]
      .filter(Boolean)
      .join(' · ');
    const links = person.socialLinks.map((l) => `${linkTitle(l)}: ${l.url}`);
    return [facts, labels.length ? `Labels: ${labels.join(', ')}` : '', links.join('\n'), person.bio?.trim() ?? '']
      .filter(Boolean)
      .join('\n\n');
  }, [person, labels]);

  // Until the user changes it, the selection is the first 49 (the gallery may still be loading a linked
  // folder, so the default is derived rather than stored). Never more than 49 at once.
  const defaultKeys = () => new Set(photos.slice(0, MAX_KEEP_PHOTOS).map(photoKey));
  const chosenKeys = picked ?? defaultKeys();
  const chosen = photos.filter((p) => chosenKeys.has(photoKey(p)));
  const toggle = (p: PhotoRef) => {
    const k = photoKey(p);
    const next = new Set(chosenKeys);
    if (next.has(k)) next.delete(k);
    else if (next.size >= MAX_KEEP_PHOTOS) return toast(`At most ${MAX_KEEP_PHOTOS} photos per note — untick one first`);
    else next.add(k);
    setPicked(next);
  };
  const setAll = (on: boolean) => setPicked(on ? defaultKeys() : new Set());

  async function copy(which: 'title' | 'body') {
    try {
      await navigator.clipboard.writeText(which === 'title' ? person.name : body);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast('Couldn’t copy — select the text and press Ctrl+C', { kind: 'error' });
    }
  }

  async function savePhotos() {
    if (typeof window.showDirectoryPicker !== 'function') return toast('Saving photos needs Chrome or Edge', { kind: 'error' });
    let parent: FileSystemDirectoryHandle;
    try {
      parent = await window.showDirectoryPicker({ mode: 'readwrite', id: 'people-keep-export' });
    } catch {
      return; // cancelled
    }
    const dir = await parent.getDirectoryHandle(safeName(person.name), { create: true });
    let saved = 0;
    let failed = 0;
    for (const [i, p] of chosen.entries()) {
      setSaving(`Saving ${i + 1} of ${chosen.length}…`);
      try {
        // The original file (Drive needs you signed in).
        const blob = await sources[p.source].getFull(p.ref);
        const base = p.source === 'local' ? p.ref.split('/').pop()!.replace(/^idb:/, '') : p.ref;
        const hasExt = /\.[a-z0-9]{2,5}$/i.test(base);
        const name = `${String(i + 1).padStart(2, '0')}-${safeName(base)}${hasExt ? '' : `.${EXT[blob.type] ?? 'jpg'}`}`;
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        saved++;
      } catch {
        failed++;
      }
    }
    setSaving(null);
    toast(
      `Saved ${saved} photo${saved === 1 ? '' : 's'} to “${parent.name}\\${dir.name}”${failed ? ` — ${failed} couldn’t be read (sign in to Drive / connect the disk)` : ''}`,
      { kind: failed ? 'error' : 'info' },
    );
  }

  return (
    <Modal title="Copy to Google Keep" onClose={onClose} wide>
      <ol className="keep-steps">
        <li>
          <a href="https://keep.google.com/" target="_blank" rel="noopener noreferrer">
            Open Google Keep <ExternalLink size={12} />
          </a>{' '}
          and start a new note.
        </li>
        <li>Copy the title and the note text below and paste them into the note.</li>
        <li>Save the photos to a folder, then drag them from that folder into the note.</li>
        {labels.length > 0 && <li>Add the labels in Keep (⋮ → Add label): {labels.join(', ')}.</li>}
      </ol>

      <div className="keep-copy">
        <div className="keep-copy-row">
          <input className="input" readOnly value={person.name} aria-label="Note title" />
          <button type="button" className="btn btn-sm" onClick={() => copy('title')}>
            {copied === 'title' ? <Check size={15} /> : <Copy size={15} />} {copied === 'title' ? 'Copied' : 'Copy title'}
          </button>
        </div>
        <div className="keep-copy-row keep-copy-body">
          <textarea className="input" readOnly rows={Math.min(10, Math.max(3, body.split('\n').length))} value={body} aria-label="Note text" />
          <button type="button" className="btn btn-sm" onClick={() => copy('body')} disabled={!body}>
            {copied === 'body' ? <Check size={15} /> : <Copy size={15} />} {copied === 'body' ? 'Copied' : 'Copy text'}
          </button>
        </div>
      </div>

      {photos.length > 0 && (
        <>
          <div className="keep-photos-head">
            <strong>
              Photos for the note: {chosen.length} of {photos.length}
              {photos.length > MAX_KEEP_PHOTOS && ` (max ${MAX_KEEP_PHOTOS})`}
            </strong>
            <span className="grow" />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAll(true)}>
              First {Math.min(MAX_KEEP_PHOTOS, photos.length)}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAll(false)}>
              None
            </button>
            <button type="button" className="btn btn-sm btn-primary" disabled={!chosen.length || !!saving} onClick={savePhotos}>
              {saving ? <LoaderCircle size={15} className="spin" /> : <FolderDown size={15} />} {saving ?? `Save ${chosen.length} to a folder…`}
            </button>
          </div>
          <div className="keep-photo-grid">
            {photos.map((p) => {
              const on = chosenKeys.has(photoKey(p));
              return (
                <button key={photoKey(p)} type="button" className={`keep-photo ${on ? 'on' : ''}`} onClick={() => toggle(p)} aria-pressed={on}>
                  <LazyThumb photo={p} alt="" />
                  <span className={`card-check ${on ? 'on' : ''}`}>{on && <Check size={14} strokeWidth={3} />}</span>
                </button>
              );
            })}
          </div>
          <p className="muted small">
            Saved as the original files. iPhone HEIC photos may not upload to Keep; if one is refused, open it and save it as JPG first.
          </p>
        </>
      )}
    </Modal>
  );
}
