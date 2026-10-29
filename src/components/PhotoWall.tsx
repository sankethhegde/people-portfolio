import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState } from 'react';
import { Bookmark, Star, Wallpaper } from 'lucide-react';
import { photoKey } from '../photos';
import type { PhotoRef } from '../types';
import { PhotoThumbImg } from './PhotoThumb';

const GAP = 12;
const RATIO = 1.25; // tile height / width

/**
 * A person's photos as a virtualised grid: only the rows on screen exist in the DOM and load images,
 * so folders with thousands of photos stay fast. Row heights are computed, never left to CSS.
 */
export function PhotoWall({
  photos,
  coverKey,
  onOpen,
  onSetCover,
  bgKey,
  onToggleBackground,
  markedKeys,
  onToggleMark,
  minTile = 190,
  className = '',
}: {
  photos: PhotoRef[];
  coverKey: string;
  /** `from`: the tile clicked, for the opening animation. */
  onOpen: (index: number, from: Element) => void;
  /** Shows a ★ on each tile that makes it the cover; omitted in view-only mode. */
  onSetCover?: (photo: PhotoRef) => void;
  /** The current panel background, and a button on each tile to choose/clear it. */
  bgKey?: string;
  onToggleBackground?: (photo: PhotoRef) => void;
  /** Marked photos, and a button on each tile to mark/unmark (omitted in view-only mode). */
  markedKeys?: Set<string>;
  onToggleMark?: (photo: PhotoRef) => void;
  /** Smallest tile width in px: the grid zoom. */
  minTile?: number;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(1, Math.floor((width + GAP) / (minTile + GAP)));
  const tileW = width ? (width - GAP * (cols - 1)) / cols : minTile;
  const rowH = Math.round(tileW * RATIO);
  const rows = Math.ceil(photos.length / cols);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH + GAP,
    overscan: 2,
  });
  // Re-measure when the tile size changes (window resize, panel opening, zoom).
  const lastRowH = useRef(rowH);
  if (lastRowH.current !== rowH) {
    lastRowH.current = rowH;
    queueMicrotask(() => virtualizer.measure());
  }

  return (
    <div className={`photo-wall ${className}`} ref={scrollRef}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="photo-wall-row"
            style={{ transform: `translateY(${row.start}px)`, height: rowH, gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: GAP }}
          >
            {photos.slice(row.index * cols, row.index * cols + cols).map((p, j) => {
              const n = row.index * cols + j;
              const isCover = photoKey(p) === coverKey;
              const isMarked = !!markedKeys?.has(photoKey(p));
              return (
                <div key={photoKey(p)} className={`photo-wall-tile ${isCover ? 'is-cover' : ''} ${isMarked ? 'is-marked' : ''}`} data-photo-key={photoKey(p)}
                  style={{ '--i': Math.min(n, 20) } as React.CSSProperties}
                >
                  <button type="button" className="photo-wall-open" onClick={(e) => onOpen(n, e.currentTarget)} aria-label={`Open photo ${n + 1} of ${photos.length}`}>
                    <PhotoThumbImg photo={p} alt="" showReason />
                  </button>
                  <div className="tile-actions">
                    {onToggleMark ? (
                      <button
                        type="button"
                        className={`tile-btn tile-mark ${isMarked ? 'on' : ''}`}
                        title={isMarked ? 'Marked (click to unmark)' : 'Mark: show it at the bottom of the panel'}
                        aria-label={isMarked ? 'Unmark photo' : 'Mark photo'}
                        aria-pressed={isMarked}
                        onClick={() => onToggleMark(p)}
                      >
                        <Bookmark size={15} fill={isMarked ? 'currentColor' : 'none'} />
                      </button>
                    ) : (
                      isMarked && (
                        <span className="tile-btn tile-mark on" title="Marked">
                          <Bookmark size={15} fill="currentColor" />
                        </span>
                      )
                    )}
                    {onToggleBackground && (
                      <button
                        type="button"
                        className={`tile-btn ${photoKey(p) === bgKey ? 'on' : ''}`}
                        title={photoKey(p) === bgKey ? 'Panel background (click to remove)' : 'Use as the panel background'}
                        aria-label={photoKey(p) === bgKey ? 'Remove as panel background' : 'Use as panel background'}
                        aria-pressed={photoKey(p) === bgKey}
                        onClick={() => onToggleBackground(p)}
                      >
                        <Wallpaper size={15} />
                      </button>
                    )}
                    {isCover ? (
                      <span className="cover-star on" title="This is the cover photo">
                        <Star size={15} fill="currentColor" /> Cover
                      </span>
                    ) : (
                      onSetCover && (
                        <button type="button" className="cover-star" title="Make this the cover photo" aria-label="Make this the cover photo" onClick={() => onSetCover(p)}>
                          <Star size={15} />
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
