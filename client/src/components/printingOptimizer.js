/**
 * Printing optimizer for one deck: move cards onto printings from as few binder sets as possible.
 *
 * Three views of the same analysis:
 * - Fewest binders: a full plan covering the whole deck, one apply for all of it. You can leave
 *   individual binders out.
 * - Best single sets: the sets holding the most of the deck, one at a time.
 * - Pick a set: any set you name.
 */
import api from '../services/api.js';
import { showToast } from '../utils/ui.js';

const PREFS_KEY = 'optimizer:prefs';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

let ctx = null; // { deckId, hasCards, reload }
let state = null;

function readPrefs() {
  try {
    return { onlyUnowned: true, excludeCommander: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { onlyUnowned: true, excludeCommander: false };
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered; fine
  }
}

const $ = (id) => document.getElementById(id);

export function setupPrintingOptimizer(context) {
  ctx = context;
  document.getElementById('optimize-printings-btn').addEventListener('click', () => {
    if (!ctx.hasCards()) {
      showToast('Add some cards first', 'warning');
      return;
    }
    open();
  });
  $('optimizer-modal-close').addEventListener('click', close);
  $('cancel-optimization-btn').addEventListener('click', close);
  $('apply-optimization-btn').addEventListener('click', apply);

  document.querySelector('#printing-optimizer-modal .opt-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-opt-tab]');
    if (!btn || !state) return;
    state.tab = btn.dataset.optTab;
    render();
  });

  for (const id of ['opt-only-unowned', 'exclude-commander-sets']) {
    $(id).addEventListener('change', () => {
      savePrefs({ onlyUnowned: $('opt-only-unowned').checked, excludeCommander: $('exclude-commander-sets').checked });
      if (state) analyze();
    });
  }

  $('opt-body').addEventListener('click', onBodyClick);
  $('opt-body').addEventListener('change', onBodyChange);
}

function open() {
  const prefs = readPrefs();
  $('opt-only-unowned').checked = prefs.onlyUnowned;
  $('exclude-commander-sets').checked = prefs.excludeCommander;
  state = { tab: 'plan', result: null, sets: null, index: 0, manual: null, skipped: new Set(), expanded: new Set(), loading: true };
  $('printing-optimizer-modal').classList.remove('hidden');
  analyze();
}

function close() {
  $('printing-optimizer-modal').classList.add('hidden');
  state = null;
}

const onlyUnowned = () => $('opt-only-unowned').checked;

