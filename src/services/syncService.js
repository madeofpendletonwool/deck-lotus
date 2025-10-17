import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cron from 'node-cron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let isRunning = false;
let lastRun = null;

/**
 * Run the MTGJSON import/update
 */
export async function runSync() {
  if (isRunning) {
    throw new Error('Sync already in progress');
  }

  try {
    isRunning = true;
    console.log('\n🔄 Starting MTGJSON sync...');

    const scriptPath = join(__dirname, '../../scripts/import-mtgjson.js');
    execSync(`node "${scriptPath}"`, { stdio: 'inherit' });

    lastRun = new Date();
    console.log('✓ Sync completed successfully');

    return { success: true, lastRun };
  } catch (error) {
    console.error('✗ Sync failed:', error.message);
    throw error;
  } finally {
    isRunning = false;
  }
}

/**
 * Get sync status
 */
export function getSyncStatus() {
  return {
    isRunning,
    lastRun
  };
}

/**
 * Setup daily sync schedule (runs at 3 AM daily)
 */
export function setupDailySync() {
  // Run every day at 3 AM
  cron.schedule('0 3 * * *', async () => {
    console.log('\n⏰ Running scheduled daily sync...');
    try {
      await runSync();
    } catch (error) {
      console.error('Scheduled sync failed:', error.message);
    }
  });

  console.log('✓ Daily sync scheduled for 3:00 AM');
}
