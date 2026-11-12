import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Goldfish, startingLife } from './goldfish.js';

const card = (name, extra = {}) => ({ name, quantity: 1, board_type: 'mainboard', type_line: 'Creature — Bear', ...extra });
const deck = () => [
  card('Forest', { quantity: 20, type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)' }),
  card('Grizzly Bears', { quantity: 30 }),
  card('Giant Growth', { quantity: 10, type_line: 'Instant' }),
  card('Sideboard Card', { quantity: 4, board_type: 'sideboard' }),
];

test('a new game shuffles the mainboard and draws seven', () => {
  const g = new Goldfish(deck(), { seed: 1 });
  assert.equal(g.zones.hand.length, 7);
  assert.equal(g.zones.library.length, 53);
  assert.equal(g.phase, 'mulligan');
  assert.equal(g.turn, 0);
  // Same seed, same game
  assert.deepEqual(new Goldfish(deck(), { seed: 1 }).zones.hand.map((u) => g.card(u).name), g.zones.hand.map((u) => g.card(u).name));
});

test('London mulligan: draw seven again, bottom one per mulligan to keep', () => {
  const g = new Goldfish(deck(), { seed: 2 });
  g.mulligan();
  g.mulligan();
  assert.equal(g.zones.hand.length, 7);
  assert.equal(g.bottomCount, 2);
  assert.equal(g.keep([g.zones.hand[0]]), false, 'must choose exactly two');
  const bottom = g.zones.hand.slice(0, 2);
  assert.equal(g.keep(bottom), true);
  assert.equal(g.zones.hand.length, 5);
  assert.deepEqual(g.zones.library.slice(-2), bottom);
  assert.equal(g.phase, 'playing');
  assert.equal(g.turn, 1);
  assert.equal(g.zones.library.length + g.zones.hand.length, 60);
});

test('free first mulligan in multiplayer commander', () => {
  const g = new Goldfish(deck(), { seed: 3, freeMulligan: true });
  g.mulligan();
  assert.equal(g.bottomCount, 0);
  g.mulligan();
  assert.equal(g.bottomCount, 1);
});

test('on the draw, the first turn draws a card; next turn untaps and draws', () => {
  const g = new Goldfish(deck(), { seed: 4, onDraw: true });
  g.keep();
  assert.equal(g.zones.hand.length, 8);
  const land = g.zones.hand.find((u) => g.card(u).name === 'Forest') || g.zones.library.find((u) => g.card(u).name === 'Forest');
  g.move(land, 'battlefield');
  g.toggleTap(land);
  assert.equal(g.isTapped(land), true);
  g.nextTurn();
  assert.equal(g.turn, 2);
  assert.equal(g.isTapped(land), false);
});

test('play: spells go to the graveyard, permanents to the battlefield', () => {
  const g = new Goldfish(deck(), { seed: 5 });
  g.keep();
  const all = [...g.zones.hand, ...g.zones.library];
  const growth = all.find((u) => g.card(u).name === 'Giant Growth');
  const bear = all.find((u) => g.card(u).name === 'Grizzly Bears');
  g.move(growth, 'hand');
  g.move(bear, 'hand');
  g.play(growth);
  g.play(bear);
  assert.equal(g.zoneOf(growth), 'graveyard');
  assert.equal(g.zoneOf(bear), 'battlefield');
});

test('undo reverses moves, life changes and turns', () => {
  const g = new Goldfish(deck(), { seed: 6 });
  g.keep();
  const before = JSON.stringify(g.zones);
  const uid = g.zones.hand[0];
  g.move(uid, 'exile');
  g.adjustLife(-3);
  g.nextTurn();
  assert.equal(g.life, 17);
  g.undo();
  g.undo();
  g.undo();
  assert.equal(JSON.stringify(g.zones), before);
  assert.equal(g.life, 20);
  assert.equal(g.turn, 1);
});

test('tokens vanish when they leave the battlefield; counters and taps reset on leaving', () => {
  const g = new Goldfish(deck(), { seed: 7 });
  g.keep();
  const token = g.createToken('Soldier');
  g.addCounter(token, 2);
  assert.equal(g.counters(token), 2);
  g.move(token, 'graveyard');
  assert.equal(g.zoneOf(token), null);
  const bear = g.zones.library.find((u) => g.card(u).name === 'Grizzly Bears');
  g.move(bear, 'battlefield');
  g.toggleTap(bear);
  g.move(bear, 'hand');
  g.move(bear, 'battlefield');
  assert.equal(g.isTapped(bear), false);
});

test('commanders start in the command zone and pick up tax when cast', () => {
  const cards = [...deck(), card('Commander Bear', { is_commander: 1 })];
  const g = new Goldfish(cards, { seed: 8, life: startingLife('commander') });
  assert.equal(g.life, 40);
  const [cmd] = g.zones.command;
  assert.ok(cmd);
  assert.equal(g.zones.library.length + g.zones.hand.length, 60);
  g.keep();
  g.move(cmd, 'battlefield');
  g.move(cmd, 'command');
  assert.equal(g.commanderTax(cmd), 2);
});

test('scry/surveil: arrangeTop puts cards on top, bottom or into the graveyard', () => {
  const g = new Goldfish(deck(), { seed: 9 });
  g.keep();
  const [a, b, c] = g.peek(3);
  g.arrangeTop([{ uid: b, to: 'top' }, { uid: a, to: 'bottom' }, { uid: c, to: 'graveyard' }]);
  assert.equal(g.zones.library[0], b);
  assert.equal(g.zones.library.at(-1), a);
  assert.deepEqual(g.zones.graveyard, [c]);
});
