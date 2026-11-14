/**
 * What to buy for a set of decks, and how to lay it out for a walk around a card store.
 *
 * The server sends every card your decks list that you don't own enough of, with per-deck board
 * counts and your owned copies. Everything here is local, so changing decks, boards or grouping
 * is instant.
 */
import { colorsOf, isLand, typeBucket } from './cube.js';

const basic = (card) => /\bBasic\b/.test(card.type_line || '');

/** Copies the selected decks want of a card, and how many of those you still need. */
export function needFor(card, selected, { includeMaybe = false } = {}) {
  let demand = 0;
  const decks = [];
  for (const d of card.decks) {
    if (!selected.has(d.deck_id)) continue;
    const qty = d.main + d.side + (includeMaybe ? d.maybe : 0);
    if (qty <= 0) continue;
    demand += qty;
    decks.push({ deck_id: d.deck_id, quantity: qty, maybeOnly: d.main + d.side === 0 });
  }
  decks.sort((a, b) => b.quantity - a.quantity);
  return { demand, need: Math.max(0, demand - (card.owned || 0)), decks };
}

/**
 * The shopping list: one item per card still needed, shaped so cardQuery filters work on it
 * (name, type_line, colors, rarity, set_code, price).
 */
export function buildList(cards, selected, { includeMaybe = false, includeBasics = false } = {}) {
  const items = [];
  for (const card of cards || []) {
    if (!includeBasics && basic(card)) continue;
    const { demand, need, decks } = needFor(card, selected, { includeMaybe });
    if (need <= 0) continue;
    const printing = card.printings[0] || {};
    const price = printing.price ?? card.cheapest ?? null;
    items.push({
      ...card,
      key: String(card.card_id),
      demand,
      need,
      deckRefs: decks,
      printing,
      set_code: printing.set_code || '',
      set_name: printing.set_name || '',
      release_date: printing.release_date || '',
      collector_number: printing.collector_number || '',
      rarity: printing.rarity || null,
      image_url: printing.image_url || null,
      price,
      cost: price != null ? price * need : 0,
    });
  }
  return items;
}

/** How many cards each deck, on its own, is missing. Used to label the deck picker. */
export function deckMissingCounts(cards, deckIds, opts = {}) {
  const counts = new Map(deckIds.map((id) => [id, 0]));
  for (const id of deckIds) {
    const only = new Set([id]);
    for (const card of cards || []) {
      if (!opts.includeBasics && basic(card)) continue;
      if (needFor(card, only, opts).need > 0) counts.set(id, counts.get(id) + 1);
    }
  }
  return counts;
}

const COLOR_GROUPS = [
  ['W', 'White'], ['U', 'Blue'], ['B', 'Black'], ['R', 'Red'], ['G', 'Green'],
  ['M', 'Multicolor'], ['C', 'Colorless'], ['L', 'Lands'],
];
const RARITY_GROUPS = [['mythic', 'Mythic'], ['rare', 'Rare'], ['uncommon', 'Uncommon'], ['common', 'Common'], ['other', 'Other']];
const TYPE_ORDER = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Other'];
const PRICE_GROUPS = [
  ['20', '$20 and up', (p) => p >= 20],
  ['5', '$5 to $20', (p) => p >= 5],
  ['1', '$1 to $5', (p) => p >= 1],
  ['0', 'Under $1', (p) => p >= 0],
];

export const GROUPINGS = [
  ['set', 'Set'],
  ['color', 'Color'],
  ['type', 'Type'],
  ['rarity', 'Rarity'],
  ['price', 'Price'],
  ['none', 'A–Z'],
];

function colorGroup(item) {
  if (isLand(item)) return 'L';
  const colors = colorsOf(item);
  if (colors.length > 1) return 'M';
  return colors[0] || 'C';
}

function priceGroup(item) {
  if (item.price == null) return 'none';
  return PRICE_GROUPS.find(([, , test]) => test(item.price))[0];
}

