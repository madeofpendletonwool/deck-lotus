import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDeck,
  resolveRules,
  getFormat,
  canLead,
  copyLimitOverride,
  colorIdentityOf,
  parsePointsList,
  groupedFormats,
  FORMATS,
} from './formats.js';

const legal = (overrides = {}) => JSON.stringify({
  standard: 'Legal', modern: 'Legal', legacy: 'Legal', vintage: 'Legal', pauper: 'Legal', commander: 'Legal',
  duel: 'Legal', paupercommander: 'Legal', brawl: 'Legal', premodern: 'Legal', oathbreaker: 'Legal', standardbrawl: 'Legal', ...overrides,
});

const card = (name, extra = {}) => ({
  name,
  quantity: 1,
  board_type: 'mainboard',
  type_line: 'Instant',
  oracle_text: '',
  color_identity: 'R',
  legalities: legal(),
  ...extra,
});

const basics = (n, name = 'Mountain') => card(name, { quantity: n, type_line: 'Basic Land — Mountain', color_identity: '' });
const errors = (result) => result.issues.filter((i) => i.severity === 'error').map((i) => i.code);

test('every format the issue asked for exists', () => {
  for (const id of ['premodern', 'canlander', 'brawl', 'twoheadedgiant', 'pauper', 'paupercommander', 'cube']) {
    assert.ok(getFormat(id), id);
  }
  const ids = FORMATS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'format ids are unique');
  assert.ok(groupedFormats().every((g) => g.formats.length));
});

test('a 60-card modern deck with four-ofs is legal', () => {
  const deck = [card('Lightning Bolt', { quantity: 4 }), basics(56)];
  const result = validateDeck(deck, 'modern');
  assert.equal(result.isLegal, true, JSON.stringify(result.issues));
});

test('deck size, copy limits and sideboard size', () => {
  const deck = [card('Lightning Bolt', { quantity: 5 }), basics(50), card('Shock', { quantity: 16, board_type: 'sideboard', legalities: legal() })];
  const codes = errors(validateDeck(deck, 'modern'));
  assert.ok(codes.includes('deck-size'));
  assert.ok(codes.includes('copies'));
  assert.ok(codes.includes('sideboard-size'));
});

test('maybeboard never counts', () => {
  const deck = [card('Lightning Bolt', { quantity: 4 }), basics(56), card('Banned Thing', { board_type: 'maybeboard', legalities: legal({ modern: 'Banned' }) })];
  assert.equal(validateDeck(deck, 'modern').isLegal, true);
});

test('banned and not-legal cards are reported', () => {
  const deck = [card('Bad', { legalities: legal({ modern: 'Banned' }) }), card('Old', { legalities: legal({ modern: null }) }), basics(58)];
  const result = validateDeck(deck, 'modern');
  assert.equal(result.illegalCardCount, 2);
  assert.deepEqual(result.illegalCards.map((c) => c.reason).sort(), ['Banned', 'Not legal in Modern']);
});

test('vintage allows one copy of a restricted card, not two', () => {
  const restricted = legal({ vintage: 'Restricted' });
  assert.equal(validateDeck([card('Ancestral Recall', { legalities: restricted }), basics(59)], 'vintage').isLegal, true);
  const codes = errors(validateDeck([card('Ancestral Recall', { quantity: 2, legalities: restricted }), basics(58)], 'vintage'));
  assert.deepEqual(codes, ['restricted']);
});

test('copy limit exceptions', () => {
  assert.equal(copyLimitOverride({ type_line: 'Basic Snow Land — Island' }), Infinity);
  assert.equal(copyLimitOverride({ oracle_text: 'A deck can have any number of cards named Relentless Rats.' }), Infinity);
  assert.equal(copyLimitOverride({ oracle_text: 'A deck can have up to seven cards named Seven Dwarves.' }), 7);
  assert.equal(copyLimitOverride({ oracle_text: 'A deck can have up to nine cards named Nazgûl.' }), 9);
  assert.equal(copyLimitOverride({ oracle_text: 'Flying' }), null);
});

