/**
 * Cube building tools, shown in the deck builder when a deck's format is Cube:
 * table and visual views, a card editor (tags, color category, notes), multi-select bulk edits,
 * analysis, playtesting (sample packs, sealed, a draft against bots) and change history.
 *
 * The deck builder owns the deck; this module reads it and hands updates back through `host`.
 */
import api from '../services/api.js';
import { showToast, formatMana, popover, confirmDialog } from '../utils/ui.js';
import { CUBE_CARD_POOLS, DEFAULT_CUBE_SETTINGS } from '../../../shared/formats.js';
import {
  COLOR_CATEGORIES,
  COLORS,
  GUILDS,
  TYPE_BUCKETS,
  CMC_BUCKETS,
  colorCategoryOf,
  defaultColorCategory,
  tagsOf,
  typeBucket,
  cmcBucket,
  isLand,
  analyzeCube,
  sortForDisplay,
  manaValue,
  Draft,
  makeSamplePack,
  makeSealedPool,
  poolToDeckList,
  newSeed,
  colorCommitment,
  tokensMade,
} from '../utils/cube.js';

let host = null;
let cubeMode = false;
let view = readPref('cubeView', 'table');
let tableRows = readPref('cubeTableRows', 'cmc'); // 'cmc' | 'type' | 'none'
const selection = new Set();
let lastClickedId = null;
let playtestMode = 'pack';
let draft = null;
let samplePack = null;
let sealed = null;

const CATEGORY_LABEL = Object.fromEntries(COLOR_CATEGORIES.map((c) => [c.id, c.label]));
const CATEGORY_SYMBOL = { W: '{W}', U: '{U}', B: '{B}', R: '{R}', G: '{G}', C: '{C}' };

function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Remembered views are only a convenience
  }
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const smallImage = (url) => (url ? url.replace('/normal/', '/small/') : '');
const boardOf = (card) => card.board_type || (card.is_sideboard ? 'sideboard' : 'mainboard');
const qtySum = (cards) => cards.reduce((s, c) => s + (c.quantity ?? 1), 0);
const deck = () => host?.getDeck();
const settings = () => ({ ...DEFAULT_CUBE_SETTINGS, ...(deck()?.settings || {}) });

function categoryIcon(id) {
  if (CATEGORY_SYMBOL[id]) return formatMana(CATEGORY_SYMBOL[id]);
  if (id === 'M') return '<i class="ph ph-circles-three" aria-hidden="true"></i>';
  if (id === 'H') return '<i class="ph ph-circle-half" aria-hidden="true"></i>';
  return '<i class="ph ph-mountains" aria-hidden="true"></i>';
}

// ---- Setup ----------------------------------------------------------------------------------

export function setupCubeTools(hooks) {
  host = hooks;

  document.querySelectorAll('.cube-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.cubeView));
  });
  document.getElementById('cube-settings-btn').addEventListener('click', openCubeSettings);

  // Table and visual views: clicks and hover previews, delegated once
  for (const id of ['mainboard', 'maybeboard']) {
    const list = document.getElementById(id);
    list.addEventListener('click', onBoardClick);
    list.addEventListener('mouseover', onBoardHover);
    list.addEventListener('mouseout', onBoardHoverEnd);
    list.addEventListener('change', (e) => {
      if (e.target.matches('[data-cube-rows]')) {
        tableRows = e.target.value;
        writePref('cubeTableRows', tableRows);
        host.rerender();
      }
    });
  }

  document.getElementById('cube-bulk-bar').addEventListener('click', onBulkClick);
  document.getElementById('cube-bulk-bar').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-bulk-tag-input]')) {
      e.preventDefault();
      bulkApply({ addTags: [e.target.value.trim()].filter(Boolean) });
    }
  });
  document.getElementById('cube-bulk-bar').addEventListener('change', (e) => {
    if (e.target.matches('[data-bulk-category]') && e.target.value) {
      bulkApply({ colorCategory: e.target.value === 'auto' ? null : e.target.value });
    }
  });

  const cubeView = document.getElementById('cube-view');
  cubeView.addEventListener('click', onCubeViewClick);
  cubeView.addEventListener('mouseover', onBoardHover);
  cubeView.addEventListener('mouseout', onBoardHoverEnd);

  // Escape clears a selection
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cubeMode && selection.size && !document.querySelector('.modal:not(.hidden), .popover')) {
      clearCubeSelection();
      host.rerender();
    }
  });
}

export function setCubeMode(on) {
  cubeMode = on;
  document.getElementById('cube-bar').classList.toggle('hidden', !on);
  if (!on) {
    document.getElementById('cube-view').classList.add('hidden');
    document.querySelector('#deck-builder-page .deck-builder-content').classList.remove('hidden');
    renderBulkBar();
    return;
  }
  draft = null;
  samplePack = null;
  sealed = null;
  applyView();
}

/** Do table/visual/list views show the deck panel (as opposed to analysis/playtest/history)? */
export function cubeViewShowsList() {
  return view === 'list';
}

export function clearCubeSelection() {
  selection.clear();
  lastClickedId = null;
  renderBulkBar();
}

function setView(next) {
  view = next;
  writePref('cubeView', view);
  if (!['table', 'visual'].includes(view)) clearCubeSelection();
  applyView();
  host.rerender();
}

