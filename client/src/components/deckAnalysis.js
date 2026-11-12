/**
 * Analysis and playtesting for a constructed deck:
 *   - Mana base: colored sources against each spell's colored cost, the Frank Karsten way
 *   - Draw odds: the chance to have drawn a set of cards by a given turn, London mulligan included
 *   - Goldfish: play the deck alone, with hand, library, battlefield, graveyard, exile, life and mulligans
 *
 * A DeckTools instance renders into one container and reads the deck through `getDeck`, so the
 * deck builder and the shared deck page can each have one.
 */
import { formatMana, popover, showToast } from '../utils/ui.js';
import {
  analyzeManaBase,
  simulateDrawOdds,
  expandLibrary,
  splitDeck,
  isLandDrop,
  resolveSources,
  requirementCost,
  parseManaCost,
  hypergeometricAtLeast,
  COLOR_NAMES,
  CONSISTENCY_TARGET,
} from '../utils/manaMath.js';
import { Goldfish, ZONE_LABELS, startingLife, hasFreeMulligan } from '../utils/goldfish.js';
import { compileQuery } from '../utils/cardQuery.js';

const TRIALS = 20000;
const MAX_TURNS = 10;

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Remembered settings are only a convenience
  }
}

const pct = (p, digits = 1) => `${(p * 100).toFixed(digits)}%`;
const qtySum = (cards) => cards.reduce((s, c) => s + (Number(c.quantity) || 0), 0);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const frontTypeOf = (card) => String(card.type_line || '').split(' // ')[0];
/** Mana value of the face you'd cast: the front half of split and adventure cards. */
const castValue = (card) => (String(card.name || '').includes(' // ') && card.mana_cost ? parseManaCost(card.mana_cost).mv : Math.floor(Number(card.cmc) || 0));

/** Mainboard identity, so analysis is only redone when the list itself changes. */
function deckKey(cards) {
  return (cards || [])
    .filter((c) => (c.board_type || (c.is_sideboard ? 'sideboard' : 'mainboard')) === 'mainboard')
    .map((c) => `${c.deck_card_id ?? c.name}:${c.quantity}:${c.is_commander ? 1 : 0}:${c.printing_id ?? ''}`)
    .sort()
    .join('|');
}

function statusOf(probability) {
  if (probability >= CONSISTENCY_TARGET) return { id: 'ok', label: 'On target', icon: 'ph-check-circle' };
  if (probability >= 0.8) return { id: 'warn', label: 'A little short', icon: 'ph-warning' };
  return { id: 'bad', label: 'Short', icon: 'ph-warning-octagon' };
}

function seg(name, options, value) {
  return `<div class="seg" role="radiogroup">${options.map(([v, label]) => `<button type="button" class="seg-btn${String(v) === String(value) ? ' active' : ''}" data-seg="${name}" data-value="${escapeHtml(v)}" role="radio" aria-checked="${String(v) === String(value)}">${label}</button>`).join('')}</div>`;
}

// ---- Draw odds goals ---------------------------------------------------------------------------

const GOAL_KINDS = [
  ['land', 'lands'],
  ['mv', 'spells with mana value'],
  ['mvmax', 'spells with mana value at most'],
  ['spell', 'nonland cards'],
  ['creature', 'creatures'],
  ['source', 'sources of'],
  ['card', 'copies of'],
  ['query', 'cards matching'],
];

function goalTest(goal, ctx) {
  const v = goal.value;
  switch (goal.kind) {
    case 'land': return isLandDrop;
    case 'spell': return (c) => !isLandDrop(c);
    case 'creature': return (c) => /\bCreature\b/.test(frontTypeOf(c));
    case 'mv': return (c) => !isLandDrop(c) && castValue(c) === Number(v);
    case 'mvmax': return (c) => !isLandDrop(c) && castValue(c) <= Number(v);
    case 'source': return (c) => !!ctx.sources.get(c)?.colors.includes(v);
    case 'card': return (c) => c.name === v;
    case 'query': return compileQuery(v);
    default: return () => false;
  }
}

function goalText(goal) {
  const n = Number(goal.count) || 0;
  const v = goal.value;
  switch (goal.kind) {
    case 'land': return n === 1 ? 'a land' : `${n} lands`;
    case 'spell': return n === 1 ? 'a spell' : `${n} spells`;
    case 'creature': return n === 1 ? 'a creature' : `${n} creatures`;
    case 'mv': return n === 1 ? `a ${v}-drop` : `${n} ${v}-drops`;
    case 'mvmax': return n === 1 ? `a spell costing ${v} or less` : `${n} spells costing ${v} or less`;
    case 'source': return `${n === 1 ? 'a' : n} ${COLOR_NAMES[v]?.toLowerCase() || v} source${n === 1 ? '' : 's'}`;
    case 'card': return n === 1 ? escapeHtml(v || 'a card') : `${n} copies of ${escapeHtml(v || 'a card')}`;
    case 'query': return `${n === 1 ? 'a card' : `${n} cards`} matching <code>${escapeHtml(v || '')}</code>`;
    default: return '';
  }
}

