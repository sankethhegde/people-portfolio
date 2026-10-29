import { useState, type ReactNode } from 'react';
import { PANEL_WIDTH, setPrefs, usePrefs } from '../lib/prefs';
import { useIsNarrow } from '../lib/useMediaQuery';
import { useFullPhoto, useThumbnail } from '../photos';
import type { PhotoRef } from '../types';

const maxWidth = () => Math.min(PANEL_WIDTH.max, Math.round(window.innerWidth * 0.7));
const clamp = (w: number) => Math.round(Math.min(maxWidth(), Math.max(PANEL_WIDTH.min, w)));

/**
 * The right-hand panel's frame: an optional photo background, a drag handle on the left edge to
 * resize it (width remembered), and a scrolling content area. On phones it's a full-screen sheet.
 */
export function PanelShell({
  label,
  background,
  footer,
  children,
}: {
  label: string;
  background?: PhotoRef;
  /** Docked at the bottom, outside the scrolling content (the marked photos). */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { panelWidth } = usePrefs();
  const narrow = useIsNarrow();
  const [dragW, setDragW] = useState<number | null>(null);
  const width = clamp(dragW ?? panelWidth);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId); // keep receiving moves even if the pointer leaves the thin handle
    } catch {
      /* capture isn't essential */
    }
    document.body.classList.add('is-resizing');
    let latest = startW;
    const move = (ev: PointerEvent) => {
      latest = clamp(startW + (startX - ev.clientX)); // dragging left widens the panel
      setDragW(latest);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      document.body.classList.remove('is-resizing');
      setPrefs({ panelWidth: latest });
      setDragW(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <aside
      className={`panel ${background ? 'has-bg' : ''} ${footer ? 'has-footer' : ''}`}
      aria-label={label}
      style={narrow ? undefined : { width, flexBasis: width }}
    >
      {!narrow && (
        <div
          className={`panel-resize ${dragW !== null ? 'is-dragging' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel (drag, or use the arrow keys; double-click to reset)"
          aria-valuemin={PANEL_WIDTH.min}
          aria-valuemax={maxWidth()}
          aria-valuenow={width}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={startDrag}
          onDoubleClick={() => setPrefs({ panelWidth: PANEL_WIDTH.default })}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              e.stopPropagation(); // don't step to the previous/next person
              setPrefs({ panelWidth: clamp(width + (e.key === 'ArrowLeft' ? 24 : -24)) });
            }
          }}
        />
      )}
      {background && <PanelBackground photo={background} />}
      <div className="panel-scroll">{children}</div>
      {footer}
    </aside>
  );
}

/** The chosen photo, filling the panel behind its content, with an overlay that keeps text readable. */
function PanelBackground({ photo }: { photo: PhotoRef }) {
  const full = useFullPhoto(photo);
  const thumb = useThumbnail(photo);
  const src = full.status === 'ok' ? full.url : thumb.status === 'ok' ? thumb.url : undefined;
  return <div className="panel-bg" aria-hidden="true">{src && <img src={src} alt="" referrerPolicy="no-referrer" draggable={false} />}</div>;
}
