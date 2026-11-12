import { THEMES, DEFAULT_THEME, resolveTheme } from '../../../shared/themes.js';

// The account's theme is the source of truth; this cache only exists so index.html can
// apply it before first paint instead of flashing the default on every load.
const CACHE_KEY = 'theme';

export { THEMES };

export function currentTheme() {
  return document.documentElement.dataset.theme || DEFAULT_THEME;
}

/** Apply a theme to the page and remember it for the next load. */
export function applyTheme(id) {
  const theme = resolveTheme(id);
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(CACHE_KEY, theme);
  } catch {
    // Private mode or blocked storage: the theme still applies, it just won't pre-paint.
  }

  // Match the browser chrome (mobile address bar) to the page background.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  }

  window.dispatchEvent(new CustomEvent('theme:change', { detail: { theme } }));
  return theme;
}

/** Read a colour token as the current theme resolves it, for canvas code like Chart.js. */
export function themeColor(token, alpha = 1) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (alpha >= 1 || !value.startsWith('#')) return value;
  const hex = value.length === 4 ? value.replace(/\w/g, c => c + c).slice(1) : value.slice(1);
  const n = parseInt(hex.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
