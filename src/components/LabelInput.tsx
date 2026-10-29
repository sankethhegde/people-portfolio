import { useId, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useData } from '../lib/data';
import { findOrCreateLabel, labelFullName } from '../lib/store';
import { LabelChip } from './LabelChip';
import { useToast } from './Toasts';

const MAX_SUGGESTIONS = 8;

/** Chips + autocomplete. Enter picks the highlighted label or creates "Group: Label" from the text (FR-31). */
export function LabelInput({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { labels, labelMap, groupMap, labelCounts } = useData();
  const toast = useToast();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const listId = useId();

  const q = text.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const chosen = new Set(value);
    return labels
      .filter((l) => !chosen.has(l.id))
      .map((l) => ({ l, full: labelFullName(l, groupMap) }))
      .filter(({ full }) => !q || full.toLowerCase().includes(q))
      .sort((a, b) => (labelCounts.get(b.l.id) ?? 0) - (labelCounts.get(a.l.id) ?? 0))
      .slice(0, MAX_SUGGESTIONS);
  }, [labels, value, q, groupMap, labelCounts]);

  const exact = suggestions.some(({ full }) => full.toLowerCase() === q);
  const options: { kind: 'pick' | 'create'; id?: string; text: string }[] = [
    ...suggestions.map(({ l, full }) => ({ kind: 'pick' as const, id: l.id, text: full })),
    ...(q && !exact ? [{ kind: 'create' as const, text: text.trim() }] : []),
  ];

  async function choose(i: number) {
    const opt = options[i];
    if (!opt) return;
    let id = opt.id;
    if (opt.kind === 'create') {
      const created = await findOrCreateLabel(opt.text);
      if (!created) return;
      id = created.id;
      toast(`Label “${labelFullName(created, groupMap)}” created`);
    }
    if (id && !value.includes(id)) onChange([...value, id]);
    setText('');
    setHi(0);
  }

  return (
    <div className="label-input">
      <div className="label-input-chips">
        {value.map((id) => {
          const l = labelMap.get(id);
          if (!l) return null;
          const g = l.groupId ? groupMap.get(l.groupId)?.name : undefined;
          return <LabelChip key={id} label={l} groupName={g} small onRemove={() => onChange(value.filter((x) => x !== id))} />;
        })}
      </div>
      <div className="combo">
        <input
          className="input"
          value={text}
          placeholder="Add a label, e.g. Relation: Friend"
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(e) => {
            setText(e.target.value);
            setHi(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              // With text typed and no list highlight match, Enter creates.
              choose(Math.min(hi, options.length - 1));
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        {open && options.length > 0 && (
          <ul className="combo-list" id={listId} role="listbox">
            {options.map((o, i) => {
              const l = o.id ? labelMap.get(o.id) : undefined;
              return (
                <li
                  key={o.id ?? 'create'}
                  role="option"
                  aria-selected={i === hi}
                  className={i === hi ? 'active' : ''}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(i);
                  }}
                  onMouseEnter={() => setHi(i)}
                >
                  {l ? (
                    <>
                      <span className="chip-dot" style={{ background: l.color }} />
                      <span className="grow">{o.text}</span>
                      <span className="muted">{labelCounts.get(l.id) ?? 0}</span>
                    </>
                  ) : (
                    <>
                      <Plus size={14} /> Create “{o.text}”
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="hint">Type “Group: Label” to put a new label in a group.</p>
    </div>
  );
}
