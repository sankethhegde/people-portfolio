import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource-variable/nunito/wght.css'; // light theme font (bundled, no Google request)
import '@fontsource-variable/plus-jakarta-sans/wght.css'; // dark theme font
import './styles.css';
import './lib/prefs'; // applies the saved theme before first paint

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
