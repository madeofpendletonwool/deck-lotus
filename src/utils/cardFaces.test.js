import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCardFaces, mergeCardRows } from './cardFaces.js';

const face = (side, faceName, overrides = {}) => ({
  name: 'Front // Back',
  layout: 'transform',
  side,
  faceName,
  type: `${faceName} type`,
  text: `${faceName} text`,
  manaCost: `{${faceName}}`,
  colors: 'R',
  power: null,
  ...overrides,
});

test('a prepared creature is stored as the creature, whichever face comes last', () => {
  const creature = face('a', 'Lorehold Archivist', { layout: 'prepare', type: 'Creature — Dwarf Artificer', power: '2' });
  const spell = face('b', 'Restore Relic', { layout: 'prepare', type: 'Sorcery' });

  for (const rows of [[creature, spell], [spell, creature]]) {
    const merged = mergeCardFaces(rows);
    assert.equal(merged.type, 'Creature — Dwarf Artificer');
    assert.equal(merged.power, '2');
    assert.equal(merged.manaCost, '{Lorehold Archivist}');
  }
});

test('the back face text stays readable under its own name', () => {
  const merged = mergeCardFaces([face('b', 'Stomp'), face('a', 'Giant')]);
  assert.equal(merged.text, 'Giant text\n\n// Stomp\nStomp text');
});

test('faces with no rules text add nothing', () => {
  const merged = mergeCardFaces([face('a', 'Vanilla', { text: null }), face('b', 'Back')]);
  assert.equal(merged.text, '// Back\nBack text');
});

test('reversible cards do not repeat identical text', () => {
  const merged = mergeCardFaces([face('a', 'Same', { text: 'Flying' }), face('b', 'Same', { text: 'Flying' })]);
  assert.equal(merged.text, 'Flying');
});

test('split cards have the colors of every half, in WUBRG order', () => {
  const fire = face('a', 'Fire', { layout: 'split', colors: 'R' });
  const ice = face('b', 'Ice', { layout: 'split', colors: 'U' });
  assert.equal(mergeCardFaces([fire, ice]).colors, 'U, R');
});

test('double-faced and adventure cards keep the front color', () => {
  for (const layout of ['transform', 'adventure', 'prepare']) {
    const merged = mergeCardFaces([face('a', 'A', { layout, colors: 'G' }), face('b', 'B', { layout, colors: 'R' })]);
    assert.equal(merged.colors, 'G');
  }
});

test('colorless split faces stay colorless', () => {
  const merged = mergeCardFaces([face('a', 'A', { layout: 'split', colors: null }), face('b', 'B', { layout: 'split', colors: null })]);
  assert.equal(merged.colors, null);
});

test('later printings of a face win, as they do for single-faced cards', () => {
  const merged = mergeCardFaces([face('a', 'Old', { type: 'Old type' }), face('a', 'New', { type: 'New type' })]);
  assert.equal(merged.type, 'New type');
  assert.equal(merged.text, 'New text');
});

test('single-faced cards pass through untouched', () => {
  const opt = { name: 'Opt', side: null, type: 'Instant', text: 'Scry 1.', colors: 'U' };
  assert.equal(mergeCardFaces([opt]), opt);
});

test('a meld result with only a back-side row is still kept', () => {
  const brisela = { name: 'Brisela, Voice of Nightmares', side: 'b', type: 'Legendary Creature', text: 'Flying' };
  assert.equal(mergeCardFaces([brisela]), brisela);
});

test('mergeCardRows gives one row per card name', () => {
  const rows = [
    face('b', 'Back'),
    { name: 'Opt', side: null, type: 'Instant' },
    face('a', 'Front'),
    { name: 'Opt', side: null, type: 'Instant' },
  ];
  const merged = mergeCardRows(rows);
  assert.deepEqual(merged.map((c) => c.name), ['Front // Back', 'Opt']);
  assert.equal(merged[0].type, 'Front type');
});
