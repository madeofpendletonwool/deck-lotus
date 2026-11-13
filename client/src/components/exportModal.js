import { copyText, showToast } from '../utils/ui.js';
import {
  EXPORT_FORMATS,
  DEFAULT_EXPORT_OPTIONS,
  generateExport,
  countExportedCards,
} from '../utils/deckExport.js';
import { tokenize } from '../utils/cardQuery.js';
import { tagsOf } from '../utils/cube.js';

const FORMAT_NOTES = {
  mtgprint: 'Paste this into the box on MTG Print, press Submit, then download your PDF.',
  mpc: 'In the MPC Autofill editor choose Add Cards → Text and paste. It picks the art itself, so printings are left off. Projects max out at 612 cards.',
  arena: 'Paste into Arena using Import. Arena rejects printings it does not have, so use Plain text if a line fails.',
  tcgplayer: 'Paste into TCGplayer Mass Entry.',
};

const FORMAT_PREFERENCE_KEY = 'deckExportFormat';

// One-click filter terms. Clicking one toggles its term in the filter box, replacing any other
// term from the same group, so the box stays the single source of truth and can be hand-edited.
const PRICE_TERM = /^(usd|price|\$)(:|<=|>=|=|<|>)/i;
const FILTER_CHIPS = [
  { label: '$1+', term: 'usd>=1', group: PRICE_TERM, needsPrices: true },
  { label: '$5+', term: 'usd>=5', group: PRICE_TERM, needsPrices: true },
  { label: '$20+', term: 'usd>=20', group: PRICE_TERM, needsPrices: true },
  { label: 'Under $1', term: 'usd<1', group: PRICE_TERM, needsPrices: true },
  null,
  { label: 'Rare & mythic', term: 'r>=rare', group: /^r(arity)?(:|<=|>=|=|<|>)/i },
  { label: 'No lands', term: '-t:land', group: /^-?t(ype)?:land$/i },
  { label: 'Creatures', term: 't:creature', group: /^-?t(ype)?:creature$/i },
  { label: 'Noncreature', term: '-t:creature', group: /^-?t(ype)?:creature$/i },
  { label: 'Double-faced', term: 'is:dfc', group: /^-?is:dfc$/i },
  { label: 'Single-faced', term: '-is:dfc', group: /^-?is:dfc$/i },
];
const MAX_TAG_CHIPS = 8;

let activeDeck = null;
let activeCards = [];
let activeFormat = 'mtgprint';

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const filterInput = () => document.getElementById('export-filter');

/** The term a tag chip adds: "#ramp", or tag:"card draw" when the tag has a space. */
const tagTerm = (tag) => (/\s|"/.test(tag) ? `tag:"${tag.replace(/"/g, '')}"` : `#${tag}`);

function tagChips(cards) {
  const counts = new Map();
  for (const card of cards) {
    for (const tag of tagsOf(card)) counts.set(tag, (counts.get(tag) || 0) + (card.quantity ?? 1));
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TAG_CHIPS)
    .map(([tag]) => ({ label: `#${tag}`, term: tagTerm(tag) }));
}

function chipsFor(cards) {
  const hasPrices = cards.some((c) => Number.isFinite(c.price) && c.price > 0);
  const chips = FILTER_CHIPS.filter((chip) => !chip?.needsPrices || hasPrices);
  if (chips[0] === null) chips.shift(); // no leading separator when the price chips are hidden
  const tags = tagChips(cards);
  return tags.length ? [...chips, null, ...tags] : chips;
}

function filterTokens() {
  return tokenize(filterInput().value);
}

function renderChips() {
  const tokens = filterTokens().map((t) => t.toLowerCase());
  document.getElementById('export-filter-chips').innerHTML = chipsFor(activeCards).map((chip) => {
    if (!chip) return '<span class="export-chip-sep" aria-hidden="true"></span>';
    const on = tokens.includes(chip.term.toLowerCase());
    return `<button type="button" class="tag-chip ${on ? 'active' : ''}" data-term="${escapeHtml(chip.term)}" aria-pressed="${on}">${escapeHtml(chip.label)}</button>`;
  }).join('');
}

function toggleChip(term) {
  const chip = chipsFor(activeCards).find((c) => c?.term === term);
  const tokens = filterTokens();
  const lower = term.toLowerCase();
  const next = tokens.some((t) => t.toLowerCase() === lower)
    ? tokens.filter((t) => t.toLowerCase() !== lower)
    : [...tokens.filter((t) => !chip?.group?.test(t)), term];
  filterInput().value = next.join(' ');
  renderPreview();
}

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
    oneOfEach: document.getElementById('export-opt-oneofeach').checked,
    filter: filterInput().value,
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
  const cards = activeCards;

  document.getElementById('export-text').value = generateExport(format.id, cards, options);

  const count = countExportedCards(cards, options);
  const unfiltered = countExportedCards(cards, { ...options, filter: '', oneOfEach: false });
  const narrowed = count !== unfiltered;
  document.getElementById('export-count').textContent = narrowed
    ? `${count} of ${unfiltered} ${unfiltered === 1 ? 'card' : 'cards'}`
    : `${count} ${count === 1 ? 'card' : 'cards'}`;

  const filtering = options.filter.trim() !== '';
  filterInput().classList.toggle('invalid', filtering && count === 0);
  document.getElementById('export-note').textContent = filtering && count === 0
    ? 'No cards match the filter.'
    : FORMAT_NOTES[format.id] || '';
  document.getElementById('export-opt-maybeboard-wrap').classList.toggle('hidden', !format.supportsMaybeboard);

  const openBtn = document.getElementById('open-export');
  openBtn.classList.toggle('hidden', !format.openUrl);
  document.getElementById('open-export-label').textContent = format.openLabel || '';

  renderChips();
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

  ['sideboard', 'maybeboard', 'basics', 'unowned', 'oneofeach'].forEach((name) => {
    document.getElementById(`export-opt-${name}`).addEventListener('change', renderPreview);
  });

  filterInput().addEventListener('input', renderPreview);
  document.getElementById('export-filter-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-term]');
    if (chip) toggleChip(chip.dataset.term);
  });
  const helpBtn = document.getElementById('export-filter-help-btn');
  helpBtn.addEventListener('click', () => {
    const help = document.getElementById('export-filter-help');
    const open = help.classList.toggle('hidden') === false;
    helpBtn.setAttribute('aria-expanded', String(open));
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
 * @param {{name: string, cards: Array}} deck cards may carry their own `price`
 * @param {object} [options]
 * @param {boolean} [options.canFilterOwned] the share page has no ownership data
 * @param {Object<string, number>} [options.prices] price by deck_card_id, for the price filters
 */
export function openExportModal(deck, { canFilterOwned = true, prices = null } = {}) {
  // A filter is about one deck, so a different deck starts unfiltered
  if (activeDeck?.id !== deck.id) filterInput().value = '';
  activeDeck = deck;
  activeCards = (deck.cards || []).map((card) => ({
    ...card,
    price: card.price ?? prices?.[card.deck_card_id] ?? null,
  }));

  document.getElementById('export-deck-name').textContent = deck.name || 'deck';

  const unowned = document.getElementById('export-opt-unowned');
  document.getElementById('export-opt-unowned-wrap').classList.toggle('hidden', !canFilterOwned);
  if (!canFilterOwned) unowned.checked = false;

  renderFormatList();
  renderPreview();
  document.getElementById('export-deck-modal').classList.remove('hidden');
}
