/**
 * A small Scryfall-style filter language for cards already loaded in a deck or cube:
 *
 *   bolt                 name contains "bolt"
 *   t:creature           type line        o:"draw a card"   rules text
 *   c:rg  c=rg  c<=rg    colors: includes / exactly / within     (c:c is colorless)
 *   ci:wu                color identity, same operators
 *   mv<=2  cmc=3         mana value       pow>=3  tou<2
 *   r:mythic  r>=rare    rarity           s:lea   set code
 *   tag:aggro  #aggro    cube tags        cat:m   cube color category
 *   usd>=5  $<1          price, when the deck has prices loaded (unpriced cards never match)
 *   is:land is:fixing is:gold is:multicolor is:mono is:colorless is:hybrid is:owned is:commander
 *   is:basic is:dfc is:priced is:unpriced
 *   qty>=4  is:foil is:nonfoil is:free is:indeck is:unused   your copies, in the collection view
 *   -t:land              any term can be negated with a leading minus
 *
 * Plain text with no operators keeps working as a simple name search.
 */
import { colorsOf, colorCategoryOf, tagsOf, isFixing, isLand, manaValue, COLORS } from './cube.js';

const COLOR_WORDS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C' };
const GUILD_WORDS = {
  azorius: 'WU', dimir: 'UB', rakdos: 'BR', gruul: 'RG', selesnya: 'GW', orzhov: 'WB', izzet: 'UR', golgari: 'BG', boros: 'RW', simic: 'GU',
  bant: 'GWU', esper: 'WUB', grixis: 'UBR', jund: 'BRG', naya: 'RGW', abzan: 'WBG', jeskai: 'URW', sultai: 'BGU', mardu: 'RWB', temur: 'GUR',
};
const RARITIES = ['common', 'uncommon', 'rare', 'mythic'];
const RARITY_SHORT = { c: 'common', u: 'uncommon', r: 'rare', m: 'mythic' };
// Layouts with a second printed face, which a proxy needs a back for.
const DOUBLE_FACED_LAYOUTS = new Set(['transform', 'modal_dfc', 'meld', 'reversible_card', 'double_faced_token']);

/** A card's price in dollars, or null when nothing has priced it. A price of 0 means unknown. */
const priceOf = (c) => (Number.isFinite(c.price) && c.price > 0 ? c.price : null);

/** Split on spaces, keeping "quoted phrases" together. */
export function tokenize(query) {
  const tokens = [];
  const text = String(query || '').trim();
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    let j = i;
    let inQuote = false;
    while (j < text.length && (inQuote || !/\s/.test(text[j]))) {
      if (text[j] === '"') inQuote = !inQuote;
      j++;
    }
    tokens.push(text.slice(i, j));
    i = j;
  }
  return tokens;
}

function parseColors(value) {
  const v = value.toLowerCase();
  if (COLOR_WORDS[v]) return COLOR_WORDS[v] === 'C' ? [] : [COLOR_WORDS[v]];
  if (GUILD_WORDS[v]) return GUILD_WORDS[v].split('');
  if (v === 'c' || v === 'colorless') return [];
  if (v === 'm' || v === 'multicolor' || v === 'gold') return null; // handled by caller
  return COLORS.filter((c) => v.toUpperCase().includes(c));
}

function compare(actual, op, expected) {
  switch (op) {
    case ':':
    case '=': return actual === expected;
    case '!=': return actual !== expected;
    case '<': return actual < expected;
    case '<=': return actual <= expected;
    case '>': return actual > expected;
    case '>=': return actual >= expected;
    default: return false;
  }
}

function colorMatch(cardColors, op, wanted) {
  const has = (c) => cardColors.includes(c);
  const within = cardColors.every((c) => wanted.includes(c));
  const includesAll = wanted.every(has);
  if (wanted.length === 0) {
    // c:c — colorless
    return op === '!=' ? cardColors.length > 0 : cardColors.length === 0;
  }
  switch (op) {
    case ':':
    case '>=': return includesAll;
    case '=': return includesAll && within;
    case '!=': return !(includesAll && within);
    case '<=': return within;
    case '<': return within && cardColors.length < wanted.length;
    case '>': return includesAll && cardColors.length > wanted.length;
    default: return false;
  }
}

