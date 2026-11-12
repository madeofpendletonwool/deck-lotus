/**
 * Decks measured against the user's own collection: how much of a deck they own and what the rest
 * costs, which of their cards fit a deck, and which cards their decks are fighting over.
 * The counting rules live in shared/collection.js.
 */
import db from '../db/connection.js';
import { PRINTING_PRICE_SQL, DEFAULT_PRINTING_ORDER_SQL } from './pricingService.js';
import { resolveRules } from '../../shared/formats.js';
import { collectionReport, contestedCards, deckIdentity, binderFits, claimsCopies } from '../../shared/collection.js';

const BOARD_SQL = `COALESCE(dc.board_type, CASE WHEN dc.is_sideboard = 1 THEN 'sideboard' ELSE 'mainboard' END)`;
const MAX_PARAMS = 900; // SQLite's default limit on bound parameters is 999

function parseSettings(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

/** Run a query once per chunk of ids, for `IN (...)` lists that may be long. */
function allInChunks(ids, build) {
  const out = [];
  for (let i = 0; i < ids.length; i += MAX_PARAMS) {
    const chunk = ids.slice(i, i + MAX_PARAMS);
    const [sql, params] = build(chunk.map(() => '?').join(','), chunk);
    out.push(...db.all(sql, params));
  }
  return out;
}

/** A deck's cards with what's needed here: card, board, and its printing's price. */
function deckRows(deckId) {
  return db.all(
    `SELECT dc.quantity, dc.is_sideboard, dc.is_commander, ${BOARD_SQL} as board_type,
            p.card_id, p.image_url, c.name, c.type_line, c.mana_cost, c.cmc, c.color_identity,
            ${PRINTING_PRICE_SQL} as price
     FROM deck_cards dc
     JOIN printings p ON dc.printing_id = p.id
     JOIN cards c ON p.card_id = c.id
     WHERE dc.deck_id = ?`,
    [deckId]
  );
}

/** Copies owned per card, any printing. */
function ownedCounts(userId, cardIds) {
  if (!cardIds.length) return new Map();
  const rows = allInChunks(cardIds, (ph, ids) => [
    `SELECT p.card_id, SUM(op.quantity) as owned
     FROM owned_printings op JOIN printings p ON op.printing_id = p.id
     WHERE op.user_id = ? AND p.card_id IN (${ph})
     GROUP BY p.card_id`,
    [userId, ...ids],
  ]);
  return new Map(rows.map((r) => [r.card_id, r.owned]));
}

/** How many copies of each card the user's decks list, per deck (maybeboards excluded). */
function deckUsage(userId, { cardIds = null, excludeDeckId = null } = {}) {
  const base = `SELECT d.id as deck_id, d.name as deck_name, d.format, p.card_id, SUM(dc.quantity) as quantity
     FROM deck_cards dc
     JOIN decks d ON dc.deck_id = d.id
     JOIN printings p ON dc.printing_id = p.id
     WHERE d.user_id = ? AND ${BOARD_SQL} != 'maybeboard'${excludeDeckId != null ? ' AND d.id != ?' : ''}`;
  const params = [userId, ...(excludeDeckId != null ? [excludeDeckId] : [])];
  if (!cardIds) return db.all(`${base} GROUP BY d.id, p.card_id`, params);
  if (!cardIds.length) return [];
  return allInChunks(cardIds, (ph, ids) => [`${base} AND p.card_id IN (${ph}) GROUP BY d.id, p.card_id`, [...params, ...ids]]);
}

/** The price of each card's cheapest playable printing, the one an added card defaults to. */
function cheapestPrices(cardIds) {
  const stmt = db.prepare(`SELECT ${PRINTING_PRICE_SQL} as price FROM printings p WHERE p.card_id = ? ORDER BY ${DEFAULT_PRINTING_ORDER_SQL} LIMIT 1`);
  return new Map(cardIds.map((id) => [id, stmt.get(id)?.price ?? null]));
}

function buildReport(userId, rows, excludeDeckId) {
  const cardIds = [...new Set(rows.filter(claimsCopies).map((r) => r.card_id))];
  const owned = ownedCounts(userId, cardIds);
  const otherDecks = deckUsage(userId, { cardIds, excludeDeckId });

  // Only price what may need buying
  const demand = new Map();
  for (const r of rows.filter(claimsCopies)) demand.set(r.card_id, (demand.get(r.card_id) || 0) + r.quantity);
  const others = new Map();
  for (const r of otherDecks) others.set(r.card_id, (others.get(r.card_id) || 0) + r.quantity);
  const toPrice = cardIds.filter((id) => (owned.get(id) || 0) < demand.get(id) + (others.get(id) || 0));

  return collectionReport({ rows, owned, otherDecks, cheapest: cheapestPrices(toPrice) });
}

/** The ownership report for one of the user's decks, or null when it isn't theirs. */
export function getDeckCollection(deckId, userId) {
  const deck = db.get(`SELECT id, format FROM decks WHERE id = ? AND user_id = ?`, [deckId, userId]);
  if (!deck) return null;
  return buildReport(userId, deckRows(deck.id), deck.id);
}

/**
 * The headline numbers of every deck's report, keyed by deck id, for a deck list:
 * { cards, ownedCards, missingCards, missingCopies, sharedCards, cost, unpriced }.
 * Same counting rules as the full report, so the list and the deck page agree.
 */
export function getDeckSummaries(userId) {
  const decks = db.all(`SELECT id FROM decks WHERE user_id = ?`, [userId]);
  const out = {};
  for (const { id } of decks) {
    const { summary } = buildReport(userId, deckRows(id), id);
    out[id] = {
      cards: summary.cards,
      ownedCards: summary.ownedCards,
      missingCards: summary.missingCards,
      missingCopies: summary.missingCopies,
      sharedCards: summary.sharedCards,
      cost: summary.cost,
      unpriced: summary.unpriced,
    };
  }
  return out;
}

/** The same report for someone else's shared deck, measured against the viewer's collection. */
export function getSharedDeckCollection(deckId, viewerId) {
  // Viewing your own share link: the deck doesn't compete with itself
  const own = db.get(`SELECT id FROM decks WHERE id = ? AND user_id = ?`, [deckId, viewerId]);
  return buildReport(viewerId, deckRows(deckId), own ? deckId : null);
}

/**
 * Owned cards that could go in a deck. Options: q, type, freeOnly, sort, offset, limit, and
 * colors ('deck' to keep to the deck's identity, 'any' for everything legal).
 */
export function getBinderFits(deckId, userId, options = {}) {
  const deck = db.get(`SELECT id, format, settings FROM decks WHERE id = ? AND user_id = ?`, [deckId, userId]);
  if (!deck) return null;

  const rules = resolveRules(deck.format, parseSettings(deck.settings));
  const rows = deckRows(deck.id);
  const identity = deckIdentity(rows, rules);
  const colors = options.colors === 'any' ? null : identity.colors;

  const inDeck = new Set(rows.filter(claimsCopies).map((r) => r.card_id));
  const inMaybe = new Set(rows.filter((r) => !claimsCopies(r)).map((r) => r.card_id));

  // Every owned printing, rolled up per card; the deck gets the printing you have most of
  const ownedRows = db.all(
    `SELECT op.printing_id, op.quantity, p.card_id, p.image_url,
            c.name, c.type_line, c.mana_cost, c.cmc, c.color_identity, c.legalities, c.oracle_text, c.edhrec_rank
     FROM owned_printings op
     JOIN printings p ON op.printing_id = p.id
     JOIN cards c ON p.card_id = c.id
     WHERE op.user_id = ? AND op.quantity > 0`,
    [userId]
  );
  const byCard = new Map();
  for (const r of ownedRows) {
    const entry = byCard.get(r.card_id);
    if (!entry) {
      const { quantity, printing_id, ...card } = r;
      byCard.set(r.card_id, { ...card, owned: quantity, printing_id, best: quantity });
      continue;
    }
    entry.owned += r.quantity;
    if (r.quantity > entry.best) {
      entry.best = r.quantity;
      entry.printing_id = r.printing_id;
      if (r.image_url) entry.image_url = r.image_url;
    }
    if (!entry.image_url && r.image_url) entry.image_url = r.image_url;
  }

  const used = new Map();
  for (const r of deckUsage(userId)) used.set(r.card_id, (used.get(r.card_id) || 0) + r.quantity);

  const result = binderFits([...byCard.values()].map(({ best, ...c }) => c), {
    rules,
    colors,
    used,
    inDeck,
    inMaybe,
    q: options.q,
    type: options.type,
    freeOnly: options.freeOnly,
    sort: options.sort || (rules?.commander ? 'rank' : 'name'),
    offset: options.offset,
    limit: options.limit,
  });

  return {
    ...result,
    identity,
    format: rules ? { id: rules.id, label: rules.label, legality: rules.legality || null } : null,
    owned: byCard.size,
  };
}

/** Cards the user's decks want more copies of than they own. */
export function getContestedCards(userId) {
  const usage = deckUsage(userId);
  const cardIds = [...new Set(usage.map((r) => r.card_id))];
  if (!cardIds.length) return { cards: [], shortCopies: 0, cost: 0 };

  const owned = ownedCounts(userId, cardIds);
  const details = new Map(allInChunks(cardIds, (ph, ids) => [
    `SELECT c.id as card_id, c.name, c.type_line,
            (SELECT p.image_url FROM printings p WHERE p.card_id = c.id AND p.image_url IS NOT NULL LIMIT 1) as image_url
     FROM cards c WHERE c.id IN (${ph})`,
    ids,
  ]).map((r) => [r.card_id, r]));

  const cards = contestedCards(usage.map((r) => ({ ...details.get(r.card_id), ...r })), owned);
  const prices = cheapestPrices(cards.map((c) => c.card_id));
  let cost = 0;
  for (const c of cards) {
    c.price_each = prices.get(c.card_id);
    if (c.price_each != null) cost += c.price_each * c.short;
  }
  return {
    cards,
    shortCopies: cards.reduce((s, c) => s + c.short, 0),
    cost: Math.round(cost * 100) / 100,
  };
}
