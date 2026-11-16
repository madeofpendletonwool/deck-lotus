/**
 * Shopping list: what your decks need that you don't own enough of, laid out for a walk around
 * a card store. Everything after the first load is local: switching decks, grouping, filtering
 * and checking cards off never waits on the server. Checked cards are remembered in this
 * browser, so a refresh in the middle of a shop keeps your place.
 */
import api from '../services/api.js';
import { formatMana, showToast, popover, openDrawer, copyText, confirmDialog } from '../utils/ui.js';
import { compileQuery } from '../utils/cardQuery.js';
import { buildList, groupItems, deckMissingCounts, listText, underCap, binderGroups, GROUPINGS, SET_ORDERS } from '../utils/shopping.js';
import { showCardDetail } from './cardDetail.js';

const PREFS_KEY = 'shopping:prefs';
const CHECKED_KEY = 'shopping:checked';

const DEFAULT_PREFS = {
  deckIds: null, // null: every deck except cubes
  groupBy: 'set',
  setOrder: 'count', // set groups: most cards first, so the binder worth the most is on top
  maxPrice: null, // leave out cards that cost more than this everywhere (you'll proxy them)
  binderCommander: true, // binder plan may send you to Commander precon binders
  view: 'list',
  includeMaybe: false,
  includeBasics: false,
  hideChecked: false,
};

let data = null;
let loading = null;
let stale = true;
let prefs = { ...DEFAULT_PREFS, ...readStore(PREFS_KEY, {}) };
let checked = new Set(readStore(CHECKED_KEY, []));
let collapsed = new Set();
let query = '';
let current = { items: [], filtered: [], shown: [], groups: [] };

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${n.toFixed(2)}`;
const plural = (n, word, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;
const small = (url) => (url ? url.replace('/normal/', '/small/') : '');

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and full storage just don't remember
  }
}

const savePrefs = () => writeStore(PREFS_KEY, prefs);
const saveChecked = () => writeStore(CHECKED_KEY, [...checked]);

export function setupShopping() {
  window.addEventListener('page:shopping', () => load());
  // Anything that changes your collection elsewhere makes the list out of date.
  window.addEventListener('card-ownership-changed', () => {
    stale = true;
    if (isVisible()) load();
  });

  const search = document.getElementById('shop-search');
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = search.value;
      render();
    }, 120);
  });

  document.getElementById('shop-decks-btn').addEventListener('click', (e) => openDeckPicker(e.currentTarget));
  document.getElementById('shop-copy-btn').addEventListener('click', (e) => openCopyMenu(e.currentTarget));
  document.getElementById('shop-optimize-open').addEventListener('click', () => {
    document.getElementById('shopping-optimizer-results').innerHTML = '';
    openDrawer('shop-optimizer-drawer');
  });
  document.getElementById('shopping-optimize-btn').addEventListener('click', runOptimizer);

  document.getElementById('shop-group').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-group]');
    if (!btn) return;
    prefs.groupBy = btn.dataset.group;
    collapsed = new Set();
    savePrefs();
    render();
  });
  document.getElementById('shop-view').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    prefs.view = btn.dataset.view;
    savePrefs();
    render();
  });
  document.getElementById('shop-options').addEventListener('click', (e) => {
    const order = e.target.closest('[data-set-order]');
    if (order) {
      prefs.setOrder = order.dataset.setOrder;
      savePrefs();
      render();
      return;
    }
    const btn = e.target.closest('[data-pref]');
    if (!btn) return;
    prefs[btn.dataset.pref] = !prefs[btn.dataset.pref];
    savePrefs();
    render();
  });

  const cap = document.getElementById('shop-max-price');
  if (prefs.maxPrice != null) cap.value = prefs.maxPrice;
  let capTimer = null;
  cap.addEventListener('input', () => {
    clearTimeout(capTimer);
    capTimer = setTimeout(() => {
      const value = cap.value.trim() === '' ? null : Number(cap.value);
      prefs.maxPrice = Number.isFinite(value) && value >= 0 ? value : null;
      savePrefs();
      render();
    }, 200);
  });
  document.getElementById('shop-summary').addEventListener('click', onSummaryClick);
  document.getElementById('shop-list').addEventListener('click', onListClick);

  // "/" jumps to the search box, as on most list pages
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || !isVisible() || e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.modal:not(.hidden)')) return;
    e.preventDefault();
    search.focus();
  });

  const bar = document.getElementById('shop-bar');
  new ResizeObserver(() => {
    document.getElementById('shopping-page').style.setProperty('--shop-bar-h', `${bar.offsetHeight}px`);
  }).observe(bar);
}

const isVisible = () => !document.getElementById('shopping-page').classList.contains('hidden');

async function load() {
  if (loading) return loading;
  const list = document.getElementById('shop-list');
  if (!data) list.innerHTML = '<div class="grid-message"><div class="spinner"></div></div>';
  else if (stale) list.classList.add('is-loading');
  loading = (async () => {
    try {
      data = await api.getShoppingList();
      stale = false;
      render();
    } catch (error) {
      list.innerHTML = `<div class="grid-message"><i class="ph ph-warning"></i><h3>Couldn't load your shopping list</h3><p>${esc(error.message)}</p></div>`;
    } finally {
      list.classList.remove('is-loading');
      loading = null;
    }
  })();
  return loading;
}

