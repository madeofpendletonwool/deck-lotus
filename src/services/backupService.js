import { getDb } from '../db/index.js';
import fs from 'fs';
import path from 'path';

/**
 * Create a backup of all user data (users, decks, deck_cards, api_keys)
 * Returns a JSON object with all user data
 */
export function createBackup(userId = null) {
  const db = getDb();

  const backup = {
    version: '1.0',
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

  // Backup decks
  backup.data.decks = db.prepare(`
    SELECT id, user_id, name, format, description, created_at, updated_at
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
             dc.added_at, p.uuid as printing_uuid
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
      db.prepare('DELETE FROM api_keys WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM deck_cards WHERE deck_id IN (SELECT id FROM decks WHERE user_id = ?)').run(userId);
      db.prepare('DELETE FROM deck_shares WHERE deck_id IN (SELECT id FROM decks WHERE user_id = ?)').run(userId);
      db.prepare('DELETE FROM decks WHERE user_id = ?').run(userId);
      // Don't delete the user itself, just update it
    } else if (overwrite && !userId) {
      db.prepare('DELETE FROM deck_cards').run();
      db.prepare('DELETE FROM deck_shares').run();
      db.prepare('DELETE FROM decks').run();
      db.prepare('DELETE FROM api_keys').run();
      db.prepare('DELETE FROM users').run();
    }

    // Restore users
    const insertUser = db.prepare(`
      INSERT OR REPLACE INTO users (id, username, email, password_hash, is_admin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const user of usersToRestore) {
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

    // Restore API keys
    const apiKeys = (backupData.data.api_keys || []).filter(k =>
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

    // Restore decks
    const decks = (backupData.data.decks || []).filter(d =>
      restoredUserIds.includes(d.user_id)
    );

    const insertDeck = db.prepare(`
      INSERT OR REPLACE INTO decks (id, user_id, name, format, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const deck of decks) {
      try {
        insertDeck.run(
          deck.id,
          deck.user_id,
          deck.name,
          deck.format,
          deck.description,
          deck.created_at,
          deck.updated_at
        );
        results.decks++;
      } catch (e) {
        results.errors.push(`Deck ${deck.name}: ${e.message}`);
      }
    }

    const restoredDeckIds = decks.map(d => d.id);

    // Restore deck_cards (using UUIDs to find current printing_ids)
    const deckCards = (backupData.data.deck_cards || []).filter(dc =>
      restoredDeckIds.includes(dc.deck_id)
    );

    const getPrintingId = db.prepare(`
      SELECT id FROM printings WHERE uuid = ? LIMIT 1
    `);

    const insertDeckCard = db.prepare(`
      INSERT OR REPLACE INTO deck_cards (deck_id, printing_id, quantity, is_sideboard, is_commander, added_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const deckCard of deckCards) {
      try {
        const printing = getPrintingId.get(deckCard.printing_uuid);
        if (printing) {
          insertDeckCard.run(
            deckCard.deck_id,
            printing.id,
            deckCard.quantity,
            deckCard.is_sideboard,
            deckCard.is_commander,
            deckCard.added_at
          );
          results.deck_cards++;
        } else {
          results.errors.push(`Printing UUID ${deckCard.printing_uuid} not found in database`);
        }
      } catch (e) {
        results.errors.push(`Deck card: ${e.message}`);
      }
    }

    // Restore deck shares
    const deckShares = (backupData.data.deck_shares || []).filter(ds =>
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
