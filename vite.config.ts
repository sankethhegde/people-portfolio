import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port 5173 matters: it is the authorised JavaScript origin for Google OAuth (Phase 2).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // Keep the ~540 flag SVGs as separate files (loaded only when shown) instead of inlining them into the CSS.
  build: { assetsInlineLimit: (file) => (file.includes('flag-icons') ? false : undefined) },
});
