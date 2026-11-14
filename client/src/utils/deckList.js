/**
 * Searching, filtering and sorting the My Decks page. Pure, so it can be tested without a DOM.
 */
import { isCubeFormat } from '../../../shared/formats.js';

export const DECK_SORTS = [
  ['updated', 'Last edited'],
  ['created', 'Newest'],
  ['name', 'Name'],
  ['cards', 'Most cards'],
  ['price-desc', 'Price: high to low'],
  ['price-asc', 'Price: low to high'],
];

const byName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
// SQLite timestamps ("2026-11-14 10:00:00") sort correctly as strings
const newestFirst = (key) => (a, b) => String(b[key] || '').localeCompare(String(a[key] || ''));
const priceOf = (d) => Number(d.total_price) || 0;

const COMPARE = {
  updated: newestFirst('updated_at'),
  created: newestFirst('created_at'),
  name: byName,
  cards: (a, b) => (b.mainboard_count || 0) - (a.mainboard_count || 0),
  'price-desc': (a, b) => priceOf(b) - priceOf(a),
  // Decks with no priced cards are usually empty, so they go last rather than first
  'price-asc': (a, b) => (!priceOf(a) - !priceOf(b)) || priceOf(a) - priceOf(b),
};

/**
 * The decks to show. `kind` is 'all' | 'decks' | 'cubes', `format` a format id or '' for any,
 * and `query` matches the name, format or description.
 */
export function filterDecks(decks, { kind = 'all', format = '', query = '', sort = 'updated', formatLabel = (f) => f } = {}) {
  const q = query.trim().toLowerCase();
  const compare = COMPARE[sort] || COMPARE.updated;
  return decks
    .filter((d) => kind === 'all' || (kind === 'cubes') === isCubeFormat(d.format))
    .filter((d) => !format || (format === 'none' ? !d.format : d.format === format))
    .filter((d) => !q || [d.name, d.description, d.format && formatLabel(d.format)].some((t) => String(t || '').toLowerCase().includes(q)))
    .sort((a, b) => compare(a, b) || byName(a, b));
}

/** The formats the given decks use, for the format filter. 'none' stands for decks without one. */
export function formatsInUse(decks) {
  const formats = new Set(decks.map((d) => d.format || 'none'));
  return [...formats];
}
