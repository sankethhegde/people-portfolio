import type { SocialLink, SocialPlatform } from '../types';

export const PLATFORMS: { id: SocialPlatform; name: string; hosts: string[] }[] = [
  { id: 'instagram', name: 'Instagram', hosts: ['instagram.com'] },
  { id: 'reddit', name: 'Reddit', hosts: ['reddit.com', 'redd.it'] },
  { id: 'linkedin', name: 'LinkedIn', hosts: ['linkedin.com'] },
  { id: 'x', name: 'X', hosts: ['x.com', 'twitter.com'] },
  { id: 'facebook', name: 'Facebook', hosts: ['facebook.com', 'fb.com'] },
  { id: 'youtube', name: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  { id: 'github', name: 'GitHub', hosts: ['github.com'] },
  { id: 'website', name: 'Website', hosts: [] },
  { id: 'other', name: 'Custom link', hosts: [] },
];

export const platformName = (p: SocialPlatform) => PLATFORMS.find((x) => x.id === p)?.name ?? p;

export const linkTitle = (l: SocialLink) =>
  l.platform === 'other' && l.title?.trim() ? l.title.trim() : platformName(l.platform);

/** Guess the platform from a pasted URL; undefined when it isn't a known site. */
export function detectPlatform(url: string): SocialPlatform | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\./, '');
    return PLATFORMS.find((p) => p.hosts.some((h) => host === h || host.endsWith('.' + h)))?.id;
  } catch {
    return undefined;
  }
}

/** Returns an error message, or null when the URL is valid (NFR-05: https only). */
export function validateUrl(url: string): string | null {
  const v = url.trim();
  if (!v) return 'Paste a link';
  if (!/^https:\/\//i.test(v)) return 'Link must start with https://';
  try {
    const u = new URL(v);
    if (!u.hostname.includes('.')) return 'That doesn’t look like a web address';
  } catch {
    return 'That doesn’t look like a web address';
  }
  return null;
}

/** Accept "instagram.com/foo" by adding https://, but never rewrite http:// silently. */
export const normaliseUrl = (url: string) => {
  const v = url.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || !v ? v : `https://${v}`;
};
