/**
 * A deck measured against the cards you own.
 *
 * Ownership is counted per card, across every printing you own: a deck that calls for an Alpha Sol
 * Ring is satisfied by the Commander Masters one in your binder. Deck demand is the mainboard,
 * sideboard and commanders; maybeboards aren't built, so they don't claim copies.
 *
 * Basic lands are left out of every count. Few people log them and everyone has a pile of them.
 *
 * Shared by the server (which builds the reports) and its tests.
 */
import { isBasicLand, colorIdentityOf, legalityStatus } from './formats.js';

export const boardOf = (c) => c.board_type || (c.is_sideboard ? 'sideboard' : 'mainboard');
export const claimsCopies = (c) => boardOf(c) !== 'maybeboard';

/**
 * What a deck asks for, one entry per card: { card_id, name, quantity, priced, value, ... }.
 * `value` sums quantity × price over the rows that have a price, so a card listed in two printings
 * gets their weighted average.
 */
export function deckDemand(rows) {
  const byCard = new Map();
  for (const row of rows || []) {
    if (!claimsCopies(row)) continue;
    const qty = Number(row.quantity) || 0;
    if (qty <= 0) continue;
    let entry = byCard.get(row.card_id);
    if (!entry) {
      entry = {
        card_id: row.card_id,
        name: row.name,
        type_line: row.type_line,
        mana_cost: row.mana_cost,
        cmc: row.cmc,
        image_url: row.image_url,
        is_commander: false,
        quantity: 0,
        pricedQty: 0,
        value: 0,
      };
      byCard.set(row.card_id, entry);
    }
    entry.quantity += qty;
    if (row.is_commander) entry.is_commander = true;
    if (!entry.image_url && row.image_url) entry.image_url = row.image_url;
    const price = Number(row.price);
    if (row.price != null && Number.isFinite(price)) {
      entry.pricedQty += qty;
      entry.value += qty * price;
    }
  }
  return byCard;
}

/**
 * Status of one card in a deck against your collection:
 *   'owned'   you own enough and no other deck wants those copies
 *   'shared'  you own enough for this deck, but not for every deck that lists it
 *   'partial' you own some, not enough for this deck alone
 *   'missing' you own none
 */
export function cardStatus({ need, owned, otherDemand }) {
  if (owned <= 0) return 'missing';
  if (owned < need) return 'partial';
  return otherDemand > 0 && need + otherDemand > owned ? 'shared' : 'owned';
}

const money = (n) => Math.round(n * 100) / 100;

/**
 * The full report for a deck.
 *
 * @param rows        the deck's cards, each with card_id, quantity, board_type, price (its printing's)
 * @param owned       Map card_id → copies you own
 * @param otherDecks  rows of { deck_id, deck_name, format, card_id, quantity }, for your other decks
 * @param cheapest    Map card_id → price of the card's cheapest playable printing
 */
