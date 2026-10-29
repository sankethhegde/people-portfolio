import { flushSync } from 'react-dom';
import type { PhotoRef } from '../types';
import type { Motion } from './prefs';
import { photoKey } from '../photos';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const cardOf = (personId: string) =>
  document.querySelector<HTMLElement>(`.card[data-person-id="${CSS.escape(personId)}"]`);

/** The chosen animation style (set on <html> by lib/prefs). */
export const motionStyle = () => (document.documentElement.dataset.motion ?? 'spring') as Motion;

/** A soft spring: overshoots a little, then settles. Also defined as --spring in styles.css. */
export const SPRING =
  'linear(0, 0.04 1.8%, 0.16 4%, 0.5 9.5%, 0.8 14.5%, 0.98 19.5%, 1.07 24%, 1.09 27%, 1.08 30.5%, 1.03 37%, 0.995 45%, 0.99 52%, 1 70%, 1)';

/** Where the "reveal" circle grows from / shrinks into (CSS variables read by styles.css). */
function setOrigin(el: Element | null) {
  const r = el?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : innerWidth / 2;
  const y = r ? r.top + r.height / 2 : innerHeight / 2;
  const root = document.documentElement.style;
  root.setProperty('--vt-x', `${Math.round(x)}px`);
  root.setProperty('--vt-y', `${Math.round(y)}px`);
  // Radius that covers the whole window from that point.
  root.setProperty('--vt-r', `${Math.ceil(Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)))}px`);
}

/**
 * Runs a React state change as an animated view transition (Chrome / Edge; elsewhere it just runs).
 * `fromCard`: the person card that "opens" into the photo area. `toCard`: the card the photo area
 * shrinks back into. Both get the shared name `person-tile` for the duration; the look of each
 * style lives in styles.css under html[data-motion=…].
 */
export function animateView(update: () => void, opts: { fromCard?: string; toCard?: string } = {}) {
  if (!document.startViewTransition || reducedMotion()) {
    update();
    return;
  }
  const style = motionStyle();
  // On phones the person opens as a sheet over the grid, so cards don't morph (the sheet slides).
  // "Reveal" wipes the whole page in a circle instead of morphing the card.
  const morph = !matchMedia('(max-width: 760px)').matches && style !== 'reveal';
  const named: HTMLElement[] = [];
  const name = (el: HTMLElement | null) => {
    if (!el || !morph) return;
    el.style.viewTransitionName = 'person-tile';
    named.push(el);
  };
  if (opts.fromCard) {
    const card = cardOf(opts.fromCard);
    name(card);
    setOrigin(card);
  }
  const root = document.documentElement;
  root.classList.add('vt-person');
  root.classList.toggle('vt-closing', !!opts.toCard);
  const t = document.startViewTransition(() => {
    for (const el of named.splice(0)) el.style.viewTransitionName = '';
    flushSync(update);
    if (opts.toCard) {
      const card = cardOf(opts.toCard);
      name(card);
      setOrigin(card);
    }
  });
  t.finished.finally(() => {
    root.classList.remove('vt-person', 'vt-closing');
    for (const el of named) el.style.viewTransitionName = '';
  });
}

// ---- "open this photo" requests (the marked strip in the panel → the photo viewer) ----

export interface OpenPhotoRequest {
  personId: string;
  photo: PhotoRef;
  /** Element to grow the viewer from. */
  from?: Element;
}
const openListeners = new Set<(r: OpenPhotoRequest) => boolean>();

/** Asks the person's photo grid to open a photo; false if no grid could (e.g. it's not in the gallery). */
export function requestOpenPhoto(r: OpenPhotoRequest): boolean {
  let handled = false;
  for (const l of openListeners) handled = l(r) || handled;
  return handled;
}
export function onOpenPhotoRequest(l: (r: OpenPhotoRequest) => boolean) {
  openListeners.add(l);
  return () => void openListeners.delete(l);
}

/** The on-screen element showing `photo` in the photo grid or the marked strip, if any. */
export function visiblePhotoEl(photo: PhotoRef, prefer?: Element | null): Element | null {
  const sel = `[data-photo-key="${CSS.escape(photoKey(photo))}"]`;
  const candidates = [
    prefer && prefer.isConnected ? prefer : null,
    document.querySelector(`.photo-wall ${sel}`),
    document.querySelector(`.marked-strip ${sel}`),
  ];
  for (const el of candidates) {
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) return el;
  }
  return null;
}
