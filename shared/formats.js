/**
 * Format registry and deck validation, shared by the server (legality checks) and the client
 * (format pickers, commander controls, size readouts). Pure functions only: no DOM, no database.
 *
 * Card legality comes from MTGJSON's `legalities` object, keyed by the `legality` field below.
 * MTGJSON reports one of 'Legal', 'Banned', 'Restricted' or null (not legal). What 'Restricted'
 * means depends on the format: one copy in Vintage-style formats, "can't be your commander" in
 * Duel Commander.
 *
 * Commander eligibility comes from MTGJSON `leadership_skills` ({ commander, brawl, oathbreaker,
 * pauper_commander, predh }), with a rules-text heuristic for rows imported before that existed.
 */

export const FORMAT_GROUPS = ['Constructed', 'Commander', 'Highlander', 'Multiplayer', 'Limited', 'Cube'];

const constructed = (id, label, legality, extra = {}) => ({
  id,
  label,
  group: 'Constructed',
  legality,
  deckSize: { min: 60 },
  copies: 4,
  sideboard: 15,
  restricted: 'one',
  ...extra,
});

const commanderFormat = (id, label, legality, skill, extra = {}) => ({
  id,
  label,
  group: 'Commander',
  legality,
  deckSize: { exact: 100 },
  copies: 1,
  sideboard: null,
  restricted: 'one',
  commander: { skill, max: 2, colorIdentity: true },
  ...extra,
});

export const FORMATS = [
  constructed('standard', 'Standard', 'standard', { description: 'The most recent sets' }),
  constructed('pioneer', 'Pioneer', 'pioneer', { description: 'Return to Ravnica forward' }),
  constructed('modern', 'Modern', 'modern', { description: 'Eighth Edition forward' }),
  constructed('premodern', 'Premodern', 'premodern', { description: 'Fourth Edition through Scourge' }),
  constructed('legacy', 'Legacy', 'legacy'),
  constructed('vintage', 'Vintage', 'vintage', { description: 'Restricted cards are limited to one copy' }),
  constructed('pauper', 'Pauper', 'pauper', { description: 'Commons only' }),
  constructed('timeless', 'Timeless', 'timeless', { description: 'Arena’s eternal format' }),
  constructed('historic', 'Historic', 'historic'),
  constructed('alchemy', 'Alchemy', 'alchemy'),
  constructed('penny', 'Penny Dreadful', 'penny'),
  constructed('oldschool', 'Old School 93/94', 'oldschool'),
  constructed('future', 'Future Standard', 'future'),

  commanderFormat('commander', 'Commander', 'commander', 'commander'),
  commanderFormat('duel', 'Duel Commander', 'duel', 'commander', {
    restricted: 'not-commander',
    description: 'Restricted cards can’t be your commander',
  }),
  commanderFormat('paupercommander', 'Pauper Commander', 'paupercommander', 'pauper_commander', {
    description: 'Commons, led by an uncommon creature',
  }),
  commanderFormat('brawl', 'Brawl', 'brawl', 'brawl', {
    description: '100 cards, Arena card pool',
  }),
  commanderFormat('standardbrawl', 'Standard Brawl', 'standardbrawl', 'brawl', {
    deckSize: { exact: 60 },
    description: '60 cards, Standard card pool',
  }),
  commanderFormat('oathbreaker', 'Oathbreaker', 'oathbreaker', 'oathbreaker', {
    deckSize: { exact: 60 },
    commander: { skill: 'oathbreaker', max: 2, colorIdentity: true, signatureSpell: true },
    description: 'A planeswalker and its signature spell',
  }),
  commanderFormat('predh', 'Pre-EDH', 'predh', 'predh'),

  {
    id: 'canlander',
    label: 'Canadian Highlander',
    group: 'Highlander',
    legality: 'vintage',
    deckSize: { min: 100 },
    copies: 1,
    sideboard: null,
    restricted: 'allowed',
    points: { cap: 10 },
    description: '100-card singleton with a 10 point budget',
  },
  {
    id: 'gladiator',
    label: 'Gladiator',
    group: 'Highlander',
    legality: 'gladiator',
    deckSize: { exact: 100 },
    copies: 1,
    sideboard: null,
    restricted: 'one',
    description: '100-card singleton on Arena',
  },

  {
    id: 'twoheadedgiant',
    label: 'Two-Headed Giant',
    group: 'Multiplayer',
    baseFormat: { default: 'standard' },
    teamCopyLimit: true,
    description: 'Team play on a shared life total; uses a constructed card pool',
  },

  {
    id: 'limited',
    label: 'Limited (Draft / Sealed)',
    group: 'Limited',
    legality: null,
    deckSize: { min: 40 },
    copies: null,
    sideboard: null,
    restricted: 'allowed',
    description: '40 cards from your pool',
  },

  {
    id: 'cube',
    label: 'Cube',
    group: 'Cube',
    legality: null,
    deckSize: null,
    copies: null,
    sideboard: null,
    restricted: 'allowed',
    isCube: true,
    description: 'A curated pool to draft from',
  },
];