export function collectionReport({ rows, owned = new Map(), otherDecks = [], cheapest = new Map() }) {
  const demand = deckDemand(rows);

  const others = new Map(); // card_id → [{ deck_id, name, format, quantity }]
  for (const r of otherDecks) {
    if (!demand.has(r.card_id)) continue;
    const qty = Number(r.quantity) || 0;
    if (qty <= 0) continue;
    if (!others.has(r.card_id)) others.set(r.card_id, []);
    others.get(r.card_id).push({ deck_id: r.deck_id, name: r.deck_name, format: r.format || null, quantity: qty });
  }

  const summary = {
    cards: 0,
    copies: 0,
    ownedCards: 0, // cards you own enough of for this deck
    ownedCopies: 0,
    missingCards: 0,
    missingCopies: 0,
    sharedCards: 0, // owned, but other decks claim the same copies
    alongsideCopies: 0, // copies to buy so no other deck gives anything up
    basics: 0,
    cost: 0, // missingCopies at the deck's printings (cheapest printing when the deck's has no price)
    cheapestCost: 0, // missingCopies at each card's cheapest printing
    alongsideCost: 0,
    unpriced: 0, // missing cards with no price at all
  };

  const cards = [];
  for (const entry of demand.values()) {
    if (isBasicLand(entry)) {
      summary.basics += entry.quantity;
      continue;
    }
    const need = entry.quantity;
    const have = Math.max(0, Number(owned.get(entry.card_id)) || 0);
    const otherList = (others.get(entry.card_id) || []).sort((a, b) => b.quantity - a.quantity || String(a.name).localeCompare(String(b.name)));
    const otherDemand = otherList.reduce((s, d) => s + d.quantity, 0);
    const missing = Math.max(0, need - have);
    // If every other deck keeps its copies, how many are left for this one?
    const spare = Math.max(0, have - otherDemand);
    const alongside = Math.max(0, need - spare);

    const cheapestEach = cheapest.has(entry.card_id) && cheapest.get(entry.card_id) != null ? Number(cheapest.get(entry.card_id)) : null;
    const deckEach = entry.pricedQty ? entry.value / entry.pricedQty : null;
    const priceEach = deckEach ?? cheapestEach;

    const status = cardStatus({ need, owned: have, otherDemand });
    cards.push({
      card_id: entry.card_id,
      name: entry.name,
      type_line: entry.type_line,
      mana_cost: entry.mana_cost,
      cmc: entry.cmc,
      image_url: entry.image_url,
      is_commander: entry.is_commander,
      need,
      owned: have,
      missing,
      alongside,
      status,
      price_each: priceEach == null ? null : money(priceEach),
      cheapest_each: cheapestEach == null ? null : money(cheapestEach),
      other_decks: otherList,
      other_demand: otherDemand,
    });

    summary.cards += 1;
    summary.copies += need;
    summary.ownedCopies += Math.min(need, have);
    summary.missingCopies += missing;
    summary.alongsideCopies += alongside;
    if (missing === 0) summary.ownedCards += 1;
    else summary.missingCards += 1;
    if (status === 'shared') summary.sharedCards += 1;
    if (missing > 0) {
      if (priceEach == null) summary.unpriced += 1;
      else summary.cost += missing * priceEach;
      summary.cheapestCost += missing * (cheapestEach ?? priceEach ?? 0);
    }
    if (alongside > 0) summary.alongsideCost += alongside * (priceEach ?? 0);
  }

  summary.cost = money(summary.cost);
  summary.cheapestCost = money(summary.cheapestCost);
  summary.alongsideCost = money(summary.alongsideCost);

  const order = { missing: 0, partial: 1, shared: 2, owned: 3 };
  cards.sort((a, b) => order[a.status] - order[b.status] || String(a.name).localeCompare(String(b.name)));
  return { summary, cards };
}

/**
 * Deck rows cut down to the copies you don't own, for a shopping list. Rows carry `owned_quantity`
 * (copies of the card owned, any printing), as the deck endpoint returns them. Owned copies are
 * used up by rows in the order given, so pass mainboard rows first. Basic lands and maybeboard
 * rows are left out.
 */
export function missingRows(rows) {
  const left = new Map();
  const out = [];
  for (const row of rows || []) {
    if (!claimsCopies(row) || isBasicLand(row)) continue;
    if (!left.has(row.card_id)) left.set(row.card_id, Math.max(0, Number(row.owned_quantity) || 0));
    const qty = Number(row.quantity) || 0;
    const covered = Math.min(qty, left.get(row.card_id));
    left.set(row.card_id, left.get(row.card_id) - covered);
    if (qty - covered > 0) out.push({ ...row, quantity: qty - covered });
  }
  return out;
}

/**
 * Cards your decks are fighting over: listed (outside maybeboards) by two or more decks that,
 * between them, want more copies than you own. Cards you own none of aren't contested, just missing.
 *
 * @param usage  rows of { card_id, name, type_line, image_url, deck_id, deck_name, format, quantity }
 * @param owned  Map card_id → copies you own
 */
export function contestedCards(usage, owned) {
  const byCard = new Map();
  for (const r of usage || []) {
    const qty = Number(r.quantity) || 0;
    if (qty <= 0 || isBasicLand(r)) continue;
    let entry = byCard.get(r.card_id);
    if (!entry) {
      entry = { card_id: r.card_id, name: r.name, type_line: r.type_line, image_url: r.image_url, demand: 0, decks: [] };
      byCard.set(r.card_id, entry);
    }
    if (!entry.image_url && r.image_url) entry.image_url = r.image_url;
    const existing = entry.decks.find((d) => d.deck_id === r.deck_id);
    if (existing) existing.quantity += qty;
    else entry.decks.push({ deck_id: r.deck_id, name: r.deck_name, format: r.format || null, quantity: qty });
    entry.demand += qty;
  }

  const result = [];
  for (const entry of byCard.values()) {
    const have = Number(owned.get(entry.card_id)) || 0;
    if (have <= 0 || entry.decks.length < 2 || entry.demand <= have) continue;
    entry.decks.sort((a, b) => b.quantity - a.quantity || String(a.name).localeCompare(String(b.name)));
    result.push({ ...entry, owned: have, short: entry.demand - have });
  }
  result.sort((a, b) => b.short - a.short || b.decks.length - a.decks.length || String(a.name).localeCompare(String(b.name)));
  return result;
}

