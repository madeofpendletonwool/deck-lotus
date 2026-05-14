import cron from 'node-cron';
import { getDb } from '../db/connection.js';
import { getLowestPrice as manaPoolPrice, isConfigured as manaPoolConfigured } from './manaPoolService.js';
import { getLowestPrice as tcgPlayerPrice, isConfigured as tcgConfigured } from './tcgplayerService.js';
import { sendPriceAlert, isConfigured as ntfyConfigured } from './notificationService.js';

async function getLowestPrice(cardName, condition) {
  if (manaPoolConfigured()) return manaPoolPrice(cardName, condition);
  if (tcgConfigured()) return tcgPlayerPrice(cardName, condition);
  throw new Error('No price source configured — set MANAPOOL_API_TOKEN or TCGPlayer credentials');
}

// ── Watch CRUD ────────────────────────────────────────────────────────────────

export function getWatches(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT w.*,
           (SELECT found_price FROM price_check_log WHERE watch_id = w.id ORDER BY checked_at DESC LIMIT 1) AS latest_price
    FROM price_watches w
    WHERE w.user_id = ?
    ORDER BY w.created_at DESC
  `).all(userId);
}

export function createWatch(userId, { cardName, maxPrice, condition = 'nm', notes, expiresAt, cardId, scryfallId, imageUrl, setCode, setName }) {
  if (!cardName?.trim()) throw new Error('card_name is required');

  const parsedMax = maxPrice != null && maxPrice !== '' ? parseFloat(maxPrice) : null;
  if (parsedMax !== null && (isNaN(parsedMax) || parsedMax <= 0)) {
    throw new Error('max_price must be a positive number');
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO price_watches (user_id, card_name, max_price, condition, notes, expires_at, card_id, scryfall_id, image_url, set_code, set_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, cardName.trim(), parsedMax, condition, notes || null, expiresAt || null,
    cardId || null, scryfallId || null, imageUrl || null, setCode || null, setName || null);

  return db.prepare('SELECT * FROM price_watches WHERE id = ?').get(result.lastInsertRowid);
}

export function updateWatch(userId, watchId, updates) {
  const db = getDb();
  const watch = db.prepare('SELECT * FROM price_watches WHERE id = ? AND user_id = ?').get(watchId, userId);
  if (!watch) throw new Error('Watch not found');

  const fields = [];
  const values = [];

  if (updates.maxPrice !== undefined) {
    const v = updates.maxPrice != null && updates.maxPrice !== '' ? parseFloat(updates.maxPrice) : null;
    fields.push('max_price = ?');
    values.push(v);
  }
  if (updates.condition !== undefined) {
    fields.push('condition = ?');
    values.push(updates.condition);
  }
  if (updates.notes !== undefined) {
    fields.push('notes = ?');
    values.push(updates.notes);
  }
  if (updates.expiresAt !== undefined) {
    fields.push('expires_at = ?');
    values.push(updates.expiresAt);
  }
  if (updates.isActive !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.isActive ? 1 : 0);
  }

  if (!fields.length) return watch;

  values.push(watchId, userId);
  db.prepare(`UPDATE price_watches SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
  return db.prepare('SELECT * FROM price_watches WHERE id = ?').get(watchId);
}

export function deleteWatch(userId, watchId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM price_watches WHERE id = ? AND user_id = ?').run(watchId, userId);
  if (!result.changes) throw new Error('Watch not found');
}

export function getWatchHistory(userId, watchId, limit = 50) {
  const db = getDb();
  const watch = db.prepare('SELECT id FROM price_watches WHERE id = ? AND user_id = ?').get(watchId, userId);
  if (!watch) throw new Error('Watch not found');

  return db.prepare(`
    SELECT * FROM price_check_log WHERE watch_id = ? ORDER BY checked_at DESC LIMIT ?
  `).all(watchId, limit);
}

// ── Scheduled price checking ──────────────────────────────────────────────────

