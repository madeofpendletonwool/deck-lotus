/**
 * Mana math for a deck: which lands count as sources of which colors, how likely each spell is to
 * be castable on curve, and the odds of drawing a set of cards by a given turn.
 *
 * The mana base check follows Frank Karsten's method. A spell with mana value T and P pips of a
 * color needs P sources of that color among the cards seen by turn T. The probability is taken
 * given that you hit your land drops (at least T lands seen), so it measures your colors and not
 * flood or screw. Hands are mulliganed with the London mulligan, keeping 2-5 lands in seven, 2-4
 * in six, 1-4 in five, and anything at four. A spell counts as castable when that comes out at 90%
 * or better. The numbers are worked out exactly from the deck's own size and land count, so they
 * match his tables for a 60-card deck with typical lands and stay meaningful for 40, 99 or odd counts.
 */
import { seededRandom } from './cube.js';

export const SOURCE_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'];
export const COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };
const LAND_TYPE_COLORS = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
const LAND_TYPES = Object.keys(LAND_TYPE_COLORS);

export const CONSISTENCY_TARGET = 0.9;

const boardOf = (card) => card.board_type || (card.is_sideboard ? 'sideboard' : 'mainboard');
const qtyOf = (card) => Math.max(0, Number(card.quantity ?? 1) || 0);

// ---- Faces -----------------------------------------------------------------------------------

/** Front and back of a card. Multi-face text is stored as "front\n\n// Back Name\nback". */
export function cardFaces(card) {
  const types = String(card.type_line || '').split(' // ');
  const [frontText, ...rest] = String(card.oracle_text || '').split(/\n+\/\/ /);
  const backText = rest.length ? rest.join('\n').split('\n').slice(1).join('\n') : '';
  return {
    front: { type: types[0] || '', text: frontText || '' },
    back: rest.length || types.length > 1 ? { type: types[1] || '', text: backText } : null,
  };
}

const isLandType = (type) => /\bLand\b/.test(type || '');

/**
 * The face a card is played from as a land drop, or null. Modal double-faced cards with a land on
 * the back count, as Karsten counts them. Their back face type isn't always stored, so a back
 * face with a mana ability stands in for it.
 */
export function landFace(card) {
  const { front, back } = cardFaces(card);
  if (isLandType(front.type)) return front;
  if (card.layout === 'modal_dfc' && back) {
    if (isLandType(back.type)) return back;
    if (!back.type && /\{T\}(?:[^.]*)?: Add /.test(back.text)) return { type: 'Land', text: back.text };
  }
  return null;
}

export const isLandDrop = (card) => landFace(card) !== null;

// ---- Costs -----------------------------------------------------------------------------------

/**
 * The colored requirements of a mana cost (front face only).
 * Phyrexian symbols can be paid with life and {2/W} with generic mana, so neither needs a source.
 */
export function parseManaCost(manaCost) {
  const cost = String(manaCost || '').split(' // ')[0];
  const out = { mv: 0, x: 0, pips: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, hybrid: [] };
  for (const [, raw] of cost.matchAll(/\{([^}]+)\}/g)) {
    const sym = raw.toUpperCase();
    if (/^\d+$/.test(sym)) out.mv += Number(sym);
    else if (sym === 'X' || sym === 'Y' || sym === 'Z') out.x++;
    else if (sym in out.pips) {
      out.pips[sym]++;
      out.mv++;
    } else if (sym.includes('/')) {
      const parts = sym.split('/');
      const generic = parts.find((p) => /^\d+$/.test(p));
      out.mv += generic ? Number(generic) : 1;
      if (generic || parts.includes('P')) continue;
      const colors = SOURCE_COLORS.filter((c) => parts.includes(c));
      if (colors.length) out.hybrid.push(colors.join(''));
    }
    // Snow, half mana and the rest need no particular source
  }
  return out;
}

/**
 * What a spell needs to be cast on curve: [{ colors, need, turn }]. `colors` is one color, or
 * several for hybrid pips (a source of any of them will do). Spells with X are cast for X = 1.
 */
export function colorRequirements(card) {
  if (isLandDrop(card)) return [];
  const cost = parseManaCost(card.mana_cost);
  const turn = Math.max(1, cost.mv + (cost.x ? 1 : 0));
  const reqs = [];
  for (const color of SOURCE_COLORS) {
    if (cost.pips[color]) reqs.push({ colors: color, need: cost.pips[color], turn });
  }
  const hybrid = new Map();
  for (const colors of cost.hybrid) hybrid.set(colors, (hybrid.get(colors) || 0) + 1);
  for (const [colors, need] of hybrid) reqs.push({ colors, need, turn });
  return reqs;
}