test('color identity parsing', () => {
  assert.deepEqual(colorIdentityOf({ color_identity: 'B, G, R' }), ['B', 'G', 'R']);
  assert.deepEqual(colorIdentityOf({ color_identity: 'WU' }), ['W', 'U']);
  assert.deepEqual(colorIdentityOf({ color_identity: null }), []);
});

const commander = (name, extra = {}) => card(name, {
  is_commander: 1,
  type_line: 'Legendary Creature — Goblin',
  leadership_skills: JSON.stringify({ commander: true, brawl: true, oathbreaker: false, pauper_commander: false, predh: false }),
  ...extra,
});

const singles = (n, prefix = 'Spell') => Array.from({ length: n }, (_, i) => card(`${prefix} ${i}`));

test('a correct commander deck is legal', () => {
  const deck = [commander('Krenko'), ...singles(60), basics(39)];
  const result = validateDeck(deck, 'commander');
  assert.equal(result.isLegal, true, JSON.stringify(result.issues));
  assert.deepEqual(result.summary.colorIdentity, ['R']);
});

test('commander decks: missing commander, singleton, color identity, exact size', () => {
  const deck = [card('Krenko'), card('Bolt', { quantity: 2 }), card('Counterspell', { color_identity: 'U' }), basics(90)];
  const codes = errors(validateDeck(deck, 'commander'));
  assert.ok(codes.includes('no-commander'));
  assert.ok(codes.includes('copies'));
  assert.ok(codes.includes('deck-size'));

  const withCommander = [commander('Krenko'), card('Counterspell', { color_identity: 'U' }), ...singles(58), basics(40)];
  assert.ok(errors(validateDeck(withCommander, 'commander')).includes('color-identity'));
});

test('partners pair, unrelated legends do not', () => {
  const a = commander('Thrasios', { oracle_text: 'Partner (You can have two commanders if both have partner.)', color_identity: 'G, U' });
  const b = commander('Tymna', { oracle_text: 'Partner (You can have two commanders if both have partner.)', color_identity: 'W, B' });
  const deck = [a, b, ...singles(58).map((c) => ({ ...c, color_identity: 'U' })), basics(40)];
  assert.equal(validateDeck(deck, 'commander').isLegal, true, JSON.stringify(validateDeck(deck, 'commander').issues));

  const c = commander('Krenko');
  const d = commander('Zada');
  assert.ok(errors(validateDeck([c, d, ...singles(58), basics(40)], 'commander')).includes('commander-pair'));
});

test('pauper commander needs an uncommon creature commander', () => {
  const rare = commander('Rare Legend', { leadership_skills: JSON.stringify({ commander: true, pauper_commander: false }) });
  assert.ok(errors(validateDeck([rare, ...singles(60), basics(39)], 'paupercommander')).includes('ineligible-commander'));

  const unc = commander('Uncommon Creature', {
    type_line: 'Creature — Goblin',
    leadership_skills: JSON.stringify({ commander: false, pauper_commander: true }),
  });
  assert.equal(validateDeck([unc, ...singles(60), basics(39)], 'paupercommander').isLegal, true);
});

test('canLead falls back to text when leadership skills are missing', () => {
  assert.equal(canLead({ type_line: 'Legendary Creature — Elf' }, 'commander'), true);
  assert.equal(canLead({ type_line: 'Legendary Planeswalker — Ajani' }, 'brawl'), true);
  assert.equal(canLead({ type_line: 'Legendary Planeswalker — Ajani' }, 'commander'), false);
  assert.equal(canLead({ type_line: 'Planeswalker — Daretti', oracle_text: 'Daretti can be your commander.' }, 'commander'), true);
  assert.equal(canLead({ type_line: 'Creature — Goblin', rarity: 'uncommon' }, 'pauper_commander'), true);
});

test('duel commander: restricted cards are fine in the deck but not as commander', () => {
  const restricted = legal({ duel: 'Restricted' });
  const ok = [commander('Krenko'), card('Restricted Spell', { legalities: restricted }), ...singles(59), basics(39)];
  assert.equal(validateDeck(ok, 'duel').isLegal, true, JSON.stringify(validateDeck(ok, 'duel').issues));
  const bad = [commander('Krenko', { legalities: restricted }), ...singles(60), basics(39)];
  assert.ok(errors(validateDeck(bad, 'duel')).includes('restricted-commander'));
});

