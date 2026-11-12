/**
 * Colour themes for the web client, shared so the server can validate a saved choice.
 * The palettes themselves live in client/src/styles/main.css under [data-theme="<id>"];
 * this list only names them. Adding a theme means adding both.
 */

export const DEFAULT_THEME = 'lotus';

export const THEMES = [
  { id: 'lotus', label: 'Lotus', mode: 'dark', description: 'Near-black with lotus gold. The default.' },
  { id: 'midnight', label: 'Midnight', mode: 'dark', description: 'Deep slate with a cool blue accent.' },
  { id: 'dracula', label: 'Dracula', mode: 'dark', description: 'Purple-grey with violet and pink.' },
  { id: 'nord', label: 'Nord', mode: 'dark', description: 'Arctic blue-grey with frost cyan.' },
  { id: 'catppuccin', label: 'Catppuccin Mocha', mode: 'dark', description: 'Soft pastel mauve on dark.' },
  { id: 'gruvbox', label: 'Gruvbox', mode: 'dark', description: 'Warm retro browns with aqua.' },
  { id: 'solarized-dark', label: 'Solarized Dark', mode: 'dark', description: 'Teal-black with Solarized blue.' },
  { id: 'light', label: 'Daylight', mode: 'light', description: 'Clean light greys with amber.' },
  { id: 'solarized-light', label: 'Solarized Light', mode: 'light', description: 'Warm cream with Solarized blue.' },
];

const THEME_IDS = new Set(THEMES.map(t => t.id));

export function isValidTheme(id) {
  return typeof id === 'string' && THEME_IDS.has(id);
}

/** The theme to actually use for a stored value, which may be null or no longer exist. */
export function resolveTheme(id) {
  return isValidTheme(id) ? id : DEFAULT_THEME;
}
