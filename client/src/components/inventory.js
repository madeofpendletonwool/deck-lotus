/**
 * Inventory: your whole collection, searched and filtered in the browser.
 *
 * The page loads every owned card once (/inventory/index) and does the rest locally, so search,
 * facets, sorting and grouping answer as you type even with tens of thousands of cards. Results
 * render in chunks as you scroll, so a big collection doesn't build ten thousand tiles at once.
 */
import api from '../services/api.js';
import { formatMana, showToast, showError, confirmDialog, openDrawer, closeDrawer, copyText, popover } from '../utils/ui.js';
import { toItems, filterItems, sortItems, setFacets, totals, activeFilterCount, EMPTY_FILTERS, SORTS } from '../utils/inventory.js';
import { groupItems } from '../utils/shopping.js';
import { showCardDetail } from './cardDetail.js';

const PREFS_KEY = 'inventory:prefs';
const CHUNK = 120;

const GROUPS = [['none', 'None'], ['set', 'Set'], ['color', 'Color'], ['type', 'Type'], ['rarity', 'Rarity'], ['price', 'Price']];
const SIZES = [['s', 'S'], ['m', 'M'], ['l', 'L']];
const COLOR_CHIPS = [['W', 'ms-w'], ['U', 'ms-u'], ['B', 'ms-b'], ['R', 'ms-r'], ['G', 'ms-g'], ['C', 'ms-c'], ['M', null]];
const TYPE_CHIPS = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle'];
const RARITY_CHIPS = [['common', 'Common'], ['uncommon', 'Uncommon'], ['rare', 'Rare'], ['mythic', 'Mythic']];
const FINISHES = [['all', 'Any finish'], ['foil', 'Foil'], ['nonfoil', 'Nonfoil']];
const AVAILABILITY = [
  ['all', 'All copies', ''],
  ['free', 'Free', 'Cards with copies no deck is using'],
  ['indeck', 'In decks', 'Cards at least one deck uses'],
  ['unused', 'Unused', 'Cards no deck uses'],
  ['short', 'Short', 'Cards your decks list more copies of than you own'],
];

let index = null;
let allItems = [];
let loading = null;
let stale = true;
let filters = cloneFilters(EMPTY_FILTERS);
let prefs = { sort: 'name', group: 'none', view: 'grid', size: 'm', ...readPrefs() };
let shown = [];
let queue = [];
let queuePos = 0;
let selectMode = false;
let selectedCards = new Set(); // card ids
let contested = null; // Cards your decks want more copies of than you own
let observer = null;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n, word, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;

function cloneFilters(f) {
  return { ...f, colors: [...f.colors], types: [...f.types], rarities: [...f.rarities], sets: [...f.sets] };
}

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered in private windows
  }
}

const isVisible = () => !document.getElementById('inventory-page').classList.contains('hidden');

export function setupInventory() {
  window.addEventListener('page:inventory', () => {
    load();
    loadContested();
  });
  window.addEventListener('card-ownership-changed', (e) => refreshCards([e.detail.cardId]));

  setupControls();
  setupContested();
  setupBulkAddModal();
  setupQuickSearch();
  setupBulkActions();

  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) renderMore();
  }, { rootMargin: '900px 0px' });
  observer.observe(document.getElementById('inv-sentinel'));
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function load() {
  if (loading) return loading;
  const results = document.getElementById('inventory-grid');
  if (!index) {
    results.innerHTML = '<div class="grid-message"><div class="spinner"></div></div>';
  } else {
    // Show what we have straight away; refresh underneath
    if (!results.children.length) render();
    if (!stale) return null;
  }
  loading = (async () => {
    try {
      index = await api.getInventoryIndex();
      allItems = toItems(index);
      stale = false;
      // Forget selections of cards that are gone
      const ids = new Set(allItems.map((i) => i.card_id));
      selectedCards = new Set([...selectedCards].filter((id) => ids.has(id)));
      render({ keepScroll: true });
    } catch (error) {
      results.innerHTML = `<div class="grid-message"><i class="ph ph-warning"></i><h3>Couldn't load your collection</h3><p>${esc(error.message)}</p></div>`;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

async function reload() {
  stale = true;
  await load();
}

/** Re-read a few cards after a change and patch them in, rather than reloading everything. */
async function refreshCards(cardIds) {
  if (!index) return;
  try {
    const patch = await api.getInventoryIndex(cardIds);
    const fresh = new Map(toItems({ cards: patch.cards, sets: { ...index.sets, ...patch.sets } }).map((i) => [i.card_id, i]));
    Object.assign(index.sets, patch.sets);
    const ids = new Set(cardIds);
    const next = allItems.filter((i) => !ids.has(i.card_id) || fresh.has(i.card_id)).map((i) => fresh.get(i.card_id) || i);
    for (const [id, item] of fresh) if (!allItems.some((i) => i.card_id === id)) next.push(item);
    allItems = next;
    if (isVisible()) render({ keepScroll: true });
  } catch {
    stale = true;
  }
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function setupControls() {
  const search = document.getElementById('inventory-search');
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filters.query = search.value;
      render();
    }, 110);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      e.stopPropagation();
      search.value = '';
      filters.query = '';
      render();
    }
  });

  const help = document.getElementById('inv-help');
  const helpBtn = document.getElementById('inv-help-btn');
  helpBtn.addEventListener('click', () => {
    help.classList.toggle('hidden');
    helpBtn.setAttribute('aria-expanded', String(!help.classList.contains('hidden')));
  });

  const sort = document.getElementById('inventory-sort');
  sort.innerHTML = SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  sort.value = prefs.sort;
  sort.addEventListener('change', () => {
    prefs.sort = sort.value;
    savePrefs();
    render();
  });

  const group = document.getElementById('inv-group');
  group.innerHTML = GROUPS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  group.value = prefs.group;
  group.addEventListener('change', () => {
    prefs.group = group.value;
    savePrefs();
    render();
  });

  document.getElementById('inv-view').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    prefs.view = btn.dataset.view;
    savePrefs();
    render({ keepScroll: true });
  });
  document.getElementById('inv-size').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-size]');
    if (!btn) return;
    prefs.size = btn.dataset.size;
    savePrefs();
    render({ keepScroll: true });
  });

  const bar = document.getElementById('inv-bar');
  new ResizeObserver(() => {
    document.getElementById('inventory-page').style.setProperty('--inv-bar-h', `${bar.offsetHeight}px`);
  }).observe(bar);

  document.getElementById('inv-facets').addEventListener('click', onFacetClick);
  document.getElementById('inv-summary').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="clear-filters"]')) clearFilters();
  });
  document.getElementById('inventory-grid').addEventListener('click', onResultsClick);

  // "/" jumps to the search box
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || !isVisible() || e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.modal:not(.hidden)')) return;
    e.preventDefault();
    search.focus();
  });
}

