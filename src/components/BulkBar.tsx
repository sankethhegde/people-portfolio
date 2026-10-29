import { useMemo, useState } from 'react';
import { CheckSquare, Tag, Tags, Trash2, X } from 'lucide-react';
import { db } from '../db';
import { useData } from '../lib/data';
import { bulkDeletePeople, bulkSetLabel, labelFullName } from '../lib/store';
import { LabelInput } from './LabelInput';
import { ConfirmDialog } from './Modal';
import { useToast } from './Toasts';

interface Props {
  checkedIds: Set<string>;
  /** Ids of everyone currently shown, for "Select all". */
  visibleIds: string[];
  onChange: (ids: Set<string>) => void;
  onDone: () => void;
}

/** FR-34: act on several selected people at once. */
export function BulkBar({ checkedIds, visibleIds, onChange, onDone }: Props) {
  const { people, labelMap, groupMap } = useData();
  const toast = useToast();
  const [popover, setPopover] = useState<'add' | 'remove' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ids = [...checkedIds];
  const n = ids.length;

  // Labels carried by at least one selected person, with how many carry each.
  const present = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of people) if (checkedIds.has(p.id)) for (const l of p.labelIds) counts.set(l, (counts.get(l) ?? 0) + 1);
    return [...counts]
      .map(([id, count]) => ({ label: labelMap.get(id), count }))
      .filter((x) => x.label)
      .sort((a, b) => b.count - a.count);
  }, [people, checkedIds, labelMap]);

  async function apply(labelId: string, add: boolean) {
    setPopover(null);
    // A label created a moment ago isn't in the live data yet, so read it from the database.
    const label = labelMap.get(labelId) ?? (await db.labels.get(labelId));
    const { changed, undo } = await bulkSetLabel(ids, labelId, add);
    const group = label?.groupId ? (groupMap.get(label.groupId) ?? (await db.groups.get(label.groupId))) : undefined;
    const name = label ? (group ? `${group.name}: ${label.name}` : label.name) : 'label';
    toast(`${add ? 'Added' : 'Removed'} “${name}” ${add ? 'to' : 'from'} ${changed} ${changed === 1 ? 'person' : 'people'}`, { undo });
  }

  const allShown = visibleIds.length > 0 && visibleIds.every((id) => checkedIds.has(id));

  return (
    <div className="bulkbar" role="toolbar" aria-label="Bulk actions">
      <strong className="bulk-count">{n.toLocaleString()} selected</strong>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={() => onChange(allShown ? new Set() : new Set([...checkedIds, ...visibleIds]))}
      >
        <CheckSquare size={15} /> {allShown ? 'Select none' : `Select all ${visibleIds.length.toLocaleString()} shown`}
      </button>
      <span className="grow" />
      <div className="popover-wrap">
        <button type="button" className="btn btn-sm" disabled={!n} onClick={() => setPopover(popover === 'add' ? null : 'add')} aria-expanded={popover === 'add'}>
          <Tag size={15} /> Add label
        </button>
        {popover === 'add' && (
          <div className="popover" role="dialog" aria-label="Add a label to the selected people">
            {/* LabelInput reports its full list; whatever was just added is the label to apply. */}
            <LabelInput value={[]} onChange={(next) => next.length && apply(next[next.length - 1], true)} />
          </div>
        )}
      </div>
      <div className="popover-wrap">
        <button type="button" className="btn btn-sm" disabled={!present.length} onClick={() => setPopover(popover === 'remove' ? null : 'remove')} aria-expanded={popover === 'remove'}>
          <Tags size={15} /> Remove label
        </button>
        {popover === 'remove' && (
          <div className="popover" role="dialog" aria-label="Remove a label from the selected people">
            <ul className="popover-list">
              {present.map(({ label, count }) => (
                <li key={label!.id}>
                  <button type="button" onClick={() => apply(label!.id, false)}>
                    <span className="chip-dot" style={{ background: label!.color }} />
                    <span className="grow">{labelFullName(label!, groupMap)}</span>
                    <span className="muted">{count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <button type="button" className="btn btn-sm btn-ghost-danger" disabled={!n} onClick={() => setConfirmDelete(true)}>
        <Trash2 size={15} /> Delete
      </button>
      <button type="button" className="btn btn-sm btn-primary" onClick={onDone}>
        <X size={15} /> Done
      </button>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}?`}
          message="They are removed from the directory. Photos in your folders and Drive are not touched."
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false);
            const undo = await bulkDeletePeople(ids);
            onChange(new Set());
            toast(`Deleted ${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}`, { undo });
          }}
        />
      )}
    </div>
  );
}
