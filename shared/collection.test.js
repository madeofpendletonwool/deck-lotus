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

test('card status for your own deck follows the copies in it', () => {
  const own = (o) => cardStatus({ ownDeck: true, ...o });
  assert.equal(own({ need: 1, owned: 0 }), 'missing');
  assert.equal(own({ need: 4, owned: 2, inDeck: 2 }), 'partial');
  assert.equal(own({ need: 1, owned: 1, inDeck: 1 }), 'owned');
  assert.equal(own({ need: 1, owned: 1, inDeck: 0, free: 0 }), 'shared', 'your only copy is in another deck');
  assert.equal(own({ need: 2, owned: 3, inDeck: 1, free: 1 }), 'spare');
});

test("card status for someone else's deck counts copies no deck of yours holds", () => {
  assert.equal(cardStatus({ need: 1, owned: 1, free: 1 }), 'owned');
  assert.equal(cardStatus({ need: 1, owned: 1, free: 0 }), 'shared');
  assert.equal(cardStatus({ need: 4, owned: 2, free: 2 }), 'partial');
  assert.equal(cardStatus({ need: 1, owned: 0 }), 'missing');
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

test('in your own deck, a card is owned only when its copies are in this deck', () => {
  // One Ornithopter, held by another deck; two Sol Rings, one held here; a Bolt with a free copy
  const rows = [
    row(1, 'Ornithopter', 1, { price: 1, owned_quantity: 0 }),
    row(2, 'Sol Ring', 1, { price: 2, owned_quantity: 1 }),
    row(3, 'Bolt', 2, { price: 0.5, owned_quantity: 1 }),
    row(4, 'Maybe', 1, { board_type: 'maybeboard', owned_quantity: 0 }),
  ];
  const owned = new Map([[1, 1], [2, 2], [3, 2]]);
  const otherDecks = [
    { deck_id: 10, deck_name: 'Affinity', card_id: 1, quantity: 1, held: 1 },
    { deck_id: 11, deck_name: 'Cube', card_id: 2, quantity: 1, held: 1 },
    { deck_id: 12, deck_name: 'Wishlist', card_id: 3, quantity: 4, held: 0 },
  ];
  const { summary, cards } = collectionReport({ rows, owned, otherDecks, ownDeck: true });
  const by = Object.fromEntries(cards.map((c) => [c.name, c]));

  assert.equal(by.Ornithopter.status, 'shared');
  assert.equal(by.Ornithopter.in_deck, 0);
  assert.equal(by.Ornithopter.missing, 0, 'you could take it out of Affinity');
  assert.equal(by.Ornithopter.alongside, 1, 'or buy one so Affinity keeps it');
  assert.deepEqual(by.Ornithopter.other_decks.map((d) => [d.name, d.held]), [['Affinity', 1]]);

  assert.equal(by['Sol Ring'].status, 'owned');
  assert.equal(by['Sol Ring'].alongside, 0);

  assert.equal(by.Bolt.status, 'spare', 'a deck listing a card without holding it leaves the copy free');
  assert.equal(by.Bolt.spare, 1);
  assert.equal(by.Bolt.alongside, 0);

  assert.equal(by.Maybe, undefined);
  assert.equal(summary.ownedCards, 1);
  assert.equal(summary.ownedCopies, 2);
  assert.equal(summary.missingCards, 2);
  assert.equal(summary.sharedCards, 1);
  assert.equal(summary.spareCards, 1);
  assert.equal(summary.spareCopies, 1);
  assert.equal(summary.alongsideCopies, 1);
  assert.equal(summary.alongsideCost, 1);
});

test("someone else's deck is measured against copies your decks don't hold", () => {
  const rows = [row(1, 'Sol Ring', 1, { price: 2 }), row(2, 'Rhystic Study', 1, { price: 30 })];
  const owned = new Map([[1, 1], [2, 2]]);
  const otherDecks = [
    { deck_id: 10, deck_name: 'Atraxa', card_id: 1, quantity: 1, held: 1 },
    { deck_id: 11, deck_name: 'Krenko', card_id: 1, quantity: 1, held: 0 },
    { deck_id: 10, deck_name: 'Atraxa', card_id: 2, quantity: 1, held: 1 },
  ];
  const { summary, cards } = collectionReport({ rows, owned, otherDecks });
  const sol = cards.find((c) => c.name === 'Sol Ring');
  const rhystic = cards.find((c) => c.name === 'Rhystic Study');

  assert.equal(sol.status, 'shared');
  assert.deepEqual(sol.other_decks.map((d) => d.name), ['Atraxa', 'Krenko']);
  assert.equal(sol.alongside, 1);
  assert.equal(rhystic.status, 'owned', 'one copy is free');
  assert.equal(rhystic.alongside, 0);
  assert.equal(summary.missingCopies, 0);
  assert.equal(summary.sharedCards, 1);
  assert.equal(summary.alongsideCopies, 1);
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

test('missing rows keep only the copies the deck does not hold', () => {
  const rows = [
    row(1, 'Bolt', 4, { owned_quantity: 3 }),
    row(1, 'Bolt', 2, { board_type: 'sideboard', owned_quantity: 0 }),
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

test('missing rows do not buy copies you own that no deck holds', () => {
  const rows = [
    row(1, 'Bolt', 4, { owned_quantity: 1, free_quantity: 2 }),
    row(1, 'Bolt', 2, { board_type: 'sideboard', owned_quantity: 0, free_quantity: 2 }),
  ];
  assert.deepEqual(missingRows(rows).map((r) => [r.board_type, r.quantity]), [['mainboard', 1], ['sideboard', 2]]);
});

test('proxies cover a card without owning it, and are not bought', () => {
  const rows = [
    row(1, 'Volcanic Island', 1, { owned_quantity: 0, proxy_quantity: 1, price: 600 }),
    row(2, 'Opt', 4, { owned_quantity: 1, proxy_quantity: 1, price: 1 }),
    row(3, 'Bolt', 1, { owned_quantity: 1, price: 1 }),
  ];
  const owned = new Map([[2, 1], [3, 1]]);
  const { summary, cards } = collectionReport({ rows, owned, ownDeck: true });
  const by = new Map(cards.map((c) => [c.name, c]));

  assert.equal(by.get('Volcanic Island').status, 'proxied');
  assert.equal(by.get('Volcanic Island').missing, 0);
  assert.equal(by.get('Volcanic Island').alongside, 0);
  assert.equal(by.get('Opt').status, 'partial');
  assert.equal(by.get('Opt').proxied, 1);
  assert.equal(by.get('Opt').missing, 2);

  assert.equal(summary.ownedCards, 1, 'proxies are not owned');
  assert.equal(summary.missingCards, 1, 'a fully proxied card is not missing');
  assert.equal(summary.proxiedCards, 2);
  assert.equal(summary.proxiedCopies, 2);
  assert.equal(summary.missingCopies, 2);
  assert.equal(summary.cost, 2);
  assert.equal(summary.proxyCost, 601);
});

test("another person's proxies mean nothing when measuring their deck against your collection", () => {
  const { summary } = collectionReport({ rows: [row(1, 'Volcanic Island', 1, { proxy_quantity: 1 })], owned: new Map() });
  assert.equal(summary.missingCards, 1);
  assert.equal(summary.proxiedCopies, 0);
});

test('a free real copy beats a proxy', () => {
  const { cards } = collectionReport({ rows: [row(1, 'Opt', 1, { owned_quantity: 0, proxy_quantity: 1 })], owned: new Map([[1, 1]]), ownDeck: true });
  assert.equal(cards[0].status, 'spare');
  assert.equal(cards[0].spare, 1);
});

test('the shopping list skips proxied copies', () => {
  const rows = [
    row(1, 'Opt', 4, { owned_quantity: 1, proxy_quantity: 2, free_quantity: 0 }),
    row(2, 'Bolt', 1, { proxy_quantity: 1 }),
  ];
  assert.deepEqual(missingRows(rows).map((r) => [r.name, r.quantity]), [['Opt', 1]]);
});
