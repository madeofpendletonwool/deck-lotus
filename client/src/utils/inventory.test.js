import test from 'node:test';
import assert from 'node:assert/strict';
import { toItems, filterItems, sortItems, setFacets, totals, activeFilterCount, EMPTY_FILTERS } from './inventory.js';
import { groupItems } from './shopping.js';

const index = {
  sets: { m11: ['Magic 2011', '2010-07-16'], '2xm': ['Double Masters', '2020-08-07'], lea: ['Limited Edition Alpha', '1993-08-05'] },
  cards: [
    {
      card_id: 1, name: 'Lightning Bolt', type_line: 'Instant', colors: 'R', cmc: 1, oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      added: '2026-01-02', in_decks: 2,
      printings: [
        [10, 'm11', '146', 'common', 'nonfoil', 3, 1.5, 'u1'],
        [11, '2xm', '117', 'uncommon', 'foil', 1, 4, 'u2'],
      ],
    },
    {
      card_id: 2, name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', colors: 'G', cmc: 1, added: '2026-03-01', in_decks: 0,
      printings: [[20, 'm11', '182', 'common', 'nonfoil', 4, 0.25, 'u3']],
    },
    {
      card_id: 3, name: 'Sol Ring', type_line: 'Artifact', colors: '', cmc: 1, added: '2025-12-01', in_decks: 3,
      printings: [[30, 'lea', '270', 'uncommon', 'nonfoil', 1, 3000, 'u4']],
    },
    {
      card_id: 4, name: 'Boros Charm', type_line: 'Instant', colors: 'R,W', cmc: 2, added: '2026-02-01', in_decks: 0,
      printings: [[40, '2xm', '190', 'uncommon', 'nonfoil', 2, null, 'u5']],
    },
  ],
};

const items = toItems(index);
const names = (list) => list.map((i) => i.name);
const f = (overrides) => ({ ...EMPTY_FILTERS, ...overrides });

test('toItems totals copies, value and what is free', () => {
  const bolt = items[0];
  assert.equal(bolt.qty, 4);
  assert.equal(bolt.value, 8.5);
  assert.equal(bolt.price, 4);
  assert.equal(bolt.free, 2);
  assert.equal(bolt.has_foil, true);
  assert.deepEqual(bolt.set_codes, ['m11', '2xm']);
  assert.equal(bolt.set_name, 'Magic 2011');
  assert.equal(bolt.rarity, 'uncommon');
  assert.equal(items[2].free, -2);
});

test('the filter language reaches collection fields', () => {
  assert.deepEqual(names(filterItems(items, f({ query: 's:2xm' }))), ['Lightning Bolt', 'Boros Charm']);
  assert.deepEqual(names(filterItems(items, f({ query: 'qty>=4' }))), ['Lightning Bolt', 'Llanowar Elves']);
  assert.deepEqual(names(filterItems(items, f({ query: 'is:foil' }))), ['Lightning Bolt']);
  assert.deepEqual(names(filterItems(items, f({ query: 'is:unused t:instant' }))), ['Boros Charm']);
  assert.deepEqual(names(filterItems(items, f({ query: 'usd>=100' }))), ['Sol Ring']);
  assert.deepEqual(names(filterItems(items, f({ query: 'o:damage' }))), ['Lightning Bolt']);
});

test('color chips need every picked color; C adds colorless, M means gold', () => {
  assert.deepEqual(names(filterItems(items, f({ colors: ['R'] }))), ['Lightning Bolt', 'Boros Charm']);
  assert.deepEqual(names(filterItems(items, f({ colors: ['R', 'W'] }))), ['Boros Charm']);
  assert.deepEqual(names(filterItems(items, f({ colors: ['C'] }))), ['Sol Ring']);
  assert.deepEqual(names(filterItems(items, f({ colors: ['G', 'C'] }))), ['Llanowar Elves', 'Sol Ring']);
  assert.deepEqual(names(filterItems(items, f({ colors: ['M'] }))), ['Boros Charm']);
});

test('type, rarity, set, finish and availability facets', () => {
  assert.deepEqual(names(filterItems(items, f({ types: ['Creature', 'Artifact'] }))), ['Llanowar Elves', 'Sol Ring']);
  assert.deepEqual(names(filterItems(items, f({ rarities: ['common'] }))), ['Lightning Bolt', 'Llanowar Elves']);
  assert.deepEqual(names(filterItems(items, f({ sets: ['lea'] }))), ['Sol Ring']);
  assert.deepEqual(names(filterItems(items, f({ finish: 'foil' }))), ['Lightning Bolt']);
  assert.deepEqual(names(filterItems(items, f({ availability: 'short' }))), ['Sol Ring']);
  assert.deepEqual(names(filterItems(items, f({ availability: 'free' }))), ['Lightning Bolt', 'Llanowar Elves', 'Boros Charm']);
  assert.equal(activeFilterCount(f({ colors: ['R'], finish: 'foil', query: 'x' })), 3);
});

test('sorts', () => {
  assert.deepEqual(names(sortItems(items, 'value')), ['Sol Ring', 'Lightning Bolt', 'Llanowar Elves', 'Boros Charm']);
  assert.deepEqual(names(sortItems(items, 'added')), ['Llanowar Elves', 'Boros Charm', 'Lightning Bolt', 'Sol Ring']);
  assert.deepEqual(names(sortItems(items, 'value', { reverse: true })), ['Boros Charm', 'Llanowar Elves', 'Lightning Bolt', 'Sol Ring']);
  assert.deepEqual(names(sortItems(items, 'name', { reverse: true })), names(sortItems(items, 'name')).reverse());
  assert.deepEqual(names(sortItems(items, 'color')), ['Lightning Bolt', 'Llanowar Elves', 'Boros Charm', 'Sol Ring']);
  assert.deepEqual(names(sortItems(items, 'set')), ['Boros Charm', 'Lightning Bolt', 'Llanowar Elves', 'Sol Ring']);
});

test('set facets count cards with a copy from each set, newest set first', () => {
  assert.deepEqual(setFacets(items).map((s) => [s.code, s.count]), [['2xm', 2], ['m11', 2], ['lea', 1]]);
});

test('totals, and grouping keeps the chosen order', () => {
  const t = totals(items);
  assert.equal(t.copies, 11);
  assert.equal(t.free, 8);
  const groups = groupItems(sortItems(items, 'value'), 'color', { keepOrder: true });
  assert.deepEqual(groups.map((g) => g.label), ['Red', 'Green', 'Multicolor', 'Colorless']);
  assert.equal(groups.find((g) => g.label === 'Red').copies, 4);
  assert.equal(groups.find((g) => g.label === 'Colorless').cost, 3000);
});
