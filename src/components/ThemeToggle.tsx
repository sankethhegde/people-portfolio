import { Moon, Sun } from 'lucide-react';
import { setPrefs, usePrefs } from '../lib/prefs';
import { useMediaQuery } from '../lib/useMediaQuery';

/**
 * Light / dark switch for the top bar: a two-option radio group. When the theme follows the system
 * (set in ⋮ → Theme), the option matching the system is shown as selected.
 */
export function ThemeToggle() {
  const { theme } = usePrefs();
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const effective = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Colour theme">
      <label title="Light theme">
        <input type="radio" name="theme" value="light" checked={effective === 'light'} onChange={() => setPrefs({ theme: 'light' })} />
        <Sun size={15} aria-hidden="true" />
        <span className="tt-text">Light</span>
      </label>
      <label title="Dark theme">
        <input type="radio" name="theme" value="dark" checked={effective === 'dark'} onChange={() => setPrefs({ theme: 'dark' })} />
        <Moon size={15} aria-hidden="true" />
        <span className="tt-text">Dark</span>
      </label>
    </div>
  );
}
