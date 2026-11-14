/**
 * Which deck your copies of a card are in.
 *
 * Each deck_cards row has `owned_quantity`: the copies of its card from your collection that are in
 * that deck. Only mainboard and sideboard rows hold copies; maybeboards aren't built. Across all your
 * decks, a card can't hold more copies than you own (any printing, any finish).
 *
 * The triggers from migration 025 keep each row within its own quantity. The functions here keep
 * the total within the collection, and pick which copies to hand out or take back:
 *   - copies are handed out to your oldest decks first, mainboard before sideboard
 *   - when the collection shrinks, copies come back from your newest decks first, sideboard first
 *
 * Everything takes a connection with `prepare()` (better-sqlite3 or the app's DbAdapter) so the
 * migration and the MTGJSON sync script can use it without opening the app's database.
 */

export const BOARD_SQL = `COALESCE(dc.board_type, CASE WHEN dc.is_sideboard = 1 THEN 'sideboard' ELSE 'mainboard' END)`;
export const HOLDS_COPIES_SQL = `${BOARD_SQL} != 'maybeboard'`;
const HAND_OUT_ORDER_SQL = `d.created_at, d.id, CASE ${BOARD_SQL} WHEN 'mainboard' THEN 0 ELSE 1 END, dc.id`;

const MAX_PARAMS = 900;

function chunks(list) {
  const out = [];
  for (let i = 0; i < list.length; i += MAX_PARAMS) out.push(list.slice(i, i + MAX_PARAMS));
  return out;
}

/** Copies of each card the user owns, as a Map card_id → copies. */
export function ownedTotals(conn, userId, cardIds) {
  const out = new Map();
  for (const ids of chunks(cardIds)) {
    const rows = conn.prepare(
      `SELECT p.card_id, SUM(op.quantity) AS owned
       FROM owned_printings op JOIN printings p ON op.printing_id = p.id
       WHERE op.user_id = ? AND p.card_id IN (${ids.map(() => '?').join(',')})
       GROUP BY p.card_id`
    ).all(userId, ...ids);
    for (const r of rows) out.set(r.card_id, Math.max(0, Number(r.owned) || 0));
  }
  return out;
}

/** The user's deck rows that can hold copies of these cards, in hand-out order. */
function holdingRows(conn, userId, cardIds) {
  const out = [];
  for (const ids of chunks(cardIds)) {
    out.push(...conn.prepare(
      `SELECT dc.id, dc.quantity, dc.owned_quantity, dc.deck_id, d.name AS deck_name, p.card_id, ${BOARD_SQL} AS board_type
       FROM deck_cards dc
       JOIN decks d ON d.id = dc.deck_id
       JOIN printings p ON p.id = dc.printing_id
       WHERE d.user_id = ? AND p.card_id IN (${ids.map(() => '?').join(',')}) AND ${HOLDS_COPIES_SQL}
       ORDER BY ${HAND_OUT_ORDER_SQL}`
    ).all(userId, ...ids));
  }
  return out;
}

function byCard(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.card_id)) map.set(r.card_id, []);
    map.get(r.card_id).push(r);
  }
  return map;
}

/**
 * Where a card's copies are: { owned, assigned, free, decks: [{ deck_id, name, held, listed }] }.
 * `decks` lists every deck of the user's that holds or lists the card outside its maybeboard.
 */
export function copiesOf(conn, userId, cardId) {
  const owned = ownedTotals(conn, userId, [cardId]).get(cardId) || 0;
  const rows = holdingRows(conn, userId, [cardId]);
  const decks = new Map();
  let assigned = 0;
  for (const r of rows) {
    assigned += r.owned_quantity;
    if (!decks.has(r.deck_id)) decks.set(r.deck_id, { deck_id: r.deck_id, name: r.deck_name, held: 0, listed: 0 });
    const d = decks.get(r.deck_id);
    d.held += r.owned_quantity;
    d.listed += r.quantity;
  }
  return { owned, assigned, free: Math.max(0, owned - assigned), decks: [...decks.values()] };
}

/**
 * Give back copies the collection no longer has. Copies leave the newest decks first, and the
 * sideboard before the mainboard. `cardIds` null means every card the user's decks hold.
 * Returns the number of copies released.
 */