function selectedDecks() {
  const decks = data?.decks || [];
  const ids = new Set(decks.map((d) => d.id));
  if (Array.isArray(prefs.deckIds)) return new Set(prefs.deckIds.filter((id) => ids.has(id)));
  return new Set(decks.filter((d) => d.format !== 'cube').map((d) => d.id));
}

function setSelectedDecks(ids) {
  const nonCube = (data?.decks || []).filter((d) => d.format !== 'cube').map((d) => d.id);
  const same = ids.size === nonCube.length && nonCube.every((id) => ids.has(id));
  prefs.deckIds = same ? null : [...ids];
  savePrefs();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  if (!data) return;
  const selected = selectedDecks();
  const items = buildList(data.cards, selected, prefs);
  const capped = underCap(items, prefs.maxPrice);
  let filtered = capped;
  if (query.trim()) {
    const match = compileQuery(query);
    filtered = capped.filter(match);
  }
  // Group the whole list, then hide found cards, so checking one off never reshuffles the
  // binder plan under your thumb.
  const all = prefs.groupBy === 'binder'
    ? binderGroups(filtered, data.sets || {}, { commander: prefs.binderCommander })
    : groupItems(filtered, prefs.groupBy, { setOrder: prefs.setOrder });
  const shown = all.flatMap((g) => g.items);
  const groups = prefs.hideChecked ? withoutChecked(all) : all;
  current = { items, capped, filtered, shown, groups, selected };

  renderControls(selected);
  renderSummary();
  renderList();
}

function withoutChecked(groups) {
  return groups
    .map((g) => {
      const items = g.items.filter((i) => !checked.has(i.key));
      if (items.length === g.items.length) return g;
      return {
        ...g,
        items,
        cards: items.length,
        copies: items.reduce((n, i) => n + i.need, 0),
        cost: items.reduce((n, i) => n + i.cost, 0),
      };
    })
    .filter((g) => g.items.length);
}