// ---- What in your binder fits a deck ------------------------------------------------------------

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];

/**
 * The colors a deck may use. Commander decks take their commanders' color identity; other decks
 * take the identity of what's in them so far. `colors` is null when there's nothing to go on.
 */
export function deckIdentity(rows, rules) {
  const main = (rows || []).filter(claimsCopies);
  if (rules?.commander) {
    const commanders = main.filter((r) => r.is_commander);
    if (!commanders.length) return { colors: null, source: 'no-commander', names: [] };
    const colors = new Set(commanders.flatMap((c) => colorIdentityOf(c)));
    return { colors: COLOR_ORDER.filter((c) => colors.has(c)), source: 'commander', names: [...new Set(commanders.map((c) => c.name))] };
  }
  const cards = main.filter((r) => !isBasicLand(r));
  if (!cards.length) return { colors: null, source: 'empty', names: [] };
  const colors = new Set(cards.flatMap((c) => colorIdentityOf(c)));
  return { colors: COLOR_ORDER.filter((c) => colors.has(c)), source: 'deck', names: [] };
}

export const CARD_TYPES = ['creature', 'planeswalker', 'battle', 'land', 'instant', 'sorcery', 'artifact', 'enchantment'];

/** A card's main type, for grouping: Artifact Creature is a creature, Artifact Land a land. */
export function primaryType(card) {
  const front = String(card.type_line || '').split(' // ')[0].toLowerCase();
  return CARD_TYPES.find((t) => front.includes(t)) || 'other';
}

/** Is a card allowed by the format? Restricted counts, as does a card with no legality data. */
export function allowedIn(card, rules) {
  if (!rules?.legality) return true;
  const status = legalityStatus(card, rules.legality);
  return status === undefined || status === 'Legal' || status === 'Restricted';
}

export function fitsIdentity(card, colors) {
  if (!colors) return true;
  const allowed = new Set(colors);
  return colorIdentityOf(card).every((c) => allowed.has(c));
}

/**
 * Owned cards that could go in a deck: in its colors, legal in its format, not already in it.
 *
 * @param owned  one entry per card you own: { card_id, name, type_line, color_identity, legalities,
 *               oracle_text, cmc, edhrec_rank, owned, ... }
 * @param used   Map card_id → copies your decks (this one included) already claim
 * @param inDeck Set of card_ids this deck already plays; `inMaybe` its maybeboard's
 */
export function binderFits(owned, {
  rules = null,
  colors = null,
  used = new Map(),
  inDeck = new Set(),
  inMaybe = new Set(),
  q = '',
  type = '',
  freeOnly = false,
  sort = 'name',
  offset = 0,
  limit = 60,
} = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const fits = [];
  for (const card of owned || []) {
    if (inDeck.has(card.card_id) || isBasicLand(card)) continue;
    if (!fitsIdentity(card, colors) || !allowedIn(card, rules)) continue;
    const free = Math.max(0, (Number(card.owned) || 0) - (Number(used.get(card.card_id)) || 0));
    fits.push({ ...card, free, in_decks: Number(used.get(card.card_id)) || 0, in_maybeboard: inMaybe.has(card.card_id), type: primaryType(card) });
  }

  // Counts per type before the type and text filters, so the type chips can show them
  const filtered = fits.filter((c) => {
    if (freeOnly && c.free <= 0) return false;
    if (!needle) return true;
    return String(c.name).toLowerCase().includes(needle) ||
      String(c.type_line || '').toLowerCase().includes(needle) ||
      String(c.oracle_text || '').toLowerCase().includes(needle);
  });
  const typeCounts = {};
  for (const c of filtered) typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;

  const shown = type ? filtered.filter((c) => c.type === type) : filtered;
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const rank = (c) => (c.edhrec_rank == null ? Infinity : Number(c.edhrec_rank));
  const sorters = {
    name: byName,
    rank: (a, b) => rank(a) - rank(b) || byName(a, b),
    mv: (a, b) => (Number(a.cmc) || 0) - (Number(b.cmc) || 0) || byName(a, b),
    free: (a, b) => b.free - a.free || byName(a, b),
  };
  shown.sort(sorters[sort] || byName);

  const start = Math.max(0, Number(offset) || 0);
  const size = Math.min(200, Math.max(1, Number(limit) || 60));
  return {
    total: shown.length,
    fitting: fits.length,
    typeCounts,
    cards: shown.slice(start, start + size).map(({ legalities, oracle_text, ...rest }) => rest),
  };
}
