/** Label colours chosen to stay readable on both light and dark backgrounds. */
export const LABEL_COLORS = [
  '#4f46e5', // indigo
  '#0891b2', // cyan
  '#059669', // emerald
  '#65a30d', // lime
  '#ca8a04', // amber
  '#ea580c', // orange
  '#dc2626', // red
  '#db2777', // pink
  '#9333ea', // purple
  '#475569', // slate
  '#0d9488', // teal
  '#2563eb', // blue
];

export function pickColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LABEL_COLORS[h % LABEL_COLORS.length];
}

/** Black or white text, whichever contrasts more with `hex` (WCAG relative luminance). */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#111827' : '#ffffff';
}

/** Muted avatar backgrounds for the initials fallback. */
const AVATAR_BG = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];
export const avatarColor = (seed: string) => {
  let h = 0;
  for (const ch of seed) h = (h * 17 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_BG[h % AVATAR_BG.length];
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}