function renderControls(selected) {
  const decks = data.decks;
  const label = document.getElementById('shop-decks-label');
  if (!decks.length) label.textContent = 'No decks';
  else if (selected.size === 0) label.textContent = 'No decks picked';
  else if (selected.size === 1) label.textContent = decks.find((d) => selected.has(d.id))?.name || '1 deck';
  else if (selected.size === decks.length) label.textContent = `All ${decks.length} decks`;
  else label.textContent = `${selected.size} of ${decks.length} decks`;

  document.getElementById('shop-group').innerHTML = GROUPINGS.map(([id, name]) =>
    `<button type="button" class="seg-btn ${prefs.groupBy === id ? 'active' : ''}" data-group="${id}">${name}</button>`).join('');
  document.querySelectorAll('#shop-view [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === prefs.view));

  const toggle = (pref, text, title) => `<button type="button" class="shop-toggle" data-pref="${pref}" aria-pressed="${!!prefs[pref]}" title="${title}"><i class="ph ${prefs[pref] ? 'ph-check-square' : 'ph-square'}"></i>${text}</button>`;
  document.getElementById('shop-toggles').innerHTML = [
    prefs.groupBy === 'binder' ? toggle('binderCommander', 'Commander sets', 'Let the plan send you to Commander precon binders; many stores don\'t keep them') : '',
    toggle('includeMaybe', 'Maybeboards', 'Count cards that are only on maybeboards'),
    toggle('includeBasics', 'Basic lands', 'List basic lands too'),
    toggle('hideChecked', 'Hide found', 'Take cards off the list once you check them'),
  ].join('');
  document.getElementById('shop-order').innerHTML = prefs.groupBy === 'set'
    ? `<span class="shop-order-label">Sets by</span><div class="seg" role="group" aria-label="Order sets by">${SET_ORDERS.map(([id, name]) =>
      `<button type="button" class="seg-btn ${prefs.setOrder === id ? 'active' : ''}" data-set-order="${id}">${name}</button>`).join('')}</div>`
    : '';
  document.querySelector('.shop-cap').classList.toggle('is-on', prefs.maxPrice != null);
}

function renderSummary() {
  const el = document.getElementById('shop-summary');
  const { items, capped, shown: filtered } = current;
  if (!items.length) {
    el.innerHTML = '';
    return;
  }
  const copies = filtered.reduce((n, i) => n + i.need, 0);
  const cost = filtered.reduce((n, i) => n + i.cost, 0);
  const found = filtered.filter((i) => checked.has(i.key));
  const overCap = items.length - capped.length;
  const foundCopies = found.reduce((n, i) => n + i.need, 0);
  const pct = filtered.length ? Math.round((found.length / filtered.length) * 100) : 0;
  el.innerHTML = `
    <div class="shop-sum-stats">
      ${filtered.length !== capped.length ? `<span class="shop-sum-filter">${filtered.length.toLocaleString()} of ${plural(capped.length, 'card')} match</span>` : ''}
      <span><strong>${filtered.length.toLocaleString()}</strong> ${filtered.length === 1 ? 'card' : 'cards'}</span>
      <span><strong>${copies.toLocaleString()}</strong> ${copies === 1 ? 'copy' : 'copies'}</span>
      <span>about <strong>${money(cost)}</strong></span>
      ${overCap ? `<span class="shop-sum-capped" title="These cost more than ${money(prefs.maxPrice)} in every printing">${plural(overCap, 'card')} over ${money(prefs.maxPrice)} left off</span>` : ''}
    </div>
    <div class="shop-progress">
      <span class="shop-meter" aria-hidden="true"><span style="width:${pct}%"></span></span>
      <span class="shop-progress-text"><strong>${found.length}</strong> of ${filtered.length} found</span>
      ${found.length ? `
        <button type="button" class="btn btn-primary btn-sm" data-action="add-found" title="Add the found cards to your collection, in the printing your decks list"><i class="ph ph-archive"></i> Add ${plural(foundCopies, 'copy', 'copies')} to collection</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="clear-found">Uncheck all</button>` : ''}
    </div>`;
}

function renderList() {
  const el = document.getElementById('shop-list');
  const { items, groups, selected } = current;
  el.classList.toggle('is-images', prefs.view === 'images');

  if (!data.decks.length) {
    el.innerHTML = '<div class="grid-message"><i class="ph ph-stack"></i><h3>No decks yet</h3><p>Build a deck and the cards you\'re missing show up here.</p></div>';
    return;
  }
  if (!selected.size) {
    el.innerHTML = '<div class="grid-message"><i class="ph ph-stack"></i><h3>Pick decks to shop for</h3><p>Choose one or more decks with the deck button above.</p></div>';
    return;
  }
  if (!items.length) {
    el.innerHTML = `<div class="grid-message"><i class="ph ph-check-circle"></i><h3>Nothing to buy</h3><p>You own every card ${selected.size === 1 ? 'this deck needs' : 'these decks need'}${prefs.includeMaybe ? '' : ' (maybeboards aside)'}.</p></div>`;
    return;
  }
  if (!current.capped.length) {
    el.innerHTML = `<div class="grid-message"><i class="ph ph-currency-dollar"></i><h3>Nothing under ${money(prefs.maxPrice)}</h3><p>Every card left to buy costs more than that. Raise or clear the max price to see them.</p></div>`;
    return;
  }
  if (!groups.length) {
    el.innerHTML = current.filtered.length
      ? '<div class="grid-message"><i class="ph ph-check-circle"></i><h3>All found</h3><p>Every card on the list is checked off.</p></div>'
      : `<div class="grid-message"><i class="ph ph-magnifying-glass"></i><h3>No matches</h3><p>Nothing on the list matches “${esc(query)}”.</p></div>`;
    return;
  }

  const deckNames = new Map(data.decks.map((d) => [d.id, d.name]));
  const showHeads = prefs.groupBy !== 'none';
  el.innerHTML = groups.map((g) => {
    const isCollapsed = collapsed.has(g.key);
    const done = g.items.filter((i) => checked.has(i.key)).length;
    return `
      <section class="shop-group ${isCollapsed ? 'is-collapsed' : ''}" data-group="${esc(g.key)}">
        ${showHeads ? `<button type="button" class="shop-group-head" data-action="collapse" aria-expanded="${!isCollapsed}">
          <i class="ph ph-caret-down shop-caret"></i>
          <span class="shop-group-name">${esc(g.label)}</span>
          <span class="shop-group-meta">${plural(g.cards, 'card')}${g.cost ? ` · ${money(g.cost)}` : ''}${reachNote(g)}</span>
          <span class="shop-group-done ${done === g.cards ? 'is-done' : ''}">${done}/${g.cards}</span>
        </button>` : ''}
        <div class="shop-group-body">${prefs.view === 'images' ? g.items.map((i) => tileHtml(i)).join('') : g.items.map((i) => rowHtml(i, deckNames, g.code)).join('')}</div>
      </section>`;
  }).join('');
}

// A binder often holds more of the list than the cards sent there; say so, since those are
// backups if another binder is out of a card.
function reachNote(g) {
  if (!g.code || !g.holds) return '';
  const total = current.shown.length;
  const pct = total ? Math.round((g.holds / total) * 100) : 0;
  return g.holds > g.cards
    ? ` · <span class="shop-group-reach" title="This binder has ${plural(g.holds, 'card')} on your list; the others are planned from other binders">has ${g.holds} (${pct}%)</span>`
    : ` · <span class="shop-group-reach">${pct}% of the list</span>`;
}

// Other binders a card can be found in, for when the first one is out of stock.
function otherBinders(item, here) {
  if (!here) return '';
  const sets = data.sets || {};
  const others = (item.binders || [])
    .map(([code]) => code)
    .filter((code) => code !== here && sets[code] && (prefs.binderCommander || sets[code].type !== 'commander'));
  if (!others.length) return '';
  const names = others.map((c) => `${sets[c].name} (${c.toUpperCase()})`).join(', ');
  return `<span class="shop-also" title="Also in: ${esc(names)}">+${others.length} ${others.length === 1 ? 'binder' : 'binders'}</span>`;
}

function deckLine(item, deckNames) {
  const refs = item.deckRefs.map((d) => `${deckNames.get(d.deck_id) || 'Deck'}${d.quantity > 1 ? ` ×${d.quantity}` : ''}${d.maybeOnly ? ' (maybe)' : ''}`);
  return refs.join(', ');
}

function rowHtml(item, deckNames, binder = null) {
  const isChecked = checked.has(item.key);
  const decks = deckLine(item, deckNames);
  const ownedNote = item.owned ? `have ${item.owned} of ${item.demand}` : '';
  const set = item.set_code ? `${item.set_code.toUpperCase()}${item.collector_number ? ` #${item.collector_number}` : ''}` : '';
  return `
    <div class="shop-row ${isChecked ? 'is-checked' : ''}" data-key="${item.key}">
      <button type="button" class="shop-check" data-action="toggle" aria-pressed="${isChecked}" aria-label="${isChecked ? 'Found' : 'Mark as found'}: ${esc(item.name)}"><i class="ph ph-check"></i></button>
      <button type="button" class="shop-thumb" data-action="detail" aria-label="Show ${esc(item.name)}">${item.image_url ? `<img src="${esc(small(item.image_url))}" alt="" loading="lazy">` : ''}</button>
      <div class="shop-row-main" data-action="toggle">
        <div class="shop-row-name">
          <span class="shop-need">${item.need}×</span>
          <span class="shop-name">${esc(item.name)}</span>
          ${item.mana_cost ? `<span class="shop-cost">${formatMana(item.mana_cost)}</span>` : ''}
        </div>
        <div class="shop-row-sub">
          ${set ? `<span class="shop-set">${esc(set)}</span>` : ''}
          ${item.rarity ? `<span class="shop-rarity" data-rarity="${esc(item.rarity)}">${esc(item.rarity.charAt(0).toUpperCase())}</span>` : ''}
          ${item.listedSet ? `<span class="shop-listed" title="Your deck lists the ${esc(item.listedSet.toUpperCase())} printing; this binder has the card too">deck has ${esc(item.listedSet.toUpperCase())}</span>` : ''}
          ${otherBinders(item, binder)}
          ${ownedNote ? `<span class="shop-owned">${ownedNote}</span>` : ''}
          <span class="shop-decks" title="${esc(decks)}">${esc(decks)}</span>
        </div>
      </div>
      <div class="shop-row-price">
        ${item.price != null ? `<strong>${money(item.price)}</strong>${item.need > 1 ? `<small>${money(item.cost)}</small>` : ''}` : '<span class="muted">—</span>'}
      </div>
    </div>`;
}

function tileHtml(item) {
  const isChecked = checked.has(item.key);
  return `
    <div class="shop-tile ${isChecked ? 'is-checked' : ''}" data-key="${item.key}">
      <button type="button" class="shop-tile-img" data-action="toggle" aria-pressed="${isChecked}" aria-label="${isChecked ? 'Found' : 'Mark as found'}: ${esc(item.name)}">
        ${item.image_url ? `<img src="${esc(item.image_url)}" alt="${esc(item.name)}" loading="lazy">` : `<span class="shop-tile-noimg">${esc(item.name)}</span>`}
        <span class="shop-tile-need">${item.need}×</span>
        <span class="shop-tile-check"><i class="ph ph-check"></i></span>
      </button>
      <div class="shop-tile-meta">
        <button type="button" class="link-btn shop-tile-name" data-action="detail">${esc(item.name)}</button>
        <span>${item.price != null ? money(item.price) : ''}</span>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function onListClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'collapse') {
    const section = target.closest('.shop-group');
    const key = section.dataset.group;
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    section.classList.toggle('is-collapsed');
    target.setAttribute('aria-expanded', String(!collapsed.has(key)));
    return;
  }
  const row = target.closest('[data-key]');
  if (!row) return;
  const key = row.dataset.key;
  if (action === 'detail') {
    const item = current.items.find((i) => i.key === key);
    if (item) showCardDetail(item.card_id);
    return;
  }
  if (action === 'toggle') {
    if (checked.has(key)) checked.delete(key);
    else checked.add(key);
    saveChecked();
    if (prefs.hideChecked) {
      render();
      return;
    }
    // Update in place so the list doesn't jump under your thumb
    const on = checked.has(key);
    row.classList.toggle('is-checked', on);
    row.querySelector('[aria-pressed]')?.setAttribute('aria-pressed', String(on));
    const section = row.closest('.shop-group');
    const group = current.groups.find((g) => g.key === section?.dataset.group);
    const doneEl = section?.querySelector('.shop-group-done');
    if (group && doneEl) {
      const done = group.items.filter((i) => checked.has(i.key)).length;
      doneEl.textContent = `${done}/${group.cards}`;
      doneEl.classList.toggle('is-done', done === group.cards);
    }
    renderSummary();
  }
}

async function onSummaryClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  // In binder mode these carry the printing from the binder you found them in
  const found = current.shown.filter((i) => checked.has(i.key));
  if (target.dataset.action === 'clear-found') {
    found.forEach((i) => checked.delete(i.key));
    saveChecked();
    render();
    return;
  }
  if (target.dataset.action === 'add-found') {
    if (!found.length) return;
    const copies = found.reduce((n, i) => n + i.need, 0);
    const ok = await confirmDialog({
      title: 'Add found cards to your collection?',
      message: `${plural(found.length, 'card')}, ${plural(copies, 'copy', 'copies')} in all, each in the printing ${prefs.groupBy === 'binder' ? 'from the binder it\'s listed under' : 'your decks list'}. You can change printings later from the card.`,
      confirmText: 'Add to collection',
      icon: 'ph-archive',
    });
    if (!ok) return;
    target.disabled = true;
    try {
      const result = await api.bulkAddToInventory(found.map((i) => ({ printingId: i.printing.printing_id, cardName: i.name, quantity: i.need })));
      found.forEach((i) => checked.delete(i.key));
      saveChecked();
      showToast(`Added ${plural(result.added, 'copy', 'copies')} to your collection${result.failed ? `, ${result.failed} failed` : ''}`, result.failed ? 'warning' : 'success');
      stale = true;
      await load();
    } catch (error) {
      target.disabled = false;
      showToast(`Couldn't add them: ${error.message}`, 'error');
    }
  }
}

