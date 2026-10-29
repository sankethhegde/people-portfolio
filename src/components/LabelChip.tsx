import { X } from 'lucide-react';
import { textOn } from '../lib/colors';
import type { Label } from '../types';

interface Props {
  label: Label;
  groupName?: string;
  onClick?: () => void;
  onRemove?: () => void;
  active?: boolean;
  count?: number;
  small?: boolean;
  title?: string;
}

export function LabelChip({ label, groupName, onClick, onRemove, active, count, small, title }: Props) {
  const style = active || active === undefined
    ? { background: label.color, color: textOn(label.color), borderColor: label.color }
    : { borderColor: label.color, color: 'var(--text)' };
  const content = (
    <>
      {active === false && <span className="chip-dot" style={{ background: label.color }} />}
      {groupName && <span className="chip-group">{groupName}:</span>}
      <span className="chip-name">{label.name}</span>
      {count !== undefined && <span className="chip-count">{count}</span>}
    </>
  );
  const cls = `chip ${small ? 'chip-sm' : ''} ${active === false ? 'chip-outline' : ''}`;
  return (
    <span className={cls} style={style} title={title ?? (groupName ? `${groupName}: ${label.name}` : label.name)}>
      {onClick ? (
        <button type="button" className="chip-btn" onClick={onClick} aria-pressed={active}>
          {content}
        </button>
      ) : (
        content
      )}
      {onRemove && (
        <button type="button" className="chip-remove" aria-label={`Remove ${label.name}`} onClick={onRemove}>
          <X size={12} />
        </button>
      )}
    </span>
  );
}