const byName = (a, b) => a.name.localeCompare(b.name);
const byNumber = (a, b) =>
  String(a.collector_number).localeCompare(String(b.collector_number), undefined, { numeric: true }) || byName(a, b);
const byPriceDesc = (a, b) => (b.price ?? -1) - (a.price ?? -1) || byName(a, b);

/**
 * Split items into ordered groups: [{ key, label, items, cards, copies, cost }].
 * Sets run newest first and keep binder order (collector number) inside each group. With keepOrder, items stay in
 * the order given (the collection view sorts them itself). Copies and cost read `need`/`cost`
 * on shopping items and `qty`/`value` on collection items.
 */
export function groupItems(items, groupBy = 'set', { keepOrder = false } = {}) {
  const groups = new Map();
  const add = (key, label, item, order) => {
    if (!groups.has(key)) groups.set(key, { key, label, order, items: [] });
    groups.get(key).items.push(item);
  };

  for (const item of items) {
    switch (groupBy) {
      case 'set':
        // Newest set first, as most stores shelve them
        add(item.set_code || '?', item.set_name || 'Unknown set', item, { date: item.release_date || '', name: item.set_name || '' });
        break;
      case 'color': {
        const key = colorGroup(item);
        const i = COLOR_GROUPS.findIndex(([k]) => k === key);
        add(key, COLOR_GROUPS[i][1], item, i);
        break;
      }
      case 'type': {
        const bucket = typeBucket(item) || 'Other';
        const i = TYPE_ORDER.indexOf(bucket);
        add(bucket, bucket === 'Other' ? 'Other' : `${bucket}s`, item, i < 0 ? 99 : i);
        break;
      }
      case 'rarity': {
        const key = RARITY_GROUPS.some(([k]) => k === item.rarity) ? item.rarity : 'other';
        const i = RARITY_GROUPS.findIndex(([k]) => k === key);
        add(key, RARITY_GROUPS[i][1], item, i);
        break;
      }
      case 'price': {
        const key = priceGroup(item);
        const i = PRICE_GROUPS.findIndex(([k]) => k === key);
        add(key, i < 0 ? 'No price' : PRICE_GROUPS[i][1], item, i < 0 ? 99 : i);
        break;
      }
      default:
        add('all', 'All cards', item, 0);
    }
  }

  const sortItems = groupBy === 'set' ? byNumber : groupBy === 'price' ? byPriceDesc : byName;
  return [...groups.values()]
    .sort(groupBy === 'set'
      ? (a, b) => b.order.date.localeCompare(a.order.date) || a.order.name.localeCompare(b.order.name)
      : (a, b) => a.order - b.order)
    .map((g) => {
      if (!keepOrder) g.items.sort(sortItems);
      return {
        key: g.key,
        label: g.label,
        items: g.items,
        cards: g.items.length,
        copies: g.items.reduce((n, i) => n + (i.need ?? i.qty ?? 0), 0),
        cost: g.items.reduce((n, i) => n + (i.cost ?? i.value ?? 0), 0),
      };
    });
}

/** Plain text for the clipboard: a checklist grouped as on screen, or "2 Name" lines for mass entry. */
export function listText(groups, { massEntry = false } = {}) {
  if (massEntry) {
    return groups.flatMap((g) => g.items).sort(byName).map((i) => `${i.need} ${i.name}`).join('\n');
  }
  return groups.map((g) => {
    const lines = g.items.map((i) => {
      const where = i.set_code ? ` (${i.set_code.toUpperCase()}${i.collector_number ? ` #${i.collector_number}` : ''})` : '';
      const price = i.price != null ? `  $${i.price.toFixed(2)}` : '';
      return `[ ] ${i.need} ${i.name}${where}${price}`;
    });
    return `${g.label}\n${lines.join('\n')}`;
  }).join('\n\n');
}