function openDeckPicker(anchor) {
  if (!data) return;
  const decks = data.decks;
  if (!decks.length) return;
  const missing = deckMissingCounts(data.cards, decks.map((d) => d.id), prefs);
  const content = document.createElement('div');
  content.className = 'shop-deck-picker';
  const draw = (filter = '') => {
    const selected = selectedDecks();
    const q = filter.trim().toLowerCase();
    content.querySelector('.shop-deck-list').innerHTML = decks
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .map((d) => `
        <label class="shop-deck-option">
          <input type="checkbox" value="${d.id}" ${selected.has(d.id) ? 'checked' : ''}>
          <span class="shop-deck-name">${esc(d.name)}</span>
          ${d.format ? `<span class="shop-deck-format">${esc(d.format)}</span>` : ''}
          <span class="shop-deck-missing ${missing.get(d.id) ? '' : 'is-complete'}">${missing.get(d.id) ? `${missing.get(d.id)} missing` : 'complete'}</span>
        </label>`).join('') || '<div class="muted shop-deck-none">No deck matches.</div>';
  };
  content.innerHTML = `
    ${decks.length > 8 ? '<input type="search" class="shop-deck-search" placeholder="Find a deck" aria-label="Find a deck">' : ''}
    <div class="shop-deck-quick">
      <button type="button" class="btn btn-ghost btn-sm" data-pick="all">All</button>
      <button type="button" class="btn btn-ghost btn-sm" data-pick="none">None</button>
      ${decks.some((d) => d.format === 'cube') ? '<button type="button" class="btn btn-ghost btn-sm" data-pick="nocube">All but cubes</button>' : ''}
      <button type="button" class="btn btn-ghost btn-sm" data-pick="incomplete">Only incomplete</button>
    </div>
    <div class="shop-deck-list"></div>`;
  draw();
  const pop = popover(anchor, content);
  const search = content.querySelector('.shop-deck-search');
  search?.addEventListener('input', () => draw(search.value));
  search?.focus();
  content.addEventListener('change', (e) => {
    if (!e.target.matches('input[type="checkbox"]')) return;
    const ids = selectedDecks();
    const id = Number(e.target.value);
    if (e.target.checked) ids.add(id);
    else ids.delete(id);
    setSelectedDecks(ids);
    render();
  });
  content.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (!pick) return;
    const choice = pick.dataset.pick;
    const ids = new Set(decks.filter((d) => {
      if (choice === 'all') return true;
      if (choice === 'nocube') return d.format !== 'cube';
      if (choice === 'incomplete') return missing.get(d.id) > 0;
      return false;
    }).map((d) => d.id));
    setSelectedDecks(ids);
    draw(search?.value || '');
    render();
  });
  return pop;
}

