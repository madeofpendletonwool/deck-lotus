import { getDb } from '../db/index.js';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Backup configuration
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, '../../data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Scheduled backup state
let scheduledBackupJob = null;
let backupConfig = {
  enabled: false,
  frequency: 'daily', // daily, 6hours, 12hours, weekly
  retainCount: 10, // Keep last N backups
  lastRun: null
};

/**
 * Create a backup of all user data (users, decks, deck_cards, api_keys)
 * Returns a JSON object with all user data
 */
export function createBackup(userId = null) {
  const db = getDb();

  const backup = {
    // 1.1 adds owned_printings (per-printing quantities with finish) and price_watches
    version: '1.1',
    timestamp: new Date().toISOString(),
    data: {}
  };

  // If userId is provided, only backup that user's data
  // Otherwise, backup all users
  const userFilter = userId ? `WHERE id = ${userId}` : '';
  const userIdFilter = userId ? `WHERE user_id = ${userId}` : '';

  // Backup users
  backup.data.users = db.prepare(`
    SELECT id, username, email, password_hash, is_admin, created_at, updated_at
    FROM users
    ${userFilter}
  `).all();

  // Get list of user IDs to backup
  const userIds = backup.data.users.map(u => u.id);

  if (userIds.length === 0) {
    return backup; // No users to backup
  }

  const userIdsStr = userIds.join(',');

  // Backup API keys
  backup.data.api_keys = db.prepare(`
    SELECT id, user_id, key_hash, name, last_used, created_at
    FROM api_keys
    WHERE user_id IN (${userIdsStr})
  `).all();

  // Backup owned cards (with card names for stability across imports)
  backup.data.owned_cards = db.prepare(`
    SELECT oc.id, oc.user_id, oc.quantity, oc.created_at, oc.updated_at,
           c.name as card_name
    FROM owned_cards oc
    JOIN cards c ON oc.card_id = c.id
    WHERE oc.user_id IN (${userIdsStr})
  `).all();

  // Backup owned printings: the per-printing, per-finish collection the app and
  // scanner write to. Printing UUIDs stay stable across MTGJSON re-imports.
  backup.data.owned_printings = db.prepare(`
    SELECT op.user_id, op.quantity, op.finish, op.created_at, op.updated_at,
           p.uuid as printing_uuid
    FROM owned_printings op
    JOIN printings p ON op.printing_id = p.id
    WHERE op.user_id IN (${userIdsStr})
  `).all();

  // Backup price watches (card name is the stable key; card_id is re-resolved on restore)
  backup.data.price_watches = db.prepare(`
    SELECT id, user_id, card_name, max_price, condition, notes, is_active, expires_at,
           last_checked, last_price, last_notified, created_at,
           scryfall_id, image_url, set_code, set_name
    FROM price_watches
    WHERE user_id IN (${userIdsStr})
  `).all();

  // Backup decks
  backup.data.decks = db.prepare(`
    SELECT id, user_id, name, format, description, settings, created_at, updated_at
    FROM decks
    WHERE user_id IN (${userIdsStr})
  `).all();

  // Get deck IDs
  const deckIds = backup.data.decks.map(d => d.id);

  if (deckIds.length > 0) {
    const deckIdsStr = deckIds.join(',');

    // Backup deck_cards with UUIDs (stable across imports)
    backup.data.deck_cards = db.prepare(`
      SELECT dc.id, dc.deck_id, dc.quantity, dc.is_sideboard, dc.is_commander,
             dc.board_type, dc.added_at, dc.tags, dc.color_category, dc.notes, p.uuid as printing_uuid
      FROM deck_cards dc
      JOIN printings p ON dc.printing_id = p.id
      WHERE dc.deck_id IN (${deckIdsStr})
    `).all();

    // Backup deck shares
    backup.data.deck_shares = db.prepare(`
      SELECT id, deck_id, user_id, share_token, is_active, created_at, expires_at
      FROM deck_shares
      WHERE deck_id IN (${deckIdsStr})
    `).all();
  } else {
    backup.data.deck_cards = [];
    backup.data.deck_shares = [];
  }

  return backup;
}

/**
 * Restore user data from a backup JSON object
 * Options:
 * - overwrite: if true, delete existing data before restore (default: false)
 * - userId: if provided, only restore data for this user (requires matching user in backup)
 */
