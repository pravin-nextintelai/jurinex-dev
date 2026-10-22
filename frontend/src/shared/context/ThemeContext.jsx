import React, { createContext, useContext, useState, useEffect } from 'react';

/**
 * Site-wide theme (Settings → Appearance → Theme).
 *
 * Themes: light (default), dark, sepia, evergreen. The provider stamps
 * `data-theme` on <html>; the actual restyling lives in index.css, which
 * applies a root-level filter — this themes the ENTIRE app (including its
 * thousands of hardcoded light-mode colors) without touching each component.
 * Persisted per browser under the pre-existing localStorage key 'theme'.
 */

export const THEME_OPTIONS = [
  { id: 'light', label: 'Light', note: 'System default theme' },
  { id: 'dark', label: 'Dark', note: 'Warm dark, Claude-style' },
  { id: 'sepia', label: 'Sepia', note: 'Warm, paper-like reading' },
  { id: 'evergreen', label: 'Evergreen', note: 'Cool green — slate & teal' },
];

const VALID_THEMES = THEME_OPTIONS.map((t) => t.id);

/** Apply saved theme on <html> before React paints (avoids a light flash). */
export function initThemePref() {
  try {
    const saved = localStorage.getItem('theme');
    const theme = VALID_THEMES.includes(saved) ? saved : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    document.documentElement.setAttribute('data-theme', 'light');
  }
}

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('theme');
      return VALID_THEMES.includes(saved) ? saved : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* ignore quota / private mode */
    }
  }, [theme]);

  const setThemeDirect = (newTheme) => {
    setTheme(VALID_THEMES.includes(newTheme) ? newTheme : 'light');
  };

  // Cycles light → dark → sepia → evergreen → light (kept for legacy callers).
  const toggleTheme = () => {
    setTheme((prev) => {
      const idx = VALID_THEMES.indexOf(prev);
      return VALID_THEMES[(idx + 1) % VALID_THEMES.length];
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeDirect, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};
