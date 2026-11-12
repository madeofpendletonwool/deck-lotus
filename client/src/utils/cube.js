/**
 * Cube logic with no DOM: color categories, analysis, pack generation and the draft bots.
 * Kept pure so it can be unit tested and shared between the builder and the public share page.
 */

export const COLORS = ['W', 'U', 'B', 'R', 'G'];
export const COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

/** Cube columns, in CubeCobra's order. */
export const COLOR_CATEGORIES = [
  { id: 'W', label: 'White' },
  { id: 'U', label: 'Blue' },
  { id: 'B', label: 'Black' },
  { id: 'R', label: 'Red' },
  { id: 'G', label: 'Green' },
  { id: 'M', label: 'Multicolor' },
  { id: 'H', label: 'Hybrid' },
  { id: 'C', label: 'Colorless' },
  { id: 'L', label: 'Lands' },
];
const CATEGORY_IDS = new Set(COLOR_CATEGORIES.map((c) => c.id));

/** Two-color pairs in the conventional order, with their nicknames. */
export const GUILDS = [
  { id: 'WU', name: 'Azorius' }, { id: 'UB', name: 'Dimir' }, { id: 'BR', name: 'Rakdos' },
  { id: 'RG', name: 'Gruul' }, { id: 'WG', name: 'Selesnya' }, { id: 'WB', name: 'Orzhov' },
  { id: 'UR', name: 'Izzet' }, { id: 'BG', name: 'Golgari' }, { id: 'WR', name: 'Boros' },
  { id: 'UG', name: 'Simic' },
];

export const TYPE_BUCKETS = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land', 'Other'];

const boardOf = (card) => card.board_type || (card.is_sideboard ? 'sideboard' : 'mainboard');

/** Colors as an array in WUBRG order, from MTGJSON's "B, G" strings, "BG" or an array. */
export function colorsOf(card, field = 'colors') {
  const raw = card[field];
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/).filter(Boolean).flatMap((s) => (s.length > 1 ? s.split('') : [s]));
  return COLORS.filter((c) => list.includes(c));
}

/** The order-independent key for a set of colors: "WU", "BRG", "" for colorless. */
export function colorKey(colors) {
  return COLORS.filter((c) => colors.includes(c)).join('');
}

/** The pair id GUILDS uses for a two-color combination, e.g. ['G','W'] → 'WG'. */
export function guildOf(colors) {
  const key = colorKey(colors);
  if (key.length !== 2) return null;
  return GUILDS.find((g) => colorKey(g.id.split('')) === key)?.id || null;
}

export function frontType(card) {
  return (card.type_line || '').split(' // ')[0];
}

export function isLand(card) {
  return /\bLand\b/.test(frontType(card));
}

export function typeBucket(card) {
  const type = frontType(card);
  if (/\bLand\b/.test(type)) return 'Land';
  for (const bucket of ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment']) {
    if (new RegExp(`\\b${bucket}\\b`).test(type)) return bucket;
  }
  return 'Other';
}

/** Is every colored symbol in the mana cost hybrid ({W/U}, {2/R})? */
function isHybridCost(manaCost) {
  const symbols = (manaCost || '').match(/\{[^}]+\}/g) || [];
  const colored = symbols.filter((s) => /[WUBRG]/.test(s));
  return colored.length > 0 && colored.every((s) => /\//.test(s) && !/\/P\}/.test(s));
}

/** Where a card sorts in a cube unless its owner overrides it. */
export function defaultColorCategory(card) {
  if (isLand(card)) return 'L';
  const colors = colorsOf(card);
  if (colors.length === 0) return 'C';
  if (colors.length === 1) return colors[0];
  return isHybridCost(card.mana_cost) ? 'H' : 'M';
}

export function colorCategoryOf(card) {
  return CATEGORY_IDS.has(card.color_category) ? card.color_category : defaultColorCategory(card);
}

