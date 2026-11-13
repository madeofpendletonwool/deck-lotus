import test from 'node:test';
import assert from 'node:assert/strict';
import { generateExport, countExportedCards, partitionDeck, EXPORT_FORMATS } from './deckExport.js';

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

test('MPC Autofill joins every name on a one-sided card, and uses the front of the rest', () => {
  const names = (name, layout) => generateExport('mpc', [card(name, { layout })]);
  assert.equal(names('Commit // Memory', 'aftermath'), '1 Commit Memory');
  assert.equal(names('Budoka Pupil // Ichiga, Who Topples Oaks', 'flip'), '1 Budoka Pupil Ichiga, Who Topples Oaks');
  assert.equal(names('Who // What // When // Where // Why', 'split'), '1 Who What When Where Why');
  assert.equal(names('Lorehold Archivist // Restore Relic', 'prepare'), '1 Lorehold Archivist');
  assert.equal(names('Akoum Warrior // Akoum Teeth', 'modal_dfc'), '1 Akoum Warrior');
  assert.equal(names('Graf Rats // Chittering Host', 'meld'), '1 Graf Rats');
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

test('only unowned exports the copies still missing', () => {
  const mpc = (cards) => generateExport('mpc', cards, { unownedOnly: true, includeMaybeboard: true });

  assert.equal(mpc([card('Opt', { quantity: 4, is_owned: 1, owned_quantity: 1 })]), '3 Opt');
  assert.equal(mpc([card('Opt', { quantity: 4, is_owned: 1, owned_quantity: 4 })]), '');
  assert.equal(mpc([card('Opt', { quantity: 2, is_owned: 1, owned_quantity: 9 })]), '');
  assert.equal(mpc([card('Opt', { quantity: 4, is_owned: 0, owned_quantity: null })]), '4 Opt');
});

test('owned copies are shared across printings and boards, earliest board first', () => {
  const opt = { card_id: 7, is_owned: 1, owned_quantity: 3 };
  const cards = [
    card('Opt', { ...opt, quantity: 2, set_code: 'xln' }),
    card('Opt', { ...opt, quantity: 2, set_code: 'dom' }),
    card('Opt', { ...opt, quantity: 2, board_type: 'sideboard' }),
  ];
  const { main, side } = partitionDeck(cards, { unownedOnly: true });
  assert.deepEqual(main.map((c) => [c.set_code, c.quantity]), [['dom', 1]]);
  assert.deepEqual(side.map((c) => c.quantity), [2]);
  assert.equal(countExportedCards(cards, { unownedOnly: true }), 3);
});

test('owned copies are not spent on a board that is left out', () => {
  const opt = { card_id: 7, is_owned: 1, owned_quantity: 2 };
  const cards = [
    card('Opt', { ...opt, quantity: 2, board_type: 'sideboard' }),
    card('Opt', { ...opt, quantity: 4 }),
  ];
  assert.equal(generateExport('mpc', cards, { unownedOnly: true, includeSideboard: false }), '2 Opt');
});

test('a card marked owned with no count covers every copy', () => {
  const cards = [card('Opt', { quantity: 4, is_owned: 1 })];
  assert.equal(generateExport('mpc', cards, { unownedOnly: true }), '');
});

test('removing ownership wins over a stale count', () => {
  const cards = [card('Opt', { quantity: 4, is_owned: false, owned_quantity: 3 })];
  assert.equal(generateExport('mpc', cards, { unownedOnly: true }), '4 Opt');
});

test('the owned filter leaves the source deck unchanged', () => {
  const cards = [card('Opt', { quantity: 4, is_owned: 1, owned_quantity: 1 })];
  generateExport('mpc', cards, { unownedOnly: true });
  assert.equal(cards[0].quantity, 4);
});

test('countExportedCards follows the options', () => {
  assert.equal(countExportedCards(deck), 12);
  assert.equal(countExportedCards(deck, { excludeBasics: true }), 7);
});

test('legacy rows without board_type still sort by is_sideboard', () => {
  const legacy = [{ name: 'Duress', quantity: 1, board_type: null, is_sideboard: 1 }];
  assert.equal(generateExport('text', legacy), 'Sideboard\n1 Duress');
});

const priced = [
  card('Ragavan, Nimble Pilferer', { rarity: 'mythic', price: 45.5, type_line: 'Legendary Creature — Monkey Pirate' }),
  card('Lightning Bolt', { quantity: 4, rarity: 'common', price: 1.2, type_line: 'Instant' }),
  card('Delver of Secrets // Insectile Aberration', { quantity: 4, layout: 'transform', rarity: 'common', price: 0.3, type_line: 'Creature — Human Wizard' }),
  card('Scalding Tarn', { quantity: 2, rarity: 'rare', price: 22, type_line: 'Land' }),
  card('Mystery Card', { rarity: 'rare', price: null, type_line: 'Sorcery' }),
  card('Island', { quantity: 6, price: 0.1, type_line: 'Basic Land — Island' }),
];
const names = (options) => partitionDeck(priced, options).main.map((c) => c.name);

test('a price filter keeps only cards at or over the threshold, and never guesses for unpriced ones', () => {
  assert.deepEqual(names({ filter: 'usd>=5' }), ['Ragavan, Nimble Pilferer', 'Scalding Tarn']);
  assert.deepEqual(names({ filter: '$>1' }), ['Ragavan, Nimble Pilferer', 'Lightning Bolt', 'Scalding Tarn']);
  assert.deepEqual(names({ filter: 'usd<1' }), ['Delver of Secrets // Insectile Aberration', 'Island']);
  assert.deepEqual(names({ filter: 'is:unpriced' }), ['Mystery Card']);
});

test('a price of 0 counts as unknown, as the deck price endpoint reports unpriced cards that way', () => {
  assert.deepEqual(partitionDeck([card('Free?', { price: 0 })], { filter: 'usd<1' }).main, []);
});

test('filters combine with each other and with the other export options', () => {
  assert.deepEqual(names({ filter: 'usd>=5 -t:land' }), ['Ragavan, Nimble Pilferer']);
  assert.deepEqual(names({ filter: 'r>=rare or is:dfc' }), [
    'Ragavan, Nimble Pilferer',
    'Delver of Secrets // Insectile Aberration',
    'Scalding Tarn',
    'Mystery Card',
  ]);
  assert.deepEqual(names({ filter: 'usd<1', excludeBasics: true }), ['Delver of Secrets // Insectile Aberration']);
  assert.equal(countExportedCards(priced, { filter: 'usd>=5' }), 3);
});

test('the filter applies to every board, commanders included', () => {
  const kept = partitionDeck(deck, { filter: 's:c16 or s:m21' });
  assert.deepEqual(kept.commanders.map((c) => c.name), ["Atraxa, Praetors' Voice"]);
  assert.deepEqual(kept.main, []);
  assert.deepEqual(kept.side.map((c) => c.name), ['Duress']);
});

test('one copy of each collapses quantities and printings across boards', () => {
  const out = generateExport('mpc', [
    ...priced,
    card('Island', { quantity: 3, set_code: 'eld', type_line: 'Basic Land — Island' }),
    card('Lightning Bolt', { board_type: 'sideboard' }),
  ], { oneOfEach: true });
  assert.equal(out.split('\n').filter((l) => l.startsWith('1 ')).length, out.split('\n').length);
  assert.equal(out.match(/Island/g).length, 1);
  assert.equal(out.match(/Lightning Bolt/g).length, 1);
});

test('one copy of each runs after the ownership filter, so owned cards stay out', () => {
  const cards = [card('Sol Ring', { quantity: 1, is_owned: 1, owned_quantity: 1, card_id: 1 }), card('Mana Crypt', { card_id: 2 })];
  assert.equal(generateExport('mpc', cards, { unownedOnly: true, oneOfEach: true }), '1 Mana Crypt');
});
