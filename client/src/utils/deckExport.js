/**
 * Deck list exporters. Pure functions (no DOM) so they can be unit tested and shared
 * between the deck builder and the public share page.
 *
 * Each format has its own quirks, worth keeping in mind before "simplifying" this:
 *  - MTG Print takes Arena-style lines. A flat list keeps every card, with no headers to trip on.
 *  - MTG Print reports a "Commander" header as a card it can't find.
 *  - MPC Autofill splits a line on "// " into front and back faces, so "A // B" is never sent
 *    as-is (see mpcName). Set codes would *filter* its search to images tagged with that
 *    printing, so they are left off.
 *  - Arena, Moxfield and MTGO each mark the sideboard differently.
 */

const FACE_SEPARATOR = ' // ';

// Both halves are printed on one face, so MPC Autofill indexes these under both names.
const SPLIT_FACE_LAYOUTS = new Set(['split', 'aftermath']);

export const EXPORT_FORMATS = [
  {
    id: 'mtgprint',
    label: 'MTG Print',
    hint: 'Printable PDF of the exact printings',
    group: 'Print & proxies',
    openUrl: 'https://mtgprint.net/',
    openLabel: 'Copy & open MTG Print',
    extension: 'txt',
  },
  {
    id: 'mpc',
    label: 'MPC Autofill',
    hint: 'Paste into Add Cards → Text',
    group: 'Print & proxies',
    openUrl: 'https://mpcfill.com/editor',
    openLabel: 'Copy & open MPC Autofill',
    extension: 'txt',
  },
  {
    id: 'arena',
    label: 'Arena',
    hint: 'Deck and Sideboard sections, with printings',
    group: 'Play',
    extension: 'txt',
  },
  {
    id: 'mtgo',
    label: 'MTGO',
    hint: 'Names only, with a SIDEBOARD section',
    group: 'Play',
    extension: 'txt',
  },
  {
    id: 'moxfield',
    label: 'Moxfield',
    hint: 'Bulk edit, keeps exact printings',
    group: 'Deck sites',
    supportsMaybeboard: true,
    extension: 'txt',
  },
  {
    id: 'text',
    label: 'Plain text',
    hint: 'Works almost anywhere that takes a list',
    group: 'Deck sites',
    supportsMaybeboard: true,
    extension: 'txt',
  },
  {
    id: 'tcgplayer',
    label: 'TCGplayer',
    hint: 'Mass Entry format',
    group: 'Buy',
    openUrl: 'https://www.tcgplayer.com/massentry',
    openLabel: 'Copy & open TCGplayer',
    extension: 'txt',
  },
  {
    id: 'csv',
    label: 'CSV',
    hint: 'Spreadsheet with printing details',
    group: 'Data',
    supportsMaybeboard: true,
    extension: 'csv',
  },
];

export const DEFAULT_EXPORT_OPTIONS = Object.freeze({
  includeSideboard: true,
  includeMaybeboard: false,
  excludeBasics: false,
  unownedOnly: false,
});

function boardOf(card) {
  return card.board_type || (card.is_sideboard ? 'sideboard' : 'mainboard');
}

function isBasicLand(card) {
  return /\bBasic\b/.test(card.type_line || '');
}

/**
 * The name MPC Autofill finds a card under, checked against mpcfill.com: "Fire // Ice" comes
 * back as Card Not Found but "Fire Ice" matches, and everything else resolves by its front
 * name, with the back of a double-faced card filled in automatically.
 */
function mpcName(card) {
  const name = card.name || '';
  if (!name.includes(FACE_SEPARATOR)) return name;
  return SPLIT_FACE_LAYOUTS.has(card.layout) ? name.replace(FACE_SEPARATOR, ' ') : firstFaceName(card);
}

/** Just the first name, for formats that don't understand "A // B" at all. */
function firstFaceName(card) {
  return (card.name || '').split(FACE_SEPARATOR)[0];
}

function printingSuffix(card) {
  if (!card.set_code) return '';
  const collector = card.collector_number ? ` ${card.collector_number}` : '';
  return ` (${card.set_code.toUpperCase()})${collector}`;
}

