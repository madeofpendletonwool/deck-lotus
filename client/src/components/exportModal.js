import { copyText, showToast } from '../utils/ui.js';
import {
  EXPORT_FORMATS,
  DEFAULT_EXPORT_OPTIONS,
  generateExport,
  countExportedCards,
} from '../utils/deckExport.js';

const FORMAT_NOTES = {
  mtgprint: 'Paste this into the box on MTG Print, press Submit, then download your PDF.',
  mpc: 'In the MPC Autofill editor choose Add Cards → Text and paste. It picks the art itself, so printings are left off. Projects max out at 612 cards.',
  arena: 'Paste into Arena using Import. Arena rejects printings it does not have, so use Plain text if a line fails.',
  tcgplayer: 'Paste into TCGplayer Mass Entry.',
};

const FORMAT_PREFERENCE_KEY = 'deckExportFormat';

let activeDeck = null;
let activeFormat = 'mtgprint';

function loadSavedFormat() {
  try {
    const saved = localStorage.getItem(FORMAT_PREFERENCE_KEY);
    return EXPORT_FORMATS.some((f) => f.id === saved) ? saved : null;
  } catch {
    return null;
  }
}

function saveFormat(id) {
  try {
    localStorage.setItem(FORMAT_PREFERENCE_KEY, id);
  } catch {
    // A remembered format is only a convenience.
  }
}

function currentFormat() {
  return EXPORT_FORMATS.find((f) => f.id === activeFormat);
}

function readOptions() {
  const format = currentFormat();
  return {
    ...DEFAULT_EXPORT_OPTIONS,
    includeSideboard: document.getElementById('export-opt-sideboard').checked,
    includeMaybeboard: Boolean(format.supportsMaybeboard) && document.getElementById('export-opt-maybeboard').checked,
    excludeBasics: document.getElementById('export-opt-basics').checked,
    unownedOnly: document.getElementById('export-opt-unowned').checked,
  };
}

function renderFormatList() {
  const groups = [...new Set(EXPORT_FORMATS.map((f) => f.group))];
  document.getElementById('export-format-list').innerHTML = groups.map((group) => `
    <div class="export-format-group">
      <div class="export-format-group-label">${group}</div>
      ${EXPORT_FORMATS.filter((f) => f.group === group).map((f) => `
        <button type="button" class="export-format-btn ${f.id === activeFormat ? 'active' : ''}" data-format="${f.id}" aria-pressed="${f.id === activeFormat}">
          <span class="export-format-name">${f.label}</span>
          <span class="export-format-hint">${f.hint}</span>
        </button>
      `).join('')}
    </div>
  `).join('');
}

function renderPreview() {
  const format = currentFormat();
  const options = readOptions();
  const cards = activeDeck?.cards || [];

  document.getElementById('export-text').value = generateExport(format.id, cards, options);

  const count = countExportedCards(cards, options);
  document.getElementById('export-count').textContent = `${count} ${count === 1 ? 'card' : 'cards'}`;

  document.getElementById('export-note').textContent = FORMAT_NOTES[format.id] || '';
  document.getElementById('export-opt-maybeboard-wrap').classList.toggle('hidden', !format.supportsMaybeboard);

  const openBtn = document.getElementById('open-export');
  openBtn.classList.toggle('hidden', !format.openUrl);
  document.getElementById('open-export-label').textContent = format.openLabel || '';
}

function selectFormat(id) {
  activeFormat = id;
  saveFormat(id);
  document.querySelectorAll('#export-format-list .export-format-btn').forEach((btn) => {
    const isActive = btn.dataset.format === id;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
  renderPreview();
}

function downloadExport() {
  const format = currentFormat();
  const text = document.getElementById('export-text').value;
  const type = format.extension === 'csv' ? 'text/csv' : 'text/plain';
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const baseName = (activeDeck?.name || 'deck').replace(/[^\w\- ]+/g, '').trim() || 'deck';

  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseName} (${format.label}).${format.extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function setupExportModal() {
  activeFormat = loadSavedFormat() || activeFormat;

  document.getElementById('export-format-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.export-format-btn');
    if (btn) selectFormat(btn.dataset.format);
  });

  ['sideboard', 'maybeboard', 'basics', 'unowned'].forEach((name) => {
    document.getElementById(`export-opt-${name}`).addEventListener('change', renderPreview);
  });

  document.getElementById('copy-export').addEventListener('click', async () => {
    const copied = await copyText(document.getElementById('export-text').value);
    showToast(copied ? 'Deck list copied' : 'Could not copy. Select the text and copy it manually.', copied ? 'success' : 'error', 2500);
  });

  document.getElementById('download-export').addEventListener('click', downloadExport);

  document.getElementById('open-export').addEventListener('click', async () => {
    const format = currentFormat();
    const copied = await copyText(document.getElementById('export-text').value);
    window.open(format.openUrl, '_blank', 'noopener');
    showToast(
      copied ? `Deck list copied. Paste it into ${format.label}.` : 'Could not copy. Select the text and copy it manually.',
      copied ? 'success' : 'error',
      4000,
    );
  });
}

/**
 * @param {{name: string, cards: Array}} deck
 * @param {{canFilterOwned?: boolean}} [options] the share page has no ownership data
 */
export function openExportModal(deck, { canFilterOwned = true } = {}) {
  activeDeck = deck;

  document.getElementById('export-deck-name').textContent = deck.name || 'deck';

  const unowned = document.getElementById('export-opt-unowned');
  document.getElementById('export-opt-unowned-wrap').classList.toggle('hidden', !canFilterOwned);
  if (!canFilterOwned) unowned.checked = false;

  renderFormatList();
  renderPreview();
  document.getElementById('export-deck-modal').classList.remove('hidden');
}