const BY_ID = new Map(FORMATS.map((f) => [f.id, f]));

/** Formats a two-headed giant team can pick as its card pool. */
export const TWO_HEADED_GIANT_BASES = FORMATS.filter((f) => f.group === 'Constructed').map((f) => f.id);

/** Card pools a cube can be restricted to. `legality` keys are MTGJSON formats. */
export const CUBE_CARD_POOLS = [
  { id: '', label: 'Any card' },
  { id: 'vintage', label: 'Vintage legal', legality: 'vintage' },
  { id: 'legacy', label: 'Legacy legal', legality: 'legacy' },
  { id: 'modern', label: 'Modern legal', legality: 'modern' },
  { id: 'pioneer', label: 'Pioneer legal', legality: 'pioneer' },
  { id: 'premodern', label: 'Premodern legal', legality: 'premodern' },
  { id: 'pauper', label: 'Pauper (commons)', legality: 'pauper' },
  { id: 'peasant', label: 'Peasant (commons and uncommons)', maxRarity: 'uncommon' },
  { id: 'commander', label: 'Commander legal', legality: 'commander' },
];

export const DEFAULT_CUBE_SETTINGS = Object.freeze({
  targetSize: 360,
  packSize: 15,
  packsPerPlayer: 3,
  seats: 8,
  singleton: true,
  cardPool: '',
});

export function getFormat(id) {
  return BY_ID.get(id) || null;
}

export function formatLabel(id) {
  if (!id) return 'No format';
  return BY_ID.get(id)?.label || id;
}

export function isCubeFormat(id) {
  return !!BY_ID.get(id)?.isCube;
}

export function isCommanderFormat(id) {
  return !!BY_ID.get(id)?.commander;
}

/** Formats grouped for a <select>, in display order. */
export function groupedFormats() {
  return FORMAT_GROUPS.map((group) => ({ group, formats: FORMATS.filter((f) => f.group === group) }))
    .filter((g) => g.formats.length > 0);
}

/**
 * The rules a deck is held to: the format itself, or for two-headed giant its chosen card pool.
 */
export function resolveRules(formatId, options = {}) {
  const format = BY_ID.get(formatId);
  if (!format) return null;
  if (format.baseFormat) {
    const base = BY_ID.get(options.baseFormat) || BY_ID.get(format.baseFormat.default);
    return { ...base, id: format.id, label: format.label, group: format.group, baseFormat: base.id, teamCopyLimit: true };
  }
  if (format.isCube) {
    const settings = { ...DEFAULT_CUBE_SETTINGS, ...(options || {}) };
    const pool = CUBE_CARD_POOLS.find((p) => p.id === settings.cardPool) || CUBE_CARD_POOLS[0];
    return {
      ...format,
      legality: pool.legality || null,
      maxRarity: pool.maxRarity || null,
      poolLabel: pool.label,
      copies: settings.singleton ? 1 : null,
      targetSize: Number(settings.targetSize) || null,
    };
  }
  return format;
}

