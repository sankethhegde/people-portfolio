import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { detectPlatform, normaliseUrl, PLATFORMS, validateUrl } from '../lib/social';
import { ageFromBirthYear, savePerson } from '../lib/store';
import { useData } from '../lib/data';
import type { Person, SocialLink } from '../types';
import { LabelInput } from './LabelInput';
import { NATIONALITY_SUGGESTIONS } from '../lib/nationality';
import { Flag } from './Flag';
import { GalleryEditor } from './GalleryEditor';
import { SocialIcon } from './SocialIcon';
import { useToast } from './Toasts';

const SAVE_DELAY = 500;



/** What actually gets written: trimmed fields, valid links only. */
function toSaved(d: Person): Person {
  const clean = (s?: string) => s?.trim() || undefined;
  return {
    ...d,
    name: d.name.trim(),
    bio: clean(d.bio),
    location: clean(d.location),
    email: clean(d.email),
    nationality: clean(d.nationality),
    socialLinks: d.socialLinks
      .map((l) => ({ ...l, url: l.url.trim(), title: l.platform === 'other' ? clean(l.title) : undefined }))
      .filter((l) => !validateUrl(l.url)),
  };
}

/**
 * Edits a person in place and saves automatically (FR-23). A new person is only written
 * once it has a name, so closing an empty form leaves nothing behind.
 */
export function PersonEditor({ initial, isNew, onDone }: { initial: Person; isNew: boolean; onDone: (id?: string) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Person>(() => ({ ...initial, socialLinks: initial.socialLinks.map((l) => ({ ...l })) }));
  const [touchedName, setTouchedName] = useState(false);
  // Nationalities already used plus the known list (which have flags), so spelling stays consistent.
  const { people } = useData();
  const nationalityOptions = useMemo(() => {
    const used = people.map((p) => p.nationality?.trim()).filter((n): n is string => !!n);
    return [...new Set([...used, ...NATIONALITY_SUGGESTIONS])].sort((a, b) => a.localeCompare(b));
  }, [people]);
  const saved = useRef(isNew ? '' : JSON.stringify(toSaved(initial)));
  const everSaved = useRef(!isNew);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const flush = useRef(async (quiet = false) => {
    const next = toSaved(draftRef.current);
    if (!next.name) return false;
    const json = JSON.stringify(next);
    if (json === saved.current) return true;
    saved.current = json;
    await savePerson(next);
    everSaved.current = true;
    if (!quiet) toast('Saved');
    return true;
  }).current;

  // Debounced autosave on every change.
  useEffect(() => {
    const t = setTimeout(() => flush(), SAVE_DELAY);
    return () => clearTimeout(t);
  }, [draft, flush]);

  // Save anything pending if the panel switches away mid-edit.
  useEffect(() => () => void flush(true), [flush]);

  const set = <K extends keyof Person>(k: K, v: Person[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setLink = (i: number, patch: Partial<SocialLink>) =>
    set('socialLinks', draft.socialLinks.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const nameError = touchedName && !draft.name.trim() ? 'Name is required' : null;

  async function done() {
    if (!draft.name.trim()) {
      if (isNew && !everSaved.current) return onDone(undefined);
      setTouchedName(true);
      return;
    }
    await flush();
    onDone(draft.id);
  }

  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        done();
      }}
    >
      <div className="editor-head">
        <h2>{isNew ? 'New person' : 'Edit person'}</h2>
        <button type="submit" className="btn btn-primary btn-sm">
          <Check size={15} /> Done
        </button>
      </div>

      <label className="field">
        <span>Name *</span>
        <input
          className={`input ${nameError ? 'input-error' : ''}`}
          value={draft.name}
          autoFocus={isNew}
          onChange={(e) => set('name', e.target.value)}
          onBlur={() => setTouchedName(true)}
          aria-invalid={!!nameError}
        />
        {nameError && <span className="field-error">{nameError}</span>}
      </label>

      <GalleryEditor draft={draft} update={(patch) => setDraft((d) => ({ ...d, ...patch }))} />

      <div className="field">
        <span>Labels</span>
        <LabelInput value={draft.labelIds} onChange={(ids) => set('labelIds', ids)} />
      </div>

      <div className="field">
        <span>Social links</span>
        {draft.socialLinks.map((l, i) => {
          const err = l.url.trim() ? validateUrl(l.url) : null;
          return (
            <div key={i} className="link-row">
              <div className="link-row-main">
                <span className="link-icon">
                  <SocialIcon platform={l.platform} />
                </span>
                <select
                  className="input select"
                  value={l.platform}
                  onChange={(e) => setLink(i, { platform: e.target.value as SocialLink['platform'] })}
                  aria-label="Platform"
                >
                  {PLATFORMS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove link"
                  onClick={() => set('socialLinks', draft.socialLinks.filter((_, j) => j !== i))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {l.platform === 'other' && (
                <input
                  className="input"
                  placeholder="Link name, e.g. Behance"
                  value={l.title ?? ''}
                  onChange={(e) => setLink(i, { title: e.target.value })}
                />
              )}
              <input
                className={`input ${err ? 'input-error' : ''}`}
                placeholder="https://…"
                inputMode="url"
                value={l.url}
                onChange={(e) => {
                  const url = e.target.value;
                  const detected = detectPlatform(normaliseUrl(url));
                  // Auto-pick the platform from a pasted URL unless the user chose a specific one.
                  const auto = detected && (l.platform === 'website' || l.platform === 'other' || !l.url);
                  setLink(i, auto ? { url, platform: detected } : { url });
                }}
                onBlur={() => setLink(i, { url: normaliseUrl(l.url) })}
                aria-invalid={!!err}
              />
              {err && <span className="field-error">{err} — not saved until fixed</span>}
            </div>
          );
        })}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => set('socialLinks', [...draft.socialLinks, { platform: 'website', url: '' }])}
        >
          <Plus size={15} /> Add link
        </button>
      </div>

      <label className="field">
        <span>Bio / notes</span>
        <textarea className="input" rows={3} value={draft.bio ?? ''} onChange={(e) => set('bio', e.target.value)} />
      </label>
      <div className="field-row field-row-nat">
        <label className="field">
          <span>Nationality</span>
          <div className="input-with-flag">
            <Flag nationality={draft.nationality} />
            <input
              className="input"
              list="nationality-options"
              value={draft.nationality ?? ''}
              onChange={(e) => set('nationality', e.target.value)}
              placeholder="e.g. Indian"
            />
          </div>
          <datalist id="nationality-options">
            {nationalityOptions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Age</span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            max={130}
            value={draft.birthYear ? ageFromBirthYear(draft.birthYear) : ''}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              set('birthYear', Number.isFinite(n) && n >= 0 && n <= 130 ? new Date().getFullYear() - n : undefined);
            }}
          />
        </label>
      </div>

    </form>
  );
}