function applyView() {
  document.querySelectorAll('.cube-view-btn').forEach((b) => {
    const active = b.dataset.cubeView === view;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  const panelView = ['analysis', 'playtest', 'history'].includes(view);
  document.getElementById('cube-view').classList.toggle('hidden', !panelView);
  document.querySelector('#deck-builder-page .deck-builder-content').classList.toggle('hidden', panelView);
  document.querySelector('#deck-builder-page .deck-builder').dataset.cubeView = view;
}

/** Called after every deck render. Refreshes the summary and whichever full-width view is open. */
export function refreshCube() {
  if (!cubeMode) return;
  renderSummary();
  // Drop selected ids that no longer exist
  const ids = new Set((deck()?.cards || []).map((c) => String(c.deck_card_id)));
  for (const id of [...selection]) if (!ids.has(id)) selection.delete(id);
  renderBulkBar();
  if (view === 'analysis') renderAnalysis();
  else if (view === 'playtest') renderPlaytest();
  else if (view === 'history') renderHistory();
}

function renderSummary() {
  const cards = deck()?.cards || [];
  const main = qtySum(cards.filter((c) => boardOf(c) === 'mainboard'));
  const maybe = qtySum(cards.filter((c) => boardOf(c) === 'maybeboard'));
  const s = settings();
  const target = Number(s.targetSize) || 0;
  const pct = target ? Math.min(100, Math.round((main / target) * 100)) : 0;
  const pool = CUBE_CARD_POOLS.find((p) => p.id === (s.cardPool || ''));
  document.getElementById('cube-summary').innerHTML = `
    <span class="cube-summary-count"><strong>${main}</strong>${target ? ` / ${target}` : ''} cards</span>
    ${target ? `<span class="cube-progress" role="img" aria-label="${pct}% of target"><span style="width:${pct}%"></span></span>` : ''}
    ${maybe ? `<span class="muted">${maybe} maybe</span>` : ''}
    <span class="muted">${s.singleton ? 'Singleton' : 'Duplicates allowed'}${pool?.id ? ` · ${escapeHtml(pool.label)}` : ''}</span>`;
}

// ---- Table and visual views -----------------------------------------------------------------

function cardButton(card) {
  const selected = selection.has(String(card.deck_card_id));
  const tags = tagsOf(card);
  const overridden = card.color_category && card.color_category !== defaultColorCategory(card);
  return `<button type="button" class="cube-card${selected ? ' selected' : ''}" data-deck-card-id="${card.deck_card_id}" data-cat="${colorCategoryOf(card)}"
      data-image="${escapeHtml(card.image_url || '')}" aria-pressed="${selected}" title="${escapeHtml([card.type_line, tags.length ? `Tags: ${tags.join(', ')}` : '', card.notes].filter(Boolean).join('\n'))}">
    ${(card.quantity ?? 1) > 1 ? `<span class="cube-card-qty">${card.quantity}×</span>` : ''}
    <span class="cube-card-name">${escapeHtml(card.name)}</span>
    ${overridden ? '<i class="ph ph-push-pin cube-card-flag" title="Color category set by hand"></i>' : ''}
    ${tags.length ? `<span class="cube-card-tags" aria-label="${tags.length} tags">${tags.length}</span>` : ''}
  </button>`;
}

function rowKey(card) {
  if (tableRows === 'type') return typeBucket(card);
  if (tableRows === 'cmc') return isLand(card) ? 'Land' : cmcBucket(card);
  return '';
}

function rowOrder() {
  if (tableRows === 'type') return TYPE_BUCKETS;
  if (tableRows === 'cmc') return [...CMC_BUCKETS, 'Land'];
  return [''];
}

const rowLabel = (key) => (tableRows === 'cmc' && key !== 'Land' ? `${key} mana` : key);

function renderTable(cards, board) {
  const byCategory = new Map(COLOR_CATEGORIES.map((c) => [c.id, []]));
  for (const card of sortForDisplay(cards)) byCategory.get(colorCategoryOf(card)).push(card);
  // Always show the five colors; other columns only when something is in them
  const columns = COLOR_CATEGORIES.filter((c) => COLORS.includes(c.id) || byCategory.get(c.id).length);

  const controls = `<div class="cube-table-controls">
      <label>Rows <select data-cube-rows>
        <option value="cmc" ${tableRows === 'cmc' ? 'selected' : ''}>Mana value</option>
        <option value="type" ${tableRows === 'type' ? 'selected' : ''}>Card type</option>
        <option value="none" ${tableRows === 'none' ? 'selected' : ''}>None</option>
      </select></label>
      <span class="muted cube-hint">Click a card to edit it. Ctrl/⌘-click or Shift-click to select several.</span>
    </div>`;

  if (!cards.length) {
    return controls + `<div class="deck-list-empty"><i class="ph ph-cube"></i><p>${board === 'maybeboard' ? 'Cards you are considering go here.' : 'Search above to add the first card to your cube.'}</p></div>`;
  }

  const cols = columns.map((col) => {
    const list = byCategory.get(col.id);
    const groups = rowOrder()
      .map((key) => ({ key, cards: list.filter((c) => rowKey(c) === key) }))
      .filter((g) => g.cards.length);
    return `<section class="cube-column" data-cat="${col.id}">
      <header class="cube-column-head">${categoryIcon(col.id)}<span>${col.label}</span><span class="cube-column-count">${qtySum(list)}</span></header>
      ${groups.map((g) => `${g.key ? `<h5 class="cube-row-head">${escapeHtml(rowLabel(g.key))} <span>${qtySum(g.cards)}</span></h5>` : ''}${g.cards.map(cardButton).join('')}`).join('') || '<p class="cube-column-empty">—</p>'}
    </section>`;
  }).join('');

  return `${controls}<div class="cube-table" style="--cube-cols:${columns.length}">${cols}</div>`;
}

function renderVisual(cards, board) {
  if (!cards.length) {
    return `<div class="deck-list-empty"><i class="ph ph-cube"></i><p>${board === 'maybeboard' ? 'Cards you are considering go here.' : 'Search above to add the first card to your cube.'}</p></div>`;
  }
  const sorted = sortForDisplay(cards);
  return COLOR_CATEGORIES.map((cat) => {
    const list = sorted.filter((c) => colorCategoryOf(c) === cat.id);
    if (!list.length) return '';
    return `<section class="cube-visual-group">
      <h4>${categoryIcon(cat.id)} ${cat.label} <span class="muted">${qtySum(list)}</span></h4>
      <div class="cube-visual-grid">${list.map((card) => {
        const selected = selection.has(String(card.deck_card_id));
        return `<button type="button" class="cube-visual-card${selected ? ' selected' : ''}" data-deck-card-id="${card.deck_card_id}" aria-pressed="${selected}" title="${escapeHtml(card.name)}">
          <img src="${escapeHtml(card.image_url || '')}" alt="${escapeHtml(card.name)}" loading="lazy" decoding="async">
          ${(card.quantity ?? 1) > 1 ? `<span class="cube-visual-qty">${card.quantity}×</span>` : ''}
          ${tagsOf(card).length ? `<span class="cube-visual-tags">${tagsOf(card).slice(0, 3).map(escapeHtml).join(' · ')}</span>` : ''}
        </button>`;
      }).join('')}</div>
    </section>`;
  }).join('');
}

/** Draw one board of the cube into `el` in the current view. */
export function renderCubeBoard(el, cards, board) {
  el.dataset.layout = `cube-${view}`;
  el.innerHTML = view === 'visual' ? renderVisual(cards, board) : renderTable(cards, board);
}

function onBoardClick(e) {
  if (!cubeMode || view === 'list') return;
  const btn = e.target.closest('.cube-card, .cube-visual-card');
  if (!btn) return;
  const id = btn.dataset.deckCardId;

  if (e.shiftKey && lastClickedId) {
    // Select the run between the last click and this one, in screen order
    const buttons = [...btn.closest('.deck-list').querySelectorAll('[data-deck-card-id]')].map((b) => b.dataset.deckCardId);
    const a = buttons.indexOf(lastClickedId);
    const b = buttons.indexOf(id);
    if (a >= 0 && b >= 0) {
      for (const x of buttons.slice(Math.min(a, b), Math.max(a, b) + 1)) selection.add(x);
      lastClickedId = id;
      host.rerender();
      return;
    }
  }
  if (e.metaKey || e.ctrlKey || e.shiftKey || selection.size) {
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
    lastClickedId = id;
    host.rerender();
    return;
  }
  lastClickedId = id;
  openCardEditor(btn, id);
}

function onBoardHover(e) {
  const btn = e.target.closest('.cube-card, .pt-pool-card');
  if (!btn?.dataset.image) return;
  const preview = document.getElementById('card-preview');
  const img = document.getElementById('card-preview-img');
  if (!preview || !img) return;
  img.src = btn.dataset.image.replace(/\/(small|normal)\//, '/large/');
  const left = btn.getBoundingClientRect().left < window.innerWidth / 2;
  preview.style.left = left ? 'auto' : '20px';
  preview.style.right = left ? '20px' : 'auto';
  preview.classList.remove('hidden');
}

function onBoardHoverEnd(e) {
  if (e.target.closest('.cube-card, .pt-pool-card')) document.getElementById('card-preview')?.classList.add('hidden');
}

// ---- Card editor ----------------------------------------------------------------------------

function allTags() {
  const tags = new Map();
  for (const card of deck()?.cards || []) for (const t of tagsOf(card)) tags.set(t.toLowerCase(), t);
  return [...tags.values()].sort((a, b) => a.localeCompare(b));
}

async function updateCard(deckCardId, updates) {
  const result = await api.updateDeckCard(host.getDeckId(), deckCardId, updates);
  await host.setDeck(result.deck);
  return result.deck.cards.find((c) => String(c.deck_card_id) === String(deckCardId));
}

function openCardEditor(anchor, deckCardId) {
  document.getElementById('card-preview')?.classList.add('hidden');
  const card = deck().cards.find((c) => String(c.deck_card_id) === String(deckCardId));
  if (!card) return;

  const el = document.createElement('div');
  el.className = 'cube-editor';
  const render = (c) => {
    const tags = tagsOf(c);
    const board = boardOf(c);
    el.innerHTML = `
      <div class="cube-editor-head">
        <img src="${escapeHtml(smallImage(c.image_url))}" alt="" width="73" height="102">
        <div>
          <strong>${escapeHtml(c.name)}</strong>
          <div class="cube-editor-meta">${formatMana(c.mana_cost || '')}</div>
          <div class="cube-editor-meta">${escapeHtml(c.type_line || '')}</div>
          <button type="button" class="set-code-link" data-editor-action="printing">${escapeHtml((c.set_code || '').toUpperCase())} ${escapeHtml(c.collector_number || '')} · change</button>
        </div>
      </div>
      <label class="cube-editor-label">Tags</label>
      <div class="cube-editor-tags">
        ${tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}<button type="button" data-remove-tag="${escapeHtml(t)}" aria-label="Remove tag ${escapeHtml(t)}">×</button></span>`).join('')}
        <input type="text" class="cube-editor-tag-input" list="cube-tag-list" placeholder="Add tag" aria-label="Add a tag" maxlength="40">
        <datalist id="cube-tag-list">${allTags().map((t) => `<option value="${escapeHtml(t)}">`).join('')}</datalist>
      </div>
      <label class="cube-editor-label" for="cube-editor-cat">Color category</label>
      <select id="cube-editor-cat" class="cube-editor-cat">
        <option value="">Automatic (${CATEGORY_LABEL[defaultColorCategory(c)]})</option>
        ${COLOR_CATEGORIES.map((cat) => `<option value="${cat.id}" ${c.color_category === cat.id ? 'selected' : ''}>${cat.label}</option>`).join('')}
      </select>
      <label class="cube-editor-label" for="cube-editor-notes">Notes</label>
      <textarea id="cube-editor-notes" class="cube-editor-notes" rows="2" maxlength="1000" placeholder="Why it's in, what it does for the cube">${escapeHtml(c.notes || '')}</textarea>
      <div class="cube-editor-actions">
        <div class="quantity-control">
          <button type="button" class="quantity-btn" data-editor-action="dec" aria-label="One fewer">-</button>
          <span class="quantity-adjuster-value">${c.quantity ?? 1}</span>
          <button type="button" class="quantity-btn" data-editor-action="inc" aria-label="One more">+</button>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-editor-action="move">${board === 'maybeboard' ? '<i class="ph ph-arrow-up"></i> To cube' : '<i class="ph ph-arrow-down"></i> To maybe'}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-editor-action="details"><i class="ph ph-info"></i></button>
        <button type="button" class="btn btn-ghost btn-sm danger" data-editor-action="remove"><i class="ph ph-trash"></i> Remove</button>
      </div>`;
  };
  render(card);
  const pop = popover(anchor, el);
  let current = card;

  const save = async (updates) => {
    try {
      const updated = await updateCard(current.deck_card_id, updates);
      if (!updated) {
        pop.close();
        return;
      }
      current = updated;
      render(current);
      el.querySelector('.cube-editor-tag-input')?.focus();
    } catch (error) {
      showToast('Failed to save: ' + error.message, 'error');
    }
  };

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.cube-editor-tag-input')) {
      e.preventDefault();
      const tag = e.target.value.trim();
      if (tag) save({ tags: [...tagsOf(current), tag] });
    }
  });
  el.addEventListener('change', (e) => {
    if (e.target.matches('.cube-editor-cat')) save({ colorCategory: e.target.value || null });
    if (e.target.matches('.cube-editor-notes')) save({ notes: e.target.value });
    if (e.target.matches('.cube-editor-tag-input') && e.target.value.trim() && allTags().includes(e.target.value.trim())) {
      // Picked from the suggestions
      save({ tags: [...tagsOf(current), e.target.value.trim()] });
    }
  });
  el.addEventListener('click', async (e) => {
    const removeTag = e.target.closest('[data-remove-tag]');
    if (removeTag) {
      save({ tags: tagsOf(current).filter((t) => t !== removeTag.dataset.removeTag) });
      return;
    }
    const action = e.target.closest('[data-editor-action]')?.dataset.editorAction;
    if (!action) return;
    if (action === 'printing') {
      pop.close();
      host.openPrinting(current.card_id, current.deck_card_id);
    } else if (action === 'details') {
      pop.close();
      host.showCard(current.printing_id);
    } else if (action === 'inc') {
      save({ quantity: (current.quantity ?? 1) + 1 });
    } else if (action === 'dec') {
      if ((current.quantity ?? 1) <= 1) return;
      save({ quantity: current.quantity - 1 });
    } else if (action === 'move') {
      const boardType = boardOf(current) === 'maybeboard' ? 'mainboard' : 'maybeboard';
      pop.close();
      try {
        await updateCard(current.deck_card_id, { boardType, isSideboard: false });
        showToast(`${current.name} moved to ${boardType === 'maybeboard' ? 'the maybeboard' : 'the cube'}`, 'success', 1500);
      } catch (error) {
        showToast('Failed to move: ' + error.message, 'error');
      }
    } else if (action === 'remove') {
      pop.close();
      try {
        const result = await api.removeDeckCard(host.getDeckId(), current.deck_card_id);
        await host.setDeck(result.deck);
        showToast(`${current.name} removed`, 'success', 1500);
      } catch (error) {
        showToast('Failed to remove: ' + error.message, 'error');
      }
    }
  });
}

// ---- Bulk edits -----------------------------------------------------------------------------

function renderBulkBar() {
  const bar = document.getElementById('cube-bulk-bar');
  if (!bar) return;
  if (!cubeMode || selection.size === 0) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }
  const selectedTags = new Set();
  for (const card of deck()?.cards || []) {
    if (selection.has(String(card.deck_card_id))) tagsOf(card).forEach((t) => selectedTags.add(t));
  }
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <strong>${selection.size} selected</strong>
    <input type="text" data-bulk-tag-input list="cube-bulk-tag-list" placeholder="Add tag, Enter" aria-label="Tag to add to the selected cards" maxlength="40">
    <datalist id="cube-bulk-tag-list">${allTags().map((t) => `<option value="${escapeHtml(t)}">`).join('')}</datalist>
    ${selectedTags.size ? `<select data-bulk-remove-tag aria-label="Tag to remove"><option value="">Remove tag…</option>${[...selectedTags].map((t) => `<option>${escapeHtml(t)}</option>`).join('')}</select>` : ''}
    <select data-bulk-category aria-label="Set color category">
      <option value="">Color category…</option>
      <option value="auto">Automatic</option>
      ${COLOR_CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}
    </select>
    <button type="button" class="btn btn-ghost btn-sm" data-bulk="maybe"><i class="ph ph-arrows-down-up"></i> ${host.getActiveBoard() === 'maybeboard' ? 'To cube' : 'To maybe'}</button>
    <button type="button" class="btn btn-ghost btn-sm danger" data-bulk="remove"><i class="ph ph-trash"></i> Remove</button>
    <button type="button" class="btn btn-ghost btn-sm" data-bulk="all">Select all shown</button>
    <button type="button" class="btn btn-ghost btn-sm" data-bulk="clear">Clear</button>`;
  bar.querySelector('[data-bulk-remove-tag]')?.addEventListener('change', (e) => {
    if (e.target.value) bulkApply({ removeTags: [e.target.value] });
  });
}

async function bulkApply(changes, { keepSelection = true } = {}) {
  const ids = [...selection].map(Number);
  if (!ids.length) return;
  try {
    const result = await api.bulkUpdateDeckCards(host.getDeckId(), ids, changes);
    if (!keepSelection) selection.clear();
    await host.setDeck(result.deck);
    showToast(`Updated ${ids.length} card${ids.length === 1 ? '' : 's'}`, 'success', 1500);
  } catch (error) {
    showToast('Bulk edit failed: ' + error.message, 'error');
  }
}

async function onBulkClick(e) {
  const action = e.target.closest('[data-bulk]')?.dataset.bulk;
  if (!action) return;
  if (action === 'clear') {
    clearCubeSelection();
    host.rerender();
  } else if (action === 'all') {
    const board = document.getElementById(host.getActiveBoard());
    board?.querySelectorAll('[data-deck-card-id]').forEach((b) => selection.add(b.dataset.deckCardId));
    host.rerender();
  } else if (action === 'maybe') {
    const boardType = host.getActiveBoard() === 'maybeboard' ? 'mainboard' : 'maybeboard';
    await bulkApply({ boardType }, { keepSelection: false });
  } else if (action === 'remove') {
    const ok = await confirmDialog({
      title: `Remove ${selection.size} card${selection.size === 1 ? '' : 's'}?`,
      message: 'They come out of the cube. The history keeps a record.',
      confirmText: 'Remove',
      danger: true,
    });
    if (ok) await bulkApply({ remove: true }, { keepSelection: false });
  }
}

// ---- Analysis -------------------------------------------------------------------------------

function bar(value, max, label) {
  const pct = max ? Math.max(value ? 2 : 0, Math.round((value / max) * 100)) : 0;
  return `<span class="an-bar" title="${escapeHtml(label)}"><span style="width:${pct}%"></span></span>`;
}

function heat(value, max) {
  const level = !value ? 0 : Math.min(5, Math.ceil((value / (max || 1)) * 5));
  return `<td class="an-heat" data-level="${level}">${value || ''}</td>`;
}

function renderAnalysis() {
  const container = document.getElementById('cube-view');
  const cards = deck()?.cards || [];
  const a = analyzeCube(cards);
  const s = settings();

  if (!a.total) {
    container.innerHTML = '<div class="grid-message"><i class="ph ph-chart-bar"></i><h3>Nothing to analyze yet</h3><p>Add cards to the cube to see its balance.</p></div>';
    return;
  }

  const maxCat = Math.max(...COLOR_CATEGORIES.map((c) => a.categories[c.id].count), 1);
  const seats = Number(s.seats) || 8;
  const needed = seats * (Number(s.packsPerPlayer) || 3) * (Number(s.packSize) || 15);

  const tiles = [
    ['Cards', `${a.total}${s.targetSize ? `<small> / ${s.targetSize}</small>` : ''}`, `${a.unique} unique`],
    ['Draft', a.total >= needed ? `${seats} players` : `${Math.floor(a.total / ((Number(s.packsPerPlayer) || 3) * (Number(s.packSize) || 15)))} players`, `${s.packsPerPlayer} × ${s.packSize}-card packs`],
    ['Creatures', `${Math.round((a.creatures / a.total) * 100)}%`, `${a.creatures} cards`],
    ['Avg. mana value', a.avgMv.toFixed(2), 'nonland cards'],
    ['Fixing', a.fixingTotal, `${a.categories.L.count} lands total`],
    ['Multicolor', a.categories.M.count + a.categories.H.count, `${a.categories.H.count} hybrid`],
  ];

  const balanceRows = COLOR_CATEGORIES.filter((c) => a.categories[c.id].count || COLORS.includes(c.id)).map((c) => {
    const entry = a.categories[c.id];
    const isMono = COLORS.includes(c.id);
    const diff = isMono ? entry.count - a.monoAvg : 0;
    const flag = isMono && Math.abs(diff) >= Math.max(3, a.monoAvg * 0.1)
      ? `<span class="an-diff" data-dir="${diff > 0 ? 'over' : 'under'}">${diff > 0 ? '+' : '−'}${Math.abs(Math.round(diff))} vs avg</span>` : '';
    return `<tr>
      <th scope="row">${categoryIcon(c.id)} ${c.label}</th>
      <td class="num">${entry.count}</td>
      <td class="an-bar-cell">${bar(entry.count, maxCat, `${c.label}: ${entry.count}`)}</td>
      <td class="num muted">${Math.round((entry.count / a.total) * 100)}%</td>
      <td class="num muted">${entry.creatures}</td>
      <td class="num muted">${entry.nonland ? entry.avgMv.toFixed(1) : '–'}</td>
      <td>${flag}</td>
    </tr>`;
  }).join('');

  const curveCats = COLOR_CATEGORIES.filter((c) => c.id !== 'L' && a.categories[c.id].nonland);
  const maxCurve = Math.max(...curveCats.flatMap((c) => CMC_BUCKETS.map((b) => a.categories[c.id].curve[b])), 1);
  const curveTable = `<table class="an-table an-heat-table">
    <thead><tr><th></th>${CMC_BUCKETS.map((b) => `<th class="num">${b}</th>`).join('')}<th class="num">Total</th></tr></thead>
    <tbody>${curveCats.map((c) => `<tr><th scope="row">${categoryIcon(c.id)} ${c.label}</th>${CMC_BUCKETS.map((b) => heat(a.categories[c.id].curve[b], maxCurve)).join('')}<td class="num">${a.categories[c.id].nonland}</td></tr>`).join('')}
    <tr class="an-total"><th scope="row">All</th>${CMC_BUCKETS.map((b) => `<td class="num">${a.curve[b] || ''}</td>`).join('')}<td class="num">${CMC_BUCKETS.reduce((s2, b) => s2 + a.curve[b], 0)}</td></tr></tbody>
  </table>`;

  const typeCols = TYPE_BUCKETS.filter((t) => a.types[t]);
  const maxType = Math.max(...COLOR_CATEGORIES.flatMap((c) => typeCols.map((t) => a.categories[c.id].types[t] || 0)), 1);
  const typeTable = `<table class="an-table an-heat-table">
    <thead><tr><th></th>${typeCols.map((t) => `<th class="num">${t}</th>`).join('')}</tr></thead>
    <tbody>${COLOR_CATEGORIES.filter((c) => a.categories[c.id].count).map((c) => `<tr><th scope="row">${categoryIcon(c.id)} ${c.label}</th>${typeCols.map((t) => heat(a.categories[c.id].types[t] || 0, maxType)).join('')}</tr>`).join('')}
    <tr class="an-total"><th scope="row">All</th>${typeCols.map((t) => `<td class="num">${a.types[t]}</td>`).join('')}</tr></tbody>
  </table>`;

  const maxGuild = Math.max(...GUILDS.map((g) => Math.max(a.guilds[g.id].gold, a.guilds[g.id].fixing)), 1);
  const guildRows = GUILDS.map((g) => {
    const entry = a.guilds[g.id];
    const symbols = formatMana(g.id.split('').map((c) => `{${c}}`).join(''));
    const fixing = Math.round(entry.fixing * 10) / 10;
    const warn = entry.gold > 0 && fixing < 1 ? '<span class="an-diff" data-dir="under">No fixing</span>' : '';
    return `<tr>
      <th scope="row">${symbols} ${g.name}</th>
      <td class="num">${entry.gold}</td><td class="an-bar-cell">${bar(entry.gold, maxGuild, `${g.name} gold cards: ${entry.gold}`)}</td>
      <td class="num">${fixing}</td><td class="an-bar-cell">${bar(entry.fixing, maxGuild, `${g.name} fixing: ${fixing}`)}</td>
      <td>${warn}</td>
    </tr>`;
  }).join('');

  const maxFix = Math.max(...COLORS.map((c) => a.fixingByColor[c]), 1);
  const fixingRows = COLORS.map((c) => `<tr><th scope="row">${categoryIcon(c)} ${CATEGORY_LABEL[c]}</th><td class="num">${a.fixingByColor[c]}</td><td class="an-bar-cell">${bar(a.fixingByColor[c], maxFix, `Fixing for ${CATEGORY_LABEL[c]}: ${a.fixingByColor[c]}`)}</td></tr>`).join('');

  const tokens = new Map();
  for (const card of cards.filter((c) => boardOf(c) === 'mainboard')) {
    for (const t of tokensMade(card)) {
      if (!tokens.has(t)) tokens.set(t, []);
      tokens.get(t).push(card.name);
    }
  }
  const tokenList = [...tokens].sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]));

  const rarityOrder = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'];
  const rarity = rarityOrder.filter((r) => a.rarity[r]).map((r) => `<span class="an-pill" data-rarity="${r}">${r} <strong>${a.rarity[r]}</strong></span>`).join('');

  container.innerHTML = `
    <div class="an-tiles">${tiles.map(([label, value, sub]) => `<div class="an-tile"><span class="an-tile-label">${label}</span><span class="an-tile-value">${value}</span><span class="an-tile-sub">${sub}</span></div>`).join('')}</div>
    <div class="an-grid">
      <section class="an-section">
        <h3>Color balance</h3>
        <p class="an-note">Mono-colored sections ideally sit close to the average of ${a.monoAvg.toFixed(1)}. Flags show any color off by 10% or more.</p>
        <table class="an-table"><thead><tr><th></th><th class="num">Cards</th><th></th><th class="num">Share</th><th class="num">Creatures</th><th class="num">Avg MV</th><th></th></tr></thead><tbody>${balanceRows}</tbody></table>
      </section>
      <section class="an-section">
        <h3>Color pairs</h3>
        <p class="an-note">Gold cards per pair, and the lands and rocks that make both colors. Tri-lands count a third toward each of their pairs.</p>
        <table class="an-table"><thead><tr><th></th><th class="num">Gold</th><th></th><th class="num">Fixing</th><th></th><th></th></tr></thead><tbody>${guildRows}</tbody></table>
      </section>
      <section class="an-section an-wide">
        <h3>Mana curve by color</h3>
        ${curveTable}
      </section>
      <section class="an-section an-wide">
        <h3>Card types by color</h3>
        ${typeTable}
      </section>
      <section class="an-section">
        <h3>Fixing by color</h3>
        <p class="an-note">How many fixing lands and rocks can make each color.</p>
        <table class="an-table"><tbody>${fixingRows}</tbody></table>
      </section>
      <section class="an-section">
        <h3>Tags</h3>
        ${a.tags.length ? `<div class="an-tags">${a.tags.map(([t, n]) => `<button type="button" class="tag-chip" data-filter-tag="${escapeHtml(t)}" title="Show cards tagged ${escapeHtml(t)}">${escapeHtml(t)} <strong>${n}</strong></button>`).join('')}</div>` : '<p class="an-note">No tags yet. Tag cards with archetypes or roles (aggro, reanimator, removal…) to track them here.</p>'}
        <h3 class="an-sub">Rarity</h3>
        <div class="an-tags">${rarity || '<span class="muted">—</span>'}</div>
      </section>
      <section class="an-section an-wide">
        <h3>Tokens and emblems needed <span class="muted">${tokenList.length}</span></h3>
        ${tokenList.length ? `<ul class="an-tokens">${tokenList.map(([t, names]) => `<li><span>${escapeHtml(t)}</span><span class="muted" title="${escapeHtml(names.join(', '))}">${names.length} card${names.length === 1 ? '' : 's'}: ${escapeHtml(names.slice(0, 4).join(', '))}${names.length > 4 ? '…' : ''}</span></li>`).join('')}</ul>` : '<p class="an-note">Nothing in the cube makes tokens.</p>'}
      </section>
    </div>`;
}