/** "100 cards", "60+ cards". */
export function deckSizeLabel(rules) {
  if (!rules?.deckSize) return '';
  const { exact, min, max } = rules.deckSize;
  if (exact) return `${exact} cards`;
  if (min && max) return `${min}–${max} cards`;
  if (min) return `${min}+ cards`;
  return '';
}

// ---- Card helpers -----------------------------------------------------------------------------

const boardOf = (card) => card.board_type || (card.is_sideboard ? 'sideboard' : 'mainboard');

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** MTGJSON color identities are stored as "B, G" strings; arrays and "BG" also work. */
export function colorIdentityOf(card) {
  const raw = card.color_identity;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return String(raw).split(/[\s,]+/).filter(Boolean).flatMap((s) => (s.length > 1 ? s.split('') : [s]));
}

export function isBasicLand(card) {
  return /\bBasic\b/.test(card.type_line || '');
}

const NUMBER_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/**
 * How many copies of a card the deck may hold despite the usual limit: Infinity for basics and
 * "any number of cards named" cards, 7 for Seven Dwarves, 9 for Nazgûl. Null when nothing special.
 */
export function copyLimitOverride(card) {
  if (isBasicLand(card)) return Infinity;
  const text = card.oracle_text || '';
  if (/a deck can have any number of cards named/i.test(text)) return Infinity;
  const upTo = text.match(/a deck can have up to (\w+) cards named/i);
  if (upTo) return NUMBER_WORDS[upTo[1].toLowerCase()] || Number(upTo[1]) || null;
  return null;
}

function legalityStatus(card, key) {
  if (!key) return 'Legal';
  const legalities = parseJson(card.legalities);
  if (!legalities) return undefined; // Unknown: don't flag cards we have no data for
  const status = legalities[key];
  return status && status !== 'null' ? status : null;
}

/** Can this card lead a deck in a format, judged by MTGJSON leadership skills or its text? */
export function canLead(card, skill = 'commander') {
  const skills = parseJson(card.leadership_skills);
  if (skills && skill in skills) return !!skills[skill];

  const type = card.type_line || '';
  const text = card.oracle_text || '';
  if (skill === 'oathbreaker') return /planeswalker/i.test(type);
  if (skill === 'brawl' && /legendary/i.test(type) && /planeswalker/i.test(type)) return true;
  if (skill === 'pauper_commander') {
    return /creature/i.test(type) && (card.rarity === 'uncommon' || card.lowest_rarity === 'uncommon');
  }
  if (/legendary/i.test(type) && /creature/i.test(type)) return true;
  if (/\bBackground\b/i.test(type)) return true;
  return /can be your commander/i.test(text);
}

const cmdrText = (c) => (c.oracle_text || '').replace(/\r/g, '');
const hasPartner = (c) =>
  /(^|\n)Partner\b(?!\s+with)/i.test(cmdrText(c)) ||
  /have two commanders if both have partner/i.test(cmdrText(c).replace(/\n/g, ' '));
