import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, stepDetail, formatTimeLeft, formatTimeAgo, lostCopies } from './syncFormat.js';

const MB = 1024 * 1024;

test('durations read in seconds, then minutes and seconds', () => {
  assert.equal(formatDuration(45_000), '45s');
  assert.equal(formatDuration(192_000), '3m 12s');
  assert.equal(formatDuration(65_000), '1m 05s');
  assert.equal(formatDuration(-5), '0s');
});

test('step detail prefers words, then shows measured progress', () => {
  assert.equal(stepDetail({ detail: 'Importing rulings', done: 2, total: 7, unit: 'stages' }), 'Importing rulings');
  assert.equal(stepDetail({ detail: null, done: 142 * MB, total: 512 * MB, unit: 'bytes' }), '142 of 512 MB');
  assert.equal(stepDetail({ detail: null, done: 300 * MB, total: null, unit: 'bytes' }), '300 MB');
  assert.equal(stepDetail({ detail: null, done: 5000, total: 100000, unit: 'printings' }), '5,000 of 100,000 printings');
  assert.equal(stepDetail({ detail: null, done: null, total: null, unit: null }), '');
});

test('time left stays quiet until there is something to go on', () => {
  assert.equal(formatTimeLeft(5_000, 5), '');
  assert.equal(formatTimeLeft(60_000, 25), 'About 3 min left');
  assert.equal(formatTimeLeft(180_000, 95), 'Under a minute left');
  assert.equal(formatTimeLeft(180_000, 100), '');
});

test('time ago picks the right unit and plural', () => {
  const now = 10 * 24 * 60 * 60_000;
  assert.equal(formatTimeAgo(now - 5_000, now), 'just now');
  assert.equal(formatTimeAgo(now - 60_000, now), '1 minute ago');
  assert.equal(formatTimeAgo(now - 5 * 60 * 60_000, now), '5 hours ago');
  assert.equal(formatTimeAgo(now - 3 * 24 * 60 * 60_000, now), '3 days ago');
});

test('lost copies adds up decks and collections, and tolerates no summary', () => {
  assert.equal(lostCopies({ deckCardsLost: 2, ownedCardsLost: 1, ownedPrintingsLost: 3 }), 6);
  assert.equal(lostCopies({}), 0);
  assert.equal(lostCopies(null), 0);
});
