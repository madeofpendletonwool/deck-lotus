import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBinderSet, planBinders, binderReach } from './binders.js';

test('binder sets are paper sets a store would file singles by', () => {
  assert.ok(isBinderSet({ code: 'DOM', type: 'expansion' }));
  assert.ok(isBinderSet({ code: 'CMM', type: 'masters' }));
  assert.ok(isBinderSet({ code: 'MKC', type: 'commander' }));
  assert.ok(!isBinderSet({ code: 'MKC', type: 'commander' }, { commander: false }));
  assert.ok(!isBinderSet({ code: 'SLD', type: 'box' }), 'Secret Lair');
  assert.ok(!isBinderSet({ code: 'PLST', type: 'masters' }), 'The List');
  assert.ok(!isBinderSet({ code: 'PDOM', type: 'promo' }));
  assert.ok(!isBinderSet({ code: 'VMA', type: 'masters', is_online_only: 1 }));
});

const card = (name, sets, listed = null) => ({ name, sets, listed });
const plan = (items, extra = {}) => planBinders(items, { setsOf: (i) => i.sets, preferred: (i) => i.listed, ...extra });

test('one big binder beats a scatter of the sets you picked', () => {
  const items = [
    card('A', ['DOM', 'M19'], 'SLD'),
    card('B', ['DOM'], 'DOM'),
    card('C', ['DOM', 'M20'], 'M20'),
    card('D', ['M20']),
  ];
  const { binders, unplaced } = plan(items);
  assert.deepEqual(binders.map((b) => [b.code, b.items.map((i) => i.name)]), [['DOM', ['A', 'B']], ['M20', ['C', 'D']]]);
  assert.equal(binders[0].holds, 3);
  assert.deepEqual(unplaced, []);
});

test('cards in no binder set are left over', () => {
  const { binders, unplaced } = plan([card('A', ['DOM']), card('Promo only', [])]);
  assert.equal(binders.length, 1);
  assert.deepEqual(unplaced.map((i) => i.name), ['Promo only']);
});

test('a binder made redundant by later picks is dropped', () => {
  // Greedy opens X (4 cards) first, then needs Y and Z for cards 3 and 6; X is then redundant.
  const items = [
    card('1', ['X', 'Y']), card('2', ['X', 'Y']), card('3', ['Y']),
    card('4', ['X', 'Z']), card('5', ['X', 'Z']), card('6', ['Z']),
  ];
  const { binders } = plan(items);
  assert.deepEqual(binders.map((b) => b.code).sort(), ['Y', 'Z']);
  assert.equal(binders.reduce((n, b) => n + b.items.length, 0), 6);
});

test('ties go to the set the card is listed in, then the tie break', () => {
  assert.equal(plan([card('A', ['M19', 'DOM'], 'M19')]).binders[0].code, 'M19');
  const newest = plan([card('A', ['M19', 'DOM'])], { tieBreak: (c) => ({ M19: '2018-07', DOM: '2018-04' }[c]) });
  assert.equal(newest.binders[0].code, 'M19');
});

test('reach counts each card once per binder', () => {
  const reach = binderReach([card('A', ['DOM', 'DOM']), card('B', ['DOM', 'M19'])], (i) => i.sets);
  assert.equal(reach.get('DOM'), 2);
  assert.equal(reach.get('M19'), 1);
});