// ---- Playtest -------------------------------------------------------------------------------

function cardImageButton(card, attrs = '') {
  return `<button type="button" class="pt-card" ${attrs} title="${escapeHtml(card.name)}">
    <img src="${escapeHtml(card.image_url || '')}" alt="${escapeHtml(card.name)}" loading="lazy" decoding="async">
  </button>`;
}

function poolColumns(pool) {
  const sorted = sortForDisplay(pool);
  return `<div class="pt-pool">${COLOR_CATEGORIES.map((cat) => {
    const list = sorted.filter((c) => colorCategoryOf(c) === cat.id);
    if (!list.length) return '';
    return `<div class="pt-pool-col"><h5>${categoryIcon(cat.id)} ${cat.label} <span>${list.length}</span></h5>
      ${list.map((c) => `<div class="pt-pool-card" data-image="${escapeHtml(c.image_url || '')}"><span class="pt-mv">${isLand(c) ? '' : manaValue(c)}</span>${escapeHtml(c.name)}</div>`).join('')}</div>`;
  }).join('')}</div>`;
}

function playtestTabs() {
  const modes = [['pack', 'Sample pack', 'ph-package'], ['draft', 'Draft', 'ph-users-three'], ['sealed', 'Sealed', 'ph-archive-box']];
  return `<div class="pt-tabs" role="tablist">${modes.map(([id, label, icon]) => `<button type="button" class="pt-tab${playtestMode === id ? ' active' : ''}" data-pt-mode="${id}" role="tab" aria-selected="${playtestMode === id}"><i class="ph ${icon}"></i> ${label}</button>`).join('')}</div>`;
}

