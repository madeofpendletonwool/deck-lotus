/**
 * The card detail modal: one card, its printings, your copies of it, and its rules.
 *
 * Layout: the card image and the selected printing's facts (prices, buy links, artist)
 * on the left; name, rules text and tabs on the right. Everything that changes after
 * opening (quantities, the selected printing, the active tab) re-renders only its own
 * section, so adding a copy doesn't reload the modal or lose your place.
 */
import api from '../services/api.js';
import { formatMana, showToast, popover } from '../utils/ui.js';
import { uniquePrintings, sortPrintings, printingMatches, formatPrice } from '../utils/printings.js';

const MODAL_ID = 'card-detail-modal';

// Layouts with a separately printed back face. Split, adventure and flip cards print
// both halves on the front, so there is nothing to flip to.
const FLIPPABLE_LAYOUTS = new Set(['transform', 'modal_dfc', 'meld', 'reversible_card', 'double_faced_token', 'art_series']);

const LEGALITY_FORMATS = [
  ['standard', 'Standard'], ['pioneer', 'Pioneer'], ['modern', 'Modern'], ['legacy', 'Legacy'],
  ['vintage', 'Vintage'], ['pauper', 'Pauper'], ['commander', 'Commander'], ['oathbreaker', 'Oathbreaker'],
  ['duel', 'Duel Commander'], ['paupercommander', 'Pauper Commander'], ['predh', 'PreDH'], ['brawl', 'Brawl'],
  ['standardbrawl', 'Standard Brawl'], ['historic', 'Historic'], ['timeless', 'Timeless'], ['alchemy', 'Alchemy'],
  ['explorer', 'Explorer'], ['penny', 'Penny Dreadful'], ['premodern', 'Premodern'], ['oldschool', 'Old School'],
  ['gladiator', 'Gladiator'], ['future', 'Future'],
];

const PRINT_SORTS = [
  ['date-desc', 'Newest'],
  ['date-asc', 'Oldest'],
  ['price-asc', 'Cheapest'],
  ['price-desc', 'Priciest'],
];

const BOARDS = [['mainboard', 'Main'], ['sideboard', 'Side'], ['maybeboard', 'Maybe']];

const RELATION_LABELS = { token: 'Token', reverseRelated: 'Created by', spellbook: 'Spellbook', meld: 'Melds with' };

