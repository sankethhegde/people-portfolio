import { useState } from 'react';
import { Cloud, FolderOpen, HardDrive, ImagePlus, Link2, Star, Unlink, X } from 'lucide-react';
import { photoKey, refreshFolder, retryPhotos, useFolderImages } from '../photos';
import { signIn } from '../photos/driveAuth';
import { withCover } from '../lib/store';
import type { LinkedFolder, Person, PhotoRef } from '../types';
import { PhotoPicker, type PickerMode } from './PhotoPicker';
import { LazyThumb } from './PhotoThumb';
import { useToast } from './Toasts';

/** Folder photos shown in the editor; the full set is in the photo view. */
const EDITOR_FOLDER_PREVIEW = 23;

interface Props {
  draft: Person;
  /** Applies a change to the person's cover / photos / folder. */
  update: (patch: Pick<Person, 'photo' | 'photos' | 'folder'>) => void;
}

/**
 * A person's photos: one cover (shown on the card), photos picked one by one, and an
 * optional linked folder whose photos join the gallery automatically.
 */
export function GalleryEditor({ draft, update }: Props) {
  const toast = useToast();
  const [picker, setPicker] = useState<PickerMode | null>(null);
  const folder = useFolderImages(draft.folder);
  const picked = draft.photos ?? [];
  const pickedKeys = new Set(picked.map(photoKey));
  const coverKey = draft.photo ? photoKey(draft.photo) : '';
  const folderOnly = folder.images.filter((p) => photoKey(p) !== coverKey && !pickedKeys.has(photoKey(p)));
  const total = (draft.photo ? 1 : 0) + picked.length + folderOnly.length;

  function addPhotos(refs: PhotoRef[]) {
    const have = new Set([coverKey, ...pickedKeys]);
    const fresh = refs.filter((r) => !have.has(photoKey(r)));
    if (!fresh.length) return toast('Those photos are already in the gallery');
    const [first, ...rest] = fresh;
    if (!draft.photo) update({ photo: first, photos: [...picked, ...rest], folder: draft.folder });
    else update({ photo: draft.photo, photos: [...picked, ...fresh], folder: draft.folder });
    toast(`Added ${fresh.length} ${fresh.length === 1 ? 'photo' : 'photos'}`);
  }

  function setCover(ref: PhotoRef) {
    update({ ...withCover(draft, ref, folder.images), folder: draft.folder });
  }

  function remove(ref: PhotoRef) {
    if (photoKey(ref) === coverKey) {
      // The next photo becomes the cover so the card keeps a picture.
      const [next, ...rest] = picked;
      update({ photo: next ?? folderOnly[0], photos: rest, folder: draft.folder });
    } else {
      update({ photo: draft.photo, photos: picked.filter((p) => photoKey(p) !== photoKey(ref)), folder: draft.folder });
    }
  }

  function link(f: LinkedFolder, images: PhotoRef[]) {
    refreshFolder(f);
    update({ photo: draft.photo ?? images[0], photos: picked, folder: f });
    toast(`Linked “${f.name}” — ${images.length} ${images.length === 1 ? 'photo' : 'photos'}`);
  }

  const tile = (ref: PhotoRef, kind: 'cover' | 'picked' | 'folder') => (
    <div key={photoKey(ref)} className={`gallery-tile ${kind === 'cover' ? 'gallery-cover' : ''}`}>
      <LazyThumb photo={ref} alt={draft.name} />
      {kind === 'cover' && <span className="gallery-badge">Cover</span>}
      {kind === 'folder' && (
        <span className="gallery-badge gallery-badge-folder" title="From the linked folder">
          <FolderOpen size={11} />
        </span>
      )}
      <div className="gallery-actions">
        {kind !== 'cover' && (
          <button type="button" className="gallery-btn" title="Make this the cover photo" aria-label="Make cover" onClick={() => setCover(ref)}>
            <Star size={13} />
          </button>
        )}
        {kind !== 'folder' && (
          <button type="button" className="gallery-btn" title="Remove from gallery" aria-label="Remove photo" onClick={() => remove(ref)}>
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="field">
      <span>Photos {total > 0 && <span className="muted">({total})</span>}</span>
      {total > 0 ? (
        <div className="gallery-grid">
          {draft.photo && tile(draft.photo, 'cover')}
          {picked.map((p) => tile(p, 'picked'))}
          {folderOnly.slice(0, EDITOR_FOLDER_PREVIEW).map((p) => tile(p, 'folder'))}
        </div>
      ) : null}
      {folderOnly.length > EDITOR_FOLDER_PREVIEW && (
        <p className="hint">
          …and {(folderOnly.length - EDITOR_FOLDER_PREVIEW).toLocaleString()} more from the linked folder (all shown in the photo view).
        </p>
      )}
      {total === 0 && (
        <p className="hint">No photos yet. The first one you add becomes the cover shown on the card.</p>
      )}
      <div className="row-gap">
        <button type="button" className="btn btn-sm" onClick={() => setPicker('multi')}>
          <ImagePlus size={15} /> Add photos
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setPicker('folder')}>
          <Link2 size={15} /> {draft.folder ? 'Change folder' : 'Link a folder'}
        </button>
      </div>

      {draft.folder && (
        <div className="linked-folder">
          {draft.folder.source === 'gdrive' ? <Cloud size={15} /> : <HardDrive size={15} />}
          <span className="grow">
            Linked: <strong>{draft.folder.name}</strong>{' '}
            <span className="muted">
              {folder.status === 'loading' && '— reading…'}
              {folder.status === 'ok' && `— ${folder.images.length} ${folder.images.length === 1 ? 'photo' : 'photos'}`}
              {folder.status === 'missing' && '— folder not found'}
            </span>
          </span>
          {folder.status === 'needs-permission' && draft.folder.source === 'gdrive' && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                try {
                  if (await signIn()) retryPhotos();
                } catch (e) {
                  toast((e as Error).message, { kind: 'error' });
                }
              }}
            >
              Sign in to see photos
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            title="Unlink folder (photos stay in the folder)"
            aria-label="Unlink folder"
            onClick={() => {
              // If the cover came from the folder, keep it as a picked photo rather than losing it.
              update({ photo: draft.photo, photos: picked, folder: undefined });
            }}
          >
            <Unlink size={15} />
          </button>
        </div>
      )}

      {picker && (
        <PhotoPicker
          mode={picker}
          hint={draft.name}
          initialSource={draft.folder?.source ?? draft.photo?.source}
          onClose={() => setPicker(null)}
          onPickMany={(refs) => {
            addPhotos(refs);
            setPicker(null);
          }}
          onPickFolder={(f, images) => {
            link(f, images);
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}
