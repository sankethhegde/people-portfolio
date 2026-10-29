import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { LABEL_COLORS } from '../lib/colors';
import { groupedLabels, useData } from '../lib/data';
import { deleteGroup, deleteLabel, findOrCreateGroup, findOrCreateLabel, labelFullName, mergeLabel, renameGroup, updateLabel } from '../lib/store';
import type { Label } from '../types';
import { Modal } from './Modal';
import { useToast } from './Toasts';

/** Create, rename, recolour, regroup, merge and delete labels and label groups (FR-32, FR-33). */
export function LabelManager({ onClose }: { onClose: () => void }) {
  const { labels, groups, labelCounts } = useData();
  const toast = useToast();
  const [newGroup, setNewGroup] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, { kind: 'error' });
    }
  };

  return (
    <Modal title="Labels" onClose={onClose} wide>
      <div className="lm-create">
        <form
          className="row-gap"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newLabel.trim()) return;
            run(async () => {
              await findOrCreateLabel(newLabel);
              setNewLabel('');
            });
          }}
        >
          <input className="input" placeholder="New label, e.g. City: Udupi" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <button className="btn btn-sm" type="submit">
            <Plus size={15} /> Label
          </button>
        </form>
        <form
          className="row-gap"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newGroup.trim()) return;
            run(async () => {
              await findOrCreateGroup(newGroup);
              setNewGroup('');
            });
          }}
        >
          <input className="input" placeholder="New group, e.g. Relation" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
          <button className="btn btn-sm" type="submit">
            <Plus size={15} /> Group
          </button>
        </form>
      </div>

      {!labels.length && !groups.length && <p className="muted">No labels yet. Create one above or while editing a person.</p>}

      {groupedLabels(labels, groups).map(({ group, labels: ls }) => (
        <section key={group?.id ?? 'ungrouped'} className="lm-group">
          <div className="lm-group-head">
            {group ? (
              <>
                <input
                  className="input input-inline lm-group-name"
                  defaultValue={group.name}
                  aria-label="Group name"
                  onBlur={(e) => e.target.value !== group.name && run(() => renameGroup(group.id, e.target.value))}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                <button
                  className="icon-btn"
                  title="Delete group (its labels become ungrouped)"
                  aria-label={`Delete group ${group.name}`}
                  onClick={() =>
                    run(async () => {
                      await deleteGroup(group.id);
                      toast(`Group “${group.name}” deleted`);
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </>
            ) : (
              <h3 className="lm-group-name">Ungrouped</h3>
            )}
          </div>
          {ls.length === 0 && <p className="muted small">No labels in this group.</p>}
          {ls.map((l) => (
            <LabelRow key={l.id} label={l} count={labelCounts.get(l.id) ?? 0} run={run} />
          ))}
        </section>
      ))}
    </Modal>
  );
}

function LabelRow({ label, count, run }: { label: Label; count: number; run: (fn: () => Promise<unknown>) => void }) {
  const { groups, labels, groupMap } = useData();
  const toast = useToast();
  const others = labels
    .filter((l) => l.id !== label.id)
    .map((l) => ({ id: l.id, name: labelFullName(l, groupMap) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="lm-row">
      <ColorPicker value={label.color} onChange={(color) => run(() => updateLabel(label.id, { color }))} />
      <input
        className="input input-inline grow"
        defaultValue={label.name}
        key={label.name}
        aria-label="Label name"
        onBlur={(e) => e.target.value !== label.name && run(() => updateLabel(label.id, { name: e.target.value }))}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <select
        className="input select lm-select"
        value={label.groupId ?? ''}
        aria-label="Group"
        onChange={(e) => run(() => updateLabel(label.id, { groupId: e.target.value || undefined }))}
      >
        <option value="">Ungrouped</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      {others.length > 0 && (
        <select
          className="input select lm-select lm-merge"
          value=""
          aria-label={`Merge ${label.name} into another label`}
          title="Merge into another label: its people move over and this label is deleted"
          onChange={(e) => {
            const into = others.find((o) => o.id === e.target.value);
            if (!into) return;
            run(async () => {
              const undo = await mergeLabel(label.id, into.id);
              toast(`Merged “${label.name}” into “${into.name}”`, { undo });
            });
          }}
        >
          <option value="">Merge into…</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      <span className="muted lm-count" title="People with this label">
        {count}
      </span>
      <button
        className="icon-btn"
        aria-label={`Delete label ${label.name}`}
        onClick={() =>
          run(async () => {
            const undo = await deleteLabel(label.id);
            toast(`Label “${label.name}” deleted${count ? ` from ${count} people` : ''}`, { undo });
          })
        }
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="color-pick">
      <button className="swatch" style={{ background: value }} aria-label="Change colour" onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="swatches" onMouseLeave={() => setOpen(false)}>
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${c === value ? 'swatch-on' : ''}`}
              style={{ background: c }}
              aria-label={c}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