function clearFilters() {
  filters = cloneFilters(EMPTY_FILTERS);
  document.getElementById('inventory-search').value = '';
  render();
}

function toggleIn(list, value) {
  const i = list.indexOf(value);
  if (i >= 0) list.splice(i, 1);
  else list.push(value);
}

function onFacetClick(e) {
  const chip = e.target.closest('[data-facet]');
  if (!chip) return;
  const { facet, value } = chip.dataset;
  switch (facet) {
    case 'color': toggleIn(filters.colors, value); break;
    case 'type': toggleIn(filters.types, value); break;
    case 'rarity': toggleIn(filters.rarities, value); break;
    case 'finish': filters.finish = value; break;
    case 'availability': filters.availability = value; break;
    case 'set-remove': toggleIn(filters.sets, value); break;
    case 'sets': openSetPicker(chip); return;
    case 'clear': clearFilters(); return;
    default: return;
  }
  render();
}

function openSetPicker(anchor) {
  const facets = setFacets(allItems);
  const content = document.createElement('div');
  content.className = 'inv-set-picker';
  content.innerHTML = `
    <input type="search" class="inv-set-search" placeholder="Find a set by name or code" aria-label="Find a set">
    <div class="inv-set-list"></div>`;
  const list = content.querySelector('.inv-set-list');
  const draw = (q = '') => {
    const term = q.trim().toLowerCase();
    const rows = facets.filter((s) => !term || s.code.includes(term) || s.name.toLowerCase().includes(term));
    list.innerHTML = rows.length ? rows.map((s) => `
      <label class="inv-set-option">
        <input type="checkbox" value="${esc(s.code)}" ${filters.sets.includes(s.code) ? 'checked' : ''}>
        <span class="inv-set-name">${esc(s.name)}</span>
        <span class="inv-set-code">${esc(s.code.toUpperCase())}</span>
        <span class="inv-set-count">${s.count.toLocaleString()}</span>
      </label>`).join('') : '<div class="muted inv-set-none">No set matches.</div>';
  };
  draw();
  popover(anchor, content);
  const search = content.querySelector('.inv-set-search');
  search.focus();
  search.addEventListener('input', () => draw(search.value));
  content.addEventListener('change', (e) => {
    if (!e.target.matches('input[type="checkbox"]')) return;
    toggleIn(filters.sets, e.target.value);
    render();
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render({ keepScroll = false } = {}) {
  if (!index) return;
  const y = window.scrollY;
  shown = sortItems(filterItems(allItems, filters), prefs.sort);

  renderStats();
  renderBar();
  renderFacets();
  renderSummary();
  renderResults();
  updateBulkActionsBar();
  if (keepScroll) {
    // Fill enough rows to get back to where we were
    while (queuePos < queue.length && document.documentElement.scrollHeight < y + window.innerHeight * 2) renderMore();
    window.scrollTo(0, y);
  }
}

function renderBar() {
  document.querySelectorAll('#inv-view [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === prefs.view));
  const size = document.getElementById('inv-size');
  size.classList.toggle('hidden', prefs.view !== 'grid');
  size.innerHTML = SIZES.map(([v, l]) => `<button type="button" class="seg-btn ${prefs.size === v ? 'active' : ''}" data-size="${v}" title="${{ s: 'Small', m: 'Medium', l: 'Large' }[v]} cards">${l}</button>`).join('');
  document.getElementById('inventory-sort').value = prefs.sort;
  document.getElementById('inv-group').value = prefs.group;
}

function renderStats() {
  const container = document.getElementById('inventory-stats');
  const t = totals(allItems);
  const tile = (label, value, sub = '') => `<div class="inv-stat"><span class="inv-stat-label">${label}</span><span class="inv-stat-value">${value}</span>${sub ? `<span class="inv-stat-sub">${sub}</span>` : ''}</div>`;
  container.innerHTML = `
    ${tile('Cards', t.cards.toLocaleString(), `${plural(t.copies, 'copy', 'copies')}`)}
    ${tile('Value', money(t.value))}
    ${tile('In decks', t.inDecks.toLocaleString(), 'copies')}
    ${tile('Free', t.free.toLocaleString(), 'copies')}
    ${contested ? `<button type="button" class="inv-stat inv-stat-btn${contested.cards.length ? ' is-warning' : ''}" id="inventory-contested-btn" title="Cards two or more of your decks want more copies of than you own">
      <span class="inv-stat-label">Contested</span>
      <span class="inv-stat-value">${contested.cards.length.toLocaleString()}</span>
      <span class="inv-stat-sub">${contested.cards.length ? `${plural(contested.shortCopies, 'copy', 'copies')} short` : 'no conflicts'}</span>
    </button>` : ''}`;
}

function chip(facet, value, label, on, title = '') {
  return `<button type="button" class="inv-chip" data-facet="${facet}" data-value="${esc(value)}" aria-pressed="${on}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function renderFacets() {
  const el = document.getElementById('inv-facets');
  const setsByCode = new Map(setFacets(allItems).map((s) => [s.code, s]));
  const count = activeFilterCount(filters);
  el.innerHTML = `
    <div class="inv-facet-group" role="group" aria-label="Colors">
      ${COLOR_CHIPS.map(([c, cls]) => chip('color', c, cls ? `<i class="ms ${cls} ms-cost"></i>` : '<span class="inv-multi">M</span>', filters.colors.includes(c), { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless', M: 'Two or more colors' }[c])).join('')}
    </div>
    <div class="inv-facet-group" role="group" aria-label="Types">
      ${TYPE_CHIPS.map((t) => chip('type', t, t, filters.types.includes(t))).join('')}
    </div>
    <div class="inv-facet-group" role="group" aria-label="Rarity">
      ${RARITY_CHIPS.map(([v, l]) => chip('rarity', v, `<span class="inv-rarity-dot" data-rarity="${v}"></span>${l}`, filters.rarities.includes(v))).join('')}
    </div>
    <div class="inv-facet-group" role="group" aria-label="Finish">
      ${FINISHES.map(([v, l]) => chip('finish', v, v === 'foil' ? `<i class="ph ph-sparkle"></i>${l}` : l, filters.finish === v)).join('')}
    </div>
    <div class="inv-facet-group" role="group" aria-label="Deck use">
      ${AVAILABILITY.map(([v, l, t]) => chip('availability', v, l, filters.availability === v, t)).join('')}
    </div>
    <div class="inv-facet-group">
      <button type="button" class="inv-chip" data-facet="sets" aria-pressed="${filters.sets.length > 0}"><i class="ph ph-books"></i>Sets<i class="ph ph-caret-down"></i></button>
      ${filters.sets.map((code) => `<button type="button" class="inv-chip inv-chip-removable" data-facet="set-remove" data-value="${esc(code)}" aria-pressed="true" title="Remove">${esc(setsByCode.get(code)?.name || code.toUpperCase())}<i class="ph ph-x"></i></button>`).join('')}
      ${count ? `<button type="button" class="link-btn inv-clear" data-facet="clear">Clear ${count === 1 ? 'filter' : `${count} filters`}</button>` : ''}
    </div>`;
}

function renderSummary() {
  const el = document.getElementById('inv-summary');
  if (!allItems.length) {
    el.innerHTML = '';
    return;
  }
  const t = totals(shown);
  const filtered = shown.length !== allItems.length;
  el.innerHTML = `
    <span>${filtered ? `<strong>${t.cards.toLocaleString()}</strong> of ${allItems.length.toLocaleString()} cards` : `<strong>${t.cards.toLocaleString()}</strong> cards`}</span>
    <span><strong>${t.copies.toLocaleString()}</strong> ${t.copies === 1 ? 'copy' : 'copies'}</span>
    <span><strong>${money(t.value)}</strong></span>
    ${filtered ? '<button type="button" class="link-btn" data-action="clear-filters">Show everything</button>' : ''}`;
}

function renderResults() {
  const el = document.getElementById('inventory-grid');
  el.className = `inv-results is-${prefs.view} size-${prefs.size}${selectMode ? ' is-selecting' : ''}`;
  queue = [];
  queuePos = 0;

  if (!allItems.length) {
    el.innerHTML = `<div class="grid-message"><i class="ph ph-archive"></i><h3>Your collection is empty</h3><p>Add cards with the box at the top, paste a list with Bulk add, or scan them with the Android app.</p></div>`;
    return;
  }
  if (!shown.length) {
    el.innerHTML = `<div class="grid-message"><i class="ph ph-magnifying-glass"></i><h3>No cards match</h3><p><button type="button" class="link-btn" data-action="clear-filters">Clear the filters</button> to see everything.</p></div>`;
    el.querySelector('[data-action="clear-filters"]').addEventListener('click', clearFilters);
    return;
  }

  const groups = prefs.group === 'none' ? [{ key: 'all', label: '', items: shown, cards: shown.length, copies: 0, cost: 0, bare: true }] : groupItems(shown, prefs.group, { keepOrder: true });
  for (const g of groups) {
    queue.push({ group: g });
    for (const item of g.items) queue.push({ item });
  }

  el.innerHTML = prefs.view === 'list'
    ? `<table class="inv-table">
        <thead><tr>
          ${selectMode ? '<th class="inv-col-check"></th>' : ''}
          ${th('name', 'Card')}<th class="inv-col-type">Type</th>${th('set', 'Printings')}
          ${th('qty', 'Copies', 'num')}<th class="num inv-col-decks" title="Copies in decks (maybeboards aside)">In decks</th><th class="num inv-col-free">Free</th>
          ${th('price', 'Each', 'num')}${th('value', 'Value', 'num')}
        </tr></thead>
      </table>`
    : '';
  el.querySelectorAll('th[data-sort]').forEach((h) => h.addEventListener('click', () => {
    prefs.sort = h.dataset.sort;
    savePrefs();
    render();
  }));
  renderMore();
}

function th(sort, label, cls = '') {
  const active = prefs.sort === sort;
  return `<th class="${cls} inv-sortable ${active ? 'is-sorted' : ''}" data-sort="${sort}" aria-sort="${active ? (sort === 'name' ? 'ascending' : 'descending') : 'none'}">${label}${active ? ' <i class="ph ph-caret-down"></i>' : ''}</th>`;
}

/** Append the next chunk of results. */
function renderMore() {
  if (queuePos >= queue.length) return;
  const el = document.getElementById('inventory-grid');
  const isList = prefs.view === 'list';
  const end = Math.min(queue.length, queuePos + CHUNK);
  let container = isList ? el.querySelector('tbody:last-of-type') : el.querySelector('.inv-group:last-of-type .inv-grid');
  let html = '';
  const flush = () => {
    if (html && container) container.insertAdjacentHTML('beforeend', html);
    html = '';
  };
  for (; queuePos < end; queuePos++) {
    const entry = queue[queuePos];
    if (entry.group) {
      flush();
      const g = entry.group;
      if (isList) {
        el.querySelector('table').insertAdjacentHTML('beforeend', `<tbody class="inv-group">${g.bare ? '' : `<tr class="inv-group-row"><th colspan="${selectMode ? 9 : 8}">${groupHead(g)}</th></tr>`}</tbody>`);
        container = el.querySelector('tbody:last-of-type');
      } else {
        el.insertAdjacentHTML('beforeend', `<section class="inv-group">${g.bare ? '' : `<h3 class="inv-group-head">${groupHead(g)}</h3>`}<div class="inv-grid"></div></section>`);
        container = el.querySelector('.inv-group:last-of-type .inv-grid');
      }
    } else {
      html += isList ? rowHtml(entry.item) : tileHtml(entry.item);
    }
  }
  flush();
}

function groupHead(g) {
  return `<span class="inv-group-name">${esc(g.label)}</span><span class="inv-group-meta">${plural(g.cards, 'card')} · ${plural(g.copies, 'copy', 'copies')}${g.cost ? ` · ${money(g.cost)}` : ''}</span>`;
}

const imageFor = (item) => (prefs.size === 's' ? item.image_url?.replace('/normal/', '/small/') : item.image_url);

function tileHtml(item) {
  const selected = selectedCards.has(item.card_id);
  const short = item.free < 0;
  return `
    <div class="inv-card ${selected ? 'is-selected' : ''}" data-card="${item.card_id}">
      <button type="button" class="inv-card-img" data-action="open" aria-label="${esc(item.name)}">
        ${item.image_url ? `<img src="${esc(imageFor(item))}" alt="" loading="lazy" decoding="async">` : `<span class="inv-noimg">${esc(item.name)}</span>`}
        <span class="inv-qty" title="${plural(item.qty, 'copy', 'copies')}">${item.qty}</span>
        ${item.has_foil ? '<span class="inv-foil" title="You have a foil copy"><i class="ph-fill ph-sparkle"></i></span>' : ''}
        ${selectMode ? `<span class="inv-check" aria-hidden="true"><i class="ph ph-check"></i></span>` : ''}
      </button>
      <div class="inv-card-meta">
        <span class="inv-card-use ${short ? 'is-short' : ''}" title="${item.in_decks ? `${item.in_decks} in decks, ${short ? `${-item.free} short` : `${item.free} free`}` : 'Not in any deck'}">
          ${item.in_decks ? `<i class="ph ph-stack"></i>${item.in_decks} in decks${short ? ` · ${-item.free} short` : ''}` : ''}
        </span>
        <span class="inv-card-value">${item.value ? money(item.value) : ''}</span>
      </div>
    </div>`;
}

function printingsSummary(item) {
  const shownCount = 3;
  const parts = item.printings.slice(0, shownCount).map((p) => `<span class="inv-print">${esc(String(p.set_code).toUpperCase())}${p.finish !== 'nonfoil' ? '<i class="ph-fill ph-sparkle"></i>' : ''}${item.printings.length > 1 ? ` <span class="muted">×${p.quantity}</span>` : ''}</span>`);
  if (item.printings.length > shownCount) parts.push(`<span class="muted">+${item.printings.length - shownCount}</span>`);
  return parts.join('');
}

function rowHtml(item) {
  const selected = selectedCards.has(item.card_id);
  return `
    <tr class="inv-row ${selected ? 'is-selected' : ''}" data-card="${item.card_id}" data-action="open">
      ${selectMode ? `<td class="inv-col-check"><span class="inv-row-check" aria-hidden="true"><i class="ph ph-check"></i></span></td>` : ''}
      <td class="inv-col-name"><span class="inv-row-name">${esc(item.name)}</span>${item.mana_cost ? `<span class="inv-row-cost">${formatMana(item.mana_cost)}</span>` : ''}</td>
      <td class="inv-col-type">${esc((item.type_line || '').split(' // ')[0])}</td>
      <td class="inv-col-prints">${printingsSummary(item)}</td>
      <td class="num">${item.qty}</td>
      <td class="num inv-col-decks">${item.in_decks || '<span class="muted">0</span>'}</td>
      <td class="num inv-col-free ${item.free < 0 ? 'is-short' : ''}">${item.free}</td>
      <td class="num">${item.price != null ? money(item.price) : '<span class="muted">—</span>'}</td>
      <td class="num inv-col-value">${item.value ? money(item.value) : '<span class="muted">—</span>'}</td>
    </tr>`;
}

function onResultsClick(e) {
  const target = e.target.closest('[data-action="open"]');
  if (!target) return;
  const holder = target.closest('[data-card]');
  if (!holder) return;
  const cardId = Number(holder.dataset.card);
  if (selectMode) {
    if (selectedCards.has(cardId)) selectedCards.delete(cardId);
    else selectedCards.add(cardId);
    holder.classList.toggle('is-selected', selectedCards.has(cardId));
    updateBulkActionsBar();
    return;
  }
  showCardDetail(cardId);
}

// ---------------------------------------------------------------------------
// Select mode and bulk actions
// ---------------------------------------------------------------------------

function setupBulkActions() {
  const selectToggle = document.getElementById('inventory-select-toggle');
  selectToggle.addEventListener('click', () => {
    selectMode = !selectMode;
    selectToggle.classList.toggle('active', selectMode);
    if (!selectMode) selectedCards.clear();
    render({ keepScroll: true });
  });

  document.getElementById('inventory-select-all').addEventListener('click', () => {
    shown.forEach((item) => selectedCards.add(item.card_id));
    render({ keepScroll: true });
  });

  document.getElementById('inventory-clear-selection').addEventListener('click', () => {
    selectedCards.clear();
    render({ keepScroll: true });
  });

  document.getElementById('inventory-remove-selected').addEventListener('click', async () => {
    if (selectedCards.size === 0) return;
    const cards = allItems.filter((i) => selectedCards.has(i.card_id));
    const copies = cards.reduce((n, c) => n + c.qty, 0);
    const ok = await confirmDialog({
      title: 'Remove from your collection?',
      message: `${plural(cards.length, 'card')} (${plural(copies, 'copy', 'copies')}, every printing and finish). Decks keep listing them.`,
      confirmText: 'Remove',
      danger: true,
    });
    if (!ok) return;
    const btn = document.getElementById('inventory-remove-selected');
    btn.disabled = true;
    try {
      for (const card of cards) {
        for (const p of card.printings) {
          await api.setOwnedPrintingQuantity(p.printing_id, 0, p.finish);
        }
      }
      selectedCards.clear();
      showToast(`Removed ${plural(cards.length, 'card')}`, 'success');
    } catch (error) {
      showToast(`Couldn't remove them all: ${error.message}`, 'error');
    } finally {
      btn.disabled = false;
      await reload();
    }
  });

  document.getElementById('inventory-add-to-deck').addEventListener('click', async () => {
    if (selectedCards.size === 0) return;
    await showAddToDeckModal();
  });
}

async function showAddToDeckModal() {
  let decks;
  try {
    decks = (await api.getDecks()).decks;
  } catch (error) {
    showToast(`Couldn't load your decks: ${error.message}`, 'error');
    return;
  }
  if (!decks?.length) {
    showToast('Create a deck first', 'warning');
    return;
  }
  const cards = allItems.filter((i) => selectedCards.has(i.card_id));
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content modal-sm">
      <button type="button" class="modal-close" aria-label="Close">&times;</button>
      <h2>Add ${plural(cards.length, 'card')} to a deck</h2>
      <p class="modal-lede">One copy of each, in the printing you have most of.</p>
      <div class="form-group">
        <label for="deck-select-for-add">Deck</label>
        <select id="deck-select-for-add" class="filter-select" style="width: 100%;">
          ${decks.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="board-select-for-add">Board</label>
        <select id="board-select-for-add" class="filter-select" style="width: 100%;">
          <option value="mainboard">Mainboard</option>
          <option value="sideboard">Sideboard</option>
          <option value="maybeboard">Maybeboard</option>
        </select>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" id="confirm-add-to-deck">Add to deck</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('.modal-close, [data-close]')) close();
  });
  modal.querySelector('#confirm-add-to-deck').addEventListener('click', async (e) => {
    const deckId = modal.querySelector('#deck-select-for-add').value;
    const board = modal.querySelector('#board-select-for-add').value;
    e.target.disabled = true;
    let added = 0;
    try {
      for (const card of cards) {
        const printing = card.printings[0];
        if (!printing) continue;
        await api.addCardToDeck(deckId, printing.printing_id, 1, board === 'sideboard', false, board);
        added++;
      }
      close();
      showToast(`Added ${plural(added, 'card')} to ${decks.find((d) => String(d.id) === deckId)?.name || 'the deck'}`, 'success');
      selectedCards.clear();
      await reload();
    } catch (error) {
      e.target.disabled = false;
      showToast(`Added ${added}, then failed: ${error.message}`, 'error');
    }
  });
}

function updateBulkActionsBar() {
  const bar = document.getElementById('inventory-bulk-actions');
  bar.classList.toggle('hidden', !selectMode);
  document.getElementById('inventory-selected-count').textContent = selectedCards.size
    ? `${selectedCards.size.toLocaleString()} selected`
    : 'Tap cards to select them';
  document.getElementById('inventory-add-to-deck').disabled = selectedCards.size === 0;
  document.getElementById('inventory-remove-selected').disabled = selectedCards.size === 0;
  document.getElementById('inventory-select-all').textContent = `Select all ${shown.length.toLocaleString()} shown`;
}

// ---------------------------------------------------------------------------
// Quick add: type a name, pick a printing
// ---------------------------------------------------------------------------

let quickSearchTimeout = null;
let activePrintingFlyout = null;

function setupQuickSearch() {
  const searchInput = document.getElementById('inventory-quick-search');
  const resultsContainer = document.getElementById('inventory-quick-results');

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(quickSearchTimeout);
    if (query.length < 2) {
      resultsContainer.classList.add('hidden');
      resultsContainer.innerHTML = '';
      closePrintingFlyout();
      return;
    }
    quickSearchTimeout = setTimeout(async () => {
      try {
        const result = await api.searchCards(query, 15);
        const seen = new Map();
        for (const card of result.cards) if (!seen.has(card.name)) seen.set(card.name, card);
        renderQuickSearchResults([...seen.values()]);
      } catch (error) {
        console.error('Quick search failed:', error);
      }
    }, 200);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.inventory-quick-add') && !e.target.closest('.printing-flyout')) {
      resultsContainer.classList.add('hidden');
      closePrintingFlyout();
    }
  });

  searchInput.addEventListener('focus', () => {
    if (resultsContainer.innerHTML.trim()) resultsContainer.classList.remove('hidden');
  });
}

function renderQuickSearchResults(cards) {
  const resultsContainer = document.getElementById('inventory-quick-results');
  if (!cards.length) {
    resultsContainer.innerHTML = '<div class="quick-result-empty">No cards found</div>';
    resultsContainer.classList.remove('hidden');
    return;
  }
  const owned = new Map(allItems.map((i) => [i.card_id, i.qty]));
  resultsContainer.innerHTML = cards.map((card) => `
    <div class="quick-result-item" data-card-id="${card.id}">
      ${card.image_url ? `<img src="${esc(card.image_url)}" class="quick-result-image" alt="" loading="lazy">` : '<div class="quick-result-image-placeholder"></div>'}
      <div class="quick-result-info">
        <span class="quick-result-name">${esc(card.name)}</span>
        <span class="quick-result-type">${esc(card.type_line || '')}${owned.get(card.id) ? ` · <span class="quick-result-owned">${owned.get(card.id)} owned</span>` : ''}</span>
      </div>
      <div class="quick-result-mana">${formatMana(card.mana_cost || '')}</div>
      <i class="ph ph-caret-right quick-result-caret"></i>
    </div>`).join('');
  resultsContainer.classList.remove('hidden');
  resultsContainer.querySelectorAll('.quick-result-item').forEach((item) => {
    item.addEventListener('click', () => showPrintingsFlyout(Number(item.dataset.cardId), item));
  });
}

async function showPrintingsFlyout(cardId, anchorEl) {
  closePrintingFlyout();
  try {
    const { printings = [] } = await api.getCardPrintings(cardId);
    if (!printings.length) {
      showToast('No printings found', 'warning');
      return;
    }
    const flyout = document.createElement('div');
    flyout.className = 'printing-flyout';
    flyout.innerHTML = `
      <div class="printing-flyout-header">
        <input type="text" class="printing-flyout-search" placeholder="Filter by set..." autocomplete="off">
        <span class="printing-flyout-count">${printings.length} printings</span>
      </div>
      <div class="printing-flyout-list">
        ${printings.map((p) => `
          <div class="printing-flyout-item" data-printing-id="${p.id}" data-set-code="${esc(p.set_code.toLowerCase())}" data-set-name="${esc((p.set_name || '').toLowerCase())}">
            <img src="${esc(p.image_url || '')}" alt="" loading="lazy">
            <div class="printing-flyout-info">
              <span class="printing-flyout-set">${esc(p.set_code.toUpperCase())}</span>
              <span class="printing-flyout-num">#${esc(p.collector_number || '?')}</span>
              ${p.rarity ? `<span class="printing-flyout-rarity">${esc(p.rarity)}</span>` : ''}
            </div>
            <button class="btn btn-sm btn-success printing-add-btn" data-printing-id="${p.id}" title="Add a copy"><i class="ph ph-plus"></i></button>
          </div>`).join('')}
      </div>`;

    const rect = document.getElementById('inventory-quick-results').getBoundingClientRect();
    flyout.style.position = 'fixed';
    const left = rect.right + 8 + 320 > window.innerWidth ? Math.max(8, rect.left) : rect.right + 8;
    const top = left === rect.right + 8 ? rect.top : rect.bottom + 8;
    flyout.style.left = `${left}px`;
    flyout.style.top = `${top}px`;
    flyout.style.maxHeight = `${Math.min(400, window.innerHeight - top - 20)}px`;
    document.body.appendChild(flyout);
    activePrintingFlyout = flyout;

    document.querySelectorAll('.quick-result-item').forEach((el) => el.classList.remove('active'));
    anchorEl.classList.add('active');

    const search = flyout.querySelector('.printing-flyout-search');
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase().trim();
      flyout.querySelectorAll('.printing-flyout-item').forEach((item) => {
        item.style.display = !q || item.dataset.setCode.includes(q) || item.dataset.setName.includes(q) ? 'flex' : 'none';
      });
    });
    setTimeout(() => search.focus(), 50);
    flyout.addEventListener('click', (e) => {
      const item = e.target.closest('.printing-flyout-item');
      if (item) quickAddPrinting(Number(item.dataset.printingId), cardId);
    });
  } catch (error) {
    console.error('Failed to load printings:', error);
    showToast('Failed to load printings', 'error');
  }
}

