import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Check, Pin } from 'lucide-react';
import { usePrefs } from '../lib/prefs';
import { setPinned } from '../lib/store';
import { useData } from '../lib/data';
import type { Label, Person } from '../types';
import { CardPhoto } from './PersonPhoto';
import { textOn } from '../lib/colors';

const GAP = 14;
const MIN_CARD = 180;
const CARD_META = 64; // name + label row under the photo
const PHOTO_RATIO = 1.2; // photo height / width

interface Props {
  people: Person[];
  selectedId?: string;
  onSelect: (id: string) => void;
  /** Selection mode for bulk actions: clicks tick cards instead of opening them. */
  checkedIds?: Set<string>;
  onToggleCheck?: (id: string, range: boolean) => void;
  /** When the grid reappears (back from a person), scroll to and focus this card. */
  revealId?: string;
}

/** Virtualised so thousands of people stay smooth: only visible rows are in the DOM. */
export function PersonGrid({ people, selectedId, onSelect, checkedIds, onToggleCheck, revealId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(2, Math.floor((width + GAP) / (MIN_CARD + GAP)));
  const cardW = width ? (width - GAP * (cols - 1)) / cols : MIN_CARD;
  const rowH = Math.round(cardW * PHOTO_RATIO + CARD_META);
  const rows = Math.ceil(people.length / cols);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH + GAP,
    overscan: 3,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowH, virtualizer]);

  // Keep the selected card in view (after the panel opens, prev/next, or a new person appearing).
  // `found` re-runs this once a newly added person first appears in the list.
  const selectedIndex = selectedId ? people.findIndex((p) => p.id === selectedId) : -1;
  const found = selectedIndex >= 0;
  useEffect(() => {
    if (found) virtualizer.scrollToIndex(Math.floor(selectedIndex / cols), { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, cols, found]);

  /** Focus a card by index, scrolling its row into the DOM first (it may not be rendered yet). */
  function focusIndex(i: number) {
    const id = people[i]?.id;
    if (!id) return;
    virtualizer.scrollToIndex(Math.floor(i / cols), { align: 'auto' });
    let tries = 0;
    const tryFocus = () => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-person-id="${CSS.escape(id)}"]`);
      if (el) el.focus({ preventScroll: false });
      else if (tries++ < 10) requestAnimationFrame(tryFocus);
    };
    // Usually the card is already rendered; otherwise wait for the virtualiser to draw its row.
    tryFocus();
  }

  // Once the grid has a width (so the column count is right), bring back the last person viewed.
  const revealed = useRef(false);
  useEffect(() => {
    if (revealed.current || !width || !revealId) return;
    revealed.current = true;
    const i = people.findIndex((p) => p.id === revealId);
    if (i >= 0) focusIndex(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  // FR-06: arrows move between cards, Home/End jump; Enter/Space activate (native button behaviour).
  function onKeyDown(e: KeyboardEvent) {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-person-id]');
    if (!card || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = people.findIndex((p) => p.id === card.dataset.personId);
    if (i < 0) return;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
    let next: number | undefined;
    if (e.key in step) next = i + step[e.key];
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = people.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    focusIndex(Math.min(Math.max(next, 0), people.length - 1));
  }

  return (
    <div className="grid-scroll" ref={scrollRef} onKeyDown={onKeyDown}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="grid-row"
            style={{
              transform: `translateY(${row.start}px)`,
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gap: GAP,
              height: rowH,
            }}
          >
            {people.slice(row.index * cols, row.index * cols + cols).map((p) => (
              <PersonCard
                key={p.id}
                person={p}
                selected={p.id === selectedId}
                checked={checkedIds ? checkedIds.has(p.id) : undefined}
                onSelect={onSelect}
                onToggleCheck={onToggleCheck}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const MAX_CHIPS = 3;

const PersonCard = memo(function PersonCard({
  person,
  selected,
  checked,
  onSelect,
  onToggleCheck,
}: {
  person: Person;
  selected: boolean;
  /** undefined = not in selection mode */
  checked?: boolean;
  onSelect: (id: string) => void;
  onToggleCheck?: (id: string, range: boolean) => void;
}) {
  const { labelMap } = useData();
  const labels = person.labelIds.map((id) => labelMap.get(id)).filter((l): l is Label => !!l);
  const shown = labels.slice(0, MAX_CHIPS);
  const more = labels.length - shown.length;
  const selecting = checked !== undefined;
  const { viewOnly } = usePrefs();

  const onClick = (e: MouseEvent) => {
    if (selecting) onToggleCheck?.(person.id, e.shiftKey);
    else onSelect(person.id);
  };

  return (
    <div className={`card-wrap ${person.pinned ? 'is-pinned' : ''}`}>
    <button
      type="button"
      className={`card ${selected && !selecting ? 'card-selected' : ''} ${checked ? 'card-checked' : ''}`}
      onClick={onClick}
      aria-pressed={selecting ? checked : selected}
      aria-label={selecting ? `${checked ? 'Deselect' : 'Select'} ${person.name}` : undefined}
      data-person-id={person.id}
    >
      <div className="card-photo">
        <CardPhoto person={person} />
        {selecting && (
          <span className={`card-check ${checked ? 'on' : ''}`} aria-hidden="true">
            {checked && <Check size={14} strokeWidth={3} />}
          </span>
        )}
      </div>
      <div className="card-meta">
        <div className="card-name" title={person.name}>
          {person.name}
        </div>
        <div className="card-chips">
          {shown.map((l) => (
            <span key={l.id} className="mini-chip" style={{ background: l.color, color: textOn(l.color) }} title={l.name}>
              {l.name}
            </span>
          ))}
          {more > 0 && <span className="mini-chip mini-chip-more">+{more}</span>}
        </div>
      </div>
    </button>
    {/* Pin: a sibling of the card button (buttons can't nest). Shown on hover, always when pinned. */}
    {!selecting &&
      (viewOnly ? (
        person.pinned && (
          <span className="card-pin on" title="Pinned">
            <Pin size={14} fill="currentColor" />
          </span>
        )
      ) : (
        <button
          type="button"
          className={`card-pin ${person.pinned ? 'on' : ''}`}
          title={person.pinned ? 'Unpin' : 'Pin to the top'}
          aria-label={person.pinned ? `Unpin ${person.name}` : `Pin ${person.name} to the top`}
          aria-pressed={!!person.pinned}
          onClick={() => setPinned(person.id, !person.pinned)}
        >
          <Pin size={14} fill={person.pinned ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
});
