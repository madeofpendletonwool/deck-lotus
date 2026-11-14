/**
 * The collection view's data: the whole collection loaded once, then filtered and sorted in the
 * browser so a search over ten thousand cards answers as you type.
 */
import { colorsOf, isLand } from './cube.js';
import { compileQuery } from './cardQuery.js';

const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 4 };

/**
 * Collection entries from /inventory/index. Each gets totals across its printings and the fields
 * the card filter language reads: set_codes (every set you have a copy from), qty, free, in_decks,
 * has_foil, and price (your most valuable copy).
 */
export function toItems(index) {
  const sets = index?.sets || {};
  return (index?.cards || []).map((card) => {
    const printings = card.printings.map(([printing_id, set_code, collector_number, rarity, finish, quantity, price, image_url]) => ({
      printing_id,
      set_code,
      set_name: sets[set_code]?.[0] || String(set_code || '').toUpperCase(),
      release_date: sets[set_code]?.[1] || null,
      collector_number,
      rarity: rarity ? rarity.toLowerCase() : null,
      finish,
      quantity,
      price,
      image_url,
    }));
    let qty = 0;
    let value = 0;
    let top = null;
    let hasFoil = false;
    let hasNonfoil = false;
    for (const p of printings) {
      qty += p.quantity;
      if (p.price != null) {
        value += p.quantity * p.price;
        if (top == null || p.price > top) top = p.price;
      }
      if (p.finish === 'nonfoil') hasNonfoil = true;
      else hasFoil = true;
    }
    // The server lists the printing you have most copies of first; it stands for the card.
    const primary = printings[0] || {};
    const rarity = printings.reduce((best, p) => ((RARITY_RANK[p.rarity] ?? -1) > (RARITY_RANK[best] ?? -1) ? p.rarity : best), primary.rarity || null);
    const inDecks = card.in_decks || 0;
    return {
      ...card,
      key: String(card.card_id),
      printings,
      qty,
      value: Math.round(value * 100) / 100,
      price: top,
      in_decks: inDecks,
      free: qty - inDecks,
      has_foil: hasFoil,
      has_nonfoil: hasNonfoil,
      set_codes: [...new Set(printings.map((p) => String(p.set_code || '').toLowerCase()))],
      set_code: primary.set_code || '',
      set_name: primary.set_name || '',
      release_date: primary.release_date || '',
      collector_number: primary.collector_number || '',
      rarity,
      image_url: primary.image_url || null,
      added: card.added || '',
    };
  });
}

export const EMPTY_FILTERS = Object.freeze({
  query: '',
  colors: [],
  types: [],
  rarities: [],
  finish: 'all',
  availability: 'all',
  sets: [],
});

export function activeFilterCount(f) {
  return (f.query.trim() ? 1 : 0) + f.colors.length + f.types.length + f.rarities.length + f.sets.length
    + (f.finish !== 'all' ? 1 : 0) + (f.availability !== 'all' ? 1 : 0);
}

/**
 * Colors: every picked color must be on the card; M means two or more colors; C means colorless
 * and widens the pick to "these colors, or colorless".
 */
function colorTest(picked) {
  if (!picked.length) return null;
  const actual = picked.filter((c) => 'WUBRG'.includes(c));
  const multi = picked.includes('M');
  const colorless = picked.includes('C');
  return (item) => {
    const colors = colorsOf(item);
    if (colorless && colors.length === 0) return true;
    if (colorless && !actual.length && !multi) return false;
    return actual.every((c) => colors.includes(c)) && (!multi || colors.length > 1);
  };
}

const front = (item) => (item.type_line || '').split(' // ')[0];

export function filterItems(items, f) {
  const tests = [];
  if (f.query.trim()) tests.push(compileQuery(f.query));
  const color = colorTest(f.colors);
  if (color) tests.push(color);
  if (f.types.length) {
    const patterns = f.types.map((t) => new RegExp(`\\b${t}\\b`));
    tests.push((i) => patterns.some((re) => re.test(front(i))));
  }
  if (f.rarities.length) tests.push((i) => i.printings.some((p) => f.rarities.includes(p.rarity)));
  if (f.sets.length) tests.push((i) => i.set_codes.some((code) => f.sets.includes(code)));
  if (f.finish === 'foil') tests.push((i) => i.has_foil);
  if (f.finish === 'nonfoil') tests.push((i) => i.has_nonfoil);
  if (f.availability === 'free') tests.push((i) => i.free > 0);
  if (f.availability === 'indeck') tests.push((i) => i.in_decks > 0);
  if (f.availability === 'unused') tests.push((i) => i.in_decks === 0);
  if (f.availability === 'short') tests.push((i) => i.free < 0);
  if (!tests.length) return items;
  return items.filter((i) => tests.every((t) => t(i)));
}

export const SORTS = [
  ['name', 'Name'],
  ['value', 'Total value'],
  ['price', 'Price each'],
  ['qty', 'Copies'],
  ['added', 'Recently added'],
  ['cmc', 'Mana value'],
  ['color', 'Color'],
  ['set', 'Set'],
];

function colorRank(item) {
  if (isLand(item)) return 7;
  const colors = colorsOf(item);
  if (colors.length > 1) return 5;
  if (colors.length === 0) return 6;
  return 'WUBRG'.indexOf(colors[0]);
}

const byName = (a, b) => a.name.localeCompare(b.name);
const num = (v) => String(v ?? '');

const COMPARE = {
  name: byName,
  value: (a, b) => b.value - a.value || byName(a, b),
  price: (a, b) => (b.price ?? -1) - (a.price ?? -1) || byName(a, b),
  qty: (a, b) => b.qty - a.qty || byName(a, b),
  added: (a, b) => b.added.localeCompare(a.added) || byName(a, b),
  cmc: (a, b) => (a.cmc || 0) - (b.cmc || 0) || byName(a, b),
  color: (a, b) => colorRank(a) - colorRank(b) || byName(a, b),
  set: (a, b) => (b.printings[0]?.release_date || '').localeCompare(a.printings[0]?.release_date || '')
    || a.set_name.localeCompare(b.set_name)
    || num(a.collector_number).localeCompare(num(b.collector_number), undefined, { numeric: true }),
};

export function sortItems(items, sort = 'name') {
  return [...items].sort(COMPARE[sort] || COMPARE.name);
}

/** Sets you own cards from, with how many of the given cards have a copy from each. */
export function setFacets(items) {
  const counts = new Map();
  for (const item of items) {
    for (const p of item.printings) {
      const code = String(p.set_code || '').toLowerCase();
      if (!counts.has(code)) counts.set(code, { code, name: p.set_name, release_date: p.release_date, cards: new Set() });
      counts.get(code).cards.add(item.card_id);
    }
  }
  return [...counts.values()]
    .map((s) => ({ code: s.code, name: s.name, release_date: s.release_date, count: s.cards.size }))
    .sort((a, b) => (b.release_date || '').localeCompare(a.release_date || '') || a.name.localeCompare(b.name));
}

export function totals(items) {
  let copies = 0;
  let value = 0;
  let inDecks = 0;
  let free = 0;
  for (const i of items) {
    copies += i.qty;
    value += i.value;
    inDecks += Math.min(i.in_decks, i.qty);
    free += Math.max(i.free, 0);
  }
  return { cards: items.length, copies, value: Math.round(value * 100) / 100, inDecks, free };
}
