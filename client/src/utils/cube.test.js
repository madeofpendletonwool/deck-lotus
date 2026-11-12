import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultColorCategory,
  colorCategoryOf,
  producedColors,
  isFixing,
  analyzeCube,
  makePacks,
  Draft,
  seededRandom,
  makeSamplePack,
  makeSealedPool,
  guildOf,
  toCubeCobraCsv,
  poolToDeckList,
  typeBucket,
  tokensMade,
} from './cube.js';
import { compileQuery, isAdvancedQuery } from './cardQuery.js';

const c = (name, extra = {}) => ({ name, quantity: 1, board_type: 'mainboard', type_line: 'Instant', colors: '', cmc: 1, ...extra });

const bolt = c('Lightning Bolt', { colors: 'R', mana_cost: '{R}', rarity: 'common', edhrec_rank: 150, oracle_text: 'Lightning Bolt deals 3 damage to any target.' });
const hybrid = c('Boros Reckoner', { colors: 'R, W', mana_cost: '{R/W}{R/W}{R/W}', type_line: 'Creature — Minotaur', cmc: 3, power: '3', toughness: '3' });
const gold = c('Lightning Helix', { colors: 'R, W', mana_cost: '{R}{W}', cmc: 2, tags: '["burn"]' });
const sol = c('Sol Ring', { type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.', cmc: 1 });
const signet = c('Boros Signet', { type_line: 'Artifact', oracle_text: '{1}, {T}: Add {R}{W}.', cmc: 2 });
const sacred = c('Sacred Foundry', { type_line: 'Land — Mountain Plains', cmc: 0, oracle_text: '({T}: Add {R} or {W}.)' });
const fetch = c('Arid Mesa', { type_line: 'Land', cmc: 0, oracle_text: '{T}, Pay 1 life, Sacrifice Arid Mesa: Search your library for a Mountain or Plains card, put it onto the battlefield, then shuffle.' });
const city = c('City of Brass', { type_line: 'Land', cmc: 0, oracle_text: '{T}: Add one mana of any color.' });
const mountain = c('Mountain', { type_line: 'Basic Land — Mountain', cmc: 0 });
const bird = c('Birds of Paradise', { type_line: 'Creature — Bird', colors: 'G', oracle_text: '{T}: Add one mana of any color.' });

test('color categories', () => {
  assert.equal(defaultColorCategory(bolt), 'R');
  assert.equal(defaultColorCategory(hybrid), 'H');
  assert.equal(defaultColorCategory(gold), 'M');
  assert.equal(defaultColorCategory(sol), 'C');
  assert.equal(defaultColorCategory(sacred), 'L');
  assert.equal(colorCategoryOf({ ...gold, color_category: 'W' }), 'W');
  assert.equal(colorCategoryOf({ ...gold, color_category: 'nonsense' }), 'M');
});

test('type buckets put artifact creatures with creatures and artifact lands with lands', () => {
  assert.equal(typeBucket(c('x', { type_line: 'Artifact Creature — Golem' })), 'Creature');
  assert.equal(typeBucket(c('x', { type_line: 'Artifact Land' })), 'Land');
  assert.equal(typeBucket(c('x', { type_line: 'Legendary Planeswalker — Jace' })), 'Planeswalker');
});

test('fixing detection', () => {
  assert.deepEqual(producedColors(sacred), ['W', 'R']);
  assert.deepEqual(producedColors(fetch), ['W', 'R']);
  assert.equal(producedColors(city).length, 5);
  assert.equal(isFixing(sacred), true);
  assert.equal(isFixing(signet), true);
  assert.equal(isFixing(sol), false);
  assert.equal(isFixing(mountain), false);
  assert.equal(isFixing(bird), false, 'mana dorks are not counted as fixing');
});

test('guild ids are order independent', () => {
  assert.equal(guildOf(['R', 'W']), 'WR');
  assert.equal(guildOf(['G', 'W']), 'WG');
  assert.equal(guildOf(['W']), null);
});

test('analysis counts categories, guilds and fixing', () => {
  const cards = [bolt, hybrid, gold, sol, signet, sacred, fetch, city, { ...bolt, name: 'Maybe', board_type: 'maybeboard' }];
  const a = analyzeCube(cards);
  assert.equal(a.total, 8);
  assert.equal(a.categories.R.count, 1);
  assert.equal(a.categories.H.count, 1);
  assert.equal(a.categories.L.count, 3);
  assert.equal(a.guilds.WR.gold, 2);
  assert.ok(a.guilds.WR.fixing > 3, 'foundry, mesa, signet and a share of city');
  assert.equal(a.fixingTotal, 4);
  assert.deepEqual(a.tags, [['burn', 1]]);
});

const bigCube = (n) => Array.from({ length: n }, (_, i) => c(`Card ${i}`, {
  deck_card_id: i,
  colors: ['W', 'U', 'B', 'R', 'G', ''][i % 6],
  edhrec_rank: (i * 37) % 5000 + 1,
}));

test('packs are dealt without repeats and reproducibly from a seed', () => {
  const cube = bigCube(360);
  const a = makePacks(cube, { seats: 8, packsPerPlayer: 3, packSize: 15 }, seededRandom(42));
  const b = makePacks(cube, { seats: 8, packsPerPlayer: 3, packSize: 15 }, seededRandom(42));
  assert.equal(a.short, 0);
  const uids = a.packs.flat(2).map((x) => x.uid);
  assert.equal(uids.length, 360);
  assert.equal(new Set(uids).size, 360);
  assert.deepEqual(uids, b.packs.flat(2).map((x) => x.uid));
});

test('a small cube deals smaller packs and reports the shortfall', () => {
  const { packs, short, packSize } = makePacks(bigCube(100), { seats: 8, packsPerPlayer: 3, packSize: 15 });
  assert.equal(short, 260);
  assert.equal(packSize, 4);
  assert.ok(packs.flat().every((p) => p.length === 4));
});

test('a full draft gives every seat 45 cards and logs your picks', () => {
  const draft = new Draft(bigCube(360), { seats: 8, packsPerPlayer: 3, packSize: 15 }, 7);
  assert.equal(draft.pack.length, 15);
  draft.pick(draft.pack[0].uid);
  assert.equal(draft.pack.length, 14, 'the pack passed in has one fewer card');
  assert.equal(draft.pickNumber, 2);
  draft.autoPick();
  assert.equal(draft.isDone, true);
  assert.ok(draft.picks.every((p) => p.length === 45));
  const all = draft.picks.flat().map((x) => x.uid);
  assert.equal(new Set(all).size, 360, 'no card is drafted twice');
  assert.equal(draft.log.length, 45);
  assert.deepEqual(draft.log[15], { ...draft.log[15], round: 2, pick: 1 });
});

test('bots settle into colors', () => {
  const draft = new Draft(bigCube(360), { seats: 8 }, 99);
  draft.autoPick();
  for (const picks of draft.picks.slice(1)) {
    const counts = {};
    for (const card of picks) if (card.colors) counts[card.colors] = (counts[card.colors] || 0) + 1;
    const top2 = Object.values(counts).sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0);
    const colored = Object.values(counts).reduce((a, b) => a + b, 0);
    assert.ok(top2 / colored > 0.5, `bot took ${JSON.stringify(counts)}`);
  }
});

test('sample packs and sealed pools', () => {
  assert.equal(makeSamplePack(bigCube(50), 15, 3).pack.length, 15);
  assert.deepEqual(makeSamplePack(bigCube(50), 15, 3).pack.map((x) => x.uid), makeSamplePack(bigCube(50), 15, 3).pack.map((x) => x.uid));
  const sealed = makeSealedPool(bigCube(50), { packs: 6, packSize: 15 }, 1);
  assert.equal(sealed.pool.length, 50);
  assert.equal(sealed.short, 40);
});

test('pool to deck list merges copies and keeps printings', () => {
  const lines = poolToDeckList([{ ...bolt, set_code: 'm11', collector_number: '149' }, { ...bolt, set_code: 'm11', collector_number: '149' }, gold]);
  assert.deepEqual(lines, ['2 Lightning Bolt (M11) 149', '1 Lightning Helix']);
});

test('CubeCobra CSV export', () => {
  const csv = toCubeCobraCsv([{ ...gold, set_code: 'RAV', color_category: 'R', notes: 'a, b' }, { ...bolt, board_type: 'maybeboard' }]);
  const [header, first, second] = csv.split('\n');
  assert.ok(header.startsWith('name,CMC,Type,Color,Set'));
  assert.ok(first.includes(',rav,'));
  assert.ok(first.includes(',Red,'));
  assert.ok(first.includes(',burn,'));
  assert.ok(first.includes('"a, b"'));
  assert.ok(second.includes(',true,'));
});

test('query language', () => {
  const cards = [bolt, hybrid, gold, sol, signet, sacred, fetch, city, bird];
  const names = (q) => cards.filter(compileQuery(q)).map((x) => x.name);
  assert.deepEqual(names('bolt'), ['Lightning Bolt']);
  assert.deepEqual(names('t:land -t:basic is:fixing'), ['Sacred Foundry', 'Arid Mesa', 'City of Brass']);
  assert.deepEqual(names('c=rw'), ['Boros Reckoner', 'Lightning Helix']);
  assert.deepEqual(names('c:r mv<=1'), ['Lightning Bolt']);
  assert.deepEqual(names('c<=r -t:land'), ['Lightning Bolt', 'Sol Ring', 'Boros Signet']);
  assert.deepEqual(names('c:c t:artifact'), ['Sol Ring', 'Boros Signet']);
  assert.deepEqual(names('#burn'), ['Lightning Helix']);
  assert.deepEqual(names('tag:burn or cat:h'), ['Boros Reckoner', 'Lightning Helix']);
  assert.deepEqual(names('o:"any color"'), ['City of Brass', 'Birds of Paradise']);
  assert.deepEqual(names('pow>=3'), ['Boros Reckoner']);
  assert.deepEqual(names('r:c'), ['Lightning Bolt']);
  assert.deepEqual(names('c:boros'), ['Boros Reckoner', 'Lightning Helix']);
  assert.deepEqual(names('c:m'), ['Boros Reckoner', 'Lightning Helix']);
  assert.equal(names('').length, cards.length);
  assert.equal(isAdvancedQuery('lightning bolt'), false);
  assert.equal(isAdvancedQuery('t:creature'), true);
  assert.equal(isAdvancedQuery('#aggro'), true);
});

test('tokens needed are read from rules text', () => {
  const tok = (oracle_text, name = 'X') => tokensMade({ name, oracle_text });
  assert.deepEqual(tok('Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.'), ['1/1 red Elemental creature']);
  assert.deepEqual(tok('When this enters, create two 1/1 white Spirit creature tokens with flying.'), ['1/1 white Spirit creature with flying']);
  assert.deepEqual(tok('Create a number of Treasure tokens equal to the number of opponents.'), ['Treasure']);
  assert.deepEqual(tok('If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.'), []);
  assert.deepEqual(tok('Whenever this attacks, create a Food token or a Treasure token.'), ['Food', 'Treasure']);
  assert.deepEqual(tok('Create a token that\'s a copy of target creature.'), []);
  assert.deepEqual(tok('Create X tapped 2/2 black Zombie creature tokens.'), ['2/2 black Zombie creature']);
  assert.deepEqual(tok('−8: You get an emblem with "Spells you cast cost {B} less."', 'Liliana'), ['Emblem (Liliana)']);
});
