import { Bookmark, X } from 'lucide-react';
import { requestOpenPhoto } from '../lib/motion';
import { toggleMarked } from '../lib/store';
import { photoKey } from '../photos';
import type { Person } from '../types';
import { PhotoThumbImg } from './PhotoThumb';
import { useToast } from './Toasts';

/**
 * Marked photos, small, docked at the bottom of the panel. They fill from the bottom up: the first
 * one marked sits bottom-left and newer ones stack above. Click one to open it full size.
 */
export function MarkedStrip({ person, viewOnly }: { person: Person; viewOnly: boolean }) {
  const toast = useToast();
  const marked = person.marked ?? [];

  return (
    <section className="marked-strip" aria-label={`Marked photos of ${person.name}`}>
      <h3>
        <Bookmark size={13} fill="currentColor" /> Marked <span className="muted">· {marked.length}</span>
      </h3>
      <div className="marked-scroll">
        <ul className="marked-grid">
          {marked.map((p, i) => (
            <li key={photoKey(p)} className="marked-thumb" data-photo-key={photoKey(p)}>
              <button
                type="button"
                className="marked-open"
                title={`Marked photo ${i + 1}: click to open`}
                aria-label={`Open marked photo ${i + 1} of ${marked.length}`}
                onClick={(e) => {
                  if (!requestOpenPhoto({ personId: person.id, photo: p, from: e.currentTarget.parentElement ?? undefined })) {
                    toast('That photo isn’t in this person’s gallery any more.', { kind: 'error' });
                  }
                }}
              >
                <PhotoThumbImg photo={p} alt="" />
              </button>
              {!viewOnly && (
                <button
                  type="button"
                  className="marked-remove"
                  title="Unmark"
                  aria-label={`Unmark photo ${i + 1}`}
                  onClick={async () => {
                    const { undo } = await toggleMarked(person, p);
                    toast('Unmarked', { undo });
                  }}
                >
                  <X size={11} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
