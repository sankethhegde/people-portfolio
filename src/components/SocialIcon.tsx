import { Globe, Link } from 'lucide-react';
import { siFacebook, siGithub, siInstagram, siReddit, siX, siYoutube } from 'simple-icons';
import type { SocialPlatform } from '../types';

const BRAND: Partial<Record<SocialPlatform, { path: string; hex: string }>> = {
  instagram: siInstagram,
  reddit: siReddit,
  x: siX,
  facebook: siFacebook,
  youtube: siYoutube,
  github: siGithub,
};

/** Brand-coloured platform icon. LinkedIn is drawn by hand (it isn't in Simple Icons). */
export function SocialIcon({ platform, size = 18 }: { platform: SocialPlatform; size?: number }) {
  if (platform === 'linkedin') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="4" fill="#0A66C2" />
        <text x="12" y="17.5" textAnchor="middle" fontSize="14" fontWeight="700" fontFamily="Arial, sans-serif" fill="#fff">
          in
        </text>
      </svg>
    );
  }
  const brand = BRAND[platform];
  if (brand) {
    // X and GitHub are black marks; use currentColor so they stay visible in dark mode.
    const mono = brand.hex === '000000' || brand.hex === '181717';
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={mono ? 'currentColor' : `#${brand.hex}`}>
        <path d={brand.path} />
      </svg>
    );
  }
  return platform === 'website' ? <Globe size={size} aria-hidden="true" /> : <Link size={size} aria-hidden="true" />;
}