const partnerWithName = (c) => {
  const m = cmdrText(c).match(/Partner with ([^\n(.]+)/i);
  return m ? m[1].trim().replace(/[.,]+$/, '') : null;
};
const hasFriendsForever = (c) => /friends forever/i.test(cmdrText(c));
const hasChooseABackground = (c) => /choose a background/i.test(cmdrText(c));
const isBackground = (c) => /\bBackground\b/i.test(c.type_line || '');
const hasDoctorsCompanion = (c) => /doctor.?s companion/i.test(cmdrText(c));
const isTimeLordDoctor = (c) => /Time Lord/i.test(c.type_line || '') && /Doctor/i.test(c.type_line || '');

/** May cards `a` and `b` lead a deck together (Partner, Backgrounds, Doctor's companion…)? */
export function canPairCommanders(a, b) {
  if (!a || !b || (a.deck_card_id && a.deck_card_id === b.deck_card_id)) return false;
  if (hasPartner(a) && hasPartner(b)) return true;
  const aw = partnerWithName(a);
  const bw = partnerWithName(b);
  if (aw && (b.name || '').toLowerCase().includes(aw.toLowerCase())) return true;
  if (bw && (a.name || '').toLowerCase().includes(bw.toLowerCase())) return true;
  if (hasFriendsForever(a) && hasFriendsForever(b)) return true;
  if (hasChooseABackground(a) && isBackground(b)) return true;
  if (hasChooseABackground(b) && isBackground(a)) return true;
  if (hasDoctorsCompanion(a) && isTimeLordDoctor(b)) return true;
  if (hasDoctorsCompanion(b) && isTimeLordDoctor(a)) return true;
  return false;
}

const isInstantOrSorcery = (c) => /\b(instant|sorcery)\b/i.test(c.type_line || '');

/**
 * Parse a pasted points list: "Card Name|3", "Card Name: 3", "Card Name 3" or "3 Card Name".
 * Returns a Map of lower-cased name to points.
 */
export function parsePointsList(text) {
  const points = new Map();
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let m = line.match(/^(.+?)\s*[|:\t]\s*(\d+)\s*$/) || line.match(/^(.+?)\s+(\d+)\s*$/);
    if (m) {
      points.set(m[1].trim().toLowerCase(), Number(m[2]));
      continue;
    }
    m = line.match(/^(\d+)\s+(.+)$/);
    if (m) points.set(m[2].trim().toLowerCase(), Number(m[1]));
  }
  return points;
}

function pointsFor(card, pointsList) {
  if (!pointsList) return 0;
  const name = (card.name || '').toLowerCase();
  if (pointsList.has(name)) return pointsList.get(name);
  const front = name.split(' // ')[0];
  return pointsList.get(front) || 0;
}

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'];

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/**
 * Check a deck against a format's rules.
 *
 * @param {Array} cards deck rows: name, quantity, board_type, is_commander, type_line, oracle_text,
 *   color_identity, legalities, leadership_skills, rarity, lowest_rarity
 * @param {string} formatId
 * @param {object} options deck settings (two-headed giant base format, cube settings) plus
 *   `pointsList` (Map from parsePointsList) and `teammateCards` (the other half of a 2HG team)
 * @returns {{ format, label, isLegal, issues, illegalCards, summary }}
 */
