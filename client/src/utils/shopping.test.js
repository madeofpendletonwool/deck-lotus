import test from 'node:test';
import assert from 'node:assert/strict';
import { needFor, buildList, deckMissingCounts, groupItems, listText } from './shopping.js';
import { compileQuery } from './cardQuery.js';

const card = (name, overrides = {}) => ({
  card_id: overrides.card_id ?? name.length,
  name,
  type_line: 'Instant',
  colors: 'R',
  cmc: 1,
  owned: 0,
  cheapest: 0.5,
  printings: [{ printing_id: 1, set_code: 'm11', set_name: 'Magic 2011', collector_number: '146', rarity: 'common', price: 1.5, quantity: 4 }],
  decks: [{ deck_id: 1, main: 4, side: 0, maybe: 0, commander: false }],
  ...overrides,
});

const all = new Set([1, 2, 3]);

test('need is what the selected decks want minus every copy you own', () => {
  const bolt = card('Lightning Bolt', {
    owned: 3,
    decks: [{ deck_id: 1, main: 4, side: 0, maybe: 0 }, { deck_id: 2, main: 2, side: 1, maybe: 0 }],
  });
  assert.equal(needFor(bolt, all).need, 4);
  assert.equal(needFor(bolt, new Set([1])).need, 1);
  assert.equal(needFor(bolt, new Set([2])).need, 0);
});

test('maybeboards only count when asked', () => {
  const c = card('Shock', { decks: [{ deck_id: 1, main: 0, side: 0, maybe: 2 }] });
  assert.equal(needFor(c, all).need, 0);
  assert.equal(needFor(c, all, { includeMaybe: true }).need, 2);
  assert.equal(needFor(c, all, { includeMaybe: true }).decks[0].maybeOnly, true);
});

test('buildList leaves out basics and owned cards, and prices each copy', () => {
  const items = buildList([
    card('Lightning Bolt'),
    card('Mountain', { card_id: 99, type_line: 'Basic Land — Mountain' }),
    card('Counterspell', { card_id: 50, owned: 4, colors: 'U' }),
  ], all);
  assert.deepEqual(items.map((i) => i.name), ['Lightning Bolt']);
  assert.equal(items[0].need, 4);
  assert.equal(items[0].cost, 6);
  assert.equal(items[0].set_code, 'm11');
  assert.equal(buildList([card('Mountain', { type_line: 'Basic Land — Mountain' })], all, { includeBasics: true }).length, 1);
});

test('a card without a printing price falls back to its cheapest printing', () => {
  const [item] = buildList([card('Opt', { printings: [{ printing_id: 2, set_code: 'xln', price: null, quantity: 1 }] })], all);
  assert.equal(item.price, 0.5);
});

test('items work with the card filter language', () => {
  const items = buildList([card('Lightning Bolt'), card('Tarmogoyf', { card_id: 7, type_line: 'Creature — Lhurgoyf', colors: 'G', printings: [{ printing_id: 9, set_code: 'mm3', price: 30, rarity: 'mythic', quantity: 1 }] })], all);
  assert.deepEqual(items.filter(compileQuery('usd>=5')).map((i) => i.name), ['Tarmogoyf']);
  assert.deepEqual(items.filter(compileQuery('t:instant c:r')).map((i) => i.name), ['Lightning Bolt']);
  assert.deepEqual(items.filter(compileQuery('r:mythic')).map((i) => i.name), ['Tarmogoyf']);
});

test('deckMissingCounts counts each deck on its own', () => {
  const cards = [
    card('A', { card_id: 1, owned: 1, decks: [{ deck_id: 1, main: 1, side: 0, maybe: 0 }, { deck_id: 2, main: 1, side: 0, maybe: 0 }] }),
    card('B', { card_id: 2, decks: [{ deck_id: 2, main: 1, side: 0, maybe: 0 }] }),
  ];
  const counts = deckMissingCounts(cards, [1, 2]);
  assert.equal(counts.get(1), 0);
  assert.equal(counts.get(2), 1);
});

test('set groups run newest first in binder order; price groups run most expensive first', () => {
  const items = buildList([
    card('Zap', { card_id: 1, printings: [{ set_code: 'm11', set_name: 'Magic 2011', release_date: '2010-07-16', collector_number: '10', price: 0.2, quantity: 1 }] }),
    card('Arc', { card_id: 2, printings: [{ set_code: 'm11', set_name: 'Magic 2011', release_date: '2010-07-16', collector_number: '9', price: 25, quantity: 1 }] }),
    card('Bop', { card_id: 3, printings: [{ set_code: 'akh', set_name: 'Amonkhet', release_date: '2017-04-28', collector_number: '1', price: 3, quantity: 1 }] }),
  ], all);
  const bySet = groupItems(items, 'set');
  assert.deepEqual(bySet.map((g) => g.label), ['Amonkhet', 'Magic 2011']);
  assert.deepEqual(bySet[1].items.map((i) => i.name), ['Arc', 'Zap']);
  assert.equal(bySet[1].copies, 8);
  const byPrice = groupItems(items, 'price');
  assert.deepEqual(byPrice.map((g) => g.label), ['$20 and up', '$1 to $5', 'Under $1']);
});

test('color groups put lands and gold cards in their own groups', () => {
  const items = buildList([
    card('Bolt', { card_id: 1 }),
    card('Helix', { card_id: 2, colors: 'R,W' }),
    card('Field', { card_id: 3, colors: '', type_line: 'Land' }),
    card('Ring', { card_id: 4, colors: '', type_line: 'Artifact' }),
  ], all);
  assert.deepEqual(groupItems(items, 'color').map((g) => g.label), ['Red', 'Multicolor', 'Colorless', 'Lands']);
});

test('listText writes a checklist or mass entry lines', () => {
  const groups = groupItems(buildList([card('Lightning Bolt')], all), 'set');
  assert.equal(listText(groups), 'Magic 2011\n[ ] 4 Lightning Bolt (M11 #146)  $1.50');
  assert.equal(listText(groups, { massEntry: true }), '4 Lightning Bolt');
});