/** "{1}{U}{U}" for two blue pips on turn three: the cost pattern the requirement stands for. */
export function requirementCost({ colors, need, turn }) {
  const sym = colors.length > 1 ? `{${colors.split('').join('/')}}` : `{${colors}}`;
  const generic = turn - need;
  return `${generic > 0 ? `{${generic}}` : ''}${sym.repeat(need)}`;
}

// ---- Mana production -------------------------------------------------------------------------

/**
 * What a land face makes, read from its types and rules text. Fetches are kept as the land types
 * (or basics) they find, since what they actually make depends on the rest of the deck.
 */
export function landProduction(face) {
  const colors = new Set();
  let anyColor = false;
  const fetchTypes = new Set();
  let fetchBasic = false;

  for (const [type, color] of Object.entries(LAND_TYPE_COLORS)) {
    if (new RegExp(`\\b${type}\\b`).test(face.type)) colors.add(color);
  }

  for (const sentence of face.text.split(/\n|\.\s/)) {
    if (/\badd\b/i.test(sentence)) {
      for (const [, sym] of sentence.matchAll(/\{([WUBRGC])\}/g)) colors.add(sym);
      if (/mana of any (?:one )?(?:color|type)|any color of mana|chosen color|mana of that color|mana of any of the/i.test(sentence)) anyColor = true;
    }
    if (/search(?:es)? (?:your|their) library for/i.test(sentence)) {
      const named = LAND_TYPES.filter((t) => new RegExp(`\\b${t}\\b`).test(sentence));
      named.forEach((t) => fetchTypes.add(t));
      if (!named.length && /basic land/i.test(sentence)) fetchBasic = true;
    }
  }
  return { colors: [...colors], anyColor, fetchTypes: [...fetchTypes], fetchBasic };
}

/**
 * For each land drop in the deck, the colors it can provide, with fetches and "any color" lands
 * resolved against what the deck actually contains.
 * @returns {Map<object, {colors: string[], via: string|null}>} keyed by deck card
 */
export function resolveSources(cards, { commanderColors = null } = {}) {
  const lands = cards.filter(isLandDrop).map((card) => {
    const face = landFace(card);
    return { card, face, prod: landProduction(face) };
  });

  // What a fetch can find: the lands in the deck with the right types (or basic supertype)
  const direct = (l) => l.prod.colors;
  const findable = (pred) => {
    const found = new Set();
    for (const l of lands) if (pred(l)) direct(l).forEach((c) => found.add(c));
    return found;
  };

  const anyColors = commanderColors?.length ? commanderColors : SOURCE_COLORS.filter((c) => c !== 'C');
  const out = new Map();
  for (const l of lands) {
    const colors = new Set(direct(l));
    let via = null;
    if (l.prod.anyColor) {
      anyColors.forEach((c) => colors.add(c));
      via = 'any color';
    }
    if (l.prod.fetchTypes.length) {
      findable((o) => o !== l && l.prod.fetchTypes.some((t) => new RegExp(`\\b${t}\\b`).test(o.face.type))).forEach((c) => colors.add(c));
      via = 'fetch';
    }
    if (l.prod.fetchBasic) {
      findable((o) => o !== l && /\bBasic\b/.test(o.card.type_line || '')).forEach((c) => colors.add(c));
      via = 'fetch';
    }
    if (!isLandType(cardFaces(l.card).front.type)) via = via || 'back face';
    out.set(l.card, { colors: SOURCE_COLORS.filter((c) => colors.has(c)), via });
  }
  return out;
}

// ---- Exact probabilities ---------------------------------------------------------------------

const LOG_FACT = [0];
function logFact(n) {
  for (let i = LOG_FACT.length; i <= n; i++) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);
  return LOG_FACT[n];
}
function logComb(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return logFact(n) - logFact(k) - logFact(n - k);
}
/** Chance of drawing exactly a, b and c cards from piles of size A, B and C. */
function trivariate(a, b, c, A, B, C) {
  return Math.exp(logComb(A, a) + logComb(B, b) + logComb(C, c) - logComb(A + B + C, a + b + c));
}

/** The keep rule Karsten simulates: lands allowed in a hand of each size. */
export const KARSTEN_KEEP = { 7: [2, 5], 6: [2, 4], 5: [1, 4] };

function keeps(lands, size) {
  const range = KARSTEN_KEEP[size];
  return !range || (lands >= range[0] && lands <= range[1]);
}