function closePrintingFlyout() {
  activePrintingFlyout?.remove();
  activePrintingFlyout = null;
  document.querySelectorAll('.quick-result-item').forEach((el) => el.classList.remove('active'));
}

async function quickAddPrinting(printingId, cardId) {
  try {
    // Adds one copy on top of any you already have
    await api.bulkAddToInventory([{ printingId, quantity: 1 }]);
    showToast('Added a copy to your collection', 'success');
    closePrintingFlyout();
    const input = document.getElementById('inventory-quick-search');
    const results = document.getElementById('inventory-quick-results');
    input.value = '';
    results.classList.add('hidden');
    results.innerHTML = '';
    input.focus();
    await refreshCards([cardId]);
  } catch (error) {
    showToast(`Failed to add card: ${error.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Bulk add modal
// ---------------------------------------------------------------------------

function setupBulkAddModal() {
  const modal = document.getElementById('bulk-add-modal');
  document.getElementById('inventory-bulk-add-btn').addEventListener('click', () => {
    modal.classList.remove('hidden');
    document.getElementById('bulk-add-text').value = '';
    document.getElementById('bulk-add-preview').classList.add('hidden');
    document.getElementById('bulk-add-result').classList.add('hidden');
  });

  document.getElementById('bulk-add-preview-btn').addEventListener('click', () => {
    renderBulkAddPreview(parseBulkAddText(document.getElementById('bulk-add-text').value));
  });

  const submitBtn = document.getElementById('bulk-add-submit-btn');
  submitBtn.addEventListener('click', async () => {
    const items = parseBulkAddText(document.getElementById('bulk-add-text').value);
    if (!items.length) {
      showError('No valid cards to add');
      return;
    }
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding...';
      const result = await api.bulkAddToInventory(items);
      const resultDiv = document.getElementById('bulk-add-result');
      resultDiv.classList.remove('hidden');
      resultDiv.innerHTML = `
        <div style="color: var(--success);">Added ${result.added} cards to inventory</div>
        ${result.failed > 0 ? `
          <div style="color: var(--danger); margin-top: 0.5rem;">
            Failed: ${result.failed}
            <ul style="margin-top: 0.5rem; padding-left: 1.5rem;">
              ${result.errors.map((e) => `<li>${esc(e.cardName)}: ${esc(e.error)}</li>`).join('')}
            </ul>
          </div>` : ''}`;
      showToast(`Added ${result.added} cards!`, 'success');
      await reload();
    } catch (error) {
      showError('Bulk add failed: ' + error.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Add to Inventory';
    }
  });
}

function parseBulkAddText(text) {
  const items = [];
  for (const line of text.split('\n').filter((l) => l.trim())) {
    // "4 Lightning Bolt", "4x Lightning Bolt", "4 Lightning Bolt [M21]", "Lightning Bolt"
    const match = line.match(/^(\d+)?x?\s*(.+?)(?:\s*\[(\w+)\])?$/i);
    if (!match) continue;
    const cardName = match[2].trim();
    if (cardName) items.push({ cardName, setCode: match[3] || null, quantity: match[1] ? parseInt(match[1], 10) : 1 });
  }
  return items;
}

function renderBulkAddPreview(items) {
  const contentDiv = document.getElementById('bulk-add-preview-content');
  contentDiv.innerHTML = items.length
    ? items.map((item) => `
      <div style="display: flex; justify-content: space-between; padding: 0.25rem 0; border-bottom: 1px solid var(--border);">
        <span>${item.quantity}x ${esc(item.cardName)}</span>
        ${item.setCode ? `<span style="color: var(--text-secondary);">[${esc(item.setCode.toUpperCase())}]</span>` : ''}
      </div>`).join('')
    : '<div style="color: var(--text-secondary);">No valid cards found</div>';
  document.getElementById('bulk-add-preview').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Contested cards: decks fighting over the same copies
// ---------------------------------------------------------------------------

async function loadContested() {
  try {
    contested = await api.getContestedCards();
  } catch {
    contested = null; // The tile simply doesn't show
  }
  if (index) renderStats();
  if (!document.getElementById('contested-drawer').classList.contains('hidden')) renderContested();
}

function setupContested() {
  document.getElementById('inventory-stats').addEventListener('click', (e) => {
    if (!e.target.closest('#inventory-contested-btn')) return;
    renderContested();
    openDrawer('contested-drawer');
  });
  document.getElementById('contested-body').addEventListener('click', (e) => {
    const link = e.target.closest('[data-deck-link]');
    if (link) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      closeDrawer('contested-drawer');
      window.dispatchEvent(new CustomEvent('navigate', { detail: { path: link.getAttribute('href') } }));
      return;
    }
    const card = e.target.closest('[data-card]');
    if (card) {
      showCardDetail(Number(card.dataset.card));
      return;
    }
    if (e.target.closest('[data-action="copy-contested"]')) {
      const text = contested.cards.map((c) => `${c.short} ${c.name}`).join('\n');
      copyText(text).then((ok) => showToast(ok ? 'Copied. It pastes into TCGplayer or Mana Pool mass entry.' : 'Couldn\'t copy to the clipboard', ok ? 'success' : 'error'));
    }
  });
}

function renderContested() {
  const body = document.getElementById('contested-body');
  if (!contested) {
    body.innerHTML = '<p class="muted">Couldn\'t work out which cards are contested.</p>';
    return;
  }
  const { cards, shortCopies, cost } = contested;
  if (!cards.length) {
    body.innerHTML = `<div class="grid-message"><i class="ph ph-check-circle"></i><h3>No conflicts</h3><p>You own enough copies for every deck to be built at once.</p></div>`;
    return;
  }
  body.innerHTML = `
    <p class="an-note">Cards that two or more of your decks list, with fewer copies in your collection than they want between them. Maybeboards don't count, and neither do basic lands.</p>
    <div class="col-actions">
      <span><strong>${shortCopies.toLocaleString()}</strong> ${shortCopies === 1 ? 'copy' : 'copies'} short${cost ? `, about <strong>$${cost.toFixed(2)}</strong> at the cheapest printings` : ''}</span>
      <button type="button" class="btn btn-secondary btn-sm" data-action="copy-contested"><i class="ph ph-copy"></i> Copy what to buy</button>
    </div>
    <ul class="contested-list">
      ${cards.map((c) => `<li class="contested-item">
        <button type="button" class="contested-img" data-card="${c.card_id}" aria-label="${esc(c.name)}">${c.image_url ? `<img src="${esc(c.image_url.replace('/normal/', '/small/'))}" alt="" loading="lazy">` : ''}</button>
        <div class="contested-main">
          <div class="contested-head">
            <button type="button" class="link-btn" data-card="${c.card_id}">${esc(c.name)}</button>
            <span class="contested-count">${c.owned === 1 ? 'your only copy' : `you own ${c.owned}`}, ${c.decks.length} decks want ${c.demand}</span>
          </div>
          <div class="contested-decks">${c.decks.map((d) => `<a class="col-deck" href="/decks/${d.deck_id}" data-deck-link="${d.deck_id}">${esc(d.name)}${d.quantity > 1 ? ` <span class="muted">×${d.quantity}</span>` : ''}</a>`).join('')}</div>
        </div>
        <div class="contested-short"><strong>${c.short}</strong> short${c.price_each != null ? `<span class="muted">$${(c.price_each * c.short).toFixed(2)}</span>` : ''}</div>
      </li>`).join('')}
    </ul>`;
}