export function restoreBackup(backupData, options = {}) {
  const db = getDb();
  const { overwrite = false, userId = null } = options;

  const results = {
    users: 0,
    api_keys: 0,
    owned_cards: 0,
    owned_printings: 0,
    price_watches: 0,
    decks: 0,
    deck_cards: 0,
    deck_shares: 0,
    errors: []
  };

  // Validate backup format
  if (!backupData.version || !backupData.data) {
    throw new Error('Invalid backup format');
  }

  // If userId is specified, filter backup to only that user
  let usersToRestore = backupData.data.users || [];
  if (userId) {
    usersToRestore = usersToRestore.filter(u => u.id === userId);
    if (usersToRestore.length === 0) {
      throw new Error(`User ${userId} not found in backup`);
    }
  }

  // Start transaction
  const restore = db.transaction(() => {
    // If overwrite is enabled, delete existing data
    if (overwrite && userId) {
      // api_keys are left alone: scoped restores don't bring keys back
      db.prepare('DELETE FROM owned_cards WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM owned_printings WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM price_watches WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM deck_cards WHERE deck_id IN (SELECT id FROM decks WHERE user_id = ?)').run(userId);
      db.prepare('DELETE FROM deck_shares WHERE deck_id IN (SELECT id FROM decks WHERE user_id = ?)').run(userId);
      db.prepare('DELETE FROM decks WHERE user_id = ?').run(userId);
      // The user row itself is never touched by a scoped restore
    } else if (overwrite && !userId) {
      db.prepare('DELETE FROM deck_cards').run();
      db.prepare('DELETE FROM deck_shares').run();
      db.prepare('DELETE FROM decks').run();
      db.prepare('DELETE FROM api_keys').run();
      db.prepare('DELETE FROM owned_cards').run();
      db.prepare('DELETE FROM owned_printings').run();
      db.prepare('DELETE FROM users').run();
    }

    // Restore users. This must update in place, not INSERT OR REPLACE: REPLACE deletes
    // the old row first, and with foreign keys on that cascades away every deck, owned
    // card, price watch and API key the user has that isn't in the backup. It would also
    // delete a different user whose username or email collides.
    const insertUser = db.prepare(`
      INSERT INTO users (id, username, email, password_hash, is_admin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        email = excluded.email,
        password_hash = excluded.password_hash,
        is_admin = excluded.is_admin,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `);

    // A scoped (non-admin) restore never writes the users table: the caller
    // already exists, and taking is_admin/password_hash from an uploaded file
    // would let anyone promote themselves or change their credentials.
    for (const user of userId ? [] : usersToRestore) {
      try {
        insertUser.run(
          user.id,
          user.username,
          user.email,
          user.password_hash,
          user.is_admin || 0,
          user.created_at,
          user.updated_at
        );
        results.users++;
      } catch (e) {
        results.errors.push(`User ${user.username}: ${e.message}`);
      }
    }

    const restoredUserIds = usersToRestore.map(u => u.id);

    // Restore API keys (admin restores only: an uploaded key_hash must not become a credential)
    const apiKeys = userId ? [] : (backupData.data.api_keys || []).filter(k =>
      restoredUserIds.includes(k.user_id)
    );

    const insertApiKey = db.prepare(`
      INSERT OR REPLACE INTO api_keys (id, user_id, key_hash, name, last_used, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const key of apiKeys) {
      try {
        insertApiKey.run(
          key.id,
          key.user_id,
          key.key_hash,
          key.name,
          key.last_used,
          key.created_at
        );
        results.api_keys++;
      } catch (e) {
        results.errors.push(`API key ${key.name}: ${e.message}`);
      }
    }

    // Restore owned cards (using card names to find current card_ids)
    const ownedCards = (backupData.data.owned_cards || []).filter(oc =>
      restoredUserIds.includes(oc.user_id)
    );

    const getCardId = db.prepare(`
      SELECT id FROM cards WHERE name = ? LIMIT 1
    `);

    const insertOwnedCard = db.prepare(`
      INSERT OR REPLACE INTO owned_cards (user_id, card_id, quantity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const ownedCard of ownedCards) {
      try {
        const card = getCardId.get(ownedCard.card_name);
        if (card) {
          insertOwnedCard.run(
            userId || ownedCard.user_id,
            card.id,
            ownedCard.quantity,
            ownedCard.created_at,
            ownedCard.updated_at
          );
          results.owned_cards++;
        } else {
          results.errors.push(`Card "${ownedCard.card_name}" not found in database`);
        }
      } catch (e) {
        results.errors.push(`Owned card ${ownedCard.card_name}: ${e.message}`);
      }
    }

    // Restore owned printings (using UUIDs to find current printing_ids).
    // Backups from before 1.1 don't have them; their owned_cards still restore above.
    const ownedPrintings = (backupData.data.owned_printings || []).filter(op =>
      restoredUserIds.includes(op.user_id)
    );

    const getOwnedPrinting = db.prepare(`
      SELECT id, card_id FROM printings WHERE uuid = ? LIMIT 1
    `);

    // A restored row sets the quantity rather than adding to it, matching how the
    // other tables are restored with INSERT OR REPLACE
    const upsertOwnedPrinting = db.prepare(`
      INSERT INTO owned_printings (user_id, printing_id, quantity, finish, created_at, updated_at)
      VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
      ON CONFLICT(user_id, printing_id, finish) DO UPDATE SET
        quantity = excluded.quantity,
        updated_at = excluded.updated_at
    `);

    // owned_cards is the card-level "do I own this" flag other queries still read
    const markCardOwned = db.prepare(`
      INSERT OR IGNORE INTO owned_cards (user_id, card_id, quantity) VALUES (?, ?, 1)
    `);

    const FINISHES = new Set(['nonfoil', 'foil', 'etched']);

    for (const owned of ownedPrintings) {
      try {
        const printing = getOwnedPrinting.get(owned.printing_uuid);
        const quantity = Number(owned.quantity);
        if (!printing) {
          results.errors.push(`Owned printing UUID ${owned.printing_uuid} not found in database`);
          continue;
        }
        if (!Number.isInteger(quantity) || quantity < 1) {
          results.errors.push(`Owned printing ${owned.printing_uuid}: invalid quantity ${owned.quantity}`);
          continue;
        }
        const targetUserId = userId || owned.user_id;
        upsertOwnedPrinting.run(
          targetUserId,
          printing.id,
          quantity,
          FINISHES.has(owned.finish) ? owned.finish : 'nonfoil',
          owned.created_at ?? null,
          owned.updated_at ?? null
        );
        markCardOwned.run(targetUserId, printing.card_id);
        results.owned_printings++;
      } catch (e) {
        results.errors.push(`Owned printing ${owned.printing_uuid}: ${e.message}`);
      }
    }

    // Restore price watches. Scoped restores get fresh ids, like decks.
    const priceWatches = (backupData.data.price_watches || []).filter(w =>
      restoredUserIds.includes(w.user_id)
    );

    const getCardIdByName = db.prepare(`SELECT id FROM cards WHERE name = ? LIMIT 1`);
    const watchColumns = `user_id, card_name, max_price, condition, notes, is_active, expires_at,
      last_checked, last_price, last_notified, created_at, card_id, scryfall_id, image_url, set_code, set_name`;
    const insertWatch = db.prepare(`
      INSERT INTO price_watches (id, ${watchColumns})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id, card_name = excluded.card_name, max_price = excluded.max_price,
        condition = excluded.condition, notes = excluded.notes, is_active = excluded.is_active,
        expires_at = excluded.expires_at, last_checked = excluded.last_checked,
        last_price = excluded.last_price, last_notified = excluded.last_notified,
        created_at = excluded.created_at, card_id = excluded.card_id, scryfall_id = excluded.scryfall_id,
        image_url = excluded.image_url, set_code = excluded.set_code, set_name = excluded.set_name
    `);
    const insertScopedWatch = db.prepare(`
      INSERT INTO price_watches (${watchColumns})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?)
    `);

    for (const watch of priceWatches) {
      try {
        const values = [
          userId || watch.user_id,
          watch.card_name,
          watch.max_price ?? null,
          watch.condition || 'nm',
          watch.notes ?? null,
          watch.is_active ?? 1,
          watch.expires_at ?? null,
          watch.last_checked ?? null,
          watch.last_price ?? null,
          watch.last_notified ?? null,
          watch.created_at ?? null,
          getCardIdByName.get(watch.card_name)?.id ?? null,
          watch.scryfall_id ?? null,
          watch.image_url ?? null,
          watch.set_code ?? null,
          watch.set_name ?? null
        ];
        if (userId) insertScopedWatch.run(...values);
        else insertWatch.run(watch.id, ...values);
        results.price_watches++;
      } catch (e) {
        results.errors.push(`Price watch ${watch.card_name}: ${e.message}`);
      }
    }

    // Restore decks
    const decks = (backupData.data.decks || []).filter(d =>
      restoredUserIds.includes(d.user_id)
    );

    // Update in place for the same reason as users: REPLACE would cascade away the
    // deck's change history and any cards added since the backup
    const insertDeck = db.prepare(`
      INSERT INTO decks (id, user_id, name, format, description, settings, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        name = excluded.name,
        format = excluded.format,
        description = excluded.description,
        settings = excluded.settings,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `);

    // Scoped restores get fresh deck ids so a crafted file can't REPLACE another user's deck
    const insertScopedDeck = db.prepare(`
      INSERT INTO decks (user_id, name, format, description, settings, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Backup deck id -> deck id in this database
    const deckIdMap = new Map();

    for (const deck of decks) {
      try {
        if (userId) {
          const info = insertScopedDeck.run(
            userId,
            deck.name,
            deck.format,
            deck.description,
            deck.settings ?? null,
            deck.created_at,
            deck.updated_at
          );
          deckIdMap.set(deck.id, Number(info.lastInsertRowid));
        } else {
          insertDeck.run(
            deck.id,
            deck.user_id,
            deck.name,
            deck.format,
            deck.description,
            deck.settings ?? null,
            deck.created_at,
            deck.updated_at
          );
          deckIdMap.set(deck.id, deck.id);
        }
        results.decks++;
      } catch (e) {
        results.errors.push(`Deck ${deck.name}: ${e.message}`);
      }
    }

    const restoredDeckIds = [...deckIdMap.keys()];

    // Restore deck_cards (using UUIDs to find current printing_ids)
    const deckCards = (backupData.data.deck_cards || []).filter(dc =>
      restoredDeckIds.includes(dc.deck_id)
    );

    const getPrintingId = db.prepare(`
      SELECT id FROM printings WHERE uuid = ? LIMIT 1
    `);

    const insertDeckCard = db.prepare(`
      INSERT OR REPLACE INTO deck_cards (deck_id, printing_id, quantity, is_sideboard, is_commander, board_type, added_at, tags, color_category, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const deckCard of deckCards) {
      try {
        const printing = getPrintingId.get(deckCard.printing_uuid);
        if (printing) {
          insertDeckCard.run(
            deckIdMap.get(deckCard.deck_id),
            printing.id,
            deckCard.quantity,
            deckCard.is_sideboard,
            deckCard.is_commander,
            deckCard.board_type || 'mainboard',
            deckCard.added_at,
            deckCard.tags ?? null,
            deckCard.color_category ?? null,
            deckCard.notes ?? null
          );
          results.deck_cards++;
        } else {
          results.errors.push(`Printing UUID ${deckCard.printing_uuid} not found in database`);
        }
      } catch (e) {
        results.errors.push(`Deck card: ${e.message}`);
      }
    }

    // Restore deck shares (admin restores only: an uploaded share_token could clobber someone else's link)
    const deckShares = userId ? [] : (backupData.data.deck_shares || []).filter(ds =>
      restoredDeckIds.includes(ds.deck_id)
    );

    const insertDeckShare = db.prepare(`
      INSERT OR REPLACE INTO deck_shares (id, deck_id, user_id, share_token, is_active, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const share of deckShares) {
      try {
        insertDeckShare.run(
          share.id,
          share.deck_id,
          share.user_id,
          share.share_token,
          share.is_active,
          share.created_at,
          share.expires_at
        );
        results.deck_shares++;
      } catch (e) {
        results.errors.push(`Deck share: ${e.message}`);
      }
    }
  });

  restore();
  return results;
}

/**
 * Export backup to a file
 */
export function exportBackupToFile(backupData, filePath) {
  fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf8');
}

/**
 * Import backup from a file
 */
export function importBackupFromFile(filePath) {
  const data = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(data);
}

/**
 * Create and save a backup to the backups directory
 */
export function createScheduledBackup() {
  const backup = createBackup(); // Backup all users
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const filename = `scheduled-backup-${timestamp}-${Date.now()}.json`;
  const filepath = path.join(BACKUP_DIR, filename);

  exportBackupToFile(backup, filepath);
  backupConfig.lastRun = new Date().toISOString();

  console.log(`✓ Scheduled backup created: ${filename}`);

  // Clean up old backups based on retention policy
  cleanupOldBackups();

  return { filename, filepath, timestamp: backup.timestamp };
}

/**
 * Clean up old backups, keeping only the most recent N backups
 */
export function cleanupOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('scheduled-backup-') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime()
      }))
      .sort((a, b) => b.mtime - a.mtime); // Sort by modified time, newest first

    const toDelete = files.slice(backupConfig.retainCount);

    toDelete.forEach(file => {
      fs.unlinkSync(file.path);
      console.log(`  🗑️  Deleted old backup: ${file.name}`);
    });

    if (toDelete.length > 0) {
      console.log(`✓ Cleaned up ${toDelete.length} old backup(s), kept ${Math.min(files.length, backupConfig.retainCount)}`);
    }
  } catch (error) {
    console.error('Error cleaning up old backups:', error.message);
  }
}

/**
 * Get list of available backup files
 */
export function listBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filepath = path.join(BACKUP_DIR, f);
        const stats = fs.statSync(filepath);
        return {
          filename: f,
          size: stats.size,
          created: stats.mtime.toISOString(),
          type: f.startsWith('scheduled-backup-') ? 'scheduled' :
                f.startsWith('pre-sync-safety') ? 'pre-sync' : 'manual'
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created)); // Newest first

    return files;
  } catch (error) {
    console.error('Error listing backups:', error.message);
    return [];
  }
}

/**
 * Resolve a backup filename to a path inside BACKUP_DIR.
 * Only plain `*.json` names are accepted, so `../` and absolute paths can't escape.
 */
function resolveBackupPath(filename) {
  if (typeof filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(filename)) {
    throw new Error('Invalid backup filename');
  }
  const filepath = path.resolve(BACKUP_DIR, filename);
  if (path.dirname(filepath) !== path.resolve(BACKUP_DIR)) {
    throw new Error('Invalid backup filename');
  }
  return filepath;
}

/**
 * Load a backup file by filename
 */
export function loadBackupFile(filename) {
  const filepath = resolveBackupPath(filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Backup file not found: ${filename}`);
  }
  return importBackupFromFile(filepath);
}

/**
 * Delete a backup file
 */
export function deleteBackupFile(filename) {
  const filepath = resolveBackupPath(filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Backup file not found: ${filename}`);
  }
  fs.unlinkSync(filepath);
  console.log(`✓ Deleted backup: ${filename}`);
  return { success: true };
}

/**
 * Configure scheduled backups
 */
export function configureScheduledBackups(config) {
  const { enabled, frequency, retainCount } = config;

  if (enabled !== undefined) backupConfig.enabled = enabled;
  if (frequency !== undefined) backupConfig.frequency = frequency;
  if (retainCount !== undefined) backupConfig.retainCount = retainCount;

  // Stop existing job if any
  if (scheduledBackupJob) {
    scheduledBackupJob.stop();
    scheduledBackupJob = null;
  }

  // Start new job if enabled
  if (backupConfig.enabled) {
    let cronExpression;

    switch (backupConfig.frequency) {
      case '6hours':
        cronExpression = '0 */6 * * *'; // Every 6 hours
        break;
      case '12hours':
        cronExpression = '0 */12 * * *'; // Every 12 hours
        break;
      case 'daily':
        cronExpression = '0 2 * * *'; // Every day at 2 AM
        break;
      case 'weekly':
        cronExpression = '0 2 * * 0'; // Every Sunday at 2 AM
        break;
      default:
        cronExpression = '0 2 * * *'; // Default to daily
    }

    scheduledBackupJob = cron.schedule(cronExpression, () => {
      console.log(`\n⏰ Running scheduled backup (${backupConfig.frequency})...`);
      try {
        createScheduledBackup();
      } catch (error) {
        console.error('Scheduled backup failed:', error.message);
      }
    });

    console.log(`✓ Scheduled backups enabled: ${backupConfig.frequency} (keeping last ${backupConfig.retainCount})`);
  } else {
    console.log('✓ Scheduled backups disabled');
  }

  return backupConfig;
}

/**
 * Get current backup configuration
 */
export function getBackupConfig() {
  return { ...backupConfig };
}
