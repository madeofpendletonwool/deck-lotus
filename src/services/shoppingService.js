import db from '../db/connection.js';
import { PRINTING_PRICE_SQL, DEFAULT_PRINTING_ORDER_SQL } from './pricingService.js';
import { isBinderSet } from '../../shared/binders.js';

const BOARD_SQL = `COALESCE(dc.board_type, CASE WHEN dc.is_sideboard = 1 THEN 'sideboard' ELSE 'mainboard' END)`;
const MAX_PARAMS = 900;

function allInChunks(ids, build) {
  const out = [];
  for (let i = 0; i < ids.length; i += MAX_PARAMS) {
    const chunk = ids.slice(i, i + MAX_PARAMS);
    const [sql, params] = build(chunk.map(() => '?').join(','), chunk);
    out.push(...db.all(sql, params));
  }
  return out;
}

/**
 * Everything the shopping page needs, for every one of the user's decks at once, so the page can
 * switch decks, boards and filters without asking again.
 *
 * One entry per card (not per printing): the store sells you a card, and any printing you own
 * counts against what your decks want. Each card says how many copies each deck lists on each
 * board and how many you own; the page works out what's left to buy. Proxied copies aren't
 * bought, so they're taken off the board counts (and reported per deck as `proxied`).
 *
 * @param {number} userId
 * @param {number[]|null} deckIds limit to these decks; null or empty means all of them
 */
export function getShoppingList(userId, deckIds = null) {
  const decks = db.all(
    `SELECT id, name, format FROM decks WHERE user_id = ? ORDER BY updated_at DESC, name`,
    [userId]
  );
  const wanted = deckIds?.length ? new Set(deckIds) : null;
  const deckList = wanted ? decks.filter((d) => wanted.has(d.id)) : decks;
  if (!deckList.length) return { decks: [], cards: [] };

  const rows = allInChunks(deckList.map((d) => d.id), (ph, ids) => [
    `SELECT dc.deck_id, ${BOARD_SQL} as board_type, dc.is_commander, dc.quantity, dc.proxy_quantity,
            p.id as printing_id, p.set_code, p.collector_number, p.rarity, p.image_url,
            s.name as set_name, s.release_date,
            c.id as card_id, c.name, c.mana_cost, c.cmc, c.colors, c.color_identity, c.type_line,
            c.oracle_text, c.layout, c.power, c.toughness,
            ${PRINTING_PRICE_SQL} as price
     FROM deck_cards dc
     JOIN printings p ON dc.printing_id = p.id
     JOIN cards c ON p.card_id = c.id
     LEFT JOIN sets s ON p.set_code = s.code
     WHERE dc.deck_id IN (${ph})`,
    ids,
  ]);

  const byCard = new Map();
  for (const r of rows) {
    let card = byCard.get(r.card_id);
    if (!card) {
      card = {
        card_id: r.card_id,
        name: r.name,
        mana_cost: r.mana_cost,
        cmc: r.cmc,
        colors: r.colors,
        color_identity: r.color_identity,
        type_line: r.type_line,
        oracle_text: r.oracle_text,
        layout: r.layout,
        power: r.power,
        toughness: r.toughness,
        owned: 0,
        cheapest: null,
        printings: new Map(),
        decks: new Map(),
      };
      byCard.set(r.card_id, card);
    }

    let printing = card.printings.get(r.printing_id);
    if (!printing) {
      printing = {
        printing_id: r.printing_id,
        set_code: r.set_code,
        set_name: r.set_name || (r.set_code || '').toUpperCase(),
        release_date: r.release_date,
        collector_number: r.collector_number,
        rarity: r.rarity ? r.rarity.toLowerCase() : null,
        image_url: r.image_url,
        price: r.price,
        quantity: 0,
      };
      card.printings.set(r.printing_id, printing);
    }
    const proxied = r.board_type === 'maybeboard' ? 0 : Math.min(r.quantity, Math.max(0, r.proxy_quantity || 0));
    const wanted = r.quantity - proxied;
    printing.quantity += wanted;

    let deck = card.decks.get(r.deck_id);
    if (!deck) {
      deck = { deck_id: r.deck_id, main: 0, side: 0, maybe: 0, proxied: 0, commander: false };
      card.decks.set(r.deck_id, deck);
    }
    deck.proxied += proxied;
    if (r.board_type === 'maybeboard') deck.maybe += wanted;
    else if (r.board_type === 'sideboard') deck.side += wanted;
    else deck.main += wanted;
    if (r.is_commander) deck.commander = true;
  }

  const cardIds = [...byCard.keys()];
  for (const r of allInChunks(cardIds, (ph, ids) => [
    `SELECT p.card_id, SUM(op.quantity) as owned
     FROM owned_printings op JOIN printings p ON op.printing_id = p.id
     WHERE op.user_id = ? AND p.card_id IN (${ph})
     GROUP BY p.card_id`,
    [userId, ...ids],
  ])) {
    byCard.get(r.card_id).owned = r.owned;
  }

  // The cheapest printing's price, as a fallback and a hint, only for cards that may need buying.
  const cheapest = db.prepare(`SELECT ${PRINTING_PRICE_SQL} as price FROM printings p WHERE p.card_id = ? ORDER BY ${DEFAULT_PRINTING_ORDER_SQL} LIMIT 1`);
  const cards = [];
  for (const card of byCard.values()) {
    const demand = [...card.decks.values()].reduce((n, d) => n + d.main + d.side + d.maybe, 0);
    if (demand <= card.owned) continue; // Owned enough for everything, maybeboards included
    card.cheapest = cheapest.get(card.card_id)?.price ?? null;
    const printings = [...card.printings.values()].sort((a, b) => b.quantity - a.quantity);
    cards.push({ ...card, printings, decks: [...card.decks.values()] });
  }
  cards.sort((a, b) => a.name.localeCompare(b.name));

  const sets = attachBinderPrintings(cards);
  for (const card of cards) {
    for (const p of card.printings) addSet(sets, p.set_code, p.set_name, p.release_date);
  }

  return {
    decks: deckList.map((d) => ({ id: d.id, name: d.name, format: d.format })),
    cards,
    sets,
  };
}