let state = null;
let openSeq = 0;
let decksCache = null;
let lastBoard = 'mainboard';
let printSort = 'date-desc';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const small = (url) => (url ? url.replace('/normal/', '/small/') : '');
const backOf = (url) => (url ? url.replace('/front/', '/back/') : '');
const year = (date) => (date ? String(date).slice(0, 4) : '');
const plural = (n, word, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;

function parseJson(text) {
  if (!text) return null;
  try {
    return typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rules text
// ---------------------------------------------------------------------------

/** One {symbol} as a Mana font icon. */
function symbolHtml(raw) {
  const s = raw.toLowerCase();
  const named = { t: 'tap', q: 'untap', '½': 'half', '∞': 'infinity' };
  if (named[s]) return `<i class="ms ms-${named[s]} ms-cost"></i>`;
  const parts = s.split('/');
  const cls = parts.join('');
  const split = parts.length > 1 && !parts.includes('p') ? ' ms-split' : '';
  return `<i class="ms ms-${esc(cls)} ms-cost${split}"></i>`;
}

const withSymbols = (html) => html.replace(/\{([^}]+)\}/g, (_, sym) => symbolHtml(sym));

function lineHtml(line) {
  const html = withSymbols(esc(line));
  // Reminder text is the parenthesised part; it reads better quieter.
  return html.replace(/\(([^()]*)\)/g, '<span class="cd-reminder">($1)</span>');
}

/** Rules text for every face. Faces after the first start with "// Face name". */
function rulesHtml(card) {
  const text = (card.oracle_text || '').replace(/\\n/g, '\n');
  if (!text.trim()) return '';
  const faceNames = card.name.split(' // ');
  const faces = text.split(/\n\n(?=\/\/ )/).map((part, i) => {
    if (i === 0) return { name: faceNames[0], body: part };
    const [head, ...rest] = part.split('\n');
    return { name: head.replace(/^\/\/\s*/, ''), body: rest.join('\n') };
  });
  const multi = faces.length > 1;
  return faces.map((face) => `
    <div class="cd-face">
      ${multi ? `<div class="cd-face-name">${esc(face.name)}</div>` : ''}
      ${face.body.split('\n').filter((l) => l.trim()).map((l) => `<p>${lineHtml(l)}</p>`).join('')}
    </div>`).join('');
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function finishesOf(printing) {
  const list = String(printing.finishes || '').split(/[\s,]+/).filter(Boolean);
  if (list.length) return list;
  const known = [];
  if (printing.price_normal != null) known.push('nonfoil');
  if (printing.price_foil != null) known.push('foil');
  if (printing.price_etched != null) known.push('etched');
  return known.length ? known : ['nonfoil'];
}

function priceFor(printing, finish) {
  if (!printing) return null;
  if (finish === 'foil') return printing.price_foil ?? null;
  if (finish === 'etched') return printing.price_etched ?? null;
  return printing.price_normal ?? null;
}

const printingById = (id) => state.allPrintings.find((p) => p.id === id);

/** Copies you own of each printing id, across finishes. */
function ownedByPrinting() {
  const map = new Map();
  for (const op of state.ownership?.ownedPrintings || []) {
    map.set(op.printing_id, (map.get(op.printing_id) || 0) + op.quantity);
  }
  // A double-faced card's copies can sit on either face's row; count them on the row we show.
  for (const p of state.allPrintings) {
    const shown = state.printings.find((u) => u.set_code === p.set_code && u.collector_number === p.collector_number);
    if (shown && shown.id !== p.id && map.has(p.id)) {
      map.set(shown.id, (map.get(shown.id) || 0) + map.get(p.id));
      map.delete(p.id);
    }
  }
  return map;
}

function selectedPrinting() {
  return printingById(state.selectedId) || state.printings[0] || null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function modal() {
  let el = document.getElementById(MODAL_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = MODAL_ID;
    el.className = 'modal hidden';
    el.innerHTML = '<div class="modal-content cd-modal" role="dialog" aria-modal="true" aria-labelledby="cd-name"><button type="button" class="modal-close" aria-label="Close">&times;</button><div class="cd-root"></div></div>';
    document.body.appendChild(el);
    bindEvents(el);
  }
  return el;
}

const root = () => modal().querySelector('.cd-root');
const part = (name) => root().querySelector(`[data-part="${name}"]`);

function renderShell() {
  const { card } = state;
  const leadership = parseJson(card.leadership_skills);
  const canLead = leadership && (leadership.commander || leadership.oathbreaker || leadership.brawl);
  const range = priceRangeOf(state.printings);

  const facts = [
    `<span class="cd-fact"><span>MV</span>${Number(card.cmc || 0)}</span>`,
    card.power != null && card.toughness != null ? `<span class="cd-fact"><span>P/T</span>${esc(card.power)}/${esc(card.toughness)}</span>` : '',
    card.loyalty ? `<span class="cd-fact"><span>Loyalty</span>${esc(card.loyalty)}</span>` : '',
    range ? `<span class="cd-fact"><span>Price</span>${range.min === range.max ? formatPrice(range.min) : `${formatPrice(range.min)} – ${formatPrice(range.max)}`}</span>` : '',
    card.edhrec_rank ? `<a class="cd-fact cd-fact-link" href="${edhrecUrl(card)}" target="_blank" rel="noopener" title="Rank among EDHREC's most played cards"><span>EDHREC</span>#${Number(card.edhrec_rank).toLocaleString()}</a>` : '',
    canLead ? `<span class="cd-fact cd-fact-accent" title="${esc(leadTitle(leadership))}"><i class="ph-fill ph-crown-simple"></i>Can be your commander</span>` : '',
    card.is_reserved ? '<span class="cd-fact" title="Wizards has promised never to reprint this card"><i class="ph ph-lock-simple"></i>Reserved List</span>' : '',
  ].filter(Boolean).join('');

  root().innerHTML = `
    <div class="cd">
      <aside class="cd-aside">
        <div class="cd-image-frame" data-part="image"></div>
        <div class="cd-printing" data-part="printing"></div>
      </aside>
      <div class="cd-main">
        <header class="cd-head">
          <div class="cd-title-row">
            <h2 class="cd-name" id="cd-name">${esc(card.name)}</h2>
            ${card.mana_cost ? `<span class="cd-cost">${formatMana(card.mana_cost)}</span>` : ''}
          </div>
          <div class="cd-type">${esc(card.type_line || '')}</div>
          <div class="cd-facts">${facts}</div>
        </header>
        <div class="cd-actions">
          <button type="button" class="btn btn-primary btn-sm" data-action="add-to-deck"><i class="ph ph-plus"></i> Add to deck <i class="ph ph-caret-down"></i></button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="add-selected" title="Add one nonfoil copy of the printing shown"><i class="ph ph-archive"></i> Add to collection</button>
          <span class="spacer"></span>
          <a class="btn btn-ghost btn-sm" data-part="scryfall" href="${scryfallUrl(selectedPrinting(), card)}" target="_blank" rel="noopener">Scryfall <i class="ph ph-arrow-up-right"></i></a>
        </div>
        <div class="cd-text">
          ${rulesHtml(card) || '<p class="muted">This card has no rules text.</p>'}
          <div class="cd-flavor" data-part="flavor"></div>
        </div>
        <div class="cd-own" data-part="own"></div>
        <nav class="cd-tabs" role="tablist" data-part="tabs"></nav>
        <div class="cd-panel" data-part="panel" role="tabpanel"></div>
      </div>
    </div>`;

  renderImage();
  renderPrinting();
  renderOwnSummary();
  renderTabs();
  renderPanel();
}

function leadTitle(skills) {
  const formats = [skills.commander && 'Commander', skills.oathbreaker && 'Oathbreaker', skills.brawl && 'Brawl'].filter(Boolean);
  return `Legal as a commander in ${formats.join(', ')}`;
}

function priceRangeOf(printings) {
  const prices = printings.map((p) => p.price_normal ?? p.price_foil ?? p.price_etched).filter((v) => v != null && v > 0);
  return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null;
}

const edhrecUrl = (card) => `https://edhrec.com/cards/${encodeURIComponent(card.name.split(' // ')[0].toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-'))}`;

function scryfallUrl(printing, card) {
  if (printing?.set_code && printing.collector_number) {
    return `https://scryfall.com/card/${encodeURIComponent(printing.set_code.toLowerCase())}/${encodeURIComponent(printing.collector_number)}`;
  }
  return `https://scryfall.com/search?q=${encodeURIComponent(`!"${card.name}"`)}`;
}

function renderImage(previewPrinting = null) {
  const frame = part('image');
  if (!frame) return;
  const printing = previewPrinting || selectedPrinting();
  const flippable = FLIPPABLE_LAYOUTS.has(state.card.layout);
  if (!printing?.image_url) {
    frame.innerHTML = '<div class="cd-noimage"><i class="ph ph-image-broken"></i>No image</div>';
    return;
  }
  const src = state.flipped && flippable ? backOf(printing.image_url) : printing.image_url;
  const img = frame.querySelector('img');
  if (img) {
    if (img.getAttribute('src') !== src) img.src = src;
  } else {
    frame.innerHTML = `
      <img class="cd-image" src="${esc(src)}" alt="${esc(state.card.name)}">
      ${flippable ? '<button type="button" class="cd-flip" data-action="flip" title="Turn the card over" aria-label="Turn the card over"><i class="ph ph-arrows-clockwise"></i></button>' : ''}`;
    frame.querySelector('img').addEventListener('error', (e) => {
      e.target.replaceWith(Object.assign(document.createElement('div'), { className: 'cd-noimage', innerHTML: '<i class="ph ph-image-broken"></i>No image' }));
    }, { once: true });
  }
}

function renderPrinting() {
  const el = part('printing');
  if (!el) return;
  const p = selectedPrinting();
  if (!p) {
    el.innerHTML = '';
    return;
  }
  const finishes = finishesOf(p);
  const prices = [
    ['nonfoil', 'Normal'], ['foil', 'Foil'], ['etched', 'Etched'],
  ].filter(([f]) => finishes.includes(f) || priceFor(p, f) != null)
    .map(([f, label]) => {
      const price = priceFor(p, f);
      return `<div class="cd-price"><span>${label}</span><strong>${price != null ? formatPrice(price) : '—'}</strong></div>`;
    }).join('');

  const buy = [
    p.tcgplayer_url && ['TCGplayer', p.tcgplayer_url],
    p.cardkingdom_url && ['Card Kingdom', p.cardkingdom_url],
    p.cardmarket_url && ['Cardmarket', p.cardmarket_url],
    ['Mana Pool', `https://manapool.com/search?q=${encodeURIComponent(state.card.name)}`],
  ].filter(Boolean);

  el.innerHTML = `
    <div class="cd-print-title">${esc(p.set_name || (p.set_code || '').toUpperCase())}</div>
    <div class="cd-print-meta">
      ${esc((p.set_code || '').toUpperCase())} · #${esc(p.collector_number || '?')}
      ${p.rarity ? ` · <span class="cd-rarity" data-rarity="${esc(p.rarity.toLowerCase())}">${esc(cap(p.rarity))}</span>` : ''}
      ${year(p.set_release_date) ? ` · ${year(p.set_release_date)}` : ''}
    </div>
    <div class="cd-prices">${prices}</div>
    <div class="cd-buy">${buy.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${label}<i class="ph ph-arrow-up-right"></i></a>`).join('')}</div>
    ${p.artist ? `<div class="cd-artist"><i class="ph ph-paint-brush"></i> ${esc(p.artist)}</div>` : ''}
    ${state.printings.length > 1 ? `<button type="button" class="link-btn cd-other-prints" data-action="tab" data-tab="printings">${plural(state.printings.length, 'printing')} <i class="ph ph-caret-right"></i></button>` : ''}`;

  const flavor = part('flavor');
  if (flavor) flavor.innerHTML = p.flavor_text ? esc(p.flavor_text.replace(/\\n/g, '\n')).replace(/\n/g, '<br>') : '';
  const scry = part('scryfall');
  if (scry) scry.href = scryfallUrl(p, state.card);
}

function renderOwnSummary() {
  const el = part('own');
  if (!el) return;
  const o = state.ownership;
  if (!o) {
    el.innerHTML = '';
    return;
  }
  if (!o.totalOwned && !o.totalInDecks) {
    el.innerHTML = '<span class="cd-own-none"><i class="ph ph-circle-dashed"></i> Not in your collection</span>';
    return;
  }
  const free = o.totalOwned - o.totalInDecks;
  el.innerHTML = `
    <span class="cd-own-stat"><i class="ph-fill ph-check-circle"></i><strong>${o.totalOwned}</strong> owned</span>
    <span class="cd-own-stat"><strong>${o.totalInDecks}</strong> in ${plural(o.deckUsage.length, 'deck')}</span>
    <span class="cd-own-stat ${free < 0 ? 'is-short' : ''}" title="${free < 0 ? 'Your decks list more copies than you own' : 'Copies not in any deck'}">${free < 0 ? `<strong>${-free}</strong> short` : `<strong>${free}</strong> free`}</span>`;
}

function tabsList() {
  const { card, ownership } = state;
  const copies = (ownership?.ownedPrintings || []).reduce((n, op) => n + op.quantity, 0);
  return [
    ['collection', 'Collection', copies || null],
    ['printings', 'Printings', state.printings.length],
    ['legality', 'Legality', null],
    card.rulings?.length && ['rulings', 'Rulings', card.rulings.length],
    card.relatedCards?.length && ['related', 'Related', card.relatedCards.length],
    card.foreignData?.length && ['languages', 'Languages', card.foreignData.length],
  ].filter(Boolean);
}

function renderTabs() {
  const el = part('tabs');
  if (!el) return;
  el.innerHTML = tabsList().map(([id, label, count]) => `
    <button type="button" role="tab" class="cd-tab ${state.tab === id ? 'active' : ''}" aria-selected="${state.tab === id}" data-action="tab" data-tab="${id}">
      ${label}${count != null ? `<span class="cd-tab-count">${count}</span>` : ''}
    </button>`).join('');
}

function renderPanel() {
  const el = part('panel');
  if (!el) return;
  const renderers = {
    collection: collectionPanel,
    printings: printingsPanel,
    legality: legalityPanel,
    rulings: rulingsPanel,
    related: relatedPanel,
    languages: languagesPanel,
  };
  el.innerHTML = (renderers[state.tab] || collectionPanel)();
  if (state.tab === 'printings') {
    const input = el.querySelector('.cd-filter');
    if (input && state.focusFilter) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
  state.focusFilter = false;
}

function collectionPanel() {
  const o = state.ownership;
  const rows = o?.ownedPrintings || [];
  const copies = rows.length
    ? `<div class="cd-rows">${rows.map((op) => {
      const p = printingById(op.printing_id);
      const price = priceFor(p, op.finish);
      return `
        <div class="cd-row" data-printing-id="${op.printing_id}" data-finish="${op.finish}">
          <img class="cd-thumb" src="${esc(small(op.image_url))}" alt="" loading="lazy">
          <div class="cd-row-main" data-action="select" data-printing-id="${op.printing_id}">
            <div class="cd-row-title">${esc(op.set_name || op.set_code.toUpperCase())}${op.finish !== 'nonfoil' ? ` <span class="finish-badge finish-${op.finish}">${op.finish === 'etched' ? 'Etched' : 'Foil'}</span>` : ''}</div>
            <div class="cd-row-sub">${esc(op.set_code.toUpperCase())} #${esc(op.collector_number || '?')}${price != null ? ` · ${formatPrice(price)} each` : ''}</div>
          </div>
          <div class="cd-stepper" role="group" aria-label="Copies">
            <button type="button" data-action="dec" aria-label="Remove a copy"><i class="ph ph-minus"></i></button>
            <span>${op.quantity}</span>
            <button type="button" data-action="inc" aria-label="Add a copy"><i class="ph ph-plus"></i></button>
          </div>
          <button type="button" class="btn-icon cd-row-menu" data-action="copy-menu" title="More" aria-label="More"><i class="ph ph-dots-three-vertical"></i></button>
        </div>`;
    }).join('')}</div>`
    : `<div class="cd-empty">
        <p>You don't have this card yet.</p>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary btn-sm" data-action="add-selected"><i class="ph ph-plus"></i> Add the printing shown</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="tab" data-tab="printings">Choose a printing</button>
        </div>
      </div>`;

  const usage = o?.deckUsage || [];
  const decks = usage.length ? `
    <h4 class="cd-sub">In your decks</h4>
    <div class="cd-decks">${usage.map((d) => {
      const side = sumList(d.sideboard_quantities);
      const main = sumList(d.mainboard_quantities);
      const other = d.total_quantity - side - main;
      const where = [main && `${main} main`, side && `${side} side`, other > 0 && `${other} maybe`].filter(Boolean).join(', ');
      return `<a class="cd-deck" href="/decks/${d.id}" data-deck-link>
        <span class="cd-deck-name">${esc(d.name)}</span>
        <span class="cd-deck-meta">${esc(where)}</span>
      </a>`;
    }).join('')}</div>` : '';

  return copies + decks;
}

const sumList = (text) => String(text || '').split(',').reduce((n, v) => n + (Number(v) || 0), 0);

function printingsPanel() {
  const owned = ownedByPrinting();
  const move = state.moving;
  const list = sortPrintings(state.printings, printSort).filter((p) => printingMatches(p, state.printQuery || ''));
  return `
    ${move ? `<div class="cd-move-banner">
      <i class="ph ph-swap"></i>
      <span>Moving <strong>${plural(move.quantity, 'copy', 'copies')}</strong> from ${esc(move.fromLabel)}. Pick the printing they really are.</span>
      <button type="button" class="btn btn-ghost btn-sm" data-action="cancel-move">Cancel</button>
    </div>` : ''}
    <div class="cd-tools">
      <div class="cd-filter-wrap"><i class="ph ph-magnifying-glass"></i><input type="search" class="cd-filter" placeholder="Filter by set" value="${esc(state.printQuery || '')}" aria-label="Filter printings by set"></div>
      <div class="seg" role="group" aria-label="Sort printings">${PRINT_SORTS.map(([v, l]) => `<button type="button" class="seg-btn ${printSort === v ? 'active' : ''}" data-action="sort" data-sort="${v}">${l}</button>`).join('')}</div>
    </div>
    <div class="cd-rows cd-print-rows">
      ${list.length ? list.map((p) => printingRow(p, owned.get(p.id) || 0, move)).join('') : '<div class="cd-empty"><p>No printing matches that filter.</p></div>'}
    </div>`;
}

function printingRow(p, ownedCount, move) {
  const finishes = finishesOf(p);
  const normal = p.price_normal;
  const foil = p.price_foil ?? p.price_etched;
  const isSelected = p.id === selectedPrinting()?.id;
  const actions = move
    ? (move.fromId === p.id ? '<span class="cd-row-note">current</span>' : `<button type="button" class="btn btn-primary btn-sm" data-action="move-here" data-printing-id="${p.id}">Move here</button>`)
    : `
      <button type="button" class="btn-icon cd-add" data-action="add-printing" data-printing-id="${p.id}" data-finish="${finishes.includes('nonfoil') ? 'nonfoil' : finishes[0]}" title="Add a ${finishes.includes('nonfoil') ? 'nonfoil' : finishes[0]} copy" aria-label="Add a copy"><i class="ph ph-plus"></i></button>
      ${finishes.includes('nonfoil') && (finishes.includes('foil') || finishes.includes('etched')) ? `<button type="button" class="btn-icon cd-add cd-add-foil" data-action="add-printing" data-printing-id="${p.id}" data-finish="${finishes.includes('foil') ? 'foil' : 'etched'}" title="Add a ${finishes.includes('foil') ? 'foil' : 'etched'} copy" aria-label="Add a foil copy"><i class="ph ph-sparkle"></i></button>` : ''}`;
  return `
    <div class="cd-row cd-print-row ${isSelected ? 'is-selected' : ''}" data-action="select" data-printing-id="${p.id}">
      <img class="cd-thumb" src="${esc(small(p.image_url))}" alt="" loading="lazy">
      <div class="cd-row-main">
        <div class="cd-row-title">${esc(p.set_name || p.set_code.toUpperCase())}</div>
        <div class="cd-row-sub">
          ${esc(p.set_code.toUpperCase())} #${esc(p.collector_number || '?')}
          ${p.rarity ? ` · <span class="cd-rarity" data-rarity="${esc(p.rarity.toLowerCase())}">${esc(cap(p.rarity))}</span>` : ''}
          ${year(p.set_release_date) ? ` · ${year(p.set_release_date)}` : ''}
        </div>
      </div>
      <div class="cd-row-price">
        ${normal != null ? `<strong>${formatPrice(normal)}</strong>` : (foil == null ? '<span class="muted">—</span>' : '')}
        ${foil != null ? `<small>${normal != null ? 'Foil ' : ''}${formatPrice(foil)}${normal == null ? ' foil' : ''}</small>` : ''}
      </div>
      <div class="cd-row-owned">${ownedCount ? `<span class="cd-owned-pill" title="Copies you own">${ownedCount}</span>` : ''}</div>
      <div class="cd-row-actions">${actions}</div>
    </div>`;
}

function legalityPanel() {
  const legalities = parseJson(state.card.legalities);
  if (!legalities) return '<div class="cd-empty"><p>No legality data for this card.</p></div>';
  const leadership = parseJson(state.card.leadership_skills);
  const items = LEGALITY_FORMATS.filter(([key]) => key in legalities).map(([key, label]) => {
    const status = legalities[key] && legalities[key] !== 'null' ? legalities[key] : 'Not Legal';
    const slug = status.toLowerCase().replace(/\s+/g, '-');
    return `<div class="cd-legal" data-status="${esc(slug)}"><span class="cd-legal-dot"></span><span class="cd-legal-name">${label}</span><span class="cd-legal-status">${esc(status === 'Not Legal' ? 'Not legal' : status)}</span></div>`;
  }).join('');
  return `
    ${leadership && (leadership.commander || leadership.oathbreaker || leadership.brawl) ? `<p class="cd-note"><i class="ph-fill ph-crown-simple"></i> ${esc(leadTitle(leadership))}.</p>` : ''}
    <div class="cd-legal-grid">${items}</div>`;
}

function rulingsPanel() {
  return `<ol class="cd-rulings">${state.card.rulings.map((r) => `
    <li><time>${esc(r.date)}</time><p>${lineHtml(r.text)}</p></li>`).join('')}</ol>`;
}

function relatedPanel() {
  return `<div class="cd-related">${state.card.relatedCards.map((r) => `
    <button type="button" class="cd-related-item" data-action="open-related" data-name="${esc(r.related_name)}">
      <span>${esc(r.related_name)}</span>
      <span class="cd-related-kind">${esc(RELATION_LABELS[r.relation_type] || cap(r.relation_type))}</span>
    </button>`).join('')}</div>`;
}

function languagesPanel() {
  return `<div class="cd-langs">${state.card.foreignData.map((f) => `
    <details class="cd-lang">
      <summary><span class="cd-lang-code">${esc(f.language)}</span><span>${esc(f.foreign_name || '')}</span></summary>
      ${f.foreign_type ? `<div class="cd-lang-type">${esc(f.foreign_type)}</div>` : ''}
      ${f.foreign_text ? `<div class="cd-lang-text">${withSymbols(esc(f.foreign_text)).replace(/\n/g, '<br>')}</div>` : ''}
      ${f.foreign_flavor_text ? `<div class="cd-lang-flavor">${esc(f.foreign_flavor_text)}</div>` : ''}
    </details>`).join('')}</div>`;
}

function rerenderPrintingsList() {
  // Re-render only the rows, so the filter input keeps focus while typing.
  const rowsEl = part('panel')?.querySelector('.cd-print-rows');
  if (!rowsEl) return renderPanel();
  const owned = ownedByPrinting();
  const list = sortPrintings(state.printings, printSort).filter((p) => printingMatches(p, state.printQuery || ''));
  rowsEl.innerHTML = list.length ? list.map((p) => printingRow(p, owned.get(p.id) || 0, state.moving)).join('') : '<div class="cd-empty"><p>No printing matches that filter.</p></div>';
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function setBusy(on) {
  root().classList.toggle('is-busy', on);
}

async function refreshOwnership() {
  const cardId = state.card.id;
  const ownership = await api.getCardOwnershipAndUsage(cardId);
  if (!state || state.card.id !== cardId) return;
  state.ownership = ownership;
  renderOwnSummary();
  renderTabs();
  renderPanel();
  window.dispatchEvent(new CustomEvent('card-ownership-changed', { detail: { cardId, owned: ownership.totalOwned > 0 } }));
}

async function setQuantity(printingId, finish, quantity) {
  setBusy(true);
  try {
    await api.setOwnedPrintingQuantity(printingId, Math.max(0, quantity), finish);
    await refreshOwnership();
  } catch (error) {
    showToast(`Couldn't update your collection: ${error.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

const ownedQty = (printingId, finish) => state.ownership?.ownedPrintings.find((op) => op.printing_id === printingId && op.finish === finish)?.quantity || 0;

async function addCopy(printingId, finish = 'nonfoil') {
  const p = printingById(printingId);
  await setQuantity(printingId, finish, ownedQty(printingId, finish) + 1);
  showToast(`Added ${finish === 'nonfoil' ? 'a copy' : `a ${finish} copy`} from ${p?.set_code?.toUpperCase() || 'that set'}`, 'success', 1800);
}

/** Move copies from one printing or finish to another, keeping any already there. */
async function moveCopies(from, to) {
  setBusy(true);
  try {
    const target = ownedQty(to.printingId, to.finish);
    await api.setOwnedPrintingQuantity(from.printingId, 0, from.finish);
    await api.setOwnedPrintingQuantity(to.printingId, target + from.quantity, to.finish);
    await refreshOwnership();
    return true;
  } catch (error) {
    showToast(`Couldn't move those copies: ${error.message}`, 'error');
    return false;
  } finally {
    setBusy(false);
  }
}

function selectPrinting(id) {
  if (!printingById(id)) return;
  state.selectedId = id;
  state.flipped = false;
  renderImage();
  renderPrinting();
  root().querySelectorAll('.cd-print-row').forEach((row) => row.classList.toggle('is-selected', Number(row.dataset.printingId) === id));
}

function flip() {
  const img = part('image')?.querySelector('img');
  state.flipped = !state.flipped;
  if (!img) return renderImage();
  img.classList.add('is-turning');
  setTimeout(() => {
    renderImage();
    img.classList.remove('is-turning');
  }, 180);
}

async function openDeckMenu(anchor) {
  const content = document.createElement('div');
  content.className = 'cd-deck-menu';
  content.innerHTML = '<div class="cd-menu-loading muted">Loading decks…</div>';
  const pop = popover(anchor, content);
  pop.el.style.zIndex = 'calc(var(--z-modal) + 1)';
  try {
    if (!decksCache) decksCache = (await api.getDecks()).decks || [];
  } catch {
    content.innerHTML = '<div class="cd-menu-loading">Couldn\'t load your decks.</div>';
    return;
  }
  if (!decksCache.length) {
    content.innerHTML = '<div class="cd-menu-loading">You have no decks yet.</div>';
    return;
  }
  const printing = selectedPrinting();
  const draw = (query = '') => {
    const q = query.trim().toLowerCase();
    const list = decksCache.filter((d) => !q || d.name.toLowerCase().includes(q));
    content.querySelector('.cd-menu-list').innerHTML = list.length
      ? list.map((d) => `<button type="button" class="cd-menu-item" data-deck-id="${d.id}"><span>${esc(d.name)}</span>${d.format ? `<span class="muted">${esc(d.format)}</span>` : ''}</button>`).join('')
      : '<div class="cd-menu-loading muted">No deck matches.</div>';
  };
  content.innerHTML = `
    <div class="cd-menu-head">
      <span class="muted">${esc((printing?.set_code || '').toUpperCase())} #${esc(printing?.collector_number || '?')} to</span>
      <div class="seg">${BOARDS.map(([v, l]) => `<button type="button" class="seg-btn ${lastBoard === v ? 'active' : ''}" data-board="${v}">${l}</button>`).join('')}</div>
    </div>
    ${decksCache.length > 6 ? '<input type="search" class="cd-menu-search" placeholder="Find a deck" aria-label="Find a deck">' : ''}
    <div class="cd-menu-list"></div>`;
  draw();
  content.querySelector('.cd-menu-search')?.focus();
  content.querySelector('.cd-menu-search')?.addEventListener('input', (e) => draw(e.target.value));
  content.addEventListener('click', async (e) => {
    const board = e.target.closest('[data-board]');
    if (board) {
      lastBoard = board.dataset.board;
      content.querySelectorAll('[data-board]').forEach((b) => b.classList.toggle('active', b === board));
      return;
    }
    const item = e.target.closest('[data-deck-id]');
    if (!item || !printing) return;
    const deck = decksCache.find((d) => String(d.id) === item.dataset.deckId);
    pop.close();
    try {
      await api.addCardToDeck(deck.id, printing.id, 1, lastBoard === 'sideboard', false, lastBoard);
      showToast(`Added to ${deck.name}${lastBoard !== 'mainboard' ? ` (${lastBoard})` : ''}`, 'success', 2000);
      await refreshOwnership();
    } catch (error) {
      showToast(`Couldn't add it: ${error.message}`, 'error');
    }
  });
}

function openCopyMenu(anchor, printingId, finish) {
  const op = state.ownership.ownedPrintings.find((o) => o.printing_id === printingId && o.finish === finish);
  if (!op) return;
  const p = printingById(printingId);
  const canFoil = p ? finishesOf(p) : ['nonfoil', 'foil'];
  const otherFinishes = ['nonfoil', 'foil', 'etched'].filter((f) => f !== finish && (canFoil.includes(f) || f === 'nonfoil' || f === 'foil'));
  const content = document.createElement('div');
  content.className = 'cd-copy-menu';
  content.innerHTML = `
    ${otherFinishes.map((f) => `<button type="button" class="cd-menu-item" data-act="finish" data-finish="${f}"><i class="ph ${f === 'nonfoil' ? 'ph-circle' : 'ph-sparkle'}"></i> Mark as ${f}</button>`).join('')}
    <button type="button" class="cd-menu-item" data-act="move"><i class="ph ph-swap"></i> Change printing…</button>
    <button type="button" class="cd-menu-item cd-menu-danger" data-act="remove"><i class="ph ph-trash"></i> Remove ${op.quantity === 1 ? 'this copy' : `all ${op.quantity}`}</button>`;
  const pop = popover(anchor, content, { align: 'right' });
  pop.el.style.zIndex = 'calc(var(--z-modal) + 1)';
  content.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    pop.close();
    if (btn.dataset.act === 'finish') {
      const to = btn.dataset.finish;
      if (await moveCopies({ printingId, finish, quantity: op.quantity }, { printingId, finish: to })) {
        showToast(`Marked as ${to}`, 'success', 1800);
      }
    } else if (btn.dataset.act === 'move') {
      state.moving = { fromId: printingId, finish, quantity: op.quantity, fromLabel: `${op.set_code.toUpperCase()} #${op.collector_number || '?'}` };
      state.tab = 'printings';
      renderTabs();
      renderPanel();
    } else if (btn.dataset.act === 'remove') {
      await setQuantity(printingId, finish, 0);
    }
  });
}

async function openRelated(name) {
  try {
    const { card } = await api.getCardByName(name);
    if (card?.id) showCardDetail(card.id);
  } catch {
    showToast(`${name} isn't in the card database`, 'info');
  }
}

function bindEvents(el) {
  el.addEventListener('click', async (e) => {
    if (!state) return;
    const deckLink = e.target.closest('[data-deck-link]');
    if (deckLink) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      el.classList.add('hidden');
      window.dispatchEvent(new CustomEvent('navigate', { detail: { path: deckLink.getAttribute('href') } }));
      return;
    }
    const target = e.target.closest('[data-action]');
    if (!target || root().classList.contains('is-busy')) return;
    const action = target.dataset.action;
    const row = target.closest('.cd-row');
    const rowPrinting = row ? Number(row.dataset.printingId) : null;

    switch (action) {
      case 'tab':
        state.tab = target.dataset.tab;
        renderTabs();
        renderPanel();
        break;
      case 'select':
        selectPrinting(Number(target.dataset.printingId));
        break;
      case 'sort':
        printSort = target.dataset.sort;
        target.parentElement.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === target));
        rerenderPrintingsList();
        break;
      case 'flip':
        flip();
        break;
      case 'add-to-deck':
        openDeckMenu(target);
        break;
      case 'add-selected': {
        const p = selectedPrinting();
        if (p) await addCopy(p.id, finishesOf(p).includes('nonfoil') ? 'nonfoil' : finishesOf(p)[0]);
        break;
      }
      case 'add-printing':
        await addCopy(Number(target.dataset.printingId), target.dataset.finish);
        break;
      case 'inc':
        await setQuantity(rowPrinting, row.dataset.finish, ownedQty(rowPrinting, row.dataset.finish) + 1);
        break;
      case 'dec':
        await setQuantity(rowPrinting, row.dataset.finish, ownedQty(rowPrinting, row.dataset.finish) - 1);
        break;
      case 'copy-menu':
        openCopyMenu(target, rowPrinting, row.dataset.finish);
        break;
      case 'move-here': {
        const move = state.moving;
        const to = Number(target.dataset.printingId);
        const toPrinting = printingById(to);
        const finish = toPrinting && !finishesOf(toPrinting).includes(move.finish) ? finishesOf(toPrinting)[0] : move.finish;
        state.moving = null;
        if (await moveCopies({ printingId: move.fromId, finish: move.finish, quantity: move.quantity }, { printingId: to, finish })) {
          showToast(`Moved to ${toPrinting?.set_code?.toUpperCase() || 'that printing'}`, 'success', 1800);
          state.tab = 'collection';
          renderTabs();
          renderPanel();
        }
        break;
      }
      case 'cancel-move':
        state.moving = null;
        state.tab = 'collection';
        renderTabs();
        renderPanel();
        break;
      case 'open-related':
        openRelated(target.dataset.name);
        break;
      default:
        break;
    }
  });

  el.addEventListener('input', (e) => {
    if (!state || !e.target.classList.contains('cd-filter')) return;
    state.printQuery = e.target.value;
    rerenderPrintingsList();
  });

  // Hovering a printing previews it on the big image; leaving the list puts the selection back.
  el.addEventListener('mouseover', (e) => {
    if (!state) return;
    const row = e.target.closest('.cd-row[data-printing-id]');
    if (!row) return;
    const p = printingById(Number(row.dataset.printingId));
    if (p && p.id !== state.previewId) {
      state.previewId = p.id;
      renderImage(p);
    }
  });
  el.addEventListener('mouseout', (e) => {
    if (!state || !state.previewId) return;
    const leftRows = e.target.closest('.cd-rows') && !e.relatedTarget?.closest?.('.cd-rows');
    if (leftRows) {
      state.previewId = null;
      renderImage();
    }
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Open the detail modal for a card.
 * @param {number} cardId
 * @param {{ tab?: string }} options
 */
export async function showCardDetail(cardId, { tab } = {}) {
  const seq = ++openSeq;
  const el = modal();
  // Only show a placeholder if the card takes a moment, so quick loads don't flash.
  const placeholder = setTimeout(() => {
    if (seq !== openSeq) return;
    root().innerHTML = '<div class="cd-loading"><div class="spinner"></div></div>';
    el.classList.remove('hidden');
  }, 120);

  try {
    const [cardResult, ownership] = await Promise.all([
      api.getCard(cardId),
      api.getCardOwnershipAndUsage(cardId).catch(() => null),
    ]);
    clearTimeout(placeholder);
    if (seq !== openSeq) return;
    const card = cardResult.card;
    const allPrintings = card.printings || [];
    const ownedIds = new Set((ownership?.ownedPrintings || []).map((op) => op.printing_id));
    const printings = uniquePrintings(allPrintings);
    // Show the printing you own the most of, else the default (cheapest) printing.
    const mostOwned = [...(ownership?.ownedPrintings || [])].sort((a, b) => b.quantity - a.quantity)[0];
    state = {
      card,
      allPrintings,
      printings,
      ownership,
      selectedId: mostOwned?.printing_id ?? printings[0]?.id ?? null,
      tab: tab || (ownedIds.size ? 'collection' : 'printings'),
      flipped: false,
      printQuery: '',
      moving: null,
      previewId: null,
    };
    renderShell();
    el.classList.remove('hidden');
    el.querySelector('.modal-content').scrollTop = 0;
  } catch (error) {
    clearTimeout(placeholder);
    if (seq !== openSeq) return;
    el.classList.add('hidden');
    console.error('Failed to load card details:', error);
    showToast(`Couldn't load that card: ${error.message}`, 'error');
  }
}
