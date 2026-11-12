import api from '../services/api.js';
import { THEMES, applyTheme, currentTheme } from '../utils/theme.js';
import { showToast } from '../utils/ui.js';

/**
 * Theme choices in Settings. Each option carries its own data-theme, so the mini preview
 * inside it renders in that theme's real tokens rather than a hand-copied swatch.
 */
export function setupThemePicker() {
  const picker = document.getElementById('theme-picker');
  if (!picker) return;

  picker.innerHTML = THEMES.map(theme => `
    <button type="button" class="theme-option" role="radio" data-theme="${theme.id}" data-theme-id="${theme.id}">
      <span class="theme-preview" aria-hidden="true">
        <span class="theme-preview-nav"><span></span><span></span><span></span></span>
        <span class="theme-preview-body">
          <span class="theme-preview-card">
            <span class="theme-preview-line"></span>
            <span class="theme-preview-line is-short"></span>
            <span class="theme-preview-button"></span>
          </span>
          <span class="theme-preview-card">
            <span class="theme-preview-line is-short"></span>
            <span class="theme-preview-line"></span>
          </span>
        </span>
      </span>
      <span class="theme-option-text">
        <span class="theme-option-name">${theme.label}<i class="ph ph-check-circle theme-option-check"></i></span>
        <span class="theme-option-desc">${theme.description}</span>
      </span>
    </button>
  `).join('');

  const markSelected = () => {
    const active = currentTheme();
    picker.querySelectorAll('.theme-option').forEach(option => {
      const selected = option.dataset.themeId === active;
      option.setAttribute('aria-checked', String(selected));
      option.tabIndex = selected ? 0 : -1;
    });
  };

  picker.addEventListener('click', async (e) => {
    const option = e.target.closest('.theme-option');
    if (!option) return;
    const previous = currentTheme();
    const next = option.dataset.themeId;
    if (next === previous) return;

    applyTheme(next); // instant; the save happens behind it
    try {
      await api.setTheme(next);
    } catch (error) {
      applyTheme(previous);
      showToast('Could not save your theme: ' + error.message, 'error');
    }
  });

  // Arrow keys move between options, as in any radio group.
  picker.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const options = [...picker.querySelectorAll('.theme-option')];
    const index = options.indexOf(document.activeElement);
    const target = options[(index + step + options.length) % options.length];
    target.focus();
    target.click();
  });

  window.addEventListener('theme:change', markSelected);
  markSelected();
}