/** Hand sizes tried in order. A free first mulligan (multiplayer Commander) adds a second seven. */
export function mulliganSizes({ freeMulligan = false } = {}) {
  return freeMulligan ? [7, 7, 6, 5, 4] : [7, 6, 5, 4];
}

/**
 * London mulligan bottoming for the exact model: put back spells until lands are at most half the
 * hand, then lands, off-color lands before sources.
 */
function bottomCards(s, o, n, count, keepSize) {
  for (let i = 0; i < count; i++) {
    const lands = s + o;
    if ((lands > Math.ceil(keepSize / 2) || n === 0) && lands > 0) {
      if (o > 0) o--;
      else s--;
    } else n--;
  }
  return [s, o, n];
}

/**
 * Chance to have `need` sources among the cards seen by `turn`.
 * @returns {{ probability: number, unconditional: number, landDrops: number }}
 *   probability: given at least `turn` lands seen (Karsten's measure)
 *   unconditional: without that condition
 *   landDrops: chance of seeing `turn` lands at all
 */
export function castProbability({ deckSize, lands, sources, need, turn, onDraw = false, freeMulligan = false }) {
  const S = Math.min(sources, lands);
  const O = lands - S;
  const M = deckSize - lands;
  const draws = Math.max(0, Math.min(turn - 1 + (onDraw ? 1 : 0), deckSize - 7));
  const sizes = mulliganSizes({ freeMulligan });
  const HAND = Math.min(7, deckSize);

  let reach = 1;
  let landed = 0;
  let landedAndCast = 0;
  let cast = 0;

  sizes.forEach((keepSize, attempt) => {
    const last = attempt === sizes.length - 1;
    let kept = 0;
    for (let s = 0; s <= Math.min(HAND, S); s++) {
      for (let o = 0; o <= Math.min(HAND - s, O); o++) {
        const n = HAND - s - o;
        if (n > M) continue;
        const p = trivariate(s, o, n, S, O, M);
        if (p === 0) continue;
        const [ks, ko] = bottomCards(s, o, n, HAND - Math.min(keepSize, HAND), keepSize);
        if (!last && !keeps(ks + ko, keepSize)) continue;
        kept += p;

        // Draws come from the cards left after the seven; bottomed cards sit under them
        const rs = S - s;
        const ro = O - o;
        const rn = M - n;
        for (let ds = 0; ds <= Math.min(draws, rs); ds++) {
          for (let dO = 0; dO <= Math.min(draws - ds, ro); dO++) {
            const dn = draws - ds - dO;
            if (dn > rn) continue;
            const w = reach * p * trivariate(ds, dO, dn, rs, ro, rn);
            const enough = ks + ds >= need;
            if (enough) cast += w;
            if (ks + ko + ds + dO >= turn) {
              landed += w;
              if (enough) landedAndCast += w;
            }
          }
        }
      }
    }
    reach *= 1 - kept;
  });

  return {
    probability: landed > 0 ? landedAndCast / landed : 0,
    unconditional: cast,
    landDrops: landed,
  };
}

/** Fewest sources (out of the deck's lands) that reach the target, or null if none do. */
export function recommendedSources({ deckSize, lands, need, turn, onDraw = false, freeMulligan = false, target = CONSISTENCY_TARGET }) {
  for (let sources = need; sources <= lands; sources++) {
    if (castProbability({ deckSize, lands, sources, need, turn, onDraw, freeMulligan }).probability >= target) return sources;
  }
  return null;
}

// ---- The deck's mana base --------------------------------------------------------------------

/** Mainboard, with any commanders split out: they start in the command zone, not the library. */
export function splitDeck(cards) {
  const main = (cards || []).filter((c) => boardOf(c) === 'mainboard' && qtyOf(c) > 0);
  return {
    library: main.filter((c) => !c.is_commander),
    commanders: main.filter((c) => c.is_commander),
  };
}

const colorIdentity = (card) => SOURCE_COLORS.filter((c) => c !== 'C' && String(card.color_identity || '').includes(c));

/**
 * Everything the mana base panel shows.
 * @param cards deck cards (any boards; only the mainboard is used)
 */
