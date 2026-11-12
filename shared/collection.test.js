import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingRows, collectionReport, contestedCards, deckIdentity, binderFits, cardStatus, primaryType, deckDemand } from './collection.js';
import { resolveRules } from './formats.js';

const row = (card_id, name, quantity, extra = {}) => ({ card_id, name, quantity, board_type: 'mainboard', type_line: 'Instant', ...extra });

test('deck demand adds up printings of one card and skips the maybeboard', () => {
  const demand = deckDemand([
    row(1, 'Bolt', 2, { price: 1 }),
    row(1, 'Bolt', 2, { price: 3 }),
    row(1, 'Bolt', 4, { board_type: 'maybeboard', price: 100 }),
    row(2, 'Counterspell', 1, { board_type: 'sideboard' }),
  ]);
  assert.equal(demand.get(1).quantity, 4);
  assert.equal(demand.get(1).value / demand.get(1).pricedQty, 2);
  assert.equal(demand.get(2).quantity, 1);
});

test('card status', () => {
  assert.equal(cardStatus({ need: 1, owned: 0, otherDemand: 0 }), 'missing');
  assert.equal(cardStatus({ need: 4, owned: 2, otherDemand: 0 }), 'partial');
  assert.equal(cardStatus({ need: 1, owned: 1, otherDemand: 0 }), 'owned');
  assert.equal(cardStatus({ need: 1, owned: 1, otherDemand: 1 }), 'shared');
  assert.equal(cardStatus({ need: 1, owned: 2, otherDemand: 1 }), 'owned');
});

test('report counts owned and missing copies and prices what is missing', () => {
  const rows = [
    row(1, 'Bolt', 4, { price: 0.5 }),
    row(2, 'Sol Ring', 1, { price: 2 }),
    row(3, 'Unpriced Thing', 1, { price: null }),
    row(4, 'Mountain', 20, { type_line: 'Basic Land — Mountain' }),
  ];
  const owned = new Map([[1, 1], [2, 3]]);
  const cheapest = new Map([[1, 0.25], [2, 1]]);
  const { summary, cards } = collectionReport({ rows, owned, cheapest });

  assert.equal(summary.basics, 20, 'basics are set aside');
  assert.equal(summary.cards, 3);
  assert.equal(summary.copies, 6);
  assert.equal(summary.ownedCopies, 2);
  assert.equal(summary.missingCopies, 4);
  assert.equal(summary.ownedCards, 1);
  assert.equal(summary.missingCards, 2);
  assert.equal(summary.cost, 1.5); // 3 Bolts at the deck's 0.50
  assert.equal(summary.cheapestCost, 0.75); // 3 Bolts at 0.25
  assert.equal(summary.unpriced, 1);

  assert.deepEqual(cards.map((c) => [c.name, c.status]), [
    ['Unpriced Thing', 'missing'],
    ['Bolt', 'partial'],
    ['Sol Ring', 'owned'],
  ]);
});

test('a deck printing with no price falls back to the cheapest printing', () => {
  const { summary, cards } = collectionReport({ rows: [row(1, 'Card', 2, { price: null })], cheapest: new Map([[1, 4]]) });
  assert.equal(cards[0].price_each, 4);
  assert.equal(summary.cost, 8);
  assert.equal(summary.unpriced, 0);
});

