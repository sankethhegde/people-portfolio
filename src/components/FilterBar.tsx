import { useState } from 'react';
import { ChevronDown, ChevronUp, ImageOff } from 'lucide-react';
import { groupedLabels, useData } from '../lib/data';
import type { FilterState } from '../lib/filters';
import { LabelChip } from './LabelChip';

interface Props {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  resultCount: number;
  total: number;
  /** People whose photo is known to be missing. */
  missingCount: number;
  /** Linked folders whose photo count isn't known yet. */
  uncountedFolders: number;
  onCountFolders: () => void;
}

/** Label filter chips grouped by label group, with any/all switch, count and clear (FR-41, FR-42). */
export function FilterBar({ filters, onChange, resultCount, total, missingCount, uncountedFolders, onCountFolders }: Props) {
  const { labels, groups, labelCounts } = useData();
  const [expanded, setExpanded] = useState(false);
  const active = new Set(filters.labelIds);
  const isFiltered = filters.q.trim() !== '' || filters.labelIds.length > 0 || filters.missingOnly || filters.photos !== 'any';
  const photoView = filters.sort.startsWith('photos') || filters.photos !== 'any';

  const toggle = (id: string) =>
    onChange({ ...filters, labelIds: active.has(id) ? filters.labelIds.filter((x) => x !== id) : [...filters.labelIds, id] });

  return (
    <div className="filterbar">
      <div className="filterbar-top">
        <span className="result-count" aria-live="polite">
          {isFiltered ? (
            <>
              <strong>{resultCount.toLocaleString()}</strong> of {total.toLocaleString()} people
            </>
          ) : (
            <>
              <strong>{total.toLocaleString()}</strong> {total === 1 ? 'person' : 'people'}
            </>
          )}
        </span>
        {filters.labelIds.length > 1 && (
          <div className="segmented" role="radiogroup" aria-label="Label match">
            {(['any', 'all'] as const).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={filters.mode === m}
                className={filters.mode === m ? 'on' : ''}
                onClick={() => onChange({ ...filters, mode: m })}
              >
                Match {m}
              </button>
            ))}
          </div>
        )}
        {isFiltered && (
          <button className="btn btn-sm btn-ghost" onClick={() => onChange({ ...filters, q: '', labelIds: [], missingOnly: false, photos: 'any' })}>
            Clear filters
          </button>
        )}
        {(missingCount > 0 || filters.missingOnly) && (
          <button
            className={'btn btn-sm ' + (filters.missingOnly ? 'btn-toggle-on' : 'btn-ghost')}
            aria-pressed={filters.missingOnly}
            onClick={() => onChange({ ...filters, missingOnly: !filters.missingOnly })}
            title="Show only people whose photo is gone from its folder"
          >
            <ImageOff size={15} /> Missing photo ({missingCount})
          </button>
        )}
        <select
          className={`input select photos-filter ${filters.photos !== 'any' ? 'is-on' : ''}`}
          value={filters.photos}
          onChange={(e) => onChange({ ...filters, photos: e.target.value as FilterState['photos'] })}
          aria-label="Filter by photos"
        >
          <option value="any">Photos: any</option>
          <option value="with">Has photos</option>
          <option value="without">No photos</option>
        </select>
        {photoView && uncountedFolders > 0 && (
          <span className="muted small uncounted">
            {uncountedFolders} linked folder{uncountedFolders === 1 ? '' : 's'} not counted yet ·{' '}
            <button type="button" className="link-btn" onClick={onCountFolders}>
              Count now
            </button>
          </span>
        )}
        <span className="grow" />
        {labels.length > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
            Labels {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        )}
      </div>

      {/* Active filters always visible, even when the label list is collapsed. */}
      {!expanded && filters.labelIds.length > 0 && <ActiveChips ids={filters.labelIds} onToggle={toggle} />}

      {expanded && (
        <div className="filter-groups">
          {groupedLabels(labels, groups).map(({ group, labels: ls }) =>
            ls.length ? (
              <div key={group?.id ?? 'ungrouped'} className="filter-group">
                <span className="filter-group-name">{group?.name ?? 'Ungrouped'}</span>
                <div className="chip-wrap">
                  {ls.map((l) => (
                    <LabelChip key={l.id} label={l} active={active.has(l.id)} count={labelCounts.get(l.id) ?? 0} onClick={() => toggle(l.id)} small />
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function ActiveChips({ ids, onToggle }: { ids: string[]; onToggle: (id: string) => void }) {
  const { labelMap, groupMap } = useData();
  return (
    <div className="chip-wrap">
      {ids.map((id) => {
        const l = labelMap.get(id);
        if (!l) return null;
        return (
          <LabelChip
            key={id}
            label={l}
            groupName={l.groupId ? groupMap.get(l.groupId)?.name : undefined}
            small
            onRemove={() => onToggle(id)}
          />
        );
      })}
    </div>
  );
}
