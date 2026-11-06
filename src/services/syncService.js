import { fork } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cron from 'node-cron';
import { createSyncRun, applySyncMessage, finishSyncRun, syncPercent } from '../utils/syncProgress.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCRIPT_PATH = join(__dirname, '../../scripts/import-mtgjson.js');
const DATA_DIR = process.env.DATA_PATH || join(__dirname, '../../data');
// File-based like app-settings.json, so the last result survives a restart whatever the DB's state
const LAST_SYNC_FILE = join(DATA_DIR, 'last-sync.json');

let currentRun = null;
let completion = null;
let { lastRun = null, lastSuccessAt = null } = readLastSync();

function readLastSync() {
  try {
    return JSON.parse(fs.readFileSync(LAST_SYNC_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveLastSync() {
  try {
    fs.writeFileSync(LAST_SYNC_FILE, JSON.stringify({ lastRun, lastSuccessAt }), 'utf8');
  } catch (error) {
    console.error('Could not save sync result:', error.message);
  }
}

/** True while a sync holds the write lock, when any write would block the server and then fail. */
export function isDatabaseLocked() {
  return currentRun?.databaseLocked === true;
}

function withLiveFields(run, now) {
  return { ...run, percent: syncPercent(run, now), elapsedMs: (run.finishedAt ?? now) - run.startedAt };
}

/**
 * Start the MTGJSON import in a child process, so the server keeps answering while it runs.
 * Returns straight away with the current status.
 */
export function startSync() {
  if (currentRun) {
    throw new Error('Sync already in progress');
  }

  console.log('\n🔄 Starting MTGJSON sync...');
  const run = createSyncRun();
  currentRun = run;

  completion = new Promise((resolve) => {
    // Always use FORCE_REIMPORT=true for syncs to preserve user data while updating MTGJSON data
    const child = fork(SCRIPT_PATH, [], { env: { ...process.env, FORCE_REIMPORT: 'true' } });
    let finished = false;

    const finish = (outcome) => {
      if (finished) return;
      finished = true;

      finishSyncRun(run, outcome);
      if (outcome.succeeded) lastSuccessAt = run.finishedAt;
      lastRun = run;
      currentRun = null;
      completion = null;
      saveLastSync();

      console.log(outcome.succeeded ? '✓ Sync completed successfully' : `✗ Sync failed: ${run.error}`);
      resolve(run);
    };

    child.on('message', (message) => applySyncMessage(run, message));
    child.on('error', (error) => finish({ succeeded: false, error: error.message }));
    child.on('exit', (code, signal) => {
      finish(code === 0
        ? { succeeded: true }
        : { succeeded: false, error: `The import stopped unexpectedly (${signal ?? `exit code ${code}`})` });
    });
  });

  return getSyncStatus();
}

/** Run a sync to the end. Rejects if it fails. */
export async function runSync() {
  startSync();
  const run = await completion;
  if (run.status === 'failed') throw new Error(run.error);
  return run;
}

/**
 * Get sync status
 */
export function getSyncStatus() {
  const now = Date.now();
  const run = currentRun ?? lastRun;
  return {
    isRunning: currentRun !== null,
    databaseLocked: isDatabaseLocked(),
    lastSuccessAt,
    run: run ? withLiveFields(run, now) : null,
  };
}

/**
 * Setup weekly sync schedule (runs at 3 AM every Sunday)
 */
export function setupDailySync() {
  // Run every Sunday at 3 AM (0 = Sunday in cron)
  cron.schedule('0 3 * * 0', async () => {
    console.log('\n⏰ Running scheduled weekly sync...');
    try {
      await runSync();
    } catch (error) {
      console.error('Scheduled sync failed:', error.message);
    }
  });

  console.log('✓ Weekly sync scheduled for Sundays at 3:00 AM');
}
