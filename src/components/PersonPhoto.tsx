import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Bookmark, ChevronLeft, ChevronRight, FolderOpen, Images, ImageOff, Lock, Star, Wallpaper, X, ZoomIn, ZoomOut } from 'lucide-react';
import { avatarColor, initials } from '../lib/colors';
import { PHOTO_TILE, setPrefs, usePrefs, type Motion } from '../lib/prefs';
import { setCoverPhoto, setPanelBackground, toggleMarked } from '../lib/store';
import { motionStyle, onOpenPhotoRequest, reducedMotion, SPRING, visiblePhotoEl } from '../lib/motion';
import { photoKey, sources, useFullPhoto, useGallery, useIsPhotoMissing, useThumbnail } from '../photos';
import type { Person, PhotoRef } from '../types';
import { problemText } from './PhotoThumb';
import { PhotoWall } from './PhotoWall';
import { allowFolder } from '../lib/access';
import { folderIdOfRef, getLocked, subscribeLocked } from '../photos/localSource';
import { useToast } from './Toasts';

function Initials({ person }: { person: Person }) {
  return (
    <div className="initials" style={{ background: avatarColor(person.id) }} aria-hidden="true">
      {initials(person.name || '?')}
    </div>
  );
}

/** Small corner badge on a card when the person has more than the cover photo. */
function GalleryBadge({ person }: { person: Person }) {
  const extra = person.photos?.length ?? 0;
  if (!extra && !person.folder) return null;
  return (
    <span
      className="card-gallery-badge"
      title={person.folder ? `${1 + extra} picked photos + folder “${person.folder.name}”` : `${1 + extra} photos`}
    >
      {person.folder ? <FolderOpen size={11} /> : <Images size={11} />}
      {extra > 0 && 1 + extra}
    </span>
  );
}

/** Card thumbnail with skeleton, initials fallback and "photo missing" badge (FR-04). */
export function CardPhoto({ person }: { person: Person }) {
  const { url, status } = useThumbnail(person.photo);
  const missing = useIsPhotoMissing(person.photo);
  if (missing || status === 'missing') {
    return (
      <>
        <Initials person={person} />
        <span className="photo-badge" title="The photo is no longer in its folder">
          <ImageOff size={12} /> missing
        </span>
      </>
    );
  }
  if (status === 'ok') {
    return (
      <>
        <img className="photo-img" src={url} alt={person.name} draggable={false} referrerPolicy="no-referrer" />
        <GalleryBadge person={person} />
      </>
    );
  }
  if (status === 'loading') return <div className="skeleton" aria-label="Loading photo" />;
  const reason = person.photo ? problemText(status, person.photo.source) : null;
  return (
    <>
      <Initials person={person} />
      <GalleryBadge person={person} />
      {reason && (
        <span className="photo-badge" title={reason}>
          {status === 'needs-permission' ? <Lock size={12} /> : <ImageOff size={12} />} {status === 'needs-permission' ? '' : reason}
        </span>
      )}
    </>
  );
}

/** Small cover photo for the panel header. */
export function PanelAvatar({ person }: { person: Person }) {
  const { url, status } = useThumbnail(person.photo);
  return (
    <div className="panel-avatar">
      {status === 'ok' ? <img className="photo-img" src={url} alt="" referrerPolicy="no-referrer" /> : <Initials person={person} />}
    </div>
  );
}

/**
 * Every photo of one person as a grid (main area on desktop, inside the sheet on phones).
 * Click a photo to open it full size; ★ makes a photo the cover straight away; − / + resize the grid.
 */