test('copies other decks claim make a card shared and are priced separately', () => {
  const rows = [row(1, 'Sol Ring', 1, { price: 2 }), row(2, 'Rhystic Study', 1, { price: 30 })];
  const owned = new Map([[1, 1], [2, 2]]);
  const otherDecks = [
    { deck_id: 10, deck_name: 'Atraxa', card_id: 1, quantity: 1 },
    { deck_id: 11, deck_name: 'Krenko', card_id: 1, quantity: 1 },
    { deck_id: 10, deck_name: 'Atraxa', card_id: 2, quantity: 1 },
    { deck_id: 12, deck_name: 'Unrelated', card_id: 99, quantity: 1 },
  ];
  const { summary, cards } = collectionReport({ rows, owned, otherDecks });
  const sol = cards.find((c) => c.name === 'Sol Ring');
  const rhystic = cards.find((c) => c.name === 'Rhystic Study');

  assert.equal(sol.status, 'shared');
  assert.equal(sol.other_demand, 2);
  assert.deepEqual(sol.other_decks.map((d) => d.name), ['Atraxa', 'Krenko']);
  assert.equal(sol.alongside, 1);
  assert.equal(rhystic.status, 'owned', 'two copies cover both decks');
  assert.equal(rhystic.alongside, 0);

  assert.equal(summary.missingCopies, 0);
  assert.equal(summary.sharedCards, 1);
  assert.equal(summary.alongsideCopies, 1);
  assert.equal(summary.alongsideCost, 2);
});

test('contested cards need two decks wanting more copies than you own', () => {
  const usage = [
    { card_id: 1, name: 'Sol Ring', deck_id: 1, deck_name: 'A', quantity: 1 },
    { card_id: 1, name: 'Sol Ring', deck_id: 2, deck_name: 'B', quantity: 1 },
    { card_id: 1, name: 'Sol Ring', deck_id: 3, deck_name: 'C', quantity: 1 },
    { card_id: 2, name: 'Bolt', deck_id: 1, deck_name: 'A', quantity: 4 }, // one deck only
    { card_id: 3, name: 'Unowned', deck_id: 1, deck_name: 'A', quantity: 1 },
    { card_id: 3, name: 'Unowned', deck_id: 2, deck_name: 'B', quantity: 1 },
    { card_id: 4, name: 'Plenty', deck_id: 1, deck_name: 'A', quantity: 1 },
    { card_id: 4, name: 'Plenty', deck_id: 2, deck_name: 'B', quantity: 1 },
    { card_id: 5, name: 'Island', type_line: 'Basic Land — Island', deck_id: 1, deck_name: 'A', quantity: 30 },
    { card_id: 5, name: 'Island', type_line: 'Basic Land — Island', deck_id: 2, deck_name: 'B', quantity: 30 },
  ];
  const owned = new Map([[1, 1], [2, 1], [4, 2], [5, 1]]);
  const result = contestedCards(usage, owned);
  assert.deepEqual(result.map((c) => c.name), ['Sol Ring']);
  assert.equal(result[0].short, 2);
  assert.equal(result[0].decks.length, 3);
});

test('a card listed twice in one deck counts as one deck', () => {
  const usage = [
    { card_id: 1, name: 'X', deck_id: 1, deck_name: 'A', quantity: 1 },
    { card_id: 1, name: 'X', deck_id: 1, deck_name: 'A', quantity: 1 },
  ];
  assert.deepEqual(contestedCards(usage, new Map([[1, 1]])), []);
});

test('deck identity comes from the commanders, or from the cards in other formats', () => {
  const commander = resolveRules('commander');
  const rows = [
    row(1, 'Atraxa', 1, { is_commander: 1, color_identity: 'W, U, B, G' }),
    row(2, 'Lightning Bolt', 1, { color_identity: 'R' }),
  ];
  assert.deepEqual(deckIdentity(rows, commander), { colors: ['W', 'U', 'B', 'G'], source: 'commander', names: ['Atraxa'] });
  assert.equal(deckIdentity([rows[1]], commander).source, 'no-commander');
  assert.deepEqual(deckIdentity(rows, resolveRules('modern')).colors, ['W', 'U', 'B', 'R', 'G']);
  assert.equal(deckIdentity([], resolveRules('modern')).colors, null);
});

test('primary type', () => {
  assert.equal(primaryType({ type_line: 'Artifact Creature — Golem' }), 'creature');
  assert.equal(primaryType({ type_line: 'Artifact Land' }), 'land');
  assert.equal(primaryType({ type_line: 'Legendary Artifact' }), 'artifact');
  assert.equal(primaryType({ type_line: 'Instant // Sorcery' }), 'instant');
});

