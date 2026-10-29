import { useSyncExternalStore } from 'react';

/** True while the CSS media query matches. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Matches the phone breakpoint in styles.css, where the panel becomes a full-screen sheet. */
export const useIsNarrow = () => useMediaQuery('(max-width: 760px)');
