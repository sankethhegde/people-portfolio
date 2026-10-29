import { useSyncExternalStore } from 'react';

/*
 * Per-browser preferences (localStorage): theme, view-only mode, photo grid zoom and panel width.
 * Storage can be unavailable (private windows), so every access is guarded and defaults apply.
 */

export type Theme = 'system' | 'light' | 'dark';
/** Animation style for opening/closing a person and a photo (styles.css + lib/motion.ts). */
export type Motion = 'simple' | 'spring' | 'flip' | 'zoom' | 'reveal';
export const MOTIONS: Motion[] = ['simple', 'spring', 'flip', 'zoom', 'reveal'];

export interface Prefs {
  theme: Theme;
  /** FR-52: hides every control that changes data. */
  viewOnly: boolean;
  /** Smallest photo tile width in the person photo view, px (the grid zoom). */
  photoTile: number;
  /** Right-hand panel width in px (dragged by its left edge). */
  panelWidth: number;
  motion: Motion;
}

const KEY = 'people-portfolio.prefs';
export const PHOTO_TILE = { min: 110, max: 420, step: 50, default: 190 };
export const PANEL_WIDTH = { min: 300, max: 900, default: 400 };
const DEFAULTS: Prefs = { theme: 'system', viewOnly: false, photoTile: PHOTO_TILE.default, panelWidth: PANEL_WIDTH.default, motion: 'spring' };

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        theme: ['system', 'light', 'dark'].includes(p.theme) ? p.theme : DEFAULTS.theme,
        viewOnly: p.viewOnly === true,
        photoTile:
          typeof p.photoTile === 'number' ? Math.min(PHOTO_TILE.max, Math.max(PHOTO_TILE.min, p.photoTile)) : PHOTO_TILE.default,
        panelWidth:
          typeof p.panelWidth === 'number' ? Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, p.panelWidth)) : PANEL_WIDTH.default,
        motion: MOTIONS.includes(p.motion) ? p.motion : DEFAULTS.motion,
      };
    }
  } catch {
    /* storage blocked: use defaults */
  }
  return DEFAULTS;
}

let prefs = load();
const listeners = new Set<() => void>();

function applyTheme(theme: Theme) {
  const el = document.documentElement;
  el.dataset.motion = prefs.motion;
  if (theme === 'system') delete el.dataset.theme;
  else el.dataset.theme = theme;
}
applyTheme(prefs.theme);

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  applyTheme(prefs.theme);
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* not persisted; still applies for this visit */
  }
  listeners.forEach((l) => l());
}

export const usePrefs = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => prefs,
  );