test('standard brawl is 60 cards', () => {
  assert.deepEqual(resolveRules('standardbrawl').deckSize, { exact: 60 });
  const deck = [commander('Krenko'), ...singles(30), basics(29)];
  assert.equal(validateDeck(deck, 'standardbrawl').isLegal, true);
});

test('oathbreaker needs a planeswalker and a signature spell', () => {
  const walker = card('Chandra', {
    is_commander: 1,
    type_line: 'Legendary Planeswalker — Chandra',
    leadership_skills: JSON.stringify({ oathbreaker: true, commander: false }),
  });
  const spell = card('Fireball', { is_commander: 1, type_line: 'Sorcery' });
  assert.equal(validateDeck([walker, spell, ...singles(30), basics(28)], 'oathbreaker').isLegal, true);
  assert.ok(errors(validateDeck([walker, ...singles(31), basics(28)], 'oathbreaker')).includes('no-signature-spell'));
});

test('canadian highlander: singleton, 100+, vintage pool, points cap', () => {
  const points = parsePointsList('Black Lotus|7\nAncestral Recall: 8\n# comment\n\nTime Walk 6');
  assert.equal(points.get('black lotus'), 7);
  assert.equal(points.get('ancestral recall'), 8);
  assert.equal(points.get('time walk'), 6);

  const restricted = legal({ vintage: 'Restricted' });
  const deck = [card('Black Lotus', { legalities: restricted }), card('Ancestral Recall', { legalities: restricted }), ...singles(60), basics(38)];
  const result = validateDeck(deck, 'canlander', { pointsList: points });
  assert.deepEqual(errors(result), ['points']);
  assert.equal(result.summary.points.total, 15);

  const noList = validateDeck(deck, 'canlander', {});
  assert.equal(noList.isLegal, true);
  assert.ok(noList.issues.some((i) => i.code === 'points-unset'));
});

test('two-headed giant uses its base format and the team copy limit', () => {
  assert.equal(resolveRules('twoheadedgiant').legality, 'standard');
  assert.equal(resolveRules('twoheadedgiant', { baseFormat: 'modern' }).legality, 'modern');

  const mine = [card('Lightning Bolt', { quantity: 3 }), basics(57)];
  const theirs = [card('Lightning Bolt', { quantity: 2 }), basics(58)];
  const result = validateDeck(mine, 'twoheadedgiant', { baseFormat: 'modern', teammateCards: theirs });
  assert.deepEqual(errors(result), ['team-copies']);
  assert.equal(validateDeck(mine, 'twoheadedgiant', { baseFormat: 'modern' }).isLegal, true);
});

test('cubes: pool restriction errors, singleton and size are warnings', () => {
  const deck = [
    card('Rare Thing', { rarity: 'rare', lowest_rarity: 'rare' }),
    card('Bolt', { rarity: 'common', lowest_rarity: 'common', quantity: 2 }),
    card('Uncommon printed common', { rarity: 'uncommon', lowest_rarity: 'common' }),
  ];
  const result = validateDeck(deck, 'cube', { cardPool: 'peasant', singleton: true, targetSize: 360 });
  assert.deepEqual(errors(result), ['illegal-cards']);
  assert.deepEqual(result.illegalCards.map((c) => c.name), ['Rare Thing']);
  const warnings = result.issues.filter((i) => i.severity === 'warning').map((i) => i.code);
  assert.ok(warnings.includes('copies'));
  assert.ok(warnings.includes('cube-size'));
  assert.ok(warnings.includes('cube-draft-size'));

  assert.equal(validateDeck(deck, 'cube', { singleton: false, targetSize: 4 }).issues.length, 1); // draft size only
});

test('unknown format is treated as freeform', () => {
  assert.equal(validateDeck([card('Anything', { quantity: 30 })], 'nonsense').isLegal, true);
});
