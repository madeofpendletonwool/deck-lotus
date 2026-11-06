export const PRINTING_SORTS = [
  { value: 'price-asc', label: 'Cheapest' },
  { value: 'price-desc', label: 'Most expensive' },
  { value: 'date-desc', label: 'Newest' },
  { value: 'date-asc', label: 'Oldest' },
  { value: 'set', label: 'Set name' },
];

/** What a printing adds to the deck: its normal price, or the only finish it comes in. */
export function printingPrice(printing) {
  return printing.price_normal ?? printing.price_foil ?? printing.price_etched ?? null;
}

/** The small print next to a printing's price, explaining the finish or giving the foil price. */
export function printingFinishNote(printing) {
  if (printing.price_normal == null) {
    if (printing.price_foil != null) return 'Foil only';
    if (printing.price_etched != null) return 'Etched only';
    return '';
  }
  return printing.price_foil != null ? `Foil ${formatPrice(printing.price_foil)}` : '';
}

export function formatPrice(price) {
  return `$${price.toFixed(2)}`;
}

const setName = (printing) => printing.set_name || printing.set_code || '';

const compareNewest = (a, b) => {
  const dateA = a.set_release_date || '';
  const dateB = b.set_release_date || '';
  return dateB.localeCompare(dateA);
};

const compareSet = (a, b) =>
  setName(a).localeCompare(setName(b)) ||
  String(a.collector_number ?? '').localeCompare(String(b.collector_number ?? ''), undefined, { numeric: true });

/** Printings with no known value sort last whichever direction is chosen. */
function compareMissingLast(a, b, valueOf, compare) {
  const valueA = valueOf(a);
  const valueB = valueOf(b);
  if (valueA == null && valueB == null) return 0;
  if (valueA == null) return 1;
  if (valueB == null) return -1;
  return compare(valueA, valueB);
}

const SORTERS = {
  'price-asc': (a, b) => compareMissingLast(a, b, printingPrice, (x, y) => x - y) || compareNewest(a, b) || compareSet(a, b),
  'price-desc': (a, b) => compareMissingLast(a, b, printingPrice, (x, y) => y - x) || compareNewest(a, b) || compareSet(a, b),
  'date-desc': (a, b) => compareMissingLast(a, b, (p) => p.set_release_date || null, (x, y) => y.localeCompare(x)) || compareSet(a, b),
  'date-asc': (a, b) => compareMissingLast(a, b, (p) => p.set_release_date || null, (x, y) => x.localeCompare(y)) || compareSet(a, b),
  set: compareSet,
};

export function sortPrintings(printings, sort) {
  return [...printings].sort(SORTERS[sort] ?? SORTERS['price-asc']);
}

const knownPriceCount = (printing) => [printing.price_normal, printing.price_foil, printing.price_etched].filter((price) => price != null).length;

/**
 * Double-faced cards have a row per face for each physical printing, with the same image and
 * number. Keep one of each: the row the deck already uses, otherwise the one with the most prices.
 */
export function uniquePrintings(printings, currentPrintingId = null) {
  const bySetAndNumber = new Map();
  for (const printing of printings) {
    const key = `${printing.set_code}|${printing.collector_number}`;
    const kept = bySetAndNumber.get(key);
    const replaces = !kept || (kept.id != currentPrintingId && (printing.id == currentPrintingId || knownPriceCount(printing) > knownPriceCount(kept)));
    if (replaces) bySetAndNumber.set(key, printing);
  }
  return [...bySetAndNumber.values()];
}

export function printingMatches(printing, query) {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return (printing.set_code || '').toLowerCase().includes(term) || (printing.set_name || '').toLowerCase().includes(term);
}

/** Lowest and highest known price, or null if none of the printings has one. */
export function priceRange(printings) {
  const prices = printings.map(printingPrice).filter((price) => price != null);
  return prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices) } : null;
}
