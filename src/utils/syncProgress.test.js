import test from 'node:test';
import assert from 'node:assert/strict';
import { SYNC_STEPS, createSyncRun, applySyncMessage, finishSyncRun, syncPercent } from './syncProgress.js';

const stepStatus = (run, id) => run.steps.find((step) => step.id === id).status;
const allStepsMessages = SYNC_STEPS.map(({ id }) => ({ type: 'step', id }));

test('starting a step finishes the one before it', () => {
  const run = createSyncRun(0);
  applySyncMessage(run, { type: 'step', id: 'download' }, 10);
  applySyncMessage(run, { type: 'step', id: 'unpack' }, 20);
  assert.equal(stepStatus(run, 'download'), 'done');
  assert.equal(run.steps[0].finishedAt, 20);
  assert.equal(stepStatus(run, 'unpack'), 'active');
  assert.equal(stepStatus(run, 'prices'), 'pending');
});

test('steps the script jumps past are marked skipped', () => {
  const run = createSyncRun(0);
  applySyncMessage(run, { type: 'step', id: 'prices-download' }, 10);
  assert.equal(stepStatus(run, 'download'), 'skipped');
  assert.equal(stepStatus(run, 'unpack'), 'skipped');
});

test('progress goes to the active step and is ignored with none', () => {
  const run = createSyncRun(0);
  applySyncMessage(run, { type: 'progress', done: 5, total: 10, unit: 'bytes' }, 1);
  assert.ok(run.steps.every((step) => step.done === null));
  applySyncMessage(run, { type: 'step', id: 'download' }, 1);
  applySyncMessage(run, { type: 'progress', done: 5, total: 10, unit: 'bytes' }, 2);
  assert.deepEqual([run.steps[0].done, run.steps[0].total, run.steps[0].unit], [5, 10, 'bytes']);
});

test('percent climbs as steps complete and reaches 100 only on success', () => {
  const run = createSyncRun(0);
  assert.equal(syncPercent(run, 0), 0);
  let previous = 0;
  for (const message of allStepsMessages) {
    applySyncMessage(run, message, 0);
    const percent = syncPercent(run, 0);
    assert.ok(percent >= previous);
    assert.ok(percent < 100);
    previous = percent;
  }
  finishSyncRun(run, { succeeded: true }, 5);
  assert.equal(syncPercent(run, 5), 100);
  assert.equal(stepStatus(run, 'finish'), 'done');
});

test('a step with no measurable progress never claims to be complete', () => {
  const run = createSyncRun(0);
  applySyncMessage(run, { type: 'step', id: 'cards' }, 0);
  const longOverdue = syncPercent(run, 1_000_000);
  applySyncMessage(run, { type: 'step', id: 'prices' }, 1_000_000);
  assert.ok(longOverdue < syncPercent(run, 1_000_000));
});

test('a failure names the step and keeps the message from the script', () => {
  const run = createSyncRun(0);
  applySyncMessage(run, { type: 'step', id: 'prices-download' }, 1);
  applySyncMessage(run, { type: 'lock', locked: true }, 1);
  applySyncMessage(run, { type: 'error', message: 'Failed to download: 503' }, 2);
  finishSyncRun(run, { succeeded: false, error: 'exit code 1' }, 3);
  assert.equal(run.status, 'failed');
  assert.equal(run.error, 'Failed to download: 503');
  assert.equal(run.failedStep, 'Downloading prices');
  assert.equal(stepStatus(run, 'prices-download'), 'failed');
  assert.equal(run.databaseLocked, false, 'a dead sync must not keep writes blocked');
});

test('a sync that dies without a message still reports a reason', () => {
  const run = createSyncRun(0);
  finishSyncRun(run, { succeeded: false, error: 'exit code 137' }, 1);
  assert.equal(run.error, 'exit code 137');
});