const legal = (extra = {}) => JSON.stringify({ commander: 'Legal', modern: 'Legal', ...extra });
const binder = [
  { card_id: 1, name: 'Sol Ring', type_line: 'Artifact', color_identity: '', legalities: legal({ modern: null }), owned: 1, cmc: 1, edhrec_rank: 1 },
  { card_id: 2, name: 'Counterspell', type_line: 'Instant', color_identity: 'U', legalities: legal(), owned: 2, cmc: 2, edhrec_rank: 50, oracle_text: 'Counter target spell.' },
  { card_id: 3, name: 'Lightning Bolt', type_line: 'Instant', color_identity: 'R', legalities: legal(), owned: 4, cmc: 1, edhrec_rank: 20 },
  { card_id: 4, name: 'Mana Crypt', type_line: 'Artifact', color_identity: '', legalities: legal({ commander: 'Banned' }), owned: 1, cmc: 0, edhrec_rank: 5 },
  { card_id: 5, name: 'Forest', type_line: 'Basic Land — Forest', color_identity: 'G', legalities: legal(), owned: 50, cmc: 0 },
  { card_id: 6, name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', color_identity: 'G', legalities: legal(), owned: 1, cmc: 1, edhrec_rank: 100 },
];

test('binder fits keep to the colors and format and skip what the deck has', () => {
  const result = binderFits(binder, {
    rules: resolveRules('commander'),
    colors: ['U', 'G'],
    inDeck: new Set([6]),
    used: new Map([[1, 1]]),
    sort: 'rank',
  });
  assert.deepEqual(result.cards.map((c) => c.name), ['Sol Ring', 'Counterspell']);
  assert.equal(result.cards[0].free, 0, 'the only Sol Ring is in another deck');
  assert.equal(result.cards[1].free, 2);
  assert.equal(result.cards[0].legalities, undefined, 'bulky fields are dropped');
  assert.deepEqual(result.typeCounts, { artifact: 1, instant: 1 });
});

test('binder fits filter by text, type, free copies, and page', () => {
  const opts = { rules: resolveRules('commander'), used: new Map([[1, 1]]) };
  assert.deepEqual(binderFits(binder, { ...opts, q: 'counter target' }).cards.map((c) => c.name), ['Counterspell']);
  assert.deepEqual(binderFits(binder, { ...opts, type: 'creature' }).cards.map((c) => c.name), ['Llanowar Elves']);
  assert.ok(!binderFits(binder, { ...opts, freeOnly: true }).cards.some((c) => c.name === 'Sol Ring'));
  const page = binderFits(binder, { ...opts, sort: 'name', offset: 1, limit: 2 });
  assert.equal(page.total, 4);
  assert.deepEqual(page.cards.map((c) => c.name), ['Lightning Bolt', 'Llanowar Elves']);
});

test('binder fits use the deck format: Sol Ring is not legal in Modern', () => {
  const names = binderFits(binder, { rules: resolveRules('modern') }).cards.map((c) => c.name);
  assert.ok(!names.includes('Sol Ring'));
  assert.ok(names.includes('Mana Crypt'), 'banned in Commander only');
});

test('missing rows keep only the copies you are short of, mainboard first', () => {
  const rows = [
    row(1, 'Bolt', 4, { owned_quantity: 3 }),
    row(1, 'Bolt', 2, { board_type: 'sideboard', owned_quantity: 3 }),
    row(2, 'Sol Ring', 1, { owned_quantity: 1 }),
    row(3, 'Mountain', 10, { type_line: 'Basic Land — Mountain', owned_quantity: 0 }),
    row(4, 'Maybe', 1, { board_type: 'maybeboard', owned_quantity: 0 }),
    row(5, 'Unowned', 2, { owned_quantity: null }),
  ];
  assert.deepEqual(missingRows(rows).map((r) => [r.name, r.board_type, r.quantity]), [
    ['Bolt', 'mainboard', 1],
    ['Bolt', 'sideboard', 2],
    ['Unowned', 'mainboard', 2],
  ]);
});