function renderPlaytest() {
  const container = document.getElementById('cube-view');
  const cards = deck()?.cards || [];
  const total = qtySum(cards.filter((c) => boardOf(c) === 'mainboard'));
  if (!total) {
    container.innerHTML = `${playtestTabs()}<div class="grid-message"><i class="ph ph-cards-three"></i><h3>The cube is empty</h3><p>Add cards to open packs from it.</p></div>`;
    return;
  }
  const s = settings();
  let body = '';

  if (playtestMode === 'pack') {
    if (!samplePack) samplePack = makeSamplePack(cards, Number(s.packSize) || 15);
    body = `<div class="pt-head">
        <h3>Sample pack <span class="muted">${samplePack.pack.length} cards</span></h3>
        <span class="muted">Seed ${samplePack.seed}</span>
        <button type="button" class="btn btn-primary btn-sm" data-pt="new-pack"><i class="ph ph-arrows-clockwise"></i> New pack</button>
      </div>
      <div class="pt-grid">${samplePack.pack.map((c) => cardImageButton(c)).join('')}</div>`;
  } else if (playtestMode === 'sealed') {
    if (!sealed) {
      body = `<div class="pt-setup">
        <h3>Sealed pool</h3>
        <p class="an-note">Open packs from the cube and build a deck from what you get.</p>
        <label>Packs <input type="number" id="pt-sealed-packs" min="1" max="12" value="6"></label>
        <label>Cards per pack <input type="number" id="pt-sealed-size" min="5" max="30" value="${Number(s.packSize) || 15}"></label>
        <button type="button" class="btn btn-primary" data-pt="open-sealed"><i class="ph ph-archive-box"></i> Open pool</button>
      </div>`;
    } else {
      body = `<div class="pt-head">
          <h3>Sealed pool <span class="muted">${sealed.pool.length} cards${sealed.short ? `, ${sealed.short} short` : ''}</span></h3>
          <span class="muted">Seed ${sealed.seed}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-pt="reset-sealed">New pool</button>
          <button type="button" class="btn btn-primary btn-sm" data-pt="save-sealed"><i class="ph ph-floppy-disk"></i> Build a deck from it</button>
        </div>
        ${poolColumns(sealed.pool)}`;
    }
  } else if (playtestMode === 'draft') {
    body = renderDraft(s, total);
  }

  container.innerHTML = playtestTabs() + body;
}

