import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDecks, formatsInUse } from './deckList.js';

const decks = [
  { name: 'Zada Storm', format: 'commander', updated_at: '2026-11-01 10:00:00', created_at: '2026-01-01 00:00:00', mainboard_count: 100, total_price: 420 },
  { name: 'aggro red', format: 'modern', updated_at: '2026-11-10 10:00:00', created_at: '2026-03-01 00:00:00', mainboard_count: 60, total_price: 85.5, description: 'Burn them out' },
  { name: 'Vintage Cube', format: 'cube', updated_at: '2026-10-01 10:00:00', created_at: '2026-06-01 00:00:00', mainboard_count: 540, total_price: 9000 },
  { name: 'Empty', format: null, updated_at: '2026-09-01 10:00:00', created_at: '2026-11-01 00:00:00', mainboard_count: 0, total_price: 0 },
];
const names = (list) => list.map((d) => d.name);

test('sorts by each key, ties by name', () => {
  assert.deepEqual(names(filterDecks(decks)), ['aggro red', 'Zada Storm', 'Vintage Cube', 'Empty']);
  assert.deepEqual(names(filterDecks(decks, { sort: 'created' })), ['Empty', 'Vintage Cube', 'aggro red', 'Zada Storm']);
  assert.deepEqual(names(filterDecks(decks, { sort: 'name' })), ['aggro red', 'Empty', 'Vintage Cube', 'Zada Storm']);
  assert.deepEqual(names(filterDecks(decks, { sort: 'cards' })), ['Vintage Cube', 'Zada Storm', 'aggro red', 'Empty']);
  assert.deepEqual(names(filterDecks(decks, { sort: 'price-desc' })), ['Vintage Cube', 'Zada Storm', 'aggro red', 'Empty']);
});

test('cheapest first puts unpriced decks last', () => {
  assert.deepEqual(names(filterDecks(decks, { sort: 'price-asc' })), ['aggro red', 'Zada Storm', 'Vintage Cube', 'Empty']);
});

test('filters by kind, format and text', () => {
  assert.deepEqual(names(filterDecks(decks, { kind: 'cubes' })), ['Vintage Cube']);
  assert.equal(filterDecks(decks, { kind: 'decks' }).length, 3);
  assert.deepEqual(names(filterDecks(decks, { format: 'modern' })), ['aggro red']);
  assert.deepEqual(names(filterDecks(decks, { format: 'none' })), ['Empty']);
  assert.deepEqual(names(filterDecks(decks, { query: 'burn' })), ['aggro red']);
  assert.deepEqual(names(filterDecks(decks, { query: 'EDH', formatLabel: (f) => (f === 'commander' ? 'Commander (EDH)' : f) })), ['Zada Storm']);
});

test('lists the formats in use', () => {
  assert.deepEqual(formatsInUse(decks).sort(), ['commander', 'cube', 'modern', 'none']);
});