export function PersonPhotos({
  person,
  onBack,
  onNeedsPermission,
  compact,
}: {
  person: Person;
  onBack?: () => void;
  /** Re-grant access for a photo's folder / sign in (one prompt per click). */
  onNeedsPermission: (photo?: PhotoRef) => void;
  /** Inside the phone sheet: no back button, smaller tiles. */
  compact?: boolean;
}) {
  const { photos, folderImages, folderStatus } = useGallery(person);
  const locked = useSyncExternalStore(subscribeLocked, getLocked);
  const lockedHere = useMemo(() => {
    const ids = new Set<string>();
    for (const p of photos) if (p.source === 'local') ids.add(folderIdOfRef(p.ref) ?? '');
    if (person.folder?.source === 'local') ids.add(person.folder.folderId.split('/')[0]);
    return locked.filter((f) => ids.has(f.id));
  }, [photos, person.folder, locked]);
  const grant = async (f: { id: string; name: string }) => {
    if (!(await allowFolder(f.id))) toast(`Chrome didn’t allow access to “${f.name}”. Try again and choose “Allow”.`, { kind: 'error' });
  };
  const { viewOnly, photoTile } = usePrefs();
  const toast = useToast();
  // Track the open photo by key, not position: making it the cover moves it to the front.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [openFrom, setOpenFrom] = useState<Element | null>(null);
  const openIndex = openKey ? photos.findIndex((p) => photoKey(p) === openKey) : -1;

  // The marked strip in the panel asks to open one of this person's photos here.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(
    () =>
      onOpenPhotoRequest((r) => {
        if (r.personId !== person.id) return false;
        const key = photoKey(r.photo);
        if (!photosRef.current.some((p) => photoKey(p) === key)) return false;
        setOpenFrom(r.from ?? null);
        setOpenKey(key);
        return true;
      }),
    [person.id],
  );

  const markedKeys = useMemo(() => new Set((person.marked ?? []).map(photoKey)), [person.marked]);

  // Just opened: the tiles cascade in (styles that use it; see .is-entering in styles.css). Only for
  // the first moment, so tiles scrolled into view later don't animate.
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setEntering(false), 1400);
    return () => clearTimeout(t);
  }, []);
  const coverKey = person.photo ? photoKey(person.photo) : '';
  const folderNote =
    person.folder &&
    (folderStatus === 'loading'
      ? `Reading “${person.folder.name}”…`
      : folderStatus === 'needs-permission'
        ? null
        : folderStatus !== 'ok'
          ? `Couldn’t read the linked folder “${person.folder.name}”.`
          : null);

  const bgKey = person.panelBg ? photoKey(person.panelBg) : undefined;
  const toggleBackground = viewOnly
    ? undefined
    : async (ref: PhotoRef) => {
        const clearing = photoKey(ref) === bgKey;
        const undo = await setPanelBackground(person, clearing ? undefined : ref);
        toast(clearing ? 'Panel background removed' : 'Set as the panel background', { undo });
      };

  const toggleMark = viewOnly
    ? undefined
    : async (ref: PhotoRef) => {
        const { marked, undo } = await toggleMarked(person, ref);
        toast(marked ? 'Marked: it’s at the bottom of the panel' : 'Unmarked', { undo });
      };

  const setCover = viewOnly
    ? undefined
    : async (ref: PhotoRef) => {
        const undo = await setCoverPhoto(person, ref, folderImages);
        toast('Cover photo updated', { undo });
      };

  const zoomGrid = (d: number) =>
    setPrefs({ photoTile: Math.min(PHOTO_TILE.max, Math.max(PHOTO_TILE.min, photoTile + d * PHOTO_TILE.step)) });

  return (
    <section className={`person-photos ${compact ? 'person-photos-compact' : ''} ${entering ? 'is-entering' : ''}`} aria-label={`Photos of ${person.name}`}>
      <div className="person-photos-head">
        {onBack && (
          <button type="button" className="btn btn-sm" onClick={onBack} title="Back to everyone (Esc)">
            <ArrowLeft size={15} /> All people
          </button>
        )}
        <h2 className={compact ? 'panel-section-title' : 'person-photos-title'}>
          {compact ? 'Photos' : person.name}
          <span className="muted"> · {photos.length} {photos.length === 1 ? 'photo' : 'photos'}</span>
        </h2>
        {person.folder?.source === 'gdrive' && folderStatus === 'needs-permission' && (
          <button type="button" className="btn btn-sm" onClick={() => onNeedsPermission({ source: 'gdrive', ref: person.folder!.folderId })}>
            <Lock size={14} /> Sign in to Google Drive to show “{person.folder.name}”
          </button>
        )}
        {/* One button per local folder this person's photos are in that Chrome needs a click for. */}
        {lockedHere.map((f) => (
          <button key={f.id} type="button" className="btn btn-sm btn-primary" onClick={() => grant(f)}>
            <Lock size={14} /> Allow access to “{f.name}”
          </button>
        ))}
        {folderNote && <span className="muted small">{folderNote}</span>}
        {!compact && photos.length > 0 && (
          <div className="zoom-group grid-zoom" role="group" aria-label="Photo size">
            <button type="button" className="icon-btn" onClick={() => zoomGrid(-1)} disabled={photoTile <= PHOTO_TILE.min} title="Smaller photos" aria-label="Smaller photos">
              <ZoomOut size={17} />
            </button>
            <button type="button" className="icon-btn" onClick={() => zoomGrid(1)} disabled={photoTile >= PHOTO_TILE.max} title="Larger photos" aria-label="Larger photos">
              <ZoomIn size={17} />
            </button>
          </div>
        )}
      </div>

      {photos.length === 0 ? (
        <div className="empty-state small">
          <Images size={32} />
          <p>No photos yet. Use Edit → Add photos or Link a folder.</p>
        </div>
      ) : (
        <PhotoWall
          photos={photos}
          coverKey={coverKey}
          onOpen={(i, from) => {
            setOpenFrom(from);
            setOpenKey(photoKey(photos[i]));
          }}
          onSetCover={setCover}
          bgKey={bgKey}
          onToggleBackground={toggleBackground}
          markedKeys={markedKeys}
          onToggleMark={toggleMark}
          minTile={compact ? 100 : photoTile}
        />
      )}

      {openIndex >= 0 && (
        <Lightbox
          person={person}
          photos={photos}
          index={openIndex}
          onIndex={(i) => setOpenKey(photoKey(photos[i]))}
          onClose={() => setOpenKey(null)}
          onNeedsPermission={onNeedsPermission}
          coverKey={coverKey}
          onSetCover={setCover}
          bgKey={bgKey}
          onToggleBackground={toggleBackground}
          markedKeys={markedKeys}
          onToggleMark={toggleMark}
          originEl={openFrom}
        />
      )}
    </section>
  );
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.5;
/** Above this zoom, swap in a sharper preview where the source offers one. */
const HI_RES_AT = 1.5;
const HI_RES_PX = 4096;

