import test from 'node:test';
import assert from 'node:assert/strict';
import { generateExport, countExportedCards, EXPORT_FORMATS } from './deckExport.js';

const card = (name, overrides = {}) => ({
  name,
  quantity: 1,
  board_type: 'mainboard',
  set_code: 'thb',
  collector_number: '302',
  type_line: 'Sorcery',
  ...overrides,
});

const deck = [
  card('Atraxa, Praetors\' Voice', { is_commander: 1, set_code: 'c16', collector_number: '28' }),
  card('Shatter the Sky', { quantity: 2 }),
  card('Delver of Secrets // Insectile Aberration', { layout: 'transform', set_code: 'isd', collector_number: '51' }),
  card('Bonecrusher Giant // Stomp', { layout: 'adventure', set_code: 'eld', collector_number: '115' }),
  card('Fire // Ice', { layout: 'split', set_code: 'mh2', collector_number: '290' }),
  card('Island', { quantity: 3, set_code: 'eld', collector_number: '254', type_line: 'Basic Land — Island' }),
  card('Island', { quantity: 2, set_code: 'thb', collector_number: '251', type_line: 'Basic Land — Island' }),
  card('Duress', { board_type: 'sideboard', set_code: 'm21', collector_number: '96' }),
  card('Opt', { board_type: 'maybeboard', set_code: 'xln', collector_number: '65', is_owned: 1 }),
];

test('every advertised format produces output', () => {
  for (const { id } of EXPORT_FORMATS) {
    assert.ok(generateExport(id, deck).length > 0, id);
  }
});

test('unknown formats throw instead of exporting nothing', () => {
  assert.throws(() => generateExport('nope', deck), /Unknown export format/);
});

test('MTG Print is a flat list of exact printings with no section headers', () => {
  assert.equal(generateExport('mtgprint', deck), [
    "1 Atraxa, Praetors' Voice (C16) 28",
    '2 Shatter the Sky (THB) 302',
    '1 Delver of Secrets // Insectile Aberration (ISD) 51',
    '1 Bonecrusher Giant // Stomp (ELD) 115',
    '1 Fire // Ice (MH2) 290',
    '3 Island (ELD) 254',
    '2 Island (THB) 251',
    '1 Duress (M21) 96',
  ].join('\n'));
});

test('MPC Autofill gets names it can actually find, merged across printings', () => {
  assert.equal(generateExport('mpc', deck), [
    "1 Atraxa, Praetors' Voice",
    '2 Shatter the Sky',
    '1 Delver of Secrets',
    '1 Bonecrusher Giant',
    '1 Fire Ice',
    '5 Island',
    '1 Duress',
  ].join('\n'));
});

test('Arena keeps the commander out of the deck and labels the sideboard', () => {
  assert.equal(generateExport('arena', deck), [
    'Commander',
    "1 Atraxa, Praetors' Voice (C16) 28",
    '',
    'Deck',
    '2 Shatter the Sky (THB) 302',
    '1 Delver of Secrets // Insectile Aberration (ISD) 51',
    '1 Bonecrusher Giant // Stomp (ELD) 115',
    '1 Fire // Ice (MH2) 290',
    '3 Island (ELD) 254',
    '2 Island (THB) 251',
    '',
    'Sideboard',
    '1 Duress (M21) 96',
  ].join('\n'));
});

test('partner commanders are all exported', () => {
  const partners = [card('Tymna the Weaver', { is_commander: 1 }), card('Thrasios, Triton Hero', { is_commander: 1 })];
  const lines = generateExport('text', partners).split('\n');
  assert.deepEqual(lines, ['Commander', '1 Tymna the Weaver', '1 Thrasios, Triton Hero']);
});

test('MTGO uses a SIDEBOARD section and differs from Arena', () => {
  const text = generateExport('mtgo', deck);
  assert.match(text, /\n\nSIDEBOARD:\n1 Duress$/);
  assert.notEqual(text, generateExport('arena', deck));
});

test('Moxfield includes printings, never claims foil, and can add a maybeboard', () => {
  const text = generateExport('moxfield', deck, { includeMaybeboard: true });
  assert.match(text, /^2 Shatter the Sky \(THB\) 302$/m);
  assert.match(text, /\n\nSIDEBOARD:\n1 Duress \(M21\) 96\n\nMAYBEBOARD:\n1 Opt \(XLN\) 65$/);
  assert.doesNotMatch(text, /\*F\*/);
});

test('TCGplayer uses bracketed set codes', () => {
  assert.match(generateExport('tcgplayer', deck), /^2 Shatter the Sky \[THB\]$/m);
});

test('CSV escapes names and records the board', () => {
  const rows = generateExport('csv', deck).split('\n');
  assert.equal(rows[0], 'Count,Name,Set Code,Set Name,Collector Number,Rarity,Board');
  assert.ok(rows.includes('1,"Atraxa, Praetors\' Voice",C16,,28,,commander'));
});

test('options filter basics, owned cards and the sideboard', () => {
  assert.doesNotMatch(generateExport('mpc', deck, { excludeBasics: true }), /Island/);
  assert.doesNotMatch(generateExport('mpc', deck, { includeSideboard: false }), /Duress/);
  const withOpt = generateExport('mpc', deck, { includeMaybeboard: true });
  assert.match(withOpt, /1 Opt/);
  assert.doesNotMatch(generateExport('mpc', deck, { includeMaybeboard: true, unownedOnly: true }), /Opt/);
});

test('countExportedCards follows the options', () => {
  assert.equal(countExportedCards(deck), 12);
  assert.equal(countExportedCards(deck, { excludeBasics: true }), 7);
});

test('legacy rows without board_type still sort by is_sideboard', () => {
  const legacy = [{ name: 'Duress', quantity: 1, board_type: null, is_sideboard: 1 }];
  assert.equal(generateExport('text', legacy), 'Sideboard\n1 Duress');
});