async function analyze() {
  state.loading = true;
  state.manual = null;
  state.skipped = new Set();
  render();
  try {
    const [result, sets] = await Promise.all([
      api.analyzeDeckPrintings(ctx.deckId(), 5, $('exclude-commander-sets').checked, onlyUnowned()),
      api.getOptimizationSets(ctx.deckId(), onlyUnowned()),
    ]);
    if (!state) return;
    state.result = result;
    state.sets = sets.sets || [];
    state.index = 0;
  } catch (error) {
    showToast(`Couldn't analyze printings: ${error.message}`, 'error');
  } finally {
    if (state) {
      state.loading = false;
      render();
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  document.querySelectorAll('#printing-optimizer-modal [data-opt-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.optTab === state.tab);
    b.setAttribute('aria-selected', String(b.dataset.optTab === state.tab));
  });
  const body = $('opt-body');
  const r = state.result;
  if (state.loading) {
    body.innerHTML = '<div class="opt-empty"><div class="spinner"></div><p>Looking through every printing…</p></div>';
  } else if (!r || !r.considered) {
    body.innerHTML = `<div class="opt-empty"><i class="ph ph-check-circle"></i><p>${onlyUnowned() && r?.totalCards
      ? 'You own or proxy every card in this deck. Untick "Only cards I don\'t own" to optimize all of them.'
      : 'No cards to optimize.'}</p></div>`;
  } else if (state.tab === 'plan') {
    body.innerHTML = planHtml(r.plan);
  } else if (state.tab === 'sets') {
    body.innerHTML = setsHtml(r.suggestions);
  } else {
    body.innerHTML = manualHtml();
  }
  updateApply();
}

function scopeNote(r) {
  return r.considered < r.totalCards
    ? `${plural(r.considered, 'card')} you don't own yet (of ${r.totalCards})`
    : plural(r.considered, 'card');
}

function planHtml(plan) {
  const r = state.result;
  const kept = plan.binders.filter((b) => !state.skipped.has(b.setCode));
  const placed = kept.reduce((n, b) => n + b.cardCount, 0);
  return `
    <div class="opt-summary">
      <div class="opt-big"><strong>${plan.binders.length}</strong> ${plan.binders.length === 1 ? 'binder' : 'binders'}</div>
      <div class="opt-summary-text">
        hold ${placed === r.considered ? 'all' : placed} of the ${scopeNote(r)}${plan.unplaced.length ? `; ${plural(plan.unplaced.length, 'card')} ${plan.unplaced.length === 1 ? 'is' : 'are'} only in promo or special sets` : ''}.
        Applying moves ${plural(changes().length, 'card')} to the printing in its binder.
      </div>
    </div>
    <div class="opt-binders">
      ${plan.binders.map((b, i) => binderHtml(b, i)).join('')}
      ${plan.unplaced.length ? `
        <details class="opt-binder is-off">
          <summary class="opt-binder-head"><span class="opt-binder-name">Not in any binder set</span><span class="opt-binder-meta">${plural(plan.unplaced.length, 'card')}, left as they are</span></summary>
          <div class="opt-cards">${plan.unplaced.map((c) => `<div class="opt-card"><span class="opt-card-name">${esc(c.cardName)}</span><span class="opt-card-from">${esc((c.currentSetCode || '').toUpperCase())}</span></div>`).join('')}</div>
        </details>` : ''}
    </div>`;
}

function binderHtml(b, i) {
  const off = state.skipped.has(b.setCode);
  const expanded = state.expanded.has(b.setCode);
  return `
    <div class="opt-binder ${off ? 'is-off' : ''}">
      <div class="opt-binder-head">
        <input type="checkbox" data-binder="${esc(b.setCode)}" ${off ? '' : 'checked'} aria-label="Use ${esc(b.setName)}">
        <button type="button" class="opt-binder-toggle" data-expand="${esc(b.setCode)}" aria-expanded="${expanded}">
          <span class="opt-binder-rank">${i + 1}</span>
          <span class="opt-binder-name">${esc(b.setName)} <small>${esc(b.setCode.toUpperCase())}</small></span>
          <span class="opt-binder-meta">${plural(b.cardCount, 'card')}${b.changeCount < b.cardCount ? ` · ${b.changeCount} to change` : ''}</span>
          <i class="ph ph-caret-down"></i>
        </button>
      </div>
      ${expanded ? `<div class="opt-cards">${b.cards.map(cardHtml).join('')}</div>` : ''}
    </div>`;
}

function cardHtml(c) {
  return `
    <div class="opt-card ${c.unchanged ? 'is-unchanged' : ''}">
      ${c.imageUrl ? `<img src="${esc(c.imageUrl.replace('/normal/', '/small/'))}" alt="" loading="lazy">` : '<span class="opt-card-noimg"></span>'}
      <span class="opt-card-name">${c.quantity > 1 ? `${c.quantity}× ` : ''}${esc(c.cardName)}${c.boardType && c.boardType !== 'mainboard' ? ` <small>${esc(c.boardType)}</small>` : ''}</span>
      <span class="opt-card-from">${c.unchanged ? 'already this printing' : `from ${esc((c.currentSetCode || '').toUpperCase())}`}</span>
    </div>`;
}

function setDetailHtml(s) {
  return `
    <div class="opt-set">
      <div>
        <h3>${esc(s.setName)} <small>${esc(s.setCode.toUpperCase())}</small></h3>
        <div class="muted">${s.releaseDate ? `Released ${new Date(s.releaseDate).toLocaleDateString()}` : ''}</div>
      </div>
      <div class="opt-set-score"><strong>${s.percentage}%</strong><span>${s.cardCount} of ${s.considered}</span></div>
    </div>
    <div class="opt-cards">${s.cards.map(cardHtml).join('')}</div>`;
}

function setsHtml(suggestions) {
  if (!suggestions.length) return '<div class="opt-empty"><p>None of these cards are in a binder set.</p></div>';
  const s = suggestions[state.index];
  return `
    <div class="opt-pager">
      <button type="button" class="btn-icon" data-page="-1" ${state.index === 0 ? 'disabled' : ''} aria-label="Previous set"><i class="ph ph-caret-left"></i></button>
      <span>${state.index + 1} / ${suggestions.length}</span>
      <button type="button" class="btn-icon" data-page="1" ${state.index === suggestions.length - 1 ? 'disabled' : ''} aria-label="Next set"><i class="ph ph-caret-right"></i></button>
      <span class="muted">of the ${scopeNote(state.result)}</span>
    </div>
    ${setDetailHtml(s)}`;
}

function manualHtml() {
  return `
    <div class="opt-manual">
      <select id="manual-set-select" class="filter-select" aria-label="Set">
        <option value="">Choose a set…</option>
        ${state.sets.map((s) => `<option value="${esc(s.code)}" ${state.manual?.setCode === s.code ? 'selected' : ''}>${esc(s.name)} (${esc(s.code)}) · ${s.card_count}</option>`).join('')}
      </select>
    </div>
    ${state.manual ? setDetailHtml(state.manual) : '<div class="opt-empty"><p>Sets are listed by how many of the cards they hold.</p></div>'}`;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function changes() {
  if (!state?.result?.considered) return [];
  let cards = [];
  if (state.tab === 'plan') cards = state.result.plan.binders.filter((b) => !state.skipped.has(b.setCode)).flatMap((b) => b.cards);
  else if (state.tab === 'sets') cards = state.result.suggestions[state.index]?.cards || [];
  else cards = state.manual?.cards || [];
  return cards.filter((c) => !c.unchanged).map((c) => ({ deckCardId: c.deckCardId, newPrintingId: c.newPrintingId }));
}

function updateApply() {
  const btn = $('apply-optimization-btn');
  const n = state?.loading ? 0 : changes().length;
  btn.disabled = !n;
  btn.innerHTML = `<i class="ph ph-check"></i> ${n ? `Change ${plural(n, 'printing')}` : 'Nothing to change'}`;
}

function onBodyClick(e) {
  const expand = e.target.closest('[data-expand]');
  if (expand) {
    const code = expand.dataset.expand;
    if (state.expanded.has(code)) state.expanded.delete(code);
    else state.expanded.add(code);
    render();
    return;
  }
  const page = e.target.closest('[data-page]');
  if (page) {
    state.index = Math.max(0, Math.min(state.result.suggestions.length - 1, state.index + Number(page.dataset.page)));
    render();
  }
}

async function onBodyChange(e) {
  if (e.target.matches('[data-binder]')) {
    const code = e.target.dataset.binder;
    if (e.target.checked) state.skipped.delete(code);
    else state.skipped.add(code);
    render();
    return;
  }
  if (e.target.id === 'manual-set-select') {
    const code = e.target.value;
    if (!code) {
      state.manual = null;
      render();
      return;
    }
    try {
      state.manual = await api.analyzeSpecificSet(ctx.deckId(), code, onlyUnowned());
    } catch (error) {
      showToast(`Couldn't analyze that set: ${error.message}`, 'error');
      state.manual = null;
    }
    render();
  }
}

async function apply() {
  const list = changes();
  if (!list.length) return;
  const btn = $('apply-optimization-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner"></i> Applying…';
  try {
    const result = await api.applyPrintingOptimization(ctx.deckId(), list);
    showToast(result.message || `Updated ${result.updated} cards`, 'success');
    await ctx.reload();
    if (state) await analyze();
  } catch (error) {
    showToast(`Couldn't apply: ${error.message}`, 'error');
    updateApply();
  }
}