export function tagsOf(card) {
  const raw = card.tags;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Mana value for curves. Lands sit outside the curve. Split cards use the cheaper half's printed total. */
export function manaValue(card) {
  return Math.max(0, Math.floor(Number(card.cmc) || 0));
}

export function cmcBucket(card) {
  const mv = manaValue(card);
  return mv >= 7 ? '7+' : String(mv);
}
export const CMC_BUCKETS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

const LAND_TYPE_COLORS = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

/**
 * The colors of mana a land or mana rock can make or fetch, worked out from its type line and
 * rules text. Approximate on purpose: good enough to count fixing, not a rules engine.
 */
export function producedColors(card) {
  const type = frontType(card);
  const text = (card.oracle_text || '').split('\n//')[0];
  const found = new Set();

  for (const [landType, color] of Object.entries(LAND_TYPE_COLORS)) {
    if (new RegExp(`\\b${landType}\\b`).test(type)) found.add(color);
  }
  if (/mana of any (one )?color|mana of any type|any color of mana/i.test(text)) COLORS.forEach((c) => found.add(c));

  for (const sentence of text.split(/[.\n]/)) {
    if (/\badd\b/i.test(sentence)) {
      for (const m of sentence.matchAll(/\{([WUBRG])\}/g)) found.add(m[1]);
    }
    // Fetch lands: "Search your library for a Forest or Plains card"
    if (/search your library for an? /i.test(sentence) && /\bcard\b/i.test(sentence)) {
      for (const [landType, color] of Object.entries(LAND_TYPE_COLORS)) {
        if (new RegExp(`\\b${landType}\\b`).test(sentence)) found.add(color);
      }
      if (/basic land card/i.test(sentence) && /any color|onto the battlefield/i.test(sentence) && /\bLand\b/.test(type) && found.size === 0) {
        // Evolving Wilds and friends fetch any basic
        COLORS.forEach((c) => found.add(c));
      }
    }
  }
  return COLORS.filter((c) => found.has(c));
}

/** Lands and rocks that make two or more colors. */
export function isFixing(card) {
  const type = frontType(card);
  if (!/\b(Land|Artifact)\b/.test(type) && !/\bCreature\b/.test(type)) return false;
  if (/\bCreature\b/.test(type) && !/\bLand\b/.test(type)) return false; // Leave mana dorks out
  return producedColors(card).length >= 2;
}

/** The cube's main pool, one entry per row (quantities kept on the row). */
export function cubeCards(cards) {
  return (cards || []).filter((c) => boardOf(c) === 'mainboard');
}

const sumQty = (list) => list.reduce((s, c) => s + (c.quantity ?? 1), 0);

/**
 * Everything the analysis view shows, computed in one pass.
 */
export function analyzeCube(cards) {
  const pool = cubeCards(cards);
  const total = sumQty(pool);

  const categories = {};
  for (const { id } of COLOR_CATEGORIES) {
    categories[id] = { count: 0, creatures: 0, curve: Object.fromEntries(CMC_BUCKETS.map((b) => [b, 0])), mvTotal: 0, nonland: 0, types: {} };
  }
  const guilds = Object.fromEntries(GUILDS.map((g) => [g.id, { gold: 0, fixing: 0, cards: [] }]));
  const fixingByColor = Object.fromEntries(COLORS.map((c) => [c, 0]));
  const types = Object.fromEntries(TYPE_BUCKETS.map((t) => [t, 0]));
  const tagCounts = new Map();
  const rarity = {};
  const curve = Object.fromEntries(CMC_BUCKETS.map((b) => [b, 0]));
  let fixingTotal = 0;
  let creatures = 0;
  let mvTotal = 0;
  let nonland = 0;

  for (const card of pool) {
    const n = card.quantity ?? 1;
    const category = colorCategoryOf(card);
    const bucket = typeBucket(card);
    const entry = categories[category];
    entry.count += n;
    entry.types[bucket] = (entry.types[bucket] || 0) + n;
    types[bucket] += n;
    if (bucket === 'Creature') {
      entry.creatures += n;
      creatures += n;
    }
    if (!isLand(card)) {
      entry.curve[cmcBucket(card)] += n;
      curve[cmcBucket(card)] += n;
      entry.mvTotal += manaValue(card) * n;
      entry.nonland += n;
      mvTotal += manaValue(card) * n;
      nonland += n;
    }
    if (card.rarity) rarity[card.rarity] = (rarity[card.rarity] || 0) + n;
    for (const tag of tagsOf(card)) tagCounts.set(tag, (tagCounts.get(tag) || 0) + n);

    const colors = colorsOf(card);
    const guild = guildOf(colors);
    if (guild && !isLand(card)) {
      guilds[guild].gold += n;
      guilds[guild].cards.push(card.name);
    }

    if (isFixing(card)) {
      fixingTotal += n;
      const produced = producedColors(card);
      for (const c of produced) fixingByColor[c] += n;
      if (produced.length === 2) {
        const pair = guildOf(produced);
        if (pair) guilds[pair].fixing += n;
      } else if (produced.length > 2) {
        // Tri-lands and rainbow lands help every pair they cover
        for (const g of GUILDS) {
          if (g.id.split('').every((c) => produced.includes(c))) guilds[g.id].fixing += n / (produced.length * (produced.length - 1) / 2);
        }
      }
    }
  }

  for (const entry of Object.values(categories)) {
    entry.avgMv = entry.nonland ? entry.mvTotal / entry.nonland : 0;
  }

  const monoCounts = COLORS.map((c) => categories[c].count);
  const monoAvg = monoCounts.reduce((a, b) => a + b, 0) / COLORS.length;
  const balance = COLORS.map((c) => ({
    color: c,
    count: categories[c].count,
    diff: categories[c].count - monoAvg,
  }));

  return {
    total,
    unique: pool.length,
    categories,
    guilds,
    fixingByColor,
    fixingTotal,
    types,
    curve,
    rarity,
    creatures,
    avgMv: nonland ? mvTotal / nonland : 0,
    balance,
    monoAvg,
    tags: [...tagCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

/** "create a 1/1 white Spirit creature token with flying" → "1/1 white Spirit creature with flying" */
export function tokensMade(card) {
  const text = (card.oracle_text || '').replace(/\([^)]*\)/g, '');
  const found = new Set();
  const add = (desc) => {
    const clean = desc.replace(/\s+/g, ' ').trim();
    // "create one or more tokens" talks about tokens in general, not a kind to bring
    if (!clean || /^(or more|or|and|of|tokens?)\b/i.test(clean)) return;
    found.add(clean.charAt(0).toUpperCase() + clean.slice(1));
  };
  // Longer counts first, so "a number of" isn't read as "a" + "number of"
  const count = '(?:a number of|that many|twice that many|one or more|that number of|x|an?|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)';
  const re = new RegExp(`create[sd]?\\s+${count}\\s+(?:tapped\\s+)?(?:and attacking\\s+)?(.+?)\\s+tokens?\\b(?:\\s+(with [^.,;]+?|named [^.,;]+?))?(?=[.,;]|\\s+(?:and|or|that|for|at|in|where|under|equal|attached|instead|until)\\b|$)`, 'gi');
  for (const m of text.matchAll(re)) {
    let desc = m[1];
    if (/^(copy|copies)\b|^(that|those|the|it)\b/i.test(desc) || desc.length > 70) desc = 'Copy of a permanent';
    add(m[2] ? `${desc} ${m[2]}` : desc);
  }
  // "create a Food token or a Treasure token": pick up the second kind too
  for (const m of text.matchAll(/tokens?\s+or\s+an?\s+([A-Z][\w-]*(?: [A-Z][\w-]*)?)\s+tokens?/g)) add(m[1]);
  if (/you get an emblem/i.test(text)) add(`Emblem (${card.name})`);
  return [...found];
}

// ---- Randomness ------------------------------------------------------------------------------

/** Small fast seeded PRNG, so a pack or draft can be replayed from its seed. */
export function seededRandom(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed() {
  return Math.floor(Math.random() * 2 ** 31) + 1;
}

export function shuffle(items, rng = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** One entry per physical card, each with a unique `uid`. */
export function expandPool(cards) {
  const out = [];
  for (const card of cubeCards(cards)) {
    for (let i = 0; i < (card.quantity ?? 1); i++) out.push({ ...card, uid: `${card.deck_card_id ?? card.name}:${i}` });
  }
  return out;
}

/**
 * Deal packs from the cube. Returns packs[round][seat]. If the cube is too small for a full
 * draft, `short` says how many cards were missing and the packs are dealt as evenly as possible.
 */
export function makePacks(cards, { seats = 8, packsPerPlayer = 3, packSize = 15 } = {}, rng = Math.random) {
  const pool = shuffle(expandPool(cards), rng);
  const needed = seats * packsPerPlayer * packSize;
  const short = Math.max(0, needed - pool.length);
  const perPack = short ? Math.floor(pool.length / (seats * packsPerPlayer)) : packSize;
  const packs = [];
  let i = 0;
  for (let round = 0; round < packsPerPlayer; round++) {
    packs.push([]);
    for (let seat = 0; seat < seats; seat++) {
      packs[round].push(pool.slice(i, i + perPack));
      i += perPack;
    }
  }
  return { packs, short, packSize: perPack };
}

// ---- Draft bots ------------------------------------------------------------------------------

const RARITY_BONUS = { mythic: 0.08, rare: 0.05, uncommon: 0.02 };

/**
 * A rough 0–1 power rating. EDHREC rank is the only popularity signal in the card data; it skews
 * toward multiplayer staples, so rarity and a little noise keep bots from all agreeing.
 */
export function cardPower(card) {
  const rank = Number(card.edhrec_rank);
  const base = rank > 0 ? Math.max(0.05, 1 - Math.log10(rank) / 4.6) : 0.3;
  return Math.min(1, base + (RARITY_BONUS[card.rarity] || 0));
}

/** A bot's color preference so far: summed power of its picks per color. */
export function colorCommitment(picks) {
  const weights = Object.fromEntries(COLORS.map((c) => [c, 0]));
  for (const card of picks) {
    const colors = colorsOf(card);
    for (const c of colors) weights[c] += cardPower(card) / colors.length;
  }
  return weights;
}

/** Score a card for a bot holding `picks`. Higher is better. */
export function scorePick(card, picks, rng = Math.random) {
  const power = cardPower(card);
  const weights = colorCommitment(picks);
  const top = COLORS.filter((c) => weights[c] > 0).sort((a, b) => weights[b] - weights[a]).slice(0, 2);
  const commitment = Math.min(1, picks.length / 8);
  const colors = isLand(card) && isFixing(card) ? producedColors(card) : colorsOf(card);

  let fit = 0;
  if (colors.length === 0) fit = 0.05;
  else if (top.length === 0) fit = 0;
  else {
    const off = colors.filter((c) => !top.includes(c)).length;
    const on = colors.length - off;
    fit = on * 0.18 - off * 0.3;
  }
  return power + fit * commitment + (rng() - 0.5) * 0.06;
}

export function botPick(pack, picks, rng = Math.random) {
  let best = 0;
  let bestScore = -Infinity;
  pack.forEach((card, i) => {
    const score = scorePick(card, picks, rng);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/**
 * A full draft against bots. The person drafting sits in seat 0. Packs pass left in odd-numbered
 * rounds (1st, 3rd) and right in the 2nd, as at a real table.
 */
export class Draft {
  constructor(cards, settings = {}, seed = newSeed()) {
    this.seed = seed;
    this.rng = seededRandom(seed);
    this.settings = { seats: 8, packsPerPlayer: 3, packSize: 15, ...settings };
    const { packs, short, packSize } = makePacks(cards, this.settings, this.rng);
    this.allPacks = packs;
    this.short = short;
    this.packSize = packSize;
    this.round = 0;
    this.pickInRound = 0;
    this.picks = Array.from({ length: this.settings.seats }, () => []);
    this.log = []; // { round, pick, card, pack (what else was in it) }
    this.current = packs[0] ? packs[0].map((p) => [...p]) : [];
  }

  get seats() {
    return this.settings.seats;
  }

  get isDone() {
    return this.round >= this.allPacks.length || this.packSize === 0;
  }

  /** The pack in front of the person drafting. */
  get pack() {
    return this.isDone ? [] : this.current[0];
  }

  get pool() {
    return this.picks[0];
  }

  get pickNumber() {
    return this.pickInRound + 1;
  }

  /** The person picks `uid` from their pack; every bot picks too, then packs pass. */
  pick(uid) {
    if (this.isDone) return;
    const mine = this.current[0];
    const index = mine.findIndex((c) => c.uid === uid);
    if (index < 0) throw new Error('That card is not in your pack');

    this.log.push({ round: this.round + 1, pick: this.pickNumber, card: mine[index], pack: mine.map((c) => c.name) });
    this.picks[0].push(mine.splice(index, 1)[0]);

    for (let seat = 1; seat < this.seats; seat++) {
      const pack = this.current[seat];
      if (!pack.length) continue;
      const i = botPick(pack, this.picks[seat], this.rng);
      this.picks[seat].push(pack.splice(i, 1)[0]);
    }

    this.pickInRound++;
    if (this.current[0].length === 0) {
      this.round++;
      this.pickInRound = 0;
      this.current = this.round < this.allPacks.length ? this.allPacks[this.round].map((p) => [...p]) : [];
      return;
    }
    // Pass: left means seat i receives the pack from seat i-1
    const left = this.round % 2 === 0;
    const n = this.seats;
    this.current = this.current.map((_, seat) => this.current[left ? (seat - 1 + n) % n : (seat + 1) % n]);
  }

  /** Let the bots pick for you until the end. Handy for a quick look at a finished pool. */
  autoPick() {
    while (!this.isDone) {
      const i = botPick(this.pack, this.pool, this.rng);
      this.pick(this.pack[i].uid);
    }
  }
}

/** Open `count` packs for a sealed pool. */
export function makeSealedPool(cards, { packs = 6, packSize = 15 } = {}, seed = newSeed()) {
  const rng = seededRandom(seed);
  const pool = shuffle(expandPool(cards), rng).slice(0, packs * packSize);
  return { seed, pool, short: Math.max(0, packs * packSize - pool.length) };
}

/** A sample pack. */
export function makeSamplePack(cards, packSize = 15, seed = newSeed()) {
  const rng = seededRandom(seed);
  return { seed, pack: shuffle(expandPool(cards), rng).slice(0, packSize) };
}

/** Group cards for display: by color category, then by mana value. */
export function sortForDisplay(cards) {
  const order = new Map(COLOR_CATEGORIES.map((c, i) => [c.id, i]));
  return [...cards].sort((a, b) =>
    order.get(colorCategoryOf(a)) - order.get(colorCategoryOf(b)) ||
    (isLand(a) - isLand(b)) ||
    manaValue(a) - manaValue(b) ||
    (a.name || '').localeCompare(b.name || ''));
}

/** A decklist line for each card, for saving a draft or sealed pool as a deck. */
export function poolToDeckList(pool) {
  const counts = new Map();
  for (const card of pool) {
    const key = card.set_code ? `${card.name} (${card.set_code.toUpperCase()})${card.collector_number ? ` ${card.collector_number}` : ''}` : card.name;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].map(([line, n]) => `${n} ${line}`);
}

// ---- CubeCobra CSV --------------------------------------------------------------------------

const CATEGORY_TO_CUBECOBRA = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Multicolored', H: 'Hybrid', C: 'Colorless', L: 'Lands' };

function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CubeCobra's CSV export layout, so a cube can move between the two sites. */
export function toCubeCobraCsv(cards) {
  const header = ['name', 'CMC', 'Type', 'Color', 'Set', 'Collector Number', 'Rarity', 'Color Category', 'status', 'Finish', 'maybeboard', 'image URL', 'image Back URL', 'tags', 'Notes', 'MTGO ID'];
  const rows = [header];
  for (const card of cards || []) {
    const board = boardOf(card);
    if (board === 'sideboard') continue;
    for (let i = 0; i < (card.quantity ?? 1); i++) {
      rows.push([
        card.name,
        card.cmc ?? '',
        card.type_line || '',
        colorsOf(card).join(''),
        card.set_code ? card.set_code.toLowerCase() : '',
        card.collector_number || '',
        card.rarity || '',
        CATEGORY_TO_CUBECOBRA[colorCategoryOf(card)],
        card.is_owned ? 'Owned' : 'Not Owned',
        'Non-foil',
        board === 'maybeboard' ? 'true' : 'false',
        '',
        '',
        tagsOf(card).join(';'),
        card.notes || '',
        '',
      ]);
    }
  }
  return rows.map((r) => r.map(csvField).join(',')).join('\n');
}
