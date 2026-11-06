// Tracks a card data sync from the messages scripts/import-mtgjson.js sends.
//
// expectedMs is how long each step took in a real sync of about 100 seconds. It weights the overall percentage, and gives
// steps that can't measure their own progress something to show.
export const SYNC_STEPS = [
  { id: 'download', label: 'Downloading card data', expectedMs: 10_000 },
  { id: 'unpack', label: 'Unpacking card data', expectedMs: 20_000 },
  { id: 'prices-download', label: 'Downloading prices', expectedMs: 2_000 },
  { id: 'backup', label: 'Backing up decks and collections', expectedMs: 6_000 },
  { id: 'cards', label: 'Importing cards and sets', expectedMs: 40_000 },
  { id: 'prices', label: 'Importing prices', expectedMs: 16_000 },
  { id: 'restore', label: 'Restoring decks and collections', expectedMs: 3_000 },
  { id: 'finish', label: 'Finishing up', expectedMs: 1_000 },
];

// Time-based progress stops short of full, so a slow step waits rather than claiming to be done.
const MAX_ESTIMATED_FRACTION = 0.95;

export function createSyncRun(now = Date.now()) {
  return {
    status: 'running',
    startedAt: now,
    finishedAt: null,
    committed: false,
    databaseLocked: false,
    error: null,
    failedStep: null,
    summary: null,
    steps: SYNC_STEPS.map(({ id, label }) => ({
      id,
      label,
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      done: null,
      total: null,
      unit: null,
      detail: null,
    })),
  };
}

const activeStep = (run) => run.steps.find((step) => step.status === 'active');

function finishActiveStep(run, now) {
  const step = activeStep(run);
  if (step) {
    step.status = 'done';
    step.finishedAt = now;
  }
}

/** Apply one message from the import script to the run. */
export function applySyncMessage(run, message, now = Date.now()) {
  switch (message.type) {
    case 'step': {
      const index = run.steps.findIndex((step) => step.id === message.id);
      if (index === -1) return;
      finishActiveStep(run, now);
      // Steps can be skipped, such as a download whose file is already on disk
      run.steps.slice(0, index).forEach((step) => {
        if (step.status === 'pending') step.status = 'skipped';
      });
      Object.assign(run.steps[index], { status: 'active', startedAt: now, detail: message.detail ?? null });
      break;
    }
    case 'progress': {
      const step = activeStep(run);
      if (!step) return;
      step.done = message.done ?? step.done;
      step.total = message.total ?? null;
      step.unit = message.unit ?? step.unit;
      if (message.detail !== undefined) step.detail = message.detail;
      break;
    }
    case 'lock':
      run.databaseLocked = message.locked;
      break;
    case 'committed':
      run.committed = true;
      break;
    case 'summary':
      run.summary = message.summary;
      break;
    case 'error':
      run.error = message.message;
      break;
  }
}

/** Record how the sync ended. A message from the script says more than an exit code can. */
export function finishSyncRun(run, { succeeded, error = null }, now = Date.now()) {
  run.databaseLocked = false;
  run.finishedAt = now;

  if (succeeded) {
    finishActiveStep(run, now);
    run.status = 'succeeded';
    return;
  }

  const step = activeStep(run);
  if (step) {
    step.status = 'failed';
    step.finishedAt = now;
    run.failedStep = step.label;
  }
  run.status = 'failed';
  run.error = run.error ?? error ?? 'The sync stopped unexpectedly';
}

const EXPECTED_MS = new Map(SYNC_STEPS.map(({ id, expectedMs }) => [id, expectedMs]));

function stepFraction(step, now) {
  if (step.status === 'done' || step.status === 'skipped') return 1;
  if (step.status !== 'active') return 0;
  if (step.total) return Math.min(step.done / step.total, 1);
  return Math.min((now - step.startedAt) / EXPECTED_MS.get(step.id), MAX_ESTIMATED_FRACTION);
}

/** Overall progress from 0 to 100. */
export function syncPercent(run, now = Date.now()) {
  if (run.status === 'succeeded') return 100;

  let expected = 0;
  let completed = 0;
  for (const step of run.steps) {
    const weight = EXPECTED_MS.get(step.id);
    expected += weight;
    completed += weight * stepFraction(step, now);
  }
  return Math.floor((completed / expected) * 100);
}
