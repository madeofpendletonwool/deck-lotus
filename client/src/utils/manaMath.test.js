import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseManaCost,
  colorRequirements,
  requirementCost,
  landFace,
  landProduction,
  resolveSources,
  castProbability,
  recommendedSources,
  analyzeManaBase,
  simulateDrawOdds,
  expandLibrary,
  hypergeometricAtLeast,
} from './manaMath.js';

const card = (name, extra = {}) => ({ name, quantity: 1, board_type: 'mainboard', type_line: 'Instant', oracle_text: '', mana_cost: '', cmc: 0, ...extra });
const island = (qty = 1) => card('Island', { quantity: qty, type_line: 'Basic Land — Island', oracle_text: '({T}: Add {U}.)' });
const mountain = (qty = 1) => card('Mountain', { quantity: qty, type_line: 'Basic Land — Mountain', oracle_text: '({T}: Add {R}.)' });
const forest = (qty = 1) => card('Forest', { quantity: qty, type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)' });
const counterspell = (qty = 1) => card('Counterspell', { quantity: qty, mana_cost: '{U}{U}', cmc: 2, oracle_text: 'Counter target spell.' });
const filler = (qty) => card('Filler', { quantity: qty, type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2 });

test('parseManaCost counts pips, generic, X, hybrid; Phyrexian and {2/W} need no source', () => {
  const c = parseManaCost('{X}{2}{U}{U}{W/U}{B/P}{2/W}');
  assert.equal(c.x, 1);
  assert.equal(c.pips.U, 2);
  assert.equal(c.mv, 2 + 2 + 1 + 1 + 2);
  assert.deepEqual(c.hybrid, ['WU']);
  assert.equal(c.pips.B, 0);
  assert.equal(c.pips.W, 0);
  // Only the front face of a split or adventure card
  assert.equal(parseManaCost('{1}{R} // {3}{U}').mv, 2);
  assert.equal(parseManaCost('{C}{C}').pips.C, 2);
});

test('colorRequirements: one per color plus hybrid groups, on the turn of the mana value', () => {
  assert.deepEqual(colorRequirements(counterspell()), [{ colors: 'U', need: 2, turn: 2 }]);
  assert.deepEqual(colorRequirements(card('Kitchen Finks', { mana_cost: '{1}{G/W}{G/W}', cmc: 3 })), [{ colors: 'WG', need: 2, turn: 3 }]);
  assert.deepEqual(colorRequirements(card('Fireball', { mana_cost: '{X}{R}', cmc: 1 })), [{ colors: 'R', need: 1, turn: 2 }]);
  assert.deepEqual(colorRequirements(island()), []);
  assert.equal(requirementCost({ colors: 'U', need: 2, turn: 3 }), '{1}{U}{U}');
  assert.equal(requirementCost({ colors: 'WG', need: 1, turn: 1 }), '{W/G}');
});

test('landFace: lands, and modal double-faced cards with a land back', () => {
  assert.ok(landFace(island()));
  assert.equal(landFace(counterspell()), null);
  const mdfc = card('Sea Gate Restoration // Sea Gate, Reborn', {
    layout: 'modal_dfc',
    type_line: 'Sorcery',
    mana_cost: '{4}{U}{U}{U}',
    oracle_text: 'Draw cards equal to the number of cards in your hand plus one.\n\n// Sea Gate, Reborn\nAs Sea Gate, Reborn enters, you may pay 3 life. If you don\'t, it enters tapped.\n{T}: Add {U}.',
  });
  assert.ok(landFace(mdfc));
  assert.deepEqual(colorRequirements(mdfc), []);
  const typed = card('Spikefield Hazard // Spikefield Cave', { layout: 'modal_dfc', type_line: 'Instant // Land', mana_cost: '{R}', oracle_text: 'Deal 1 damage.\n\n// Spikefield Cave\nSpikefield Cave enters tapped.\n{T}: Add {R}.' });
  assert.equal(landFace(typed).type, 'Land');
  // A transforming card with a land back isn't a land drop
  assert.equal(landFace(card('Search for Azcanta // Azcanta', { layout: 'transform', type_line: 'Enchantment // Legendary Land', oracle_text: 'x\n\n// Azcanta\n{T}: Add {U}.' })), null);
});

test('landProduction reads mana abilities, any-color text and fetches', () => {
  assert.deepEqual(landProduction({ type: 'Land', text: '{T}: Add {C}.\n{T}, Pay 1 life: Add {U} or {R}.' }).colors.sort(), ['C', 'R', 'U']);
  assert.equal(landProduction({ type: 'Land', text: '{T}: Add one mana of any color.' }).anyColor, true);
  assert.deepEqual(landProduction({ type: 'Land', text: '{T}, Pay 1 life, Sacrifice Scalding Tarn: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.' }).fetchTypes, ['Island', 'Mountain']);
  assert.equal(landProduction({ type: 'Land', text: '{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.' }).fetchBasic, true);
});

test('resolveSources: fetches make what they can find; Command Tower follows the commander', () => {
  const tarn = card('Scalding Tarn', { type_line: 'Land', oracle_text: '{T}, Pay 1 life, Sacrifice Scalding Tarn: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.' });
  const wilds = card('Evolving Wilds', { type_line: 'Land', oracle_text: '{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.' });
  const tower = card('Command Tower', { type_line: 'Land', oracle_text: "{T}: Add one mana of any color in your commander's color identity." });
  const vents = card('Steam Vents', { type_line: 'Land — Island Mountain', oracle_text: '({T}: Add {U} or {R}.)' });

  // Only islands in the deck: the tarn can't make red
  let map = resolveSources([tarn, island(), wilds]);
  assert.deepEqual(map.get(tarn).colors, ['U']);
  assert.deepEqual(map.get(wilds).colors, ['U']);

  map = resolveSources([tarn, island(), vents]);
  assert.deepEqual(map.get(tarn).colors, ['U', 'R']);

  map = resolveSources([tower], { commanderColors: ['B', 'G'] });
  assert.deepEqual(map.get(tower).colors, ['B', 'G']);
});

test('castProbability: certain with all sources, impossible with none', () => {
  assert.equal(castProbability({ deckSize: 60, lands: 24, sources: 24, need: 2, turn: 2 }).probability, 1);
  assert.equal(castProbability({ deckSize: 60, lands: 24, sources: 0, need: 1, turn: 1 }).probability, 0);
  const few = castProbability({ deckSize: 60, lands: 24, sources: 10, need: 2, turn: 2 }).probability;
  const many = castProbability({ deckSize: 60, lands: 24, sources: 18, need: 2, turn: 2 }).probability;
  assert.ok(few < many);
  // More draws help
  assert.ok(castProbability({ deckSize: 60, lands: 24, sources: 14, need: 1, turn: 1, onDraw: true }).probability
    > castProbability({ deckSize: 60, lands: 24, sources: 14, need: 1, turn: 1 }).probability);
});

test('recommendedSources lands near Karsten for a 60-card, 24-land deck on the play', () => {
  const rec = (need, turn) => recommendedSources({ deckSize: 60, lands: 24, need, turn });
  // Karsten's tables are within a source of these: C 14, CC 20, CCC 22-23
  assert.ok(Math.abs(rec(1, 1) - 14) <= 1);
  assert.ok(Math.abs(rec(2, 2) - 20) <= 1);
  assert.ok(Math.abs(rec(3, 3) - 23) <= 1);
  // Cheaper per pip the later you cast it
  assert.ok(rec(1, 4) < rec(1, 1));
  // Given its land drops, a deck of all sources always casts; only too few lands is unreachable
  assert.equal(recommendedSources({ deckSize: 60, lands: 10, need: 4, turn: 4 }), 10);
  assert.equal(recommendedSources({ deckSize: 60, lands: 3, need: 4, turn: 4 }), null);
});

test('analyzeManaBase: Counterspell with 16 Islands in 60 cards', () => {
  const deck = [island(16), mountain(8), counterspell(4), filler(32)];
  const result = analyzeManaBase(deck);
  assert.equal(result.deckSize, 60);
  assert.equal(result.lands, 24);
  const blue = result.colors.find((c) => c.color === 'U');
  assert.equal(blue.sources, 16);
  assert.equal(blue.pips, 8);
  const req = blue.requirements[0];
  assert.equal(req.need, 2);
  assert.equal(req.turn, 2);
  assert.equal(req.ok, false);
  assert.ok(req.recommended > 16);
  assert.equal(req.cards[0].name, 'Counterspell');
  // Commanders leave the library
  const cmd = analyzeManaBase([island(40), { ...counterspell(1), is_commander: 1 }, filler(59)]);
  assert.equal(cmd.deckSize, 99);
  assert.equal(cmd.commanders.length, 1);
});

test('simulateDrawOdds agrees with the exact hypergeometric when there are no mulligans', () => {
  const deck = [island(24), filler(36)];
  const lib = expandLibrary(deck);
  const isLand = (c) => /Land/.test(c.type_line);
  const sim = simulateDrawOdds(lib, [{ count: 3, test: isLand }], { turns: 3, trials: 40000, seed: 7 });
  const exact = hypergeometricAtLeast(60, 24, 9, 3);
  assert.ok(Math.abs(sim.byTurn[3] - exact) < 0.01, `${sim.byTurn[3]} vs ${exact}`);
  assert.equal(sim.keptSize[7], 1);
  // Deterministic for a seed
  assert.deepEqual(simulateDrawOdds(lib, [{ count: 3, test: isLand }], { turns: 3, trials: 2000, seed: 3 }).byTurn,
    simulateDrawOdds(lib, [{ count: 3, test: isLand }], { turns: 3, trials: 2000, seed: 3 }).byTurn);
});

test('simulateDrawOdds: mulligans raise the odds of a playable hand and shrink some hands', () => {
  const deck = [island(17), forest(0), filler(43)];
  const lib = expandLibrary(deck);
  const goals = [{ count: 2, test: (c) => /Land/.test(c.type_line) }];
  const none = simulateDrawOdds(lib, goals, { turns: 1, trials: 20000, seed: 5 });
  const mull = simulateDrawOdds(lib, goals, { turns: 1, trials: 20000, seed: 5, mulligan: { minLands: 2, maxLands: 5, minHandSize: 5 } });
  assert.ok(mull.byTurn[1] > none.byTurn[1] + 0.1);
  assert.ok(mull.keptSize[6] > 0);
  assert.ok(!mull.keptSize[4]);
});