function addSet(sets, code, name, releaseDate, type = null) {
  if (!code || sets[code]) return;
  sets[code] = { name: name || code.toUpperCase(), release_date: releaseDate || '', type };
}

/**
 * Give each card `binders`: one printing per binder set it appears in ([set_code, printing_id,
 * collector_number, price, image_url]), so the page can tell you which store binders hold it
 * whatever printing your decks list. The printing picked per set is the plain one a binder would
 * hold: not a promo, not full art, lowest collector number. Returns the sets they name.
 */
function attachBinderPrintings(cards) {
  const sets = {};
  const byId = new Map(cards.map((c) => [c.card_id, c]));
  for (const card of cards) card.binders = [];
  const rows = allInChunks([...byId.keys()], (ph, ids) => [
    `SELECT p.card_id, p.id as printing_id, p.set_code, p.collector_number, p.image_url,
            s.name as set_name, s.release_date, s.type as set_type, s.is_online_only,
            ${PRINTING_PRICE_SQL} as price
     FROM printings p
     JOIN sets s ON s.code = p.set_code
     WHERE p.card_id IN (${ph})
     ORDER BY p.card_id, p.set_code, p.is_promo, p.is_full_art,
              CAST(p.collector_number AS INTEGER), p.collector_number, p.id`,
    ids,
  ]);
  let last = null;
  for (const r of rows) {
    const key = `${r.card_id}|${r.set_code}`;
    if (key === last) continue;
    last = key;
    if (!isBinderSet({ code: r.set_code, type: r.set_type, is_online_only: r.is_online_only })) continue;
    byId.get(r.card_id).binders.push([r.set_code, r.printing_id, r.collector_number, r.price, r.image_url]);
    addSet(sets, r.set_code, r.set_name, r.release_date, r.set_type);
  }
  return sets;
}