/** Sort a deck into boards, applying the export options. Commanders never appear twice. */
export function partitionDeck(cards, options = {}) {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options };
  const keep = (card) => {
    if (opts.excludeBasics && isBasicLand(card)) return false;
    if (opts.unownedOnly && card.is_owned) return false;
    return true;
  };
  const kept = (cards || []).filter(keep);
  const inBoard = (board) => kept.filter((c) => boardOf(c) === board && !c.is_commander);

  return {
    commanders: kept.filter((c) => c.is_commander),
    main: inBoard('mainboard'),
    side: opts.includeSideboard ? inBoard('sideboard') : [],
    maybe: opts.includeMaybeboard ? inBoard('maybeboard') : [],
  };
}

/** Sum quantities of lines that come out identical, e.g. the same land from two sets. */
function mergeLines(cards, formatName) {
  const totals = new Map();
  for (const card of cards) {
    const name = formatName(card);
    totals.set(name, (totals.get(name) || 0) + (card.quantity ?? 1));
  }
  return [...totals].map(([name, quantity]) => `${quantity} ${name}`);
}

/** Join labelled sections with a blank line between them, skipping any that are empty. */
function sections(...parts) {
  return parts
    .filter(([, lines]) => lines.length > 0)
    .map(([header, lines]) => (header ? [header, ...lines] : lines).join('\n'))
    .join('\n\n');
}

function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv({ commanders, main, side, maybe }) {
  const rows = [['Count', 'Name', 'Set Code', 'Set Name', 'Collector Number', 'Rarity', 'Board']];
  const addRows = (cards, board) => {
    for (const c of cards) {
      rows.push([
        c.quantity ?? 1,
        c.name,
        c.set_code ? c.set_code.toUpperCase() : '',
        c.set_name,
        c.collector_number,
        c.rarity,
        board,
      ]);
    }
  };
  addRows(commanders, 'commander');
  addRows(main, 'mainboard');
  addRows(side, 'sideboard');
  addRows(maybe, 'maybeboard');
  return rows.map((row) => row.map(csvField).join(',')).join('\n');
}

/**
 * Build the export text for a deck.
 * @param {string} format one of the EXPORT_FORMATS ids
 * @param {Array} cards deck cards as returned by the deck API
 * @param {object} options see DEFAULT_EXPORT_OPTIONS
 */
export function generateExport(format, cards, options = {}) {
  const deck = partitionDeck(cards, options);
  const { commanders, main, side, maybe } = deck;
  const everything = [...commanders, ...main, ...side, ...maybe];

  const withPrinting = (c) => `${c.name}${printingSuffix(c)}`;

  switch (format) {
    case 'mtgprint':
      return mergeLines(everything, withPrinting).join('\n');

    case 'mpc':
      return mergeLines(everything, mpcName).join('\n');

    case 'arena':
      return sections(
        ['Commander', mergeLines(commanders, withPrinting)],
        ['Deck', mergeLines(main, withPrinting)],
        ['Sideboard', mergeLines(side, withPrinting)],
      );

    case 'mtgo':
      return sections(
        ['', mergeLines([...commanders, ...main], firstFaceName)],
        ['SIDEBOARD:', mergeLines(side, firstFaceName)],
      );

    case 'moxfield':
      return sections(
        ['COMMANDER:', mergeLines(commanders, withPrinting)],
        ['', mergeLines(main, withPrinting)],
        ['SIDEBOARD:', mergeLines(side, withPrinting)],
        ['MAYBEBOARD:', mergeLines(maybe, withPrinting)],
      );

    case 'text': {
      const name = (c) => c.name;
      return sections(
        ['Commander', mergeLines(commanders, name)],
        ['Deck', mergeLines(main, name)],
        ['Sideboard', mergeLines(side, name)],
        ['Maybeboard', mergeLines(maybe, name)],
      );
    }

    case 'tcgplayer': {
      const name = (c) => (c.set_code ? `${firstFaceName(c)} [${c.set_code.toUpperCase()}]` : firstFaceName(c));
      return sections(
        ['', mergeLines([...commanders, ...main], name)],
        ['Sideboard', mergeLines(side, name)],
      );
    }

    case 'csv':
      return toCsv(deck);

    default:
      throw new Error(`Unknown export format: ${format}`);
  }
}

/** Total copies a set of export options would include. Shown so people can sanity-check it. */
export function countExportedCards(cards, options = {}) {
  const { commanders, main, side, maybe } = partitionDeck(cards, options);
  return [...commanders, ...main, ...side, ...maybe].reduce((sum, c) => sum + (c.quantity ?? 1), 0);
}