function renderDraft(s, total) {
  if (!draft) {
    const perPlayer = (Number(s.packsPerPlayer) || 3) * (Number(s.packSize) || 15);
    const maxSeats = Math.max(2, Math.min(16, Math.floor(total / perPlayer) || 2));
    return `<div class="pt-setup">
      <h3>Draft against bots</h3>
      <p class="an-note">You sit in seat 1. Bots take the strongest card for their colors, judged by EDHREC rank and rarity, and settle into colors as the draft goes on. Packs pass left, then right, then left.</p>
      <label>Players <input type="number" id="pt-seats" min="2" max="16" value="${Math.min(Number(s.seats) || 8, maxSeats)}"></label>
      <label>Packs each <input type="number" id="pt-packs" min="1" max="6" value="${Number(s.packsPerPlayer) || 3}"></label>
      <label>Cards per pack <input type="number" id="pt-pack-size" min="5" max="30" value="${Number(s.packSize) || 15}"></label>
      <button type="button" class="btn btn-primary" data-pt="start-draft"><i class="ph ph-play"></i> Start draft</button>
      <p class="an-note">This cube has ${total} cards, enough for ${Math.floor(total / perPlayer)} players at these settings.</p>
    </div>`;
  }

  if (draft.isDone) {
    const bots = draft.picks.slice(1).map((picks, i) => {
      const w = colorCommitment(picks);
      const top = COLORS.filter((c) => w[c] > 0).sort((a, b) => w[b] - w[a]).slice(0, 2);
      return `<li><span>Bot ${i + 2}</span> ${formatMana(top.map((c) => `{${c}}`).join(''))} <span class="muted">${picks.slice(0, 3).map((c) => escapeHtml(c.name)).join(', ')}…</span></li>`;
    }).join('');
    return `<div class="pt-head">
        <h3>Draft complete <span class="muted">${draft.pool.length} picks</span></h3>
        <span class="muted">Seed ${draft.seed}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-pt="reset-draft">New draft</button>
        <button type="button" class="btn btn-primary btn-sm" data-pt="save-draft"><i class="ph ph-floppy-disk"></i> Build a deck from your picks</button>
      </div>
      ${poolColumns(draft.pool)}
      <div class="an-grid">
        <section class="an-section"><h3>Your picks in order</h3>
          <ol class="pt-log">${draft.log.map((l) => `<li><span class="muted">P${l.round}p${l.pick}</span> ${escapeHtml(l.card.name)}</li>`).join('')}</ol></section>
        <section class="an-section"><h3>The bots</h3><ul class="pt-bots">${bots}</ul></section>
      </div>`;
  }

  return `<div class="pt-head">
      <h3>Pack ${draft.round + 1} · Pick ${draft.pickNumber}</h3>
      <span class="muted">${draft.pack.length} cards · passing ${draft.round % 2 === 0 ? 'left' : 'right'}${draft.short ? ` · cube is ${draft.short} cards short, packs have ${draft.packSize}` : ''}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-pt="autopick" title="Let a bot finish the draft for you">Auto-pick the rest</button>
      <button type="button" class="btn btn-ghost btn-sm" data-pt="reset-draft">Quit</button>
    </div>
    <div class="pt-grid pt-pack">${draft.pack.map((c) => cardImageButton(c, `data-pick="${escapeHtml(c.uid)}"`)).join('')}</div>
    ${draft.pool.length ? `<h4 class="pt-pool-title">Your picks <span class="muted">${draft.pool.length}</span></h4>${poolColumns(draft.pool)}` : ''}`;
}

