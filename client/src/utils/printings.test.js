import test from 'node:test';
import assert from 'node:assert/strict';
import { printingPrice, printingFinishNote, sortPrintings, uniquePrintings, printingMatches, priceRange, formatPrice } from './printings.js';

const printing = (set_code, price_normal, set_release_date, overrides = {}) => ({
  set_code,
  set_name: `${set_code} set`,
  collector_number: '1',
  price_normal,
  price_foil: null,
  set_release_date,
  ...overrides,
});

const codes = (printings) => printings.map((p) => p.set_code);

const cheap = printing('CHP', 0.25, '2020-01-01');
const mid = printing('MID', 5, '2024-01-01');
const dear = printing('DER', 40, '2010-01-01');
const unpriced = printing('NON', null, '2026-01-01');
const foilOnly = printing('FOI', null, '2015-01-01', { price_foil: 12 });
const all = [unpriced, mid, dear, foilOnly, cheap];

test('a foil-only printing is priced at its foil price, and a normal price wins otherwise', () => {
  assert.equal(printingPrice(foilOnly), 12);
  assert.equal(printingPrice({ price_normal: 1, price_foil: 9 }), 1);
  assert.equal(printingPrice(unpriced), null);
});

test('an etched-only printing is priced at its etched price', () => {
  assert.equal(printingPrice({ price_normal: null, price_foil: null, price_etched: 7 }), 7);
});

test('the finish note explains the price shown', () => {
  assert.equal(printingFinishNote({ price_normal: 1, price_foil: 2.5 }), 'Foil $2.50');
  assert.equal(printingFinishNote({ price_normal: 1, price_foil: null }), '');
  assert.equal(printingFinishNote({ price_normal: null, price_foil: 2 }), 'Foil only');
  assert.equal(printingFinishNote({ price_normal: null, price_foil: null, price_etched: 2 }), 'Etched only');
  assert.equal(printingFinishNote({ price_normal: null, price_foil: null, price_etched: null }), '');
});

test('cheapest and most expensive both leave unpriced printings at the end', () => {
  assert.deepEqual(codes(sortPrintings(all, 'price-asc')), ['CHP', 'MID', 'FOI', 'DER', 'NON']);
  assert.deepEqual(codes(sortPrintings(all, 'price-desc')), ['DER', 'FOI', 'MID', 'CHP', 'NON']);
});

test('sorts by release date, leaving printings with no date at the end', () => {
  const undated = printing('UND', 1, null);
  assert.deepEqual(codes(sortPrintings([cheap, undated, mid, dear], 'date-desc')), ['MID', 'CHP', 'DER', 'UND']);
  assert.deepEqual(codes(sortPrintings([cheap, undated, mid, dear], 'date-asc')), ['DER', 'CHP', 'MID', 'UND']);
});

test('equal prices list the newest printing first', () => {
  const older = printing('OLD', 1, '2001-01-01');
  const newer = printing('NEW', 1, '2021-01-01');
  assert.deepEqual(codes(sortPrintings([older, newer], 'price-asc')), ['NEW', 'OLD']);
});

test('set sort orders collector numbers numerically within a set', () => {
  const ten = printing('AAA', 1, '2020-01-01', { collector_number: '10' });
  const two = printing('AAA', 1, '2020-01-01', { collector_number: '2' });
  assert.deepEqual(sortPrintings([ten, two], 'set').map((p) => p.collector_number), ['2', '10']);
});

test('sorting leaves the original list alone', () => {
  const original = [dear, cheap];
  sortPrintings(original, 'price-asc');
  assert.deepEqual(codes(original), ['DER', 'CHP']);
});

test('a double-faced printing stored once per face is listed once', () => {
  const front = printing('MH3', 15.96, '2024-06-14', { id: 1, collector_number: '242' });
  const back = printing('MH3', 15.96, '2024-06-14', { id: 2, collector_number: '242' });
  const borderless = printing('MH3', 29, '2024-06-14', { id: 3, collector_number: '443' });
  assert.deepEqual(uniquePrintings([front, back, borderless]).map((p) => p.id), [1, 3]);
});

test('the row the deck uses survives de-duplication, so it can still be marked current', () => {
  const front = printing('MH3', 15.96, '2024-06-14', { id: 1 });
  const back = printing('MH3', 15.96, '2024-06-14', { id: 2 });
  assert.deepEqual(uniquePrintings([front, back], 2).map((p) => p.id), [2]);
  assert.deepEqual(uniquePrintings([back, front], 2).map((p) => p.id), [2]);
  assert.deepEqual(uniquePrintings([front, back], '2').map((p) => p.id), [2]);
});

test('without a current row, the face with more prices is kept', () => {
  const unpricedFace = printing('MH3', null, '2024-06-14', { id: 1 });
  const pricedFace = printing('MH3', 5, '2024-06-14', { id: 2, price_foil: 8 });
  assert.deepEqual(uniquePrintings([unpricedFace, pricedFace]).map((p) => p.id), [2]);
});

test('search matches set code or name, ignoring case', () => {
  const horizons = printing('MH3', 1, '2024-06-14', { set_name: 'Modern Horizons 3' });
  assert.equal(printingMatches(horizons, 'mh3'), true);
  assert.equal(printingMatches(horizons, ' HORIZONS '), true);
  assert.equal(printingMatches(horizons, 'zendikar'), false);
  assert.equal(printingMatches(horizons, ''), true);
});

test('price range ignores unpriced printings', () => {
  assert.deepEqual(priceRange(all), { min: 0.25, max: 40 });
  assert.equal(priceRange([unpriced]), null);
});

test('formats prices in dollars', () => {
  assert.equal(formatPrice(3.5), '$3.50');
});
