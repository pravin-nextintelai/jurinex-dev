import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/shared/styles/index.css';
import '@/shared/styles/ClaudeAI.css';
import '@/shared/styles/modern-ui.css';
import App from '@/app/App.jsx';
import { AuthProvider } from '@/shared/context/AuthContext.jsx';
import { ThemeProvider, initThemePref } from '@/shared/context/ThemeContext.jsx';
import { initFontPref } from '@/shared/utils/fontPrefs.js';
import { installClientErrorReporter } from '@/shared/api/clientErrorReporter.js';

// Apply saved theme + font before first paint (Settings → Appearance).
initThemePref();
initFontPref();

// Send browser-side errors (uncaught exceptions, unhandled rejections, failed
// requests, render crashes) to the central error log (docs/error-logging.md).
installClientErrorReporter();

// pdfmake emits "Ran out of space in font private use area" for large fonts
// (NotoSansDevanagari has 65 K+ glyphs).  The warning is non-fatal — glyphs
// still render — but it floods the terminal.  Suppress it here at the root.
const _origWarn = console.warn.bind(console);
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('font private use area')) return;
  _origWarn(...args);
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </AuthProvider>
  </StrictMode>
);