async function savePoolAsDeck(pool, label) {
  const name = `${deck().name} ${label} ${new Date().toLocaleDateString()}`;
  // The whole pool goes to the sideboard; build the 40 from there
  const list = ['Sideboard', ...poolToDeckList(pool)].join('\n');
  try {
    const result = await api.importDeck(name, 'limited', list);
    showToast('Saved. Move cards from the sideboard into your deck.', 'success', 4000);
    if (result.deck?.id) window.dispatchEvent(new CustomEvent('navigate', { detail: { path: `/decks/${result.deck.id}` } }));
  } catch (error) {
    showToast('Failed to save the pool: ' + error.message, 'error');
  }
}

const intIn = (id, min, max, fallback) => {
  const n = parseInt(document.getElementById(id)?.value, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

async function onCubeViewClick(e) {
  const tagBtn = e.target.closest('[data-filter-tag]');
  if (tagBtn) {
    const input = document.getElementById('deck-filter-search');
    const tag = tagBtn.dataset.filterTag;
    input.value = /\s/.test(tag) ? `tag:"${tag}"` : `#${tag}`;
    input.dispatchEvent(new Event('input'));
    setView('table');
    return;
  }

  const mode = e.target.closest('[data-pt-mode]')?.dataset.ptMode;
  if (mode) {
    playtestMode = mode;
    renderPlaytest();
    return;
  }

  const pick = e.target.closest('[data-pick]')?.dataset.pick;
  if (pick && draft && !draft.isDone) {
    draft.pick(pick);
    renderPlaytest();
    return;
  }

  const action = e.target.closest('[data-pt]')?.dataset.pt;
  if (!action) return;
  const cards = deck()?.cards || [];
  const s = settings();
  switch (action) {
    case 'new-pack':
      samplePack = makeSamplePack(cards, Number(s.packSize) || 15, newSeed());
      break;
    case 'open-sealed':
      sealed = makeSealedPool(cards, { packs: intIn('pt-sealed-packs', 1, 12, 6), packSize: intIn('pt-sealed-size', 5, 30, 15) });
      break;
    case 'reset-sealed':
      sealed = null;
      break;
    case 'save-sealed':
      if (sealed) await savePoolAsDeck(sealed.pool, 'sealed');
      return;
    case 'start-draft':
      draft = new Draft(cards, {
        seats: intIn('pt-seats', 2, 16, 8),
        packsPerPlayer: intIn('pt-packs', 1, 6, 3),
        packSize: intIn('pt-pack-size', 5, 30, 15),
      });
      if (draft.packSize === 0) {
        showToast('The cube is too small for that many players', 'warning');
        draft = null;
      }
      break;
    case 'autopick':
      draft?.autoPick();
      break;
    case 'reset-draft':
      draft = null;
      break;
    case 'save-draft':
      if (draft) await savePoolAsDeck(draft.pool, 'draft');
      return;
    default:
      return;
  }
  renderPlaytest();
}

// ---- History --------------------------------------------------------------------------------

let historySeq = 0;

async function renderHistory() {
  const container = document.getElementById('cube-view');
  const seq = ++historySeq;
  if (!container.querySelector('.history')) container.innerHTML = '<div class="legality-loading">Loading history…</div>';
  try {
    const { changes } = await api.getDeckHistory(host.getDeckId());
    if (seq !== historySeq) return;
    if (!changes.length) {
      container.innerHTML = '<div class="grid-message"><i class="ph ph-clock-counter-clockwise"></i><h3>No changes yet</h3><p>Adds, cuts and moves to the maybeboard are recorded here.</p></div>';
      return;
    }
    const days = new Map();
    for (const change of changes) {
      // SQLite timestamps are UTC without a zone marker
      const when = new Date(`${change.created_at.replace(' ', 'T')}Z`);
      const day = when.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(change);
    }
    container.innerHTML = `<div class="history">${[...days].map(([day, list]) => {
      const main = list.filter((c) => c.board_type === 'mainboard');
      const added = main.filter((c) => c.action === 'add').reduce((s, c) => s + c.quantity, 0);
      const removed = main.filter((c) => c.action === 'remove').reduce((s, c) => s + c.quantity, 0);
      return `<section class="history-day">
        <h4>${escapeHtml(day)} <span class="history-net"><span data-dir="add">+${added}</span> <span data-dir="remove">−${removed}</span></span></h4>
        <ul>${list.map((c) => `<li data-action="${c.action}">
          <span class="history-sign">${c.action === 'add' ? '+' : '−'}</span>
          ${c.quantity > 1 ? `${c.quantity} ` : ''}${escapeHtml(c.card_name)}
          ${c.board_type !== 'mainboard' ? `<span class="muted">${c.action === 'add' ? 'to' : 'from'} ${escapeHtml(c.board_type)}</span>` : ''}
        </li>`).join('')}</ul>
      </section>`;
    }).join('')}</div>`;
  } catch (error) {
    container.innerHTML = '';
    showToast('Failed to load history: ' + error.message, 'error');
  }
}

// ---- Settings -------------------------------------------------------------------------------

function openCubeSettings() {
  const d = deck();
  if (!d) return;
  const s = settings();
  const modal = document.getElementById('modal');
  const sizes = [180, 270, 360, 450, 540, 720];
  document.getElementById('modal-body').innerHTML = `
    <h2>Cube settings</h2>
    <form id="cube-settings-form" class="cube-settings-form">
      <div class="form-group">
        <label for="cs-description">Description</label>
        <textarea id="cs-description" rows="3" maxlength="2000" placeholder="What kind of cube is this? Power level, archetypes, house rules…">${escapeHtml(d.description || '')}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="cs-target">Target size</label>
          <input id="cs-target" type="number" min="0" max="2000" list="cs-sizes" value="${Number(s.targetSize) || ''}">
          <datalist id="cs-sizes">${sizes.map((n) => `<option value="${n}">`).join('')}</datalist>
        </div>
        <div class="form-group">
          <label for="cs-pool">Card pool</label>
          <select id="cs-pool">${CUBE_CARD_POOLS.map((p) => `<option value="${p.id}" ${p.id === (s.cardPool || '') ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label for="cs-seats">Players</label><input id="cs-seats" type="number" min="2" max="16" value="${Number(s.seats) || 8}"></div>
        <div class="form-group"><label for="cs-packs">Packs each</label><input id="cs-packs" type="number" min="1" max="6" value="${Number(s.packsPerPlayer) || 3}"></div>
        <div class="form-group"><label for="cs-pack-size">Cards per pack</label><input id="cs-pack-size" type="number" min="5" max="30" value="${Number(s.packSize) || 15}"></div>
      </div>
      <label class="checkbox-row"><input id="cs-singleton" type="checkbox" ${s.singleton ? 'checked' : ''}> Singleton (flag duplicate cards)</label>
      <p class="an-note" id="cs-needed"></p>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary">Save</button>
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
      </div>
    </form>`;
  modal.classList.remove('hidden');

  const needed = () => {
    const n = intIn('cs-seats', 2, 16, 8) * intIn('cs-packs', 1, 6, 3) * intIn('cs-pack-size', 5, 30, 15);
    document.getElementById('cs-needed').textContent = `A full draft at these settings uses ${n} cards.`;
  };
  needed();
  document.getElementById('cube-settings-form').addEventListener('input', needed);

  document.getElementById('cube-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = {
      ...(d.settings || {}),
      targetSize: intIn('cs-target', 0, 2000, 360),
      cardPool: document.getElementById('cs-pool').value,
      seats: intIn('cs-seats', 2, 16, 8),
      packsPerPlayer: intIn('cs-packs', 1, 6, 3),
      packSize: intIn('cs-pack-size', 5, 30, 15),
      singleton: document.getElementById('cs-singleton').checked,
    };
    try {
      const description = document.getElementById('cs-description').value;
      if (description !== (d.description || '')) {
        await api.updateDeck(host.getDeckId(), { description });
        d.description = description;
      }
      await host.saveSettings(next);
      // Packs already dealt used the old settings
      samplePack = null;
      modal.classList.add('hidden');
      showToast('Cube settings saved', 'success', 1500);
    } catch (error) {
      showToast('Failed to save settings: ' + error.message, 'error');
    }
  });
}