function openCopyMenu(anchor) {
  if (!current.groups.length) {
    showToast('Nothing on the list to copy', 'info');
    return;
  }
  const content = document.createElement('div');
  content.className = 'shop-copy-menu';
  content.innerHTML = `
    <button type="button" class="shop-menu-item" data-copy="checklist"><i class="ph ph-list-checks"></i><span><strong>Checklist</strong><small>Grouped as on screen, with sets and prices</small></span></button>
    <button type="button" class="shop-menu-item" data-copy="mass"><i class="ph ph-clipboard-text"></i><span><strong>Mass entry</strong><small>"2 Card Name" lines for TCGplayer or Mana Pool</small></span></button>`;
  const pop = popover(anchor, content, { align: 'right' });
  content.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    pop.close();
    // Leave out what you've already found
    const groups = current.groups
      .map((g) => ({ ...g, items: g.items.filter((i) => !checked.has(i.key)) }))
      .filter((g) => g.items.length);
    const ok = await copyText(listText(groups, { massEntry: btn.dataset.copy === 'mass' }));
    showToast(ok ? 'Copied the cards you haven\'t found yet' : 'Couldn\'t copy to the clipboard', ok ? 'success' : 'error');
  });
}

async function runOptimizer() {
  const items = current.groups.flatMap((g) => g.items).filter((i) => !checked.has(i.key)).map((i) => ({ name: i.name, quantity: i.need }));
  const resultsEl = document.getElementById('shopping-optimizer-results');
  if (!items.length) {
    resultsEl.innerHTML = '<p class="muted">Nothing left on the list to buy.</p>';
    return;
  }
  const model = document.getElementById('shopping-optimizer-strategy').value;
  const btn = document.getElementById('shopping-optimize-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner"></i> Optimizing…';
  resultsEl.innerHTML = `<p class="muted">Pricing ${plural(items.length, 'card')} across Mana Pool sellers…</p>`;
  try {
    renderOptimizerResults(await api.manaPoolOptimize(items, model), resultsEl);
  } catch (err) {
    resultsEl.innerHTML = `<div class="shop-opt-error"><i class="ph ph-warning"></i> ${esc(err.message)}${err.message.includes('token') ? '<br><small>Set MANAPOOL_API_TOKEN in the server\'s environment to use the optimizer.</small>' : ''}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ph ph-magic-wand"></i> Optimize cart';
  }
}

function renderOptimizerResults(result, el) {
  const totals = result.totals;
  const cart = result.cart ?? [];
  if (!totals && !cart.length) {
    el.innerHTML = '<p class="muted">Mana Pool didn\'t return a cart.</p>';
    return;
  }
  const fmt = (cents) => money((cents || 0) / 100);
  const sellers = totals?.seller_count ?? '?';
  el.innerHTML = `
    <div class="shop-opt-total">
      <span><strong>${fmt(totals?.total_cents)}</strong> across ${sellers} seller${sellers !== 1 ? 's' : ''}</span>
      <a href="https://manapool.com/cart" target="_blank" rel="noopener" class="btn btn-primary btn-sm">Finish on Mana Pool <i class="ph ph-arrow-square-out"></i></a>
    </div>
    ${totals ? `<table class="an-table shop-opt-table">
      <tr><th>Cards</th><td>${fmt(totals.subtotal_cents)}</td></tr>
      <tr><th>Shipping</th><td>${fmt(totals.shipping_cents)}</td></tr>
      ${totals.buyer_fee_cents ? `<tr><th>Buyer fee</th><td>${fmt(totals.buyer_fee_cents)}</td></tr>` : ''}
      <tr class="shop-opt-sum"><th>Total</th><td>${fmt(totals.total_cents)}</td></tr>
    </table>` : ''}
    <p class="muted">${plural(cart.length, 'listing')} picked. Review and check out on Mana Pool.</p>`;
}