export function analyzeManaBase(cards, { onDraw = false, freeMulligan = false, target = CONSISTENCY_TARGET } = {}) {
  const { library, commanders } = splitDeck(cards);
  const deckSize = library.reduce((s, c) => s + qtyOf(c), 0);
  const commanderColors = commanders.length ? [...new Set(commanders.flatMap(colorIdentity))] : null;
  const sourceMap = resolveSources(library, { commanderColors });
  const lands = [...sourceMap.keys()].reduce((s, c) => s + qtyOf(c), 0);

  const sourcesFor = (colors) => [...sourceMap].reduce((s, [card, info]) => (info.colors.some((c) => colors.includes(c)) ? s + qtyOf(card) : s), 0);

  // Group identical requirements so each is computed once and lists every card that needs it
  const groups = new Map();
  const pips = Object.fromEntries(SOURCE_COLORS.map((c) => [c, 0]));
  for (const card of [...library, ...commanders]) {
    const cost = parseManaCost(card.mana_cost);
    if (!isLandDrop(card)) for (const c of SOURCE_COLORS) pips[c] += cost.pips[c] * qtyOf(card);
    for (const req of colorRequirements(card)) {
      const key = `${req.colors}|${req.need}|${req.turn}`;
      if (!groups.has(key)) groups.set(key, { ...req, cards: [] });
      groups.get(key).cards.push({ name: card.name, quantity: qtyOf(card), card });
    }
  }

  const canCompute = deckSize >= 8 && lands > 0;
  const requirements = [...groups.values()].map((req) => {
    const sources = sourcesFor(req.colors);
    const result = canCompute
      ? castProbability({ deckSize, lands, sources, need: req.need, turn: req.turn, onDraw, freeMulligan })
      : { probability: 0, unconditional: 0, landDrops: 0 };
    const recommended = canCompute ? recommendedSources({ deckSize, lands, need: req.need, turn: req.turn, onDraw, freeMulligan, target }) : null;
    return { ...req, sources, ...result, recommended, ok: result.probability >= target };
  });
  requirements.sort((a, b) => a.probability - b.probability || b.need - a.need);

  const colors = SOURCE_COLORS.map((color) => {
    const reqs = requirements.filter((r) => r.colors.includes(color) && r.colors.length === 1);
    const hybridReqs = requirements.filter((r) => r.colors.includes(color) && r.colors.length > 1);
    const worst = reqs[0] || null;
    const needed = reqs.reduce((m, r) => Math.max(m, r.recommended ?? Infinity), 0);
    return {
      color,
      sources: sourcesFor(color),
      pips: pips[color],
      spells: new Set([...reqs, ...hybridReqs].flatMap((r) => r.cards.map((c) => c.name))).size,
      requirements: reqs,
      worst,
      recommended: reqs.length ? needed : null,
    };
  }).filter((c) => c.requirements.length || (c.color !== 'C' && c.sources > 0) || c.pips);

  const landRows = [...sourceMap].map(([card, info]) => ({ card, name: card.name, quantity: qtyOf(card), ...info }))
    .sort((a, b) => b.colors.length - a.colors.length || a.name.localeCompare(b.name));

  return {
    deckSize,
    lands,
    nonlands: deckSize - lands,
    commanders,
    onDraw,
    freeMulligan,
    target,
    colors,
    requirements,
    hybrid: requirements.filter((r) => r.colors.length > 1),
    landRows,
    canCompute,
  };
}

// ---- Draw odds (simulation) ------------------------------------------------------------------

/** One entry per physical card in the library. */
export function expandLibrary(cards) {
  const out = [];
  for (const card of cards) for (let i = 0; i < qtyOf(card); i++) out.push(card);
  return out;
}

/**
 * Chance of having seen everything in `goals` by each turn, by simulation.
 *
 * @param library one entry per physical card
 * @param goals [{ count, test(card) }]: at least `count` cards passing `test`
 * @param options.mulligan null for never, or { minLands, maxLands, minHandSize }: mulligan a hand
 *   outside the land range until it would go below minHandSize (London: draw seven, bottom one per
 *   mulligan, keeping the cards the goals need)
 * @returns {{ byTurn: number[], keptSize: Record<number, number>, trials: number }}
 *   byTurn[t] for t = 1..turns, keptSize: share of games kept at each hand size
 */