export function validateDeck(cards, formatId, options = {}) {
  const rules = resolveRules(formatId, options);
  if (!rules) {
    return { format: formatId, label: formatId, isLegal: true, issues: [], illegalCards: [], summary: {} };
  }

  const issues = [];
  const add = (severity, code, message, names = []) => issues.push({ severity, code, message, cards: names });

  const all = (cards || []).filter((c) => boardOf(c) !== 'maybeboard');
  const main = all.filter((c) => boardOf(c) === 'mainboard');
  const side = all.filter((c) => boardOf(c) === 'sideboard');
  const qty = (list) => list.reduce((sum, c) => sum + (c.quantity ?? 1), 0);
  const mainCount = qty(main);
  const sideCount = qty(side);
  const summary = { mainCount, sideCount, deckSize: rules.deckSize || null };

  // ---- Card legality ----
  const illegalCards = [];
  const seenIllegal = new Set();
  const flag = (card, status, reason) => {
    if (seenIllegal.has(card.name)) return;
    seenIllegal.add(card.name);
    illegalCards.push({
      id: card.card_id ?? card.id,
      name: card.name,
      type_line: card.type_line,
      image_url: card.image_url,
      quantity: all.filter((c) => c.name === card.name).reduce((s, c) => s + (c.quantity ?? 1), 0),
      status,
      reason,
    });
  };

  for (const card of all) {
    const status = legalityStatus(card, rules.legality);
    if (status === undefined || status === 'Legal') continue;
    if (status === 'Restricted' && rules.restricted !== 'banned') continue; // Handled by copy counts
    if (status === 'Banned') flag(card, 'Banned', 'Banned');
    else if (status === null) flag(card, 'Not Legal', `Not legal in ${rules.label}`);
  }

  if (rules.maxRarity) {
    const cap = RARITY_ORDER.indexOf(rules.maxRarity);
    for (const card of all) {
      const rarity = card.lowest_rarity || card.rarity;
      if (rarity && RARITY_ORDER.indexOf(rarity) > cap) flag(card, 'Not Legal', `Never printed at ${rules.maxRarity} or below`);
    }
  }

  if (illegalCards.length) {
    add('error', 'illegal-cards', `${plural(illegalCards.length, 'card')} not legal in ${rules.label}`, illegalCards.map((c) => c.name));
  }

  // ---- Copy limits ----
  const counts = new Map();
  for (const card of all) {
    const entry = counts.get(card.name) || { card, quantity: 0 };
    entry.quantity += card.quantity ?? 1;
    counts.set(card.name, entry);
  }

  const over = [];
  const restrictedOver = [];
  for (const { card, quantity } of counts.values()) {
    // Restricted cards are called out on their own, so Vintage players see why a 2-of is flagged
    if (rules.restricted === 'one' && quantity > 1 && legalityStatus(card, rules.legality) === 'Restricted') {
      restrictedOver.push(`${card.name} (${quantity})`);
      continue;
    }
    if (!rules.copies) continue;
    const limit = copyLimitOverride(card) ?? rules.copies;
    if (quantity > limit) over.push(`${card.name} (${quantity})`);
  }
  if (over.length) {
    const what = rules.copies === 1 ? 'Singleton: more than one copy of' : `More than ${rules.copies} copies of`;
    add(rules.isCube ? 'warning' : 'error', 'copies', `${what} ${plural(over.length, 'card')}`, over);
  }
  if (restrictedOver.length) add('error', 'restricted', 'Restricted cards are limited to one copy', restrictedOver);

  // ---- Team copy limit (two-headed giant) ----
  if (rules.teamCopyLimit && Array.isArray(options.teammateCards) && rules.copies) {
    const team = new Map();
    for (const card of [...all, ...options.teammateCards.filter((c) => boardOf(c) !== 'maybeboard')]) {
      const entry = team.get(card.name) || { card, quantity: 0 };
      entry.quantity += card.quantity ?? 1;
      team.set(card.name, entry);
    }
    const over = [...team.values()]
      .filter(({ card, quantity }) => quantity > (copyLimitOverride(card) ?? rules.copies))
      .map(({ card, quantity }) => `${card.name} (${quantity} across the team)`);
    if (over.length) add('error', 'team-copies', `Your team's decks share a ${rules.copies}-copy limit`, over);
    summary.teamChecked = true;
  }

  // ---- Commanders ----
  if (rules.commander) {
    const commanders = main.filter((c) => c.is_commander);
    summary.commanders = commanders.map((c) => c.name);
    const spec = rules.commander;
    const leaders = spec.signatureSpell ? commanders.filter((c) => !isInstantOrSorcery(c)) : commanders;
    const signatureSpells = spec.signatureSpell ? commanders.filter(isInstantOrSorcery) : [];
    const noun = spec.signatureSpell ? 'oathbreaker' : 'commander';

    if (leaders.length === 0) {
      add('error', 'no-commander', `Choose a ${noun} (use the crown on a card)`);
    } else {
      const ineligible = leaders.filter((c) => !canLead(c, spec.skill));
      if (ineligible.length) {
        const why = {
          pauper_commander: 'must be an uncommon creature',
          brawl: 'must be a legendary creature or planeswalker',
          oathbreaker: 'must be a planeswalker',
        }[spec.skill] || "can't be a commander";
        add('error', 'ineligible-commander', `Your ${noun} ${why}`, ineligible.map((c) => c.name));
      }
      if (rules.restricted === 'not-commander') {
        const restricted = leaders.filter((c) => legalityStatus(c, rules.legality) === 'Restricted');
        if (restricted.length) add('error', 'restricted-commander', `Restricted in ${rules.label}: can't be your commander`, restricted.map((c) => c.name));
      }
      if (leaders.length > spec.max || (leaders.length === 2 && !canPairCommanders(leaders[0], leaders[1]))) {
        add('error', 'commander-pair', leaders.length > spec.max
          ? `At most ${spec.max} ${noun}s`
          : `These ${noun}s can't be paired (they need Partner, a Background, or similar)`, leaders.map((c) => c.name));
      }
    }

    if (spec.signatureSpell) {
      if (signatureSpells.length === 0 && leaders.length > 0) {
        add('error', 'no-signature-spell', 'Choose a signature spell (an instant or sorcery, marked with the crown)');
      } else if (signatureSpells.length > leaders.length) {
        add('error', 'signature-spell', 'Each oathbreaker has exactly one signature spell', signatureSpells.map((c) => c.name));
      }
    }

    if (spec.colorIdentity && leaders.length > 0) {
      const identity = new Set(leaders.flatMap(colorIdentityOf));
      summary.colorIdentity = [...identity];
      const outside = [...counts.values()]
        .map(({ card }) => card)
        .filter((card) => !leaders.includes(card))
        .filter((card) => colorIdentityOf(card).some((color) => !identity.has(color)))
        .map((c) => c.name);
      if (outside.length) {
        const colors = identity.size ? [...identity].join('') : 'colorless';
        add('error', 'color-identity', `${plural(outside.length, 'card')} outside your color identity (${colors})`, outside);
      }
    }
  }

  // ---- Deck size ----
  if (rules.deckSize) {
    const { exact, min, max } = rules.deckSize;
    if (exact && mainCount !== exact) {
      add('error', 'deck-size', `${rules.label} decks have exactly ${exact} cards${rules.commander ? ', commander included' : ''} (this one has ${mainCount})`);
    }
    if (min && mainCount < min) add('error', 'deck-size', `At least ${min} cards in the main deck (this one has ${mainCount})`);
    if (max && mainCount > max) add('error', 'deck-size', `At most ${max} cards in the main deck (this one has ${mainCount})`);
  }

  if (rules.sideboard && sideCount > rules.sideboard) {
    add('error', 'sideboard-size', `At most ${rules.sideboard} sideboard cards (this one has ${sideCount})`);
  }

  // ---- Points (Canadian Highlander) ----
  if (rules.points) {
    const list = options.pointsList;
    if (!list || list.size === 0) {
      add('warning', 'points-unset', 'No points list is set up, so points weren’t checked. An admin can paste the current list in Settings.');
    } else {
      const pointed = [...counts.values()]
        .map(({ card }) => ({ name: card.name, points: pointsFor(card, list) }))
        .filter((c) => c.points > 0);
      const total = pointed.reduce((s, c) => s + c.points, 0);
      summary.points = { total, cap: rules.points.cap, cards: pointed };
      if (total > rules.points.cap) {
        add('error', 'points', `${total} points is over the ${rules.points.cap} point limit`, pointed.map((c) => `${c.name} (${c.points})`));
      }
    }
  }

  // ---- Cube size target ----
  if (rules.isCube && rules.targetSize && mainCount !== rules.targetSize) {
    const diff = rules.targetSize - mainCount;
    add('warning', 'cube-size', diff > 0
      ? `${plural(diff, 'card')} short of the ${rules.targetSize}-card target`
      : `${plural(-diff, 'card')} over the ${rules.targetSize}-card target`);
  }
  if (rules.isCube) {
    summary.targetSize = rules.targetSize;
    summary.poolLabel = rules.poolLabel;
    const seats = Number(options.seats) || DEFAULT_CUBE_SETTINGS.seats;
    const needed = seats * (Number(options.packsPerPlayer) || DEFAULT_CUBE_SETTINGS.packsPerPlayer) * (Number(options.packSize) || DEFAULT_CUBE_SETTINGS.packSize);
    summary.draftCardsNeeded = needed;
    if (mainCount > 0 && mainCount < needed) {
      add('warning', 'cube-draft-size', `A ${seats}-player draft needs ${needed} cards; this cube has ${mainCount}`);
    }
  }

  const isLegal = !issues.some((i) => i.severity === 'error');
  return {
    format: rules.id,
    label: rules.label,
    baseFormat: rules.baseFormat || null,
    isLegal,
    issues,
    illegalCardCount: illegalCards.length,
    illegalCards,
    summary,
  };
}