export function releaseExcess(conn, userId, cardIds = null) {
  let ids = cardIds;
  if (ids == null) {
    ids = conn.prepare(
      `SELECT DISTINCT p.card_id FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id JOIN printings p ON p.id = dc.printing_id
       WHERE d.user_id = ? AND dc.owned_quantity > 0`
    ).all(userId).map((r) => r.card_id);
  }
  ids = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (!ids.length) return 0;

  const owned = ownedTotals(conn, userId, ids);
  const set = conn.prepare(`UPDATE deck_cards SET owned_quantity = ? WHERE id = ?`);
  let released = 0;
  for (const [cardId, rows] of byCard(holdingRows(conn, userId, ids))) {
    let excess = rows.reduce((s, r) => s + r.owned_quantity, 0) - (owned.get(cardId) || 0);
    for (let i = rows.length - 1; i >= 0 && excess > 0; i--) {
      const take = Math.min(rows[i].owned_quantity, excess);
      if (!take) continue;
      set.run(rows[i].owned_quantity - take, rows[i].id);
      excess -= take;
      released += take;
    }
  }
  return released;
}

/** Run releaseExcess for every user with decks. For after a sync or restore. */
export function releaseExcessForAll(conn) {
  let released = 0;
  for (const { id } of conn.prepare(`SELECT DISTINCT user_id AS id FROM decks`).all()) released += releaseExcess(conn, id);
  return released;
}

/**
 * Put free copies (owned, in no deck) into one deck row, up to `max` more copies and never past
 * the row's quantity. Returns the number of copies added.
 */
export function claimFree(conn, userId, deckCardId, max = Infinity) {
  const row = conn.prepare(
    `SELECT dc.id, dc.quantity, dc.owned_quantity, p.card_id, ${BOARD_SQL} AS board_type
     FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id JOIN printings p ON p.id = dc.printing_id
     WHERE dc.id = ? AND d.user_id = ?`
  ).get(deckCardId, userId);
  if (!row || row.board_type === 'maybeboard') return 0;
  const { free } = copiesOf(conn, userId, row.card_id);
  const add = Math.max(0, Math.min(max, row.quantity - row.owned_quantity, free));
  if (add) conn.prepare(`UPDATE deck_cards SET owned_quantity = owned_quantity + ? WHERE id = ?`).run(add, row.id);
  return add;
}

/** Fill every row of one deck from free copies, mainboard first. Returns the copies added. */
export function fillDeck(conn, userId, deckId) {
  const rows = conn.prepare(
    `SELECT dc.id FROM deck_cards dc WHERE dc.deck_id = ? AND ${HOLDS_COPIES_SQL}
     ORDER BY CASE ${BOARD_SQL} WHEN 'mainboard' THEN 0 ELSE 1 END, dc.id`
  ).all(deckId);
  let claimed = 0;
  for (const r of rows) claimed += claimFree(conn, userId, r.id);
  return claimed;
}

/**
 * Hand out every user's copies from scratch: oldest decks first, mainboard before sideboard.
 * Used once, by the migration that introduced per-deck ownership.
 */
export function allocateAll(conn) {
  const rows = conn.prepare(
    `SELECT dc.id, dc.quantity, d.user_id, p.card_id
     FROM deck_cards dc
     JOIN decks d ON d.id = dc.deck_id
     JOIN printings p ON p.id = dc.printing_id
     WHERE ${HOLDS_COPIES_SQL}
     ORDER BY d.user_id, p.card_id, ${HAND_OUT_ORDER_SQL}`
  ).all();
  const owned = new Map(conn.prepare(
    `SELECT op.user_id || ':' || p.card_id AS k, SUM(op.quantity) AS owned
     FROM owned_printings op JOIN printings p ON op.printing_id = p.id
     GROUP BY op.user_id, p.card_id`
  ).all().map((r) => [r.k, Math.max(0, Number(r.owned) || 0)]));

  conn.prepare(`UPDATE deck_cards SET owned_quantity = 0`).run();
  const set = conn.prepare(`UPDATE deck_cards SET owned_quantity = ? WHERE id = ?`);
  const left = new Map();
  let assigned = 0;
  for (const r of rows) {
    const k = `${r.user_id}:${r.card_id}`;
    if (!left.has(k)) left.set(k, owned.get(k) || 0);
    const give = Math.min(left.get(k), Math.max(0, Number(r.quantity) || 0));
    if (!give) continue;
    set.run(give, r.id);
    left.set(k, left.get(k) - give);
    assigned += give;
  }
  return assigned;
}