const unquote = (v) => (v.startsWith('"') && v.endsWith('"') && v.length >= 2 ? v.slice(1, -1) : v);
const numberOf = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** Turn one token into a predicate. Unknown keys fall back to a name search for the whole token. */
function predicateFor(token) {
  let negate = false;
  let t = token;
  if (t.startsWith('-') && t.length > 1) {
    negate = true;
    t = t.slice(1);
  }

  let key;
  let op;
  let value;
  if (t.startsWith('#') && t.length > 1) {
    key = 'tag';
    op = ':';
    value = t.slice(1);
  } else {
    const m = t.match(/^([a-z]+|\$)(:|!=|<=|>=|=|<|>)(.*)$/i);
    if (m) [, key, op, value] = m;
  }

  let fn;
  if (!key) {
    const needle = unquote(t).toLowerCase();
    fn = (c) => (c.name || '').toLowerCase().includes(needle);
  } else {
    key = key.toLowerCase();
    value = unquote(value || '');
    const lower = value.toLowerCase();
    switch (key) {
      case 'n':
      case 'name':
        fn = (c) => (c.name || '').toLowerCase().includes(lower);
        break;
      case 't':
      case 'type':
        fn = (c) => (c.type_line || '').toLowerCase().includes(lower);
        break;
      case 'o':
      case 'oracle':
      case 'text':
        fn = (c) => (c.oracle_text || '').toLowerCase().includes(lower);
        break;
      case 'c':
      case 'color':
      case 'ci':
      case 'id':
      case 'identity': {
        const field = key === 'c' || key === 'color' ? 'colors' : 'color_identity';
        if (['m', 'multicolor', 'gold'].includes(lower)) {
          fn = (c) => colorsOf(c, field).length > 1;
          break;
        }
        const wanted = parseColors(value);
        fn = (c) => colorMatch(colorsOf(c, field), op, wanted);
        break;
      }
      case 'mv':
      case 'cmc':
      case 'manavalue': {
        const n = numberOf(value);
        fn = n === null ? () => false : (c) => !isLand(c) && compare(manaValue(c), op, n);
        if (n === 0 && op !== '>' && op !== '>=') fn = (c) => compare(manaValue(c), op, n);
        break;
      }
      case 'pow':
      case 'power':
      case 'tou':
      case 'toughness': {
        const field = key.startsWith('p') ? 'power' : 'toughness';
        const n = numberOf(value);
        fn = (c) => {
          const v = numberOf(c[field] ?? '');
          return v !== null && n !== null && compare(v, op, n);
        };
        break;
      }
      case 'r':
      case 'rarity': {
        const wanted = RARITY_SHORT[lower] || lower;
        const rank = RARITIES.indexOf(wanted);
        fn = (c) => {
          const have = RARITIES.indexOf(c.rarity);
          return have >= 0 && rank >= 0 && compare(have, op, rank);
        };
        break;
      }
      case 'usd':
      case 'price':
      case '$': {
        const n = numberOf(value.replace(/^\$/, ''));
        fn = (c) => {
          const have = priceOf(c);
          return have !== null && n !== null && compare(have, op === ':' ? '>=' : op, n);
        };
        break;
      }
      case 's':
      case 'set':
      case 'e':
        // A collection entry can hold copies from several sets
        fn = (c) => (Array.isArray(c.set_codes) ? c.set_codes.includes(lower) : (c.set_code || '').toLowerCase() === lower);
        break;
      case 'qty':
      case 'copies':
      case 'own': {
        const n = numberOf(value);
        fn = (c) => n !== null && Number.isFinite(c.qty) && compare(c.qty, op, n);
        break;
      }
      case 'tag':
      case 'tags':
        fn = (c) => tagsOf(c).some((tag) => tag.toLowerCase() === lower);
        break;
      case 'cat':
      case 'category':
        fn = (c) => {
          const cat = colorCategoryOf(c);
          const want = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', multicolor: 'M', gold: 'M', hybrid: 'H', colorless: 'C', land: 'L', lands: 'L' }[lower] || value.toUpperCase();
          return cat === want;
        };
        break;
      case 'is':
      case 'has':
        fn = {
          land: (c) => isLand(c),
          creature: (c) => /\bCreature\b/.test(c.type_line || ''),
          fixing: (c) => isFixing(c),
          gold: (c) => colorsOf(c).length > 1,
          multicolor: (c) => colorsOf(c).length > 1,
          mono: (c) => colorsOf(c).length === 1,
          monocolor: (c) => colorsOf(c).length === 1,
          colorless: (c) => colorsOf(c).length === 0,
          hybrid: (c) => colorCategoryOf(c) === 'H',
          owned: (c) => !!c.is_owned,
          commander: (c) => !!c.is_commander,
          tagged: (c) => tagsOf(c).length > 0,
          untagged: (c) => tagsOf(c).length === 0,
          legendary: (c) => /\bLegendary\b/.test(c.type_line || ''),
          basic: (c) => /\bBasic\b/.test(c.type_line || ''),
          dfc: (c) => DOUBLE_FACED_LAYOUTS.has(c.layout),
          priced: (c) => priceOf(c) !== null,
          price: (c) => priceOf(c) !== null,
          unpriced: (c) => priceOf(c) === null,
          foil: (c) => !!c.has_foil,
          nonfoil: (c) => !!c.has_nonfoil,
          free: (c) => c.free > 0,
          available: (c) => c.free > 0,
          indeck: (c) => c.in_decks > 0,
          used: (c) => c.in_decks > 0,
          unused: (c) => Number.isFinite(c.in_decks) && c.in_decks === 0,
        }[lower] || (() => false);
        break;
      default: {
        const needle = t.toLowerCase();
        fn = (c) => (c.name || '').toLowerCase().includes(needle);
      }
    }
  }
  return negate ? (c) => !fn(c) : fn;
}

/**
 * Compile a query into a predicate. An empty query matches everything. Terms are ANDed; " or "
 * between terms splits the query into alternatives.
 */
export function compileQuery(query) {
  const text = String(query || '').trim();
  if (!text) return () => true;
  const alternatives = text.split(/\s+or\s+/i).map((part) => tokenize(part).map(predicateFor));
  return (card) => alternatives.some((preds) => preds.every((p) => p(card)));
}

/** Does the query use any operators, as opposed to plain name text? */
export function isAdvancedQuery(query) {
  return /(^|\s)-?(([a-z]+|\$)(:|!=|<=|>=|=|<|>)|#)/i.test(String(query || ''));
}