async function checkWatch(watch) {
  const db = getDb();

  try {
    // 'any' condition → fetch the cheapest price regardless of condition
    const conditionArg = watch.condition === 'any' ? null : watch.condition;
    const result = await getLowestPrice(watch.card_name, conditionArg ?? 'nm');
    const foundPrice = result?.lowPrice ?? null;

    let notified = 0;

    if (foundPrice !== null) {
      if (watch.max_price !== null) {
        // Fixed-threshold mode: alert when price is at or below target
        notified = foundPrice <= watch.max_price ? 1 : 0;
      } else {
        // New-low mode: alert when price is strictly lower than any previous check
        const prevLog = db.prepare(
          `SELECT found_price FROM price_check_log
           WHERE watch_id = ? AND found_price IS NOT NULL
           ORDER BY checked_at DESC LIMIT 1`
        ).get(watch.id);

        if (prevLog && foundPrice < prevLog.found_price) {
          notified = 1;
        }
        // No previous price yet → just record, no alert
      }
    }

    db.prepare(`
      INSERT INTO price_check_log (watch_id, found_price, notified)
      VALUES (?, ?, ?)
    `).run(watch.id, foundPrice, notified);

    db.prepare(`
      UPDATE price_watches SET last_checked = datetime('now'), last_price = ? WHERE id = ?
    `).run(foundPrice, watch.id);

    if (notified) {
      const lastNotified = watch.last_notified ? new Date(watch.last_notified) : null;
      const hoursSinceLast = lastNotified ? (Date.now() - lastNotified.getTime()) / 3_600_000 : Infinity;

      if (hoursSinceLast > 24) {
        await sendPriceAlert({
          cardName: watch.card_name,
          foundPrice,
          threshold: watch.max_price,
          condition: watch.condition,
        });

        db.prepare(`UPDATE price_watches SET last_notified = datetime('now') WHERE id = ?`).run(watch.id);
        console.log(`  ✓ Alert sent: ${watch.card_name} @ $${foundPrice}`);
      }
    }

    return { id: watch.id, cardName: watch.card_name, foundPrice, notified: !!notified };
  } catch (err) {
    console.error(`  ✗ Failed to check "${watch.card_name}": ${err.message}`);
    return { id: watch.id, cardName: watch.card_name, error: err.message };
  }
}

export async function runPriceChecks() {
  const db = getDb();

  const watches = db.prepare(`
    SELECT * FROM price_watches
    WHERE is_active = 1
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY last_checked ASC NULLS FIRST
  `).all();

  if (!watches.length) {
    console.log('Price monitor: no active watches');
    return [];
  }

  console.log(`\n💰 Checking prices for ${watches.length} watch(es)...`);

  const results = [];
  for (const watch of watches) {
    const r = await checkWatch(watch);
    results.push(r);
    // Be polite to the API — 1.5s between requests
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  // Expire watches whose deadline has passed
  db.prepare(`
    UPDATE price_watches SET is_active = 0
    WHERE is_active = 1 AND expires_at IS NOT NULL AND expires_at <= datetime('now')
  `).run();

  const hits = results.filter(r => r.notified).length;
  console.log(`✓ Price checks done — ${hits} alert(s) sent`);
  return results;
}

let activeScheduleJob = null;
let activeScheduleExpression = process.env.PRICE_CHECK_SCHEDULE || '0 */6 * * *';

export function getPriceCheckSchedule() {
  return activeScheduleExpression;
}

export function setPriceCheckSchedule(expression) {
  if (!cron.validate(expression)) throw new Error(`Invalid cron expression: ${expression}`);
  const isReschedule = !!activeScheduleJob;
  if (activeScheduleJob) { activeScheduleJob.stop(); activeScheduleJob = null; }
  activeScheduleExpression = expression;
  activeScheduleJob = cron.schedule(expression, async () => {
    console.log('\n⏰ Running scheduled price checks...');
    try { await runPriceChecks(); } catch (err) { console.error('Scheduled price check failed:', err.message); }
  });
  console.log(`✓ Price monitoring ${isReschedule ? 'rescheduled' : 'scheduled'} (${expression})`);
}

export function setupPriceMonitoringSchedule() {
  setPriceCheckSchedule(activeScheduleExpression);
}