export function simulateDrawOdds(library, goals, {
  turns = 8,
  onDraw = false,
  mulligan = null,
  freeMulligan = false,
  trials = 20000,
  seed = 1,
} = {}) {
  const n = library.length;
  const byTurn = new Array(turns + 1).fill(0);
  const keptSize = {};
  if (n === 0 || !goals.length) return { byTurn: byTurn.map(() => 0), keptSize, trials: 0 };

  const masks = goals.map((g) => Uint8Array.from(library, (card) => (g.test(card) ? 1 : 0)));
  const land = Uint8Array.from(library, (card) => (isLandDrop(card) ? 1 : 0));
  const mv = Float64Array.from(library, (card) => Number(card.cmc) || 0);
  const needs = goals.map((g) => Math.max(0, Number(g.count) || 0));
  const order = Int32Array.from({ length: n }, (_, i) => i);
  const rng = seededRandom(seed);
  const handSize = Math.min(7, n);
  const maxDraws = Math.max(0, Math.min(turns - 1 + (onDraw ? 1 : 0), n - handSize));
  const have = new Int32Array(goals.length);
  const bottomed = new Uint8Array(handSize);

  const shuffleFrom = (start, count) => {
    for (let i = start; i < start + count && i < n; i++) {
      const j = i + Math.floor(rng() * (n - i));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
  };

  /** London bottoming: keep what the goals need; of the rest, trim lands past half the hand, then the costliest spells. */
  const bottom = (count, keepSize) => {
    bottomed.fill(0);
    if (count <= 0) return;
    const useful = new Uint8Array(handSize);
    goals.forEach((_, g) => {
      let got = 0;
      for (let i = 0; i < handSize && got < needs[g]; i++) if (masks[g][order[i]] && useful[i]) got++;
      for (let i = 0; i < handSize && got < needs[g]; i++) {
        if (masks[g][order[i]] && !useful[i]) {
          useful[i] = 1;
          got++;
        }
      }
    });
    for (let k = 0; k < count; k++) {
      let lands = 0;
      for (let i = 0; i < handSize; i++) if (!bottomed[i] && land[order[i]]) lands++;
      const preferLand = lands > Math.ceil(keepSize / 2);
      let pick = -1;
      let best = -Infinity;
      for (let i = 0; i < handSize; i++) {
        if (bottomed[i]) continue;
        const c = order[i];
        // Lower tiers go first: not needed before needed, then the land/spell preference
        let score = useful[i] ? 0 : 1000;
        score += land[c] === (preferLand ? 1 : 0) ? 100 : 0;
        score += land[c] ? 0 : mv[c];
        if (score > best) {
          best = score;
          pick = i;
        }
      }
      bottomed[pick] = 1;
    }
  };

  for (let t = 0; t < trials; t++) {
    let mulls = 0;
    let keepSize = handSize;
    for (;;) {
      shuffleFrom(0, handSize);
      const free = freeMulligan && mulls >= 1 ? 1 : 0;
      keepSize = Math.max(0, handSize - Math.max(0, mulls - free));
      bottom(handSize - keepSize, keepSize);
      if (!mulligan) break;
      let lands = 0;
      for (let i = 0; i < handSize; i++) if (!bottomed[i] && land[order[i]]) lands++;
      const nextSize = handSize - Math.max(0, mulls + 1 - (freeMulligan ? 1 : 0));
      const ok = lands >= mulligan.minLands && lands <= mulligan.maxLands;
      if (ok || nextSize < (mulligan.minHandSize ?? 5)) break;
      mulls++;
    }
    keptSize[keepSize] = (keptSize[keepSize] || 0) + 1;

    have.fill(0);
    for (let i = 0; i < handSize; i++) {
      if (bottomed[i]) continue;
      for (let g = 0; g < goals.length; g++) have[g] += masks[g][order[i]];
    }
    shuffleFrom(handSize, maxDraws);
    let drawn = 0;
    for (let turn = 1; turn <= turns; turn++) {
      const target = Math.min(maxDraws, turn - 1 + (onDraw ? 1 : 0));
      while (drawn < target) {
        const c = order[handSize + drawn];
        for (let g = 0; g < goals.length; g++) have[g] += masks[g][c];
        drawn++;
      }
      let met = true;
      for (let g = 0; g < goals.length; g++) if (have[g] < needs[g]) met = false;
      if (met) byTurn[turn]++;
    }
  }

  for (const size of Object.keys(keptSize)) keptSize[size] /= trials;
  return { byTurn: byTurn.map((v) => v / trials), keptSize, trials };
}

/** Exact chance of at least `atLeast` hits in `draws` cards from a deck of `deckSize` with `hits` successes. */
export function hypergeometricAtLeast(deckSize, hits, draws, atLeast) {
  let p = 0;
  for (let k = Math.max(0, atLeast); k <= Math.min(hits, draws); k++) {
    p += Math.exp(logComb(hits, k) + logComb(deckSize - hits, draws - k) - logComb(deckSize, draws));
  }
  return Math.min(1, p);
}
