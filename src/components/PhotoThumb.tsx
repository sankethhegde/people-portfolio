import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileWarning, ImageOff, Lock, Unplug } from 'lucide-react';
import { useThumbnail, type PhotoStatus } from '../photos';
import type { PhotoRef } from '../types';

/** Short, user-facing reason a photo can't be shown. */
export function problemText(status: PhotoStatus, source: PhotoRef['source']): string | null {
  switch (status) {
    case 'missing':
      return 'Not found';
    case 'needs-permission':
      return source === 'gdrive' ? 'Sign in to Drive' : 'Allow folder access';
    case 'unsupported':
      return 'Format not supported';
    case 'offline':
      return 'Disk not connected';
    case 'error':
      return 'Couldn’t load';
    default:
      return null;
  }
}

const ICONS: Partial<Record<PhotoStatus, typeof Lock>> = {
  missing: ImageOff,
  'needs-permission': Lock,
  unsupported: FileWarning,
  offline: Unplug,
  error: AlertTriangle,
};

/** A thumbnail that only loads once it scrolls into view (for lists that aren't virtualised). */
export function LazyThumb({ photo, alt, showReason }: { photo: PhotoRef; alt: string; showReason?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setVisible(true), io.disconnect()), { rootMargin: '150px' });
    io.observe(el.current!);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={el} className="thumb-box">
      {visible ? <PhotoThumbImg photo={photo} alt={alt} showReason={showReason} /> : <div className="skeleton" />}
    </div>
  );
}

/** Loads straight away; use inside virtualised lists where only visible items are mounted. */
export function PhotoThumbImg({ photo, alt, showReason }: { photo: PhotoRef; alt: string; showReason?: boolean }) {
  const { url, status } = useThumbnail(photo);
  // A preview URL shown directly can still fail in the <img> (e.g. an expired link).
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const shown: PhotoStatus = broken ? 'error' : status;
  if (shown === 'ok') {
    return <img className="photo-img" src={url} alt={alt} draggable={false} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  if (shown === 'loading') return <div className="skeleton" />;
  const Icon = ICONS[shown] ?? ImageOff;
  const text = problemText(shown, photo.source);
  return (
    <div className="thumb-fallback" title={text ?? undefined}>
      <Icon size={showReason ? 20 : 16} />
      {showReason && text && <span>{text}</span>}
    </div>
  );
}
