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

    // Always use FORCE_REIMPORT=true for syncs to preserve user data while updating MTGJSON data
    execSync(`node "${scriptPath}"`, {
      stdio: 'inherit',
      env: { ...process.env, FORCE_REIMPORT: 'true' }
    });

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