function joinAnd(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

const DEFAULT_ODDS = {
  goals: [{ count: 3, kind: 'land' }, { count: 1, kind: 'mv', value: 2 }],
  turn: 3,
  onDraw: false,
  mulligan: 'london',
  minLands: 2,
  maxLands: 5,
  minHand: 5,
};

// ---- Controller --------------------------------------------------------------------------------

export class DeckTools {
  /**
   * @param {object} host
   * @param {HTMLElement} host.container where analysis and playtest render
   * @param {() => object} host.getDeck the deck, with `cards` and `format`
   * @param {(card: object) => void} [host.showCard] open a card's details
   * @param {(src: string, e: Event) => void} [host.preview] hover preview
   * @param {() => void} [host.hidePreview]
   */
  constructor(host) {
    this.host = host;
    this.el = host.container;
    this.view = null; // 'analysis' | 'playtest' | null
    this.analysisOnDraw = readJson('deckAnalysis', { onDraw: false }).onDraw;
    this.odds = readJson('deckOdds', DEFAULT_ODDS);
    this.cache = { manaKey: null, mana: null, oddsKey: null, odds: null };
    this.game = null;
    this.gameKey = '';
    this.gameOnDraw = false;
    this.bottomPick = new Set();
    this.queryTimer = null;

    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('change', (e) => this.onChange(e));
    this.el.addEventListener('input', (e) => this.onInput(e));
    this.el.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    this.el.addEventListener('mouseover', (e) => this.onHover(e));
    this.el.addEventListener('mouseout', (e) => this.onHoverEnd(e));
    this.el.addEventListener('dragstart', (e) => this.onDragStart(e));
    this.el.addEventListener('dragover', (e) => this.onDragOver(e));
    this.el.addEventListener('dragleave', (e) => e.target.closest?.('[data-drop]')?.classList.remove('is-drop-target'));
    this.el.addEventListener('drop', (e) => this.onDrop(e));
    this.el.addEventListener('dragend', () => this.el.querySelectorAll('.is-drop-target').forEach((z) => z.classList.remove('is-drop-target')));
    document.addEventListener('keydown', (e) => this.onKey(e));
  }

  deck() {
    return this.host.getDeck() || { cards: [] };
  }

  /** Show a view, or null to hide. */
  show(view) {
    this.view = view;
    this.render();
  }

  /** The deck changed or was replaced. */
  refresh() {
    this.render();
  }

  /** A different deck was opened: forget the game in progress. */
  reset() {
    this.game = null;
    this.gameKey = '';
    this.bottomPick.clear();
    this.cache = { manaKey: null, mana: null, oddsKey: null, odds: null };
  }

  render() {
    this.closeMenu();
    if (this.view === 'analysis') this.renderAnalysis();
    else if (this.view === 'playtest') this.renderPlaytest();
  }

  // ==== Analysis ===============================================================================

  manaBase() {
    const cards = this.deck().cards || [];
    const key = `${deckKey(cards)}#${this.analysisOnDraw}`;
    if (this.cache.manaKey !== key) {
      const freeMulligan = hasFreeMulligan(this.deck().format);
      this.cache.mana = analyzeManaBase(cards, { onDraw: this.analysisOnDraw, freeMulligan });
      this.cache.manaKey = key;
    }
    return this.cache.mana;
  }

  renderAnalysis() {
    const mb = this.manaBase();
    if (mb.deckSize === 0) {
      this.el.innerHTML = `<div class="grid-message"><i class="ph ph-chart-line-up"></i><h3>Nothing to analyze yet</h3><p>Add cards to the main deck to check its mana and draws.</p></div>`;
      return;
    }
    this.el.innerHTML = `
      ${this.tilesHtml(mb)}
      <div class="an-grid">
        <section class="an-section an-wide" aria-labelledby="ma-title">${this.manaHtml(mb)}</section>
        <section class="an-section an-wide" aria-labelledby="odds-title">${this.oddsHtml()}</section>
      </div>`;
    this.renderOddsResult();
  }

  tilesHtml(mb) {
    const { library } = splitDeck(this.deck().cards);
    const spells = library.filter((c) => !isLandDrop(c));
    const spellCount = qtySum(spells);
    const avg = spellCount ? spells.reduce((s, c) => s + castValue(c) * c.quantity, 0) / spellCount : 0;
    const mdfc = mb.landRows.filter((r) => r.via === 'back face').reduce((s, r) => s + r.quantity, 0);
    const keepable = mb.deckSize >= 7
      ? hypergeometricAtLeast(mb.deckSize, mb.lands, 7, 2) - hypergeometricAtLeast(mb.deckSize, mb.lands, 7, 6)
      : 0;
    const reqs = mb.requirements;
    const passing = reqs.filter((r) => r.ok).length;
    const worst = reqs.find((r) => !r.ok);
    const commanders = mb.commanders.length;

    return `<div class="an-tiles">
      <div class="an-tile"><span class="an-tile-label">Cards</span><span class="an-tile-value">${mb.deckSize}</span><span class="an-tile-sub">${commanders ? `plus ${plural(commanders, 'commander')}` : 'in the library'}</span></div>
      <div class="an-tile"><span class="an-tile-label">Lands</span><span class="an-tile-value">${mb.lands} <small>${pct(mb.lands / mb.deckSize, 0)}</small></span><span class="an-tile-sub">${mdfc ? `${mdfc} of them double-faced` : `${mb.nonlands} other cards`}</span></div>
      <div class="an-tile"><span class="an-tile-label">Average mana value</span><span class="an-tile-value">${avg.toFixed(2)}</span><span class="an-tile-sub">${spellCount} nonland cards</span></div>
      <div class="an-tile"><span class="an-tile-label">Keepable seven</span><span class="an-tile-value">${pct(keepable, 0)}</span><span class="an-tile-sub">opening hands with 2 to 5 lands</span></div>
      <div class="an-tile"><span class="an-tile-label">Colored costs on target</span><span class="an-tile-value">${passing}<small> / ${reqs.length}</small></span><span class="an-tile-sub">${worst ? `Hardest: ${escapeHtml(worst.cards[0].name)}` : reqs.length ? 'Every one at 90% or better' : 'No colored costs'}</span></div>
    </div>`;
  }

  manaHtml(mb) {
    const colors = mb.colors.filter((c) => c.requirements.length);
    const head = `
      <div class="an-head">
        <h3 id="ma-title">Mana base</h3>
        ${seg('ma-draw', [['play', 'On the play'], ['draw', 'On the draw']], mb.onDraw ? 'draw' : 'play')}
      </div>
      <p class="an-note">For each colored cost: the chance of having enough sources of that color by the turn its mana value says you'd cast it, given that you hit your land drops, with London mulligans${mb.freeMulligan ? ' (first one free)' : ''}. Frank Karsten's target is ${pct(CONSISTENCY_TARGET, 0)}. Only lands count as sources, double-faced lands and fetches included. Mana rocks and creatures help but aren't counted.</p>`;

    if (!mb.canCompute) {
      return `${head}<p class="muted">Add some lands to see how well they support your spells.</p>`;
    }
    if (!colors.length && !mb.hybrid.length) {
      return `${head}<p class="muted">Nothing in the deck has a colored cost.</p>`;
    }

    const colorCards = colors.map((c) => {
      const worst = c.worst;
      const st = statusOf(worst.probability);
      const needed = c.recommended === Infinity || c.recommended == null ? null : c.recommended;
      const fill = Math.min(100, (c.sources / mb.lands) * 100);
      const mark = needed ? Math.min(100, (needed / mb.lands) * 100) : null;
      return `<div class="ma-color" data-status="${st.id}">
        <div class="ma-color-head">${formatMana(`{${c.color}}`)} <strong>${COLOR_NAMES[c.color]}</strong>
          <span class="ma-status"><i class="ph-fill ${st.icon}" aria-hidden="true"></i> ${st.label}</span></div>
        <div class="ma-color-count"><strong>${c.sources}</strong> ${c.sources === 1 ? 'source' : 'sources'}
          <span class="muted">${needed == null ? `· more lands needed for ${escapeHtml(worst.cards[0].name)}` : needed > c.sources ? `· ${needed} wanted` : `· ${needed} needed`}</span></div>
        <div class="ma-meter" role="img" aria-label="${c.sources} of ${mb.lands} lands make ${COLOR_NAMES[c.color]}${needed ? `, ${needed} wanted` : ''}">
          <span style="width:${fill}%"></span>${mark != null ? `<i style="left:${mark}%"></i>` : ''}
        </div>
        <div class="ma-color-sub">Hardest: ${escapeHtml(worst.cards[0].name)} <span class="ma-cost">${formatMana(requirementCost(worst))}</span> on turn ${worst.turn} · <strong>${pct(worst.probability, 0)}</strong></div>
        <div class="ma-color-meta">${plural(c.pips, 'pip')} across ${plural(c.spells, 'card')}</div>
      </div>`;
    }).join('');

    const rows = mb.requirements.map((r) => {
      const st = statusOf(r.probability);
      const names = r.cards.map((c) => `${c.quantity > 1 ? `${c.quantity}× ` : ''}${c.name}`);
      const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? `, +${names.length - 3} more` : '');
      return `<tr data-status="${st.id}">
        <td class="ma-cost">${formatMana(requirementCost(r))}</td>
        <td class="num">${r.turn}</td>
        <td class="ma-cards" title="${escapeHtml(names.join('\n'))}">${escapeHtml(shown)}</td>
        <td class="num">${r.sources}</td>
        <td class="num">${r.recommended ?? '—'}</td>
        <td class="num ma-chance"><span class="ma-pill" data-status="${st.id}"><i class="ph-fill ${st.icon}" aria-hidden="true"></i> ${pct(r.probability)}</span><span class="visually-hidden"> ${st.label}</span></td>
      </tr>`;
    }).join('');

    const landRows = mb.landRows.map((l) => `<tr>
        <th scope="row">${escapeHtml(l.name)}</th>
        <td class="num">${l.quantity}</td>
        <td>${l.colors.length ? l.colors.map((c) => formatMana(`{${c}}`)).join(' ') : '<span class="muted">no colored mana</span>'}</td>
        <td class="muted">${l.via ? escapeHtml(l.via) : ''}</td>
      </tr>`).join('');

    return `${head}
      <div class="ma-colors">${colorCards}</div>
      <table class="an-table ma-table">
        <thead><tr><th>Cost</th><th class="num">Turn</th><th>Cards</th><th class="num">Sources</th><th class="num" title="Fewest sources that reach ${pct(CONSISTENCY_TARGET, 0)}">Needed</th><th class="num">Chance</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <details class="ma-lands">
        <summary>How each land was counted <span class="muted">${mb.lands} lands</span></summary>
        <table class="an-table">
          <thead><tr><th>Land</th><th class="num">Qty</th><th>Counts for</th><th>Note</th></tr></thead>
          <tbody>${landRows}</tbody>
        </table>
      </details>`;
  }

  // ---- Draw odds ----

  oddsHtml() {
    const o = this.odds;
    const turnOptions = Array.from({ length: MAX_TURNS }, (_, i) => `<option value="${i + 1}"${o.turn === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('');
    return `
      <div class="an-head"><h3 id="odds-title">Draw odds</h3></div>
      <div class="odds-presets" aria-label="Examples">${this.presets().map((p, i) => `<button type="button" class="tag-chip" data-odds-preset="${i}">${p.label}</button>`).join('')}</div>
      <div class="odds-builder">
        <div class="odds-goals">${this.goalsHtml()}</div>
        <div class="odds-options">
          <label>By turn <select data-odds="turn">${turnOptions}</select></label>
          ${seg('odds-draw', [['play', 'On the play'], ['draw', 'On the draw']], o.onDraw ? 'draw' : 'play')}
          <label>Mulligan
            <select data-odds="mulligan">
              <option value="london"${o.mulligan === 'london' ? ' selected' : ''}>London, by land count</option>
              <option value="never"${o.mulligan === 'never' ? ' selected' : ''}>Never</option>
            </select>
          </label>
          <span class="odds-mull${o.mulligan === 'never' ? ' hidden' : ''}">
            keep <input type="number" data-odds="minLands" min="0" max="7" value="${o.minLands}" aria-label="Fewest lands to keep"> to
            <input type="number" data-odds="maxLands" min="0" max="7" value="${o.maxLands}" aria-label="Most lands to keep"> lands, down to
            <input type="number" data-odds="minHand" min="1" max="7" value="${o.minHand}" aria-label="Smallest hand to mulligan to"> cards
          </span>
        </div>
      </div>
      <div id="odds-result" class="odds-result" aria-live="polite"></div>`;
  }

  goalsHtml() {
    const cards = splitDeck(this.deck().cards).library;
    const names = [...new Set(cards.map((c) => c.name))].sort((a, b) => a.localeCompare(b));
    const colors = this.manaBase().colors.map((c) => c.color);
    const colorChoices = colors.length ? colors : ['W', 'U', 'B', 'R', 'G'];

    return this.odds.goals.map((g, i) => {
      let param = '';
      if (g.kind === 'mv' || g.kind === 'mvmax') {
        param = `<input type="number" min="0" max="20" value="${Number(g.value) || 0}" data-goal="value" data-i="${i}" aria-label="Mana value">`;
      } else if (g.kind === 'source') {
        param = `<select data-goal="value" data-i="${i}" aria-label="Color">${colorChoices.map((c) => `<option value="${c}"${g.value === c ? ' selected' : ''}>${COLOR_NAMES[c]}</option>`).join('')}</select>`;
      } else if (g.kind === 'card') {
        param = `<select data-goal="value" data-i="${i}" aria-label="Card" class="odds-card-select">${names.map((n) => `<option${g.value === n ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select>`;
      } else if (g.kind === 'query') {
        param = `<input type="text" value="${escapeHtml(g.value || '')}" placeholder="t:creature mv<=2" data-goal="value" data-i="${i}" aria-label="Search" class="odds-query" spellcheck="false">`;
      }
      return `<div class="odds-goal">
        <span class="odds-goal-word">${i === 0 ? 'At least' : 'and'}</span>
        <input type="number" min="0" max="20" value="${Number(g.count) || 0}" data-goal="count" data-i="${i}" aria-label="How many">
        <select data-goal="kind" data-i="${i}" aria-label="What">${GOAL_KINDS.map(([k, label]) => `<option value="${k}"${g.kind === k ? ' selected' : ''}>${label}</option>`).join('')}</select>
        ${param}
        <button type="button" class="icon-btn" data-goal-remove="${i}" title="Remove" aria-label="Remove this condition"${this.odds.goals.length === 1 ? ' disabled' : ''}><i class="ph ph-x"></i></button>
      </div>`;
    }).join('') + `<button type="button" class="btn btn-ghost btn-sm" data-goal-add><i class="ph ph-plus"></i> Add condition</button>`;
  }

  presets() {
    const cards = splitDeck(this.deck().cards).library;
    const keyCard = cards.filter((c) => !isLandDrop(c)).sort((a, b) => b.quantity - a.quantity || (Number(b.cmc) || 0) - (Number(a.cmc) || 0))[0];
    const list = [
      { label: '3 lands and a 2-drop by turn 3', goals: [{ count: 3, kind: 'land' }, { count: 1, kind: 'mv', value: 2 }], turn: 3 },
      { label: 'Every land drop through turn 4', goals: [{ count: 4, kind: 'land' }], turn: 4 },
      { label: 'A 1-drop in the opening hand', goals: [{ count: 1, kind: 'mv', value: 1 }], turn: 1, onDraw: false },
      { label: '2 lands and a 1-drop on turn 1', goals: [{ count: 2, kind: 'land' }, { count: 1, kind: 'mv', value: 1 }], turn: 1 },
    ];
    if (keyCard) list.push({ label: `${keyCard.name} by turn 4`, goals: [{ count: 1, kind: 'card', value: keyCard.name }], turn: 4 });
    return list;
  }

  saveOdds() {
    writeJson('deckOdds', this.odds);
  }

  oddsResult() {
    const deck = this.deck();
    const o = this.odds;
    const key = `${deckKey(deck.cards)}#${JSON.stringify(o)}`;
    if (this.cache.oddsKey === key) return this.cache.odds;

    const { library } = splitDeck(deck.cards);
    const physical = expandLibrary(library);
    const ctx = { sources: resolveSources(library) };
    const goals = o.goals.map((g) => ({ count: g.count, test: goalTest(g, ctx) }));
    const freeMulligan = hasFreeMulligan(deck.format);
    const common = { turns: MAX_TURNS, onDraw: o.onDraw, trials: TRIALS, seed: 1, freeMulligan };
    const mulligan = o.mulligan === 'never' ? null : { minLands: Number(o.minLands), maxLands: Number(o.maxLands), minHandSize: Number(o.minHand) };
    const withMull = simulateDrawOdds(physical, goals, { ...common, mulligan });
    const without = mulligan ? simulateDrawOdds(physical, goals, { ...common, mulligan: null }) : withMull;
    this.cache.odds = { withMull, without, mulligan, freeMulligan, deckSize: physical.length };
    this.cache.oddsKey = key;
    return this.cache.odds;
  }

  renderOddsResult() {
    const target = this.el.querySelector('#odds-result');
    if (!target) return;
    const o = this.odds;
    const r = this.oddsResult();
    if (!r.deckSize) {
      target.innerHTML = '';
      return;
    }
    const p = r.withMull.byTurn[o.turn];
    const p0 = r.without.byTurn[o.turn];
    const seen = Math.min(r.deckSize, 7 + o.turn - 1 + (o.onDraw ? 1 : 0));
    const goalsText = joinAnd(o.goals.map(goalText));
    const kept = r.withMull.keptSize;
    const keptText = r.mulligan
      ? Object.keys(kept).map(Number).sort((a, b) => b - a).map((size) => `${pct(kept[size], 0)} keep ${size}`).join(' · ')
      : '';

    const rows = Array.from({ length: MAX_TURNS }, (_, i) => i + 1).map((t) => {
      const v = r.withMull.byTurn[t];
      return `<tr${t === o.turn ? ' class="is-current"' : ''}>
        <th scope="row">Turn ${t}</th>
        <td class="an-bar-cell"><span class="an-bar" title="Turn ${t}: ${pct(v)}"><span style="width:${(v * 100).toFixed(1)}%"></span></span></td>
        <td class="num">${pct(v)}</td>
        ${r.mulligan ? `<td class="num muted">${pct(r.without.byTurn[t])}</td>` : ''}
      </tr>`;
    }).join('');

    target.innerHTML = `
      <div class="odds-headline">
        <span class="odds-big">${pct(p)}</span>
        <p>chance to have ${goalsText} by turn ${o.turn} ${o.onDraw ? 'on the draw' : 'on the play'} (${seen} cards seen).
        ${r.mulligan ? `<br><span class="muted">Without mulligans: ${pct(p0)}. ${keptText}.</span>` : ''}</p>
      </div>
      <table class="an-table odds-table">
        <thead><tr><th>By</th><th><span class="visually-hidden">Chart</span></th><th class="num">${r.mulligan ? 'With mulligans' : 'Chance'}</th>${r.mulligan ? '<th class="num">Never mulligan</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="an-note">Simulated over ${TRIALS.toLocaleString()} games of this list. A card counts once it's in your hand, whether or not you could have played it.${r.mulligan ? ` Mulligans are London: draw seven, put one on the bottom for each mulligan${r.freeMulligan ? ' after a free first one' : ''}, keeping the cards these conditions need first.` : ''}</p>`;
  }

  // ==== Playtest ===============================================================================

  ensureGame() {
    const deck = this.deck();
    const key = deckKey(deck.cards);
    if (!this.game) this.newGame();
    return key !== this.gameKey;
  }

  newGame() {
    const deck = this.deck();
    this.game = new Goldfish(deck.cards || [], {
      life: startingLife(deck.format),
      onDraw: this.gameOnDraw,
      freeMulligan: hasFreeMulligan(deck.format),
    });
    this.game.onChange(() => {
      if (this.view === 'playtest') this.renderPlaytest();
    });
    this.gameKey = deckKey(deck.cards);
    this.bottomPick.clear();
  }

  renderPlaytest() {
    const { library } = splitDeck(this.deck().cards);
    if (!library.length) {
      this.el.innerHTML = `<div class="grid-message"><i class="ph ph-cards-three"></i><h3>Nothing to play yet</h3><p>Add cards to the main deck to goldfish it.</p></div>`;
      return;
    }
    const stale = this.ensureGame();
    const g = this.game;
    const sum = g.summary();
    const mulliganing = g.phase === 'mulligan';
    const need = g.bottomCount;
    for (const uid of [...this.bottomPick]) if (!g.zones.hand.includes(uid)) this.bottomPick.delete(uid);

    const lands = g.zones.battlefield.filter((u) => !g.isToken(u) && isLandDrop(g.card(u)));
    const others = g.zones.battlefield.filter((u) => !lands.includes(u));

    const actions = mulliganing
      ? `<button type="button" class="btn btn-ghost btn-sm" data-gf="mulligan" title="Shuffle and draw seven (M)"${g.zones.hand.length === 0 ? ' disabled' : ''}><i class="ph ph-arrows-clockwise"></i> Mulligan</button>
         <button type="button" class="btn btn-primary btn-sm" data-gf="keep" title="Keep (K)"${this.bottomPick.size !== need ? ' disabled' : ''}><i class="ph ph-hand"></i> ${need ? `Keep, bottom ${this.bottomPick.size}/${need}` : `Keep ${g.zones.hand.length}`}</button>`
      : `<button type="button" class="btn btn-ghost btn-sm" data-gf="draw" title="Draw a card (D)"><i class="ph ph-plus"></i> Draw</button>
         <button type="button" class="btn btn-ghost btn-sm" data-gf="untap" title="Untap everything (U)"><i class="ph ph-arrow-counter-clockwise"></i> Untap</button>
         <button type="button" class="btn btn-ghost btn-sm" data-gf="token" title="Create a token"><i class="ph ph-plus-circle"></i> Token</button>
         <button type="button" class="btn btn-primary btn-sm" data-gf="next" title="Untap and draw (N)"><i class="ph ph-skip-forward"></i> Next turn</button>`;

    this.el.innerHTML = `
      <div class="gf" data-phase="${g.phase}">
        <div class="gf-bar">
          <div class="gf-turn">${mulliganing ? `<strong>${g.mulligans ? `Mulligan ${g.mulligans}` : 'Opening hand'}</strong>` : `Turn <strong>${g.turn}</strong>`}</div>
          <div class="gf-life" title="Life">
            <button type="button" class="icon-btn" data-gf="life-down" aria-label="Lose 1 life"><i class="ph ph-minus"></i></button>
            <i class="ph-fill ph-heart" aria-hidden="true"></i>
            <input type="number" value="${g.life}" data-gf-life aria-label="Life total">
            <button type="button" class="icon-btn" data-gf="life-up" aria-label="Gain 1 life"><i class="ph ph-plus"></i></button>
          </div>
          <div class="gf-counts">Library <strong>${sum.library}</strong> · Hand <strong>${sum.hand}</strong> · Lands <strong>${sum.untappedLands}/${sum.lands}</strong> untapped</div>
          <div class="gf-actions">
            ${actions}
            <button type="button" class="icon-btn" data-gf="undo" title="Undo (Z)" aria-label="Undo"${g.canUndo ? '' : ' disabled'}><i class="ph ph-arrow-u-up-left"></i></button>
            <span class="gf-sep" aria-hidden="true"></span>
            ${seg('gf-draw', [['play', 'Play'], ['draw', 'Draw']], this.gameOnDraw ? 'draw' : 'play')}
            <button type="button" class="btn btn-ghost btn-sm" data-gf="new" title="Shuffle up a new game"><i class="ph ph-shuffle"></i> New game</button>
          </div>
        </div>
        ${stale ? `<div class="gf-notice"><i class="ph ph-info"></i> The deck has changed since this game started. <button type="button" class="btn btn-ghost btn-sm" data-gf="new">Start over with the new list</button></div>` : ''}
        <div class="gf-table">
          <div class="gf-main">
            <section class="gf-zone gf-battlefield" data-drop="battlefield" aria-label="Battlefield">
              <div class="gf-row">${others.map((u) => this.cardHtml(u, 'battlefield')).join('') || (lands.length ? '' : '<p class="gf-empty">Click a card in your hand to play it, or drag it here.</p>')}</div>
              <div class="gf-row gf-lands">${lands.map((u) => this.cardHtml(u, 'battlefield')).join('')}</div>
            </section>
            <section class="gf-zone gf-hand" data-drop="hand" aria-label="Hand">
              <div class="gf-zone-head">Hand <span class="muted">${sum.hand}</span>
                ${mulliganing && need ? `<span class="gf-hint">Choose ${plural(need, 'card')} to put on the bottom</span>` : ''}
                ${mulliganing && !need ? `<span class="gf-hint">Keep this hand or take a mulligan</span>` : ''}
              </div>
              <div class="gf-row">${g.zones.hand.map((u) => this.cardHtml(u, 'hand')).join('') || '<p class="gf-empty">No cards in hand</p>'}</div>
            </section>
          </div>
          <aside class="gf-side">
            ${g.zones.command.length || g.commanderUids.length ? this.pileHtml('command') : ''}
            ${this.pileHtml('library')}
            ${this.pileHtml('graveyard')}
            ${this.pileHtml('exile')}
            <div class="gf-log">
              <div class="gf-zone-head">Log</div>
              <ol>${g.log.slice(-40).reverse().map((l) => `<li><span class="muted">${l.turn ? `T${l.turn}` : '—'}</span> ${escapeHtml(l.text)}</li>`).join('')}</ol>
            </div>
          </aside>
        </div>
        <p class="gf-keys muted">Click a card in hand to play it, click a permanent to tap it, right-click or drag for everything else. Keys: <kbd>D</kbd> draw, <kbd>N</kbd> next turn, <kbd>U</kbd> untap, <kbd>Z</kbd> undo${mulliganing ? ', <kbd>M</kbd> mulligan, <kbd>K</kbd> keep' : ''}.</p>
      </div>`;
  }

  cardHtml(uid, zone) {
    const g = this.game;
    const card = g.card(uid);
    const tapped = g.isTapped(uid);
    const counters = g.counters(uid);
    const picked = this.bottomPick.has(uid);
    const tax = g.isCommander(uid) && zone === 'command' ? g.commanderTax(uid) : 0;
    const face = card.isToken || !card.image_url
      ? `<span class="gf-token"><span>${escapeHtml(card.name)}</span>${card.isToken ? '<small>Token</small>' : ''}</span>`
      : `<img src="${escapeHtml(card.image_url)}" alt="${escapeHtml(card.name)}" loading="lazy" draggable="false">`;
    return `<div class="gf-card${tapped ? ' is-tapped' : ''}${picked ? ' is-picked' : ''}" data-uid="${uid}" data-zone="${zone}" draggable="true" tabindex="0" role="button" aria-label="${escapeHtml(card.name)}${tapped ? ', tapped' : ''}${picked ? ', going to the bottom' : ''}">
      ${face}
      ${counters ? `<span class="gf-badge" title="Counters">${counters}</span>` : ''}
      ${tax ? `<span class="gf-badge gf-tax" title="Commander tax">+${tax}</span>` : ''}
      ${picked ? '<span class="gf-pick"><i class="ph ph-arrow-down"></i> Bottom</span>' : ''}
    </div>`;
  }

  pileHtml(zone) {
    const g = this.game;
    const uids = g.zones[zone];
    const top = zone === 'library' ? null : uids.at(-1);
    let face;
    if (zone === 'library') face = `<span class="gf-back" aria-hidden="true"><img src="/decklotus.png" alt=""></span>`;
    else if (zone === 'command') face = uids.length ? uids.map((u) => this.cardHtml(u, 'command')).join('') : '<span class="gf-pile-empty">Empty</span>';
    else face = top ? this.cardHtml(top, zone) : '<span class="gf-pile-empty">Empty</span>';

    const buttons = {
      library: `<button type="button" class="btn btn-ghost btn-sm" data-gf="draw">Draw</button>
        <button type="button" class="btn btn-ghost btn-sm" data-gf="scry">Look at top</button>
        <button type="button" class="btn btn-ghost btn-sm" data-gf="search">Search</button>
        <button type="button" class="btn btn-ghost btn-sm" data-gf="shuffle">Shuffle</button>
        <button type="button" class="btn btn-ghost btn-sm" data-gf="mill">Mill 1</button>`,
      graveyard: uids.length ? `<button type="button" class="btn btn-ghost btn-sm" data-gf-view="graveyard">View all</button>` : '',
      exile: uids.length ? `<button type="button" class="btn btn-ghost btn-sm" data-gf-view="exile">View all</button>` : '',
      command: '',
    }[zone];

    return `<section class="gf-pile gf-pile-${zone}" data-drop="${zone}" aria-label="${ZONE_LABELS[zone]}">
      <div class="gf-zone-head">${ZONE_LABELS[zone]} <span class="muted">${uids.length}</span></div>
      <div class="gf-pile-face"${zone === 'library' ? ' data-gf="draw" role="button" tabindex="0" title="Draw a card"' : ''}>${face}</div>
      ${buttons ? `<div class="gf-pile-actions">${buttons}</div>` : ''}
    </section>`;
  }

  // ---- Menus ----

  closeMenu() {
    this.menu?.close();
    this.menu = null;
  }

  openMenu(anchor, content) {
    this.closeMenu();
    this.menu = popover(anchor, content);
  }

  cardMenu(uid, anchor) {
    const g = this.game;
    const zone = g.zoneOf(uid);
    if (!zone) return;
    const card = g.card(uid);
    const moves = [
      ['hand', 'To hand', 'ph-hand'],
      ['battlefield', 'To battlefield', 'ph-squares-four'],
      ['graveyard', 'To graveyard', 'ph-skull'],
      ['exile', 'To exile', 'ph-prohibit'],
      ['library:top', 'On top of library', 'ph-arrow-line-up'],
      ['library:bottom', 'On bottom of library', 'ph-arrow-line-down'],
    ];
    if (g.isCommander(uid)) moves.push(['command', 'To command zone', 'ph-crown']);
    const items = moves.filter(([to]) => to.split(':')[0] !== zone || to.startsWith('library'));

    const el = document.createElement('div');
    el.className = 'gf-menu';
    el.innerHTML = `<div class="gf-menu-title">${escapeHtml(card.name)}</div>
      ${zone === 'battlefield' ? `<button type="button" data-act="tap"><i class="ph ph-arrow-bend-up-right"></i> ${g.isTapped(uid) ? 'Untap' : 'Tap'}</button>
        <div class="gf-menu-counters"><span>Counters <strong>${g.counters(uid)}</strong></span>
          <button type="button" data-act="counter-" aria-label="Remove a counter"><i class="ph ph-minus"></i></button>
          <button type="button" data-act="counter+" aria-label="Add a counter"><i class="ph ph-plus"></i></button></div>` : ''}
      ${items.map(([to, label, icon]) => `<button type="button" data-act="move" data-to="${to}"><i class="ph ${icon}"></i> ${label}</button>`).join('')}
      ${!card.isToken && this.host.showCard ? '<button type="button" data-act="details"><i class="ph ph-info"></i> Card details</button>' : ''}`;
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'tap') g.toggleTap(uid);
      else if (act === 'counter+' || act === 'counter-') {
        g.addCounter(uid, act === 'counter+' ? 1 : -1);
        // Keep the menu open for repeated clicks
        const fresh = this.el.querySelector(`.gf-card[data-uid="${uid}"]`);
        if (fresh) this.cardMenu(uid, fresh);
        return;
      } else if (act === 'move') this.moveTo(uid, btn.dataset.to);
      else if (act === 'details') {
        this.closeMenu();
        this.host.showCard(card);
        return;
      }
      this.closeMenu();
    });
    this.openMenu(anchor, el);
  }

  moveTo(uid, to) {
    const [zone, position] = to.split(':');
    this.game.move(uid, zone, position ? { position } : undefined);
  }

  /** A list of every card in a zone, each with quick moves. */
  zoneList(zone, anchor, { search = false } = {}) {
    const g = this.game;
    const render = () => {
      let uids = [...g.zones[zone]];
      if (search) uids.sort((a, b) => g.card(a).name.localeCompare(g.card(b).name));
      else if (zone !== 'library') uids.reverse(); // Most recent first
      const filter = el.querySelector('input')?.value.trim().toLowerCase() || '';
      if (filter) uids = uids.filter((u) => g.card(u).name.toLowerCase().includes(filter));
      el.querySelector('.gf-list').innerHTML = uids.map((u) => `<li data-uid="${u}">
          <span class="gf-list-name">${escapeHtml(g.card(u).name)}</span>
          ${zone !== 'hand' ? `<button type="button" data-to="hand" title="To hand"><i class="ph ph-hand"></i></button>` : ''}
          ${zone !== 'battlefield' ? `<button type="button" data-to="battlefield" title="To battlefield"><i class="ph ph-squares-four"></i></button>` : ''}
          ${zone !== 'graveyard' ? `<button type="button" data-to="graveyard" title="To graveyard"><i class="ph ph-skull"></i></button>` : ''}
          ${zone !== 'exile' ? `<button type="button" data-to="exile" title="To exile"><i class="ph ph-prohibit"></i></button>` : ''}
          ${zone !== 'library' ? `<button type="button" data-to="library:top" title="On top of library"><i class="ph ph-arrow-line-up"></i></button>` : ''}
        </li>`).join('') || '<li class="muted">Nothing here</li>';
    };
    const el = document.createElement('div');
    el.className = 'gf-menu gf-zone-list';
    el.innerHTML = `<div class="gf-menu-title">${search ? 'Search your library' : ZONE_LABELS[zone]}</div>
      ${search || g.zones[zone].length > 8 ? '<input type="search" placeholder="Filter by name" aria-label="Filter by name">' : ''}
      <ul class="gf-list"></ul>
      ${search ? '<p class="muted gf-menu-note">The library is shuffled after you take a card.</p>' : ''}`;
    el.addEventListener('input', render);
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-to]');
      if (!btn) return;
      const uid = btn.closest('li').dataset.uid;
      this.moveTo(uid, btn.dataset.to);
      if (search) g.shuffleLibrary();
      // Reopen on the fresh anchor so several cards can be moved in a row
      const fresh = this.el.querySelector(`[data-gf${search ? '="search"' : `-view="${zone}"`}]`);
      if (fresh && g.zones[zone].length) this.zoneList(zone, fresh, { search });
    });
    render();
    this.openMenu(anchor, el);
    el.querySelector('input')?.focus();
  }

  /** Scry / surveil: look at the top N and choose where each goes. */
  scryMenu(anchor, count = 1) {
    const g = this.game;
    let order = g.peek(count).map((uid) => ({ uid, to: 'top' }));
    const el = document.createElement('div');
    el.className = 'gf-menu gf-scry';
    const render = () => {
      el.innerHTML = `<div class="gf-menu-title">Top of library
          <label class="gf-scry-count">Look at <input type="number" min="1" max="${Math.max(1, g.zones.library.length)}" value="${order.length}"></label></div>
        <ol class="gf-list">${order.map((d, i) => `<li data-i="${i}">
          <span class="gf-list-name">${escapeHtml(g.card(d.uid).name)}</span>
          ${i > 0 ? `<button type="button" data-up title="Move up"><i class="ph ph-arrow-up"></i></button>` : '<span class="gf-list-spacer"></span>'}
          <select aria-label="Where ${escapeHtml(g.card(d.uid).name)} goes">
            <option value="top"${d.to === 'top' ? ' selected' : ''}>Top</option>
            <option value="bottom"${d.to === 'bottom' ? ' selected' : ''}>Bottom</option>
            <option value="graveyard"${d.to === 'graveyard' ? ' selected' : ''}>Graveyard</option>
          </select></li>`).join('')}</ol>
        <div class="gf-menu-actions"><button type="button" class="btn btn-primary btn-sm" data-done>Done</button></div>`;
    };
    el.addEventListener('change', (e) => {
      if (e.target.matches('select')) order[Number(e.target.closest('li').dataset.i)].to = e.target.value;
      if (e.target.matches('.gf-scry-count input')) {
        const n = Math.max(1, Math.min(g.zones.library.length, Number(e.target.value) || 1));
        const keep = new Map(order.map((d) => [d.uid, d.to]));
        const top = g.peek(n);
        // Keep the reordering of cards already shown
        const shown = order.map((d) => d.uid).filter((u) => top.includes(u));
        order = [...shown, ...top.filter((u) => !shown.includes(u))].map((uid) => ({ uid, to: keep.get(uid) || 'top' }));
        render();
      }
    });
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-up]')) {
        const i = Number(e.target.closest('li').dataset.i);
        [order[i - 1], order[i]] = [order[i], order[i - 1]];
        render();
      } else if (e.target.closest('[data-done]')) {
        this.closeMenu();
        g.arrangeTop(order);
      }
    });
    render();
    this.openMenu(anchor, el);
  }

  // ---- Events ----

  onClick(e) {
    // Segmented toggles
    const segBtn = e.target.closest('[data-seg]');
    if (segBtn) {
      const v = segBtn.dataset.value;
      if (segBtn.dataset.seg === 'ma-draw') {
        this.analysisOnDraw = v === 'draw';
        writeJson('deckAnalysis', { onDraw: this.analysisOnDraw });
        this.renderAnalysis();
      } else if (segBtn.dataset.seg === 'odds-draw') {
        this.odds.onDraw = v === 'draw';
        this.saveOdds();
        this.el.querySelectorAll('[data-seg="odds-draw"]').forEach((b) => b.classList.toggle('active', b.dataset.value === v));
        this.renderOddsResult();
      } else if (segBtn.dataset.seg === 'gf-draw') {
        this.gameOnDraw = v === 'draw';
        this.newGame();
        this.renderPlaytest();
      }
      return;
    }

    if (this.view === 'analysis') return this.onAnalysisClick(e);
    if (this.view === 'playtest') return this.onPlaytestClick(e);
  }

  onAnalysisClick(e) {
    const preset = e.target.closest('[data-odds-preset]');
    if (preset) {
      const p = this.presets()[Number(preset.dataset.oddsPreset)];
      this.odds = { ...this.odds, goals: p.goals.map((g) => ({ ...g })), turn: p.turn, ...(p.onDraw !== undefined ? { onDraw: p.onDraw } : {}) };
      this.saveOdds();
      this.rerenderOdds();
      return;
    }
    if (e.target.closest('[data-goal-add]')) {
      this.odds.goals.push({ count: 1, kind: 'spell' });
      this.saveOdds();
      this.rerenderOdds();
      return;
    }
    const remove = e.target.closest('[data-goal-remove]');
    if (remove && this.odds.goals.length > 1) {
      this.odds.goals.splice(Number(remove.dataset.goalRemove), 1);
      this.saveOdds();
      this.rerenderOdds();
    }
  }

  /** Redraw the draw odds section only, so the mana base above keeps its state (an open <details>). */
  rerenderOdds() {
    const section = this.el.querySelector('[aria-labelledby="odds-title"]');
    if (!section) return this.renderAnalysis();
    section.innerHTML = this.oddsHtml();
    this.renderOddsResult();
  }

  onChange(e) {
    const t = e.target;
    if (this.view === 'analysis') {
      if (t.dataset.odds) {
        const key = t.dataset.odds;
        this.odds[key] = key === 'mulligan' ? t.value : Number(t.value);
        if (key === 'mulligan') this.el.querySelector('.odds-mull')?.classList.toggle('hidden', t.value === 'never');
        this.saveOdds();
        this.renderOddsResult();
      } else if (t.dataset.goal) {
        const goal = this.odds.goals[Number(t.dataset.i)];
        if (t.dataset.goal === 'kind') {
          goal.kind = t.value;
          goal.value = this.defaultGoalValue(t.value);
          this.saveOdds();
          this.el.querySelector('.odds-goals').innerHTML = this.goalsHtml();
          this.renderOddsResult();
          return;
        }
        goal[t.dataset.goal] = t.dataset.goal === 'count' || goal.kind === 'mv' || goal.kind === 'mvmax' ? Number(t.value) : t.value;
        this.saveOdds();
        this.renderOddsResult();
      }
    } else if (this.view === 'playtest' && t.matches('[data-gf-life]')) {
      this.game.setLife(t.value);
    }
  }

  onInput(e) {
    // Searches and numbers update as you type
    const t = e.target;
    if (this.view !== 'analysis' || !t.dataset.goal || t.dataset.goal === 'kind') return;
    clearTimeout(this.queryTimer);
    this.queryTimer = setTimeout(() => {
      const goal = this.odds.goals[Number(t.dataset.i)];
      if (!goal) return;
      goal[t.dataset.goal] = t.type === 'number' ? Number(t.value) : t.value;
      this.saveOdds();
      this.renderOddsResult();
    }, 200);
  }

  defaultGoalValue(kind) {
    if (kind === 'mv' || kind === 'mvmax') return 2;
    if (kind === 'source') return this.manaBase().colors[0]?.color || 'W';
    if (kind === 'card') return splitDeck(this.deck().cards).library.find((c) => !isLandDrop(c))?.name || '';
    if (kind === 'query') return 't:creature';
    return undefined;
  }

  onPlaytestClick(e) {
    const g = this.game;
    if (!g) return;
    const viewBtn = e.target.closest('[data-gf-view]');
    if (viewBtn) return this.zoneList(viewBtn.dataset.gfView, viewBtn);

    const action = e.target.closest('[data-gf]');
    if (action) {
      switch (action.dataset.gf) {
        case 'mulligan': this.bottomPick.clear(); g.mulligan(); break;
        case 'keep': this.keep(); break;
        case 'draw': g.phase === 'mulligan' ? showToast('Keep a hand first', 'warning', 1500) : g.draw(1); break;
        case 'next': g.nextTurn(); break;
        case 'untap': g.untapAll(); break;
        case 'undo': g.undo(); break;
        case 'shuffle': g.shuffleLibrary(); showToast('Library shuffled', 'success', 1200); break;
        case 'mill': g.mill(1); break;
        case 'scry': if (g.zones.library.length) this.scryMenu(action, 1); break;
        case 'search': this.zoneList('library', action, { search: true }); break;
        case 'life-down': g.adjustLife(-1); break;
        case 'life-up': g.adjustLife(1); break;
        case 'token': this.tokenMenu(action); break;
        case 'new': this.newGame(); this.renderPlaytest(); break;
        default: break;
      }
      return;
    }

    const cardEl = e.target.closest('.gf-card');
    if (!cardEl) return;
    const uid = cardEl.dataset.uid;
    const zone = g.zoneOf(uid);
    if (zone === 'hand' && g.phase === 'mulligan') {
      if (!g.bottomCount) return;
      if (this.bottomPick.has(uid)) this.bottomPick.delete(uid);
      else if (this.bottomPick.size < g.bottomCount) this.bottomPick.add(uid);
      this.renderPlaytest();
    } else if (zone === 'hand') {
      this.host.hidePreview?.();
      g.play(uid);
    } else if (zone === 'battlefield') {
      g.toggleTap(uid);
    } else if (zone === 'command') {
      this.host.hidePreview?.();
      g.move(uid, 'battlefield');
    } else {
      this.cardMenu(uid, cardEl);
    }
  }

  keep() {
    const g = this.game;
    if (!g.keep([...this.bottomPick])) {
      showToast(`Choose ${plural(g.bottomCount, 'card')} to put on the bottom`, 'warning', 2000);
      return;
    }
    this.bottomPick.clear();
  }

  tokenMenu(anchor) {
    const el = document.createElement('form');
    el.className = 'gf-menu gf-token-form';
    el.innerHTML = `<div class="gf-menu-title">Create a token</div>
      <input type="text" placeholder="1/1 Soldier" aria-label="Token name" value="">
      <div class="gf-menu-actions"><button type="submit" class="btn btn-primary btn-sm">Create</button></div>`;
    el.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = el.querySelector('input').value;
      this.closeMenu();
      this.game.createToken(name || 'Token');
    });
    this.openMenu(anchor, el);
    el.querySelector('input').focus();
  }

  onContextMenu(e) {
    if (this.view !== 'playtest' || !this.game) return;
    const cardEl = e.target.closest('.gf-card');
    if (!cardEl) return;
    e.preventDefault();
    this.host.hidePreview?.();
    this.cardMenu(cardEl.dataset.uid, cardEl);
  }

  onHover(e) {
    const cardEl = e.target.closest('.gf-card');
    if (!cardEl || !this.host.preview || matchMedia('(hover: none)').matches) return;
    const img = cardEl.querySelector('img');
    if (img?.src) this.host.preview(img.src, e);
  }

  onHoverEnd(e) {
    if (e.target.closest('.gf-card') && !e.relatedTarget?.closest?.('.gf-card')) this.host.hidePreview?.();
  }

  onDragStart(e) {
    const cardEl = e.target.closest?.('.gf-card');
    if (!cardEl || this.view !== 'playtest') return;
    this.host.hidePreview?.();
    e.dataTransfer.setData('text/x-goldfish-uid', cardEl.dataset.uid);
    e.dataTransfer.effectAllowed = 'move';
  }

  onDragOver(e) {
    const zone = e.target.closest?.('[data-drop]');
    if (!zone || !e.dataTransfer.types.includes('text/x-goldfish-uid')) return;
    e.preventDefault();
    this.el.querySelectorAll('.is-drop-target').forEach((z) => z !== zone && z.classList.remove('is-drop-target'));
    zone.classList.add('is-drop-target');
  }

  onDrop(e) {
    const zone = e.target.closest?.('[data-drop]');
    const uid = e.dataTransfer.getData('text/x-goldfish-uid');
    if (!zone || !uid || !this.game) return;
    e.preventDefault();
    zone.classList.remove('is-drop-target');
    const to = zone.dataset.drop;
    if (to === 'command' && !this.game.isCommander(uid)) {
      showToast('Only a commander can go to the command zone', 'warning', 1800);
      return;
    }
    if (this.game.zoneOf(uid) === to && to !== 'library') return;
    this.game.move(uid, to, to === 'library' ? { position: 'top' } : undefined);
  }

  onKey(e) {
    if (this.view !== 'playtest' || !this.game || this.el.classList.contains('hidden') || this.el.closest('.hidden')) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('.modal:not(.hidden)')) return;
    if (e.altKey) return;
    const g = this.game;
    const key = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && key === 'z') {
      e.preventDefault();
      g.undo();
      return;
    }
    if (e.metaKey || e.ctrlKey) return;
    const playing = g.phase === 'playing';
    const actions = {
      d: () => playing && g.draw(1),
      n: () => playing && g.nextTurn(),
      u: () => playing && g.untapAll(),
      z: () => g.undo(),
      m: () => !playing && g.zones.hand.length && (this.bottomPick.clear(), g.mulligan()),
      k: () => !playing && this.keep(),
    };
    if (actions[key]) {
      e.preventDefault();
      this.closeMenu();
      actions[key]();
    }
  }
}