/**
 * Full-size photo over everything.
 * ← → step through the gallery · + / − / mouse wheel / double-click zoom · drag to pan · 0 fits · Esc closes.
 */
function Lightbox({
  person,
  photos,
  index,
  onIndex,
  onClose,
  onNeedsPermission,
  coverKey,
  onSetCover,
  bgKey,
  onToggleBackground,
  markedKeys,
  onToggleMark,
  originEl,
}: {
  person: Person;
  photos: PhotoRef[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onNeedsPermission: (photo?: PhotoRef) => void;
  coverKey: string;
  onSetCover?: (photo: PhotoRef) => void;
  bgKey?: string;
  onToggleBackground?: (photo: PhotoRef) => void;
  markedKeys: Set<string>;
  onToggleMark?: (photo: PhotoRef) => void;
  /** What was clicked to open the viewer: the photo grows out of it and shrinks back into it. */
  originEl: Element | null;
}) {
  const photo = photos[index];
  const full = useFullPhoto(photo);
  const thumb = useThumbnail(photo);
  const [broken, setBroken] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const many = photos.length > 1;
  const isCover = photoKey(photo) === coverKey;
  const isMarked = markedKeys.has(photoKey(photo));

  // ---- zoom + pan: translate (tx, ty) then scale z, around the screen centre ----
  const [view, setView] = useState({ z: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const [hiSrc, setHiSrc] = useState<string>();

  /** Zoom to z, keeping the point under (clientX, clientY) still. Defaults to the centre. */
  const zoomTo = (z: number, clientX = innerWidth / 2, clientY = innerHeight / 2) =>
    setView((v) => {
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
      if (nz === MIN_ZOOM) return { z: 1, tx: 0, ty: 0 };
      const dx = clientX - innerWidth / 2;
      const dy = clientY - innerHeight / 2;
      return { z: nz, tx: dx - ((dx - v.tx) * nz) / v.z, ty: dy - ((dy - v.ty) * nz) / v.z };
    });
  const zoomBy = (f: number, x?: number, y?: number) => zoomTo(view.z * f, x, y);

  // ---- open / close animation: the photo grows out of its tile and shrinks back into it ----
  const imgRef = useRef<HTMLImageElement>(null);
  const introDone = useRef(false);
  const openedKey = useRef(photoKey(photo));
  const closing = useRef(false);
  const [isClosing, setIsClosing] = useState(false);
  // The photo's shape, so the small preview and the full image fill the same box (no jump when the
  // full one arrives, and the opening animation lands on the final size).
  const [aspect, setAspect] = useState<number>();
  useLayoutEffect(() => {
    if (aspect && imgRef.current) intro(imgRef.current);
  }, [aspect]); // eslint-disable-line react-hooks/exhaustive-deps
  const originFor = (p: PhotoRef) => visiblePhotoEl(p, photoKey(p) === openedKey.current ? originEl : null);

  const intro = (img: HTMLImageElement) => {
    if (introDone.current || closing.current) return;
    introDone.current = true;
    if (reducedMotion()) return;
    openPhotoAnimation(motionStyle(), ref.current!, img, originFor(photo));
  };

  const requestClose = () => {
    if (closing.current) return;
    closing.current = true;
    setIsClosing(true);
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      onClose();
    };
    if (reducedMotion()) return done();
    const img = imgRef.current;
    const a = closePhotoAnimation(motionStyle(), ref.current!, img, img && !zoomed ? originFor(photo) : null);
    if (a) a.finished.then(done, done);
    // Never stay stuck open: animations don't run while the window is hidden.
    setTimeout(done, a ? 900 : 200);
  };

  const go = (d: number) => onIndex((index + d + photos.length) % photos.length);

  const shownKey = photoKey(photo);
  useEffect(() => {
    setBroken(null);
    setView({ z: 1, tx: 0, ty: 0 });
    setHiSrc(undefined);
  }, [shownKey]);

  // Load a sharper image once zoomed in (Drive previews are 1600 px by default).
  useEffect(() => {
    if (view.z < HI_RES_AT || hiSrc || !photo) return;
    const src = sources[photo.source];
    if (!src.previewUrl) return;
    let alive = true;
    src.previewUrl(photo.ref, HI_RES_PX).then((url) => {
      if (!url || !alive) return;
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => alive && setHiSrc(url);
      img.src = url;
    }, () => {});
    return () => {
      alive = false;
    };
  }, [view.z, hiSrc, photo]);

  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);

  const baseSrc = full.status === 'ok' ? full.url : thumb.status === 'ok' ? thumb.url : undefined;
  const src = hiSrc ?? baseSrc;
  const zoomed = view.z > 1;

  // Why the full photo isn't showing, if it isn't.
  const fullProblem =
    broken ??
    (full.status === 'unsupported'
      ? 'This browser can’t display this file’s format. iPhone HEIC photos are a common cause; Chrome and Edge can’t open them.'
      : full.status === 'missing'
        ? 'This photo is no longer in its folder.'
        : full.status === 'offline'
          ? 'The disk or folder this photo is on isn’t connected. Plug it back in and it will show again.'
        : full.status === 'error'
          ? 'The photo couldn’t be loaded. Check your connection and try again.'
          : null);

  const arrow = (d: number) => (
    <button
      type="button"
      className={`icon-btn lightbox-arrow ${d < 0 ? 'lightbox-arrow-left' : 'lightbox-arrow-right'}`}
      aria-label={d < 0 ? 'Previous photo' : 'Next photo'}
      onClick={(e) => {
        e.stopPropagation();
        go(d);
      }}
    >
      {d < 0 ? <ChevronLeft size={28} /> : <ChevronRight size={28} />}
    </button>
  );

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return createPortal(
    <dialog
      ref={ref}
      className={`lightbox ${zoomed ? 'is-zoomed' : ''} ${isClosing ? 'is-closing' : ''}`}
      aria-label={`${person.name}, photo ${index + 1} of ${photos.length}`}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onKeyDown={(e) => {
        if (closing.current) return;
        if ((e.key === 'm' || e.key === 'M') && onToggleMark) onToggleMark(photo);
        else if (e.key === 'ArrowLeft' && many) go(-1);
        else if (e.key === 'ArrowRight' && many) go(1);
        else if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP);
        else if (e.key === '-' || e.key === '_') zoomBy(1 / ZOOM_STEP);
        else if (e.key === '0') zoomTo(1);
      }}
      onWheel={(e) => {
        if (!src) return;
        zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY);
      }}
      onClick={requestClose}
    >
      {src && !broken && (
        <img
          key={shownKey}
          ref={imgRef}
          src={src}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            if (w && h) setAspect(w / h);
          }}
          alt={person.name}
          referrerPolicy="no-referrer"
          draggable={false}
          className="lightbox-img"
          style={{
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.z})`,
            ...(aspect && { width: `min(96vw, calc(84vh * ${aspect}))`, aspectRatio: String(aspect) }),
          }}
          onClick={stop}
          onDoubleClick={(e) => (zoomed ? zoomTo(1) : zoomTo(2.5, e.clientX, e.clientY))}
          onPointerDown={(e) => {
            if (!zoomed) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            d.moved = true;
            setView((v) => ({ ...v, tx: d.tx + e.clientX - d.x, ty: d.ty + e.clientY - d.y }));
          }}
          onPointerUp={() => (drag.current = null)}
          onError={() =>
            setBroken('This browser can’t display this file’s format. iPhone HEIC photos are a common cause; Chrome and Edge can’t open them.')
          }
        />
      )}
      {full.status === 'loading' && <span className="spinner lightbox-spinner" aria-label="Loading full size" />}
      {(fullProblem || full.status === 'needs-permission') && (
        <div className="lightbox-problem" onClick={stop}>
          {full.status === 'needs-permission' ? (
            <>
              <p>{photo.source === 'gdrive' ? 'Sign in to Google Drive to see this photo full size.' : 'Allow folder access to see this photo full size.'}</p>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onNeedsPermission(photo)}>
                {photo.source === 'gdrive' ? 'Sign in' : 'Allow access'}
              </button>
            </>
          ) : (
            <p>{fullProblem}</p>
          )}
        </div>
      )}
      {many && arrow(-1)}
      {many && arrow(1)}
      <button
        type="button"
        className="icon-btn lightbox-close"
        aria-label="Close"
        onClick={(e) => {
          e.stopPropagation();
          requestClose();
        }}
      >
        <X size={20} />
      </button>

      <div className="lightbox-bar" onClick={stop}>
        <span className="lightbox-title">
          {person.name}
          {many && <span className="muted-light"> · {index + 1} / {photos.length}</span>}
        </span>
        <div className="zoom-group" role="group" aria-label="Zoom">
          <button type="button" className="icon-btn" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={view.z <= MIN_ZOOM} aria-label="Zoom out" title="Zoom out (−)">
            <ZoomOut size={18} />
          </button>
          <button type="button" className="zoom-level" onClick={() => zoomTo(1)} title="Fit to screen (0)">
            {Math.round(view.z * 100)}%
          </button>
          <button type="button" className="icon-btn" onClick={() => zoomBy(ZOOM_STEP)} disabled={view.z >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in (+)">
            <ZoomIn size={18} />
          </button>
        </div>
        {onToggleMark ? (
          <button
            type="button"
            className={`lightbox-cover lightbox-mark ${isMarked ? 'on' : ''}`}
            onClick={() => onToggleMark(photo)}
            aria-pressed={isMarked}
            title={isMarked ? 'Unmark (M)' : 'Mark: show it at the bottom of the panel (M)'}
          >
            <Bookmark size={15} fill={isMarked ? 'currentColor' : 'none'} /> {isMarked ? 'Marked' : 'Mark'}
          </button>
        ) : (
          isMarked && (
            <span className="lightbox-cover lightbox-mark on">
              <Bookmark size={15} fill="currentColor" /> Marked
            </span>
          )
        )}
        {onToggleBackground && (
          <button
            type="button"
            className={`lightbox-cover ${photoKey(photo) === bgKey ? 'on' : ''}`}
            onClick={() => onToggleBackground(photo)}
            title={photoKey(photo) === bgKey ? 'Remove as the panel background' : 'Use as the panel background'}
          >
            <Wallpaper size={15} /> {photoKey(photo) === bgKey ? 'Background' : 'Set background'}
          </button>
        )}
        {isCover ? (
          <span className="lightbox-cover on">
            <Star size={15} fill="currentColor" /> Cover photo
          </span>
        ) : (
          onSetCover && (
            <button type="button" className="lightbox-cover" onClick={() => onSetCover(photo)}>
              <Star size={15} /> Make cover
            </button>
          )
        )}
      </div>
    </dialog>,
    document.body,
  );
}

/** The photo at rest in the viewer (matches .lightbox img's 6px corners). */
const REST_RADIUS = 6;

/** How to put the viewer's image exactly over `target`: scaled to cover it, centred, clipped to its shape. */
interface Fly { dx: number; dy: number; s: number; ix: number; iy: number; r: number }
function flyGeometry(img: HTMLImageElement, target: Element): Fly {
  const f = img.getBoundingClientRect();
  const o = target.getBoundingClientRect();
  const s = Math.max(o.width / f.width, o.height / f.height) || 1;
  return {
    dx: o.left + o.width / 2 - (f.left + f.width / 2),
    dy: o.top + o.height / 2 - (f.top + f.height / 2),
    s,
    ix: Math.max(0, (f.width - o.width / s) / 2),
    iy: Math.max(0, (f.height - o.height / s) / 2),
    r: (parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0) / s,
  };
}

/** A keyframe part-way between rest (t = 0) and sitting on the tile (t = 1), optionally turned in 3D. */
function flyFrame(g: Fly, t: number, turn = 0, extra: Keyframe = {}): Keyframe {
  return {
    transform: `translate(${g.dx * t}px, ${g.dy * t}px) scale(${1 + (g.s - 1) * t}) perspective(1400px) rotateY(${turn}deg)`,
    clipPath: `inset(${g.iy * t}px ${g.ix * t}px round ${g.r * t + REST_RADIUS * (1 - t)}px)`,
    ...extra,
  };
}

/** A circle at the centre of `el` (or the screen) that covers the whole window. */
function circleAt(el: Element | null) {
  const r = el?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : innerWidth / 2;
  const y = r ? r.top + r.height / 2 : innerHeight / 2;
  const big = Math.ceil(Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)));
  return { small: `circle(0px at ${x}px ${y}px)`, big: `circle(${big}px at ${x}px ${y}px)` };
}

/** Opening the photo viewer, in the chosen style. `target` is the tile it grows out of, if on screen. */
function openPhotoAnimation(style: Motion, dialog: HTMLDialogElement, img: HTMLImageElement, target: Element | null) {
  if (style === 'reveal') {
    const c = circleAt(target);
    dialog.animate([{ clipPath: c.small }, { clipPath: c.big }], { duration: 620, easing: 'cubic-bezier(.65,0,.35,1)' });
    img.animate([{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' });
    return;
  }
  if (!target) {
    img.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: style === 'spring' ? SPRING : 'ease-out' });
    return;
  }
  const g = flyGeometry(img, target);
  if (style === 'flip') {
    // Turns over on the way: edge-on halfway, then the photo faces you at full size.
    img.animate(
      [flyFrame(g, 1, 0), { ...flyFrame(g, 0.5, 90), offset: 0.5 }, { ...flyFrame(g, 0.5, -90), offset: 0.5 }, flyFrame(g, 0, 0)],
      { duration: 720, easing: 'cubic-bezier(.45,.05,.35,1)' },
    );
  } else if (style === 'zoom') {
    img.animate([flyFrame(g, 1, 0, { filter: 'blur(6px)' }), flyFrame(g, 0, 0, { filter: 'blur(0px)' })], {
      duration: 560,
      easing: 'cubic-bezier(.16,1,.3,1)',
    });
  } else {
    img.animate([flyFrame(g, 1), flyFrame(g, 0)], style === 'spring' ? { duration: 700, easing: SPRING } : { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}

/** Closing the photo viewer, in the chosen style. Returns the animation to wait for. */
function closePhotoAnimation(style: Motion, dialog: HTMLDialogElement, img: HTMLImageElement | null, target: Element | null): Animation | null {
  if (style === 'reveal') {
    const c = circleAt(target);
    return dialog.animate([{ clipPath: c.big }, { clipPath: c.small }], { duration: 460, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
  }
  dialog.animate([{ backgroundColor: 'rgb(5 6 10 / 0%)' }], { duration: 300, easing: 'ease-in', fill: 'forwards' });
  if (!img) return null;
  // Closed while still opening: carry on from where the photo is now.
  let from: Keyframe | null = null;
  if (img.getAnimations().length) {
    const cs = getComputedStyle(img);
    from = { transform: cs.transform, clipPath: cs.clipPath === 'none' ? `inset(0px round ${REST_RADIUS}px)` : cs.clipPath, filter: 'none' };
    for (const an of img.getAnimations()) an.cancel();
  }
  if (!target) {
    return img.animate([{ opacity: 0, transform: `${img.style.transform} scale(.9)` }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
  }
  const g = flyGeometry(img, target);
  const opts: KeyframeAnimationOptions = { duration: 340, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' };
  if (style === 'flip') {
    return img.animate(
      [from ?? flyFrame(g, 0, 0), { ...flyFrame(g, 0.5, -90), offset: 0.5 }, { ...flyFrame(g, 0.5, 90), offset: 0.5 }, flyFrame(g, 1, 0)],
      { ...opts, duration: 600, easing: 'cubic-bezier(.45,.05,.35,1)' },
    );
  }
  if (style === 'zoom') {
    return img.animate([from ?? flyFrame(g, 0, 0, { filter: 'blur(0px)' }), flyFrame(g, 1, 0, { filter: 'blur(4px)' })], { ...opts, duration: 420 });
  }
  // Spring: a small pull-back before it springs home.
  return img.animate(
    [from ?? flyFrame(g, 0), flyFrame(g, 1)],
    style === 'spring' ? { ...opts, duration: 460, easing: 'cubic-bezier(.5,-0.25,.3,1)' } : opts,
  );
}
