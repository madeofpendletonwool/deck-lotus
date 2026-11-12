import https from 'https';
import http from 'http';
import fs from 'fs';
import { createBrotliDecompress } from 'zlib';
import { pipeline } from 'stream/promises';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mergeCardRows } from '../src/utils/cardFaces.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MTGJSON_URL = process.env.MTGJSON_URL || 'https://mtgjson.com/api/v5/AllPrintings.sqlite.bz2';
const PRICES_URL = 'https://mtgjson.com/api/v5/AllPricesToday.json';
const DATA_DIR = path.join(__dirname, '../data');
const DOWNLOAD_PATH = path.join(DATA_DIR, 'AllPrintings.sqlite.bz2');
const EXTRACTED_PATH = path.join(DATA_DIR, 'AllPrintings.sqlite');
const PRICES_PATH = path.join(DATA_DIR, 'AllPricesToday.json');
const TARGET_DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'deck-lotus.db');
const PRICE_PROVIDERS = ['tcgplayer', 'cardmarket', 'cardkingdom', 'manapool'];
const PRICE_TYPES = ['normal', 'foil', 'etched'];
const DOWNLOAD_STALL_MS = 60 * 1000;

// When the server runs this as a sync it listens for these messages (see utils/syncProgress.js)
const report = (message) => {
  if (process.connected) process.send(message);
};
const summary = {};

/**
 * Download file from URL
 */
async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading from ${url}...`);
    let settled = false;

    const file = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;

    const request = client.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect. This request is finished with, so its timeout mustn't touch the new one.
        settled = true;
        response.resume();
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        settled = true;
        response.resume();
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`Failed to download: ${response.statusCode}`));
      }

      let downloaded = 0;
      const total = parseInt(response.headers['content-length'], 10);

      let lastReport = 0;
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (Date.now() - lastReport >= 250) {
          lastReport = Date.now();
          report({ type: 'progress', done: downloaded, total: total || null, unit: 'bytes' });
        }
      });
      response.on('error', fail);

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        if (settled) return;
        settled = true;
        console.log('✓ Download complete');
        resolve();
      });
    });

    function fail(err) {
      if (settled) return;
      settled = true;
      file.destroy();
      fs.rmSync(dest, { force: true });
      reject(err);
    }

    request.on('error', fail);
    // A dropped connection can go silent instead of erroring, which would hang the sync forever
    request.setTimeout(DOWNLOAD_STALL_MS, () => {
      request.destroy(new Error(`Download stalled: no data from ${new URL(url).hostname} for 60 seconds`));
    });
  });
}

/**
 * Decompress bz2 file
 */
async function decompressBz2(source, dest) {
  console.log('Decompressing file...');

  const { exec } = await import('child_process');
  const util = await import('util');
  const execPromise = util.promisify(exec);

  const sizeReporter = setInterval(() => {
    fs.stat(dest, (err, stats) => {
      if (!err) report({ type: 'progress', done: stats.size, total: null, unit: 'bytes' });
    });
  }, 500);

  try {
    // Try using system bzip2
    await execPromise(`bzip2 -d -k -c "${source}" > "${dest}"`);
    console.log('✓ Decompression complete');
  } catch (error) {
    throw new Error('Failed to decompress. Please install bzip2: brew install bzip2 (macOS) or apt-get install bzip2 (Linux)');
  } finally {
    clearInterval(sizeReporter);
  }
}

/**
 * Import cards from MTGJSON database
 */
async function importCards(sourceDb, targetDb) {
  console.log('Importing cards...');

  // Open source database
  const srcDb = new Database(sourceDb, { readonly: true });

  // Get all unique cards with all metadata
  console.log('Importing atomic cards...');
  report({ type: 'progress', done: 0, total: 7, unit: 'stages', detail: 'Reading cards' });
  const sourceCards = srcDb.prepare(`
    SELECT DISTINCT
      c.name, c.manaCost, c.manaValue, c.colors, c.colorIdentity,
      c.type, c.text, c.power, c.toughness, c.loyalty, c.keywords,
      c.isReserved, c.edhrecRank, c.edhrecSaltiness, c.originalReleaseDate,
      c.subtypes, c.supertypes, c.types, c.leadershipSkills, c.layout,
      c.side, c.faceName,
      cl.alchemy, cl.brawl, cl.commander, cl.duel, cl.future,
      cl.gladiator, cl.historic, cl.legacy, cl.modern, cl.oathbreaker,
      cl.oldschool, cl.pauper, cl.paupercommander, cl.penny, cl.pioneer,
      cl.predh, cl.premodern, cl.standard, cl.standardbrawl, cl.timeless,
      cl.vintage
    FROM cards c
    LEFT JOIN cardLegalities cl ON c.uuid = cl.uuid
    WHERE c.name IS NOT NULL
  `).all();

  const insertCard = targetDb.prepare(`
    INSERT OR REPLACE INTO cards (
      name, mana_cost, cmc, colors, color_identity,
      type_line, oracle_text, power, toughness, loyalty,
      keywords, legalities, is_reserved, edhrec_rank,
      subtypes, supertypes, types, leadership_skills,
      edhrec_saltiness, first_printing, layout
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = targetDb.transaction((cards) => {
    for (const card of cards) {
      // Parse JSON fields safely
      let colors = null;
      let colorIdentity = null;
      let keywords = null;

      try {
        if (card.colors) colors = typeof card.colors === 'string' ? card.colors : JSON.parse(card.colors).join(',');
      } catch (e) { colors = card.colors; }

      try {
        if (card.colorIdentity) colorIdentity = typeof card.colorIdentity === 'string' ? card.colorIdentity : JSON.parse(card.colorIdentity).join(',');
      } catch (e) { colorIdentity = card.colorIdentity; }

      try {
        if (card.keywords) keywords = typeof card.keywords === 'string' ? card.keywords : JSON.parse(card.keywords).join(',');
      } catch (e) { keywords = card.keywords; }

      // Parse type arrays
      let subtypes = null, supertypes = null, types = null;

      try {
        if (card.subtypes) {
          const arr = typeof card.subtypes === 'string' ? JSON.parse(card.subtypes) : card.subtypes;
          subtypes = Array.isArray(arr) ? arr.join(',') : card.subtypes;
        }
      } catch (e) { subtypes = card.subtypes; }

      try {
        if (card.supertypes) {
          const arr = typeof card.supertypes === 'string' ? JSON.parse(card.supertypes) : card.supertypes;
          supertypes = Array.isArray(arr) ? arr.join(',') : card.supertypes;
        }
      } catch (e) { supertypes = card.supertypes; }

      try {
        if (card.types) {
          const arr = typeof card.types === 'string' ? JSON.parse(card.types) : card.types;
          types = Array.isArray(arr) ? arr.join(',') : card.types;
        }
      } catch (e) { types = card.types; }

      // Parse leadership skills
      let leadershipSkills = null;
      if (card.leadershipSkills) {
        try {
          const skills = typeof card.leadershipSkills === 'string'
            ? JSON.parse(card.leadershipSkills)
            : card.leadershipSkills;
          leadershipSkills = JSON.stringify(skills);
        } catch (e) {
          leadershipSkills = card.leadershipSkills;
        }
      }

      // Build legalities JSON object from individual columns
      let legalities = null;
      if (card.alchemy || card.brawl || card.commander || card.duel || card.future ||
          card.gladiator || card.historic || card.legacy || card.modern || card.oathbreaker ||
          card.oldschool || card.pauper || card.paupercommander || card.penny || card.pioneer ||
          card.predh || card.premodern || card.standard || card.standardbrawl || card.timeless ||
          card.vintage) {
        const legalitiesObj = {
          alchemy: card.alchemy,
          brawl: card.brawl,
          commander: card.commander,
          duel: card.duel,
          future: card.future,
          gladiator: card.gladiator,
          historic: card.historic,
          legacy: card.legacy,
          modern: card.modern,
          oathbreaker: card.oathbreaker,
          oldschool: card.oldschool,
          pauper: card.pauper,
          paupercommander: card.paupercommander,
          penny: card.penny,
          pioneer: card.pioneer,
          predh: card.predh,
          premodern: card.premodern,
          standard: card.standard,
          standardbrawl: card.standardbrawl,
          timeless: card.timeless,
          vintage: card.vintage
        };
        legalities = JSON.stringify(legalitiesObj);
      }

      insertCard.run(
        card.name,
        card.manaCost,
        card.manaValue,
        colors,
        colorIdentity,
        card.type,
        card.text,
        card.power,
        card.toughness,
        card.loyalty,
        keywords,
        legalities,
        card.isReserved ? 1 : 0,
        card.edhrecRank,
        subtypes,
        supertypes,
        types,
        leadershipSkills,
        card.edhrecSaltiness,
        card.originalReleaseDate,
        card.layout
      );
    }
  });

  const uniqueCards = mergeCardRows(sourceCards);
  insertMany(uniqueCards);
  console.log(`✓ Imported ${uniqueCards.length} unique cards`);
  summary.cards = uniqueCards.length;

  // Import printings
  console.log('Importing card printings...');
  report({ type: 'progress', done: 1, total: 7, unit: 'stages', detail: 'Importing printings' });
  const sourcePrintings = srcDb.prepare(`
    SELECT c.uuid, c.name, c.setCode, c.number, c.rarity, c.artist,
           c.flavorText, c.finishes, c.isPromo, c.isFullArt,
           c.frameVersion, c.borderColor, c.watermark,
           ci.scryfallId, ci.mtgoId, ci.mtgoFoilId,
           ci.tcgplayerProductId, ci.cardKingdomId,
           ci.cardKingdomFoilId, ci.cardKingdomEtchedId,
           ci.mtgArenaId, ci.multiverseId
    FROM cards c
    LEFT JOIN cardIdentifiers ci ON c.uuid = ci.uuid
    WHERE c.uuid IS NOT NULL
  `).all();

  const insertPrinting = targetDb.prepare(`
    INSERT OR REPLACE INTO printings (
      card_id, uuid, set_code, collector_number, rarity,
      artist, flavor_text, finishes, is_promo, is_full_art,
      frame_version, border_color, watermark, language, image_url,
      scryfall_id, mtgo_id, mtgo_foil_id, tcgplayer_product_id,
      cardkingdom_id, cardkingdom_foil_id, cardkingdom_etched_id,
      mtg_arena_id, multiverse_id
    ) VALUES (
      (SELECT id FROM cards WHERE name = ? LIMIT 1),
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const insertPrintingsMany = targetDb.transaction((printings) => {
    for (const p of printings) {
      let finishes = null;

      try {
        if (p.finishes) finishes = typeof p.finishes === 'string' ? p.finishes : JSON.parse(p.finishes).join(',');
      } catch (e) { finishes = p.finishes; }

      // Generate image URL if scryfallId is available
      let imageUrl = null;
      if (p.scryfallId) {
        const dir1 = p.scryfallId.charAt(0);
        const dir2 = p.scryfallId.charAt(1);
        imageUrl = `https://cards.scryfall.io/normal/front/${dir1}/${dir2}/${p.scryfallId}.jpg`;
      }

      insertPrinting.run(
        p.name,
        p.uuid,
        p.setCode,
        p.number,
        p.rarity,
        p.artist,
        p.flavorText,
        finishes,
        p.isPromo ? 1 : 0,
        p.isFullArt ? 1 : 0,
        p.frameVersion,
        p.borderColor,
        p.watermark,
        imageUrl,
        p.scryfallId,
        p.mtgoId,
        p.mtgoFoilId,
        p.tcgplayerProductId,
        p.cardKingdomId,
        p.cardKingdomFoilId,
        p.cardKingdomEtchedId,
        p.mtgArenaId,
        p.multiverseId
      );
    }
  });

  insertPrintingsMany(sourcePrintings);
  console.log(`✓ Imported ${sourcePrintings.length} card printings`);
  summary.printings = sourcePrintings.length;

  // Import sets
  console.log('Importing sets...');
  report({ type: 'progress', done: 2, total: 7, unit: 'stages', detail: 'Importing sets' });
  const sourceSets = srcDb.prepare(`
    SELECT code, name, type, releaseDate, block, baseSetSize, totalSetSize,
           keyruneCode, tcgplayerGroupId, isOnlineOnly, isFoilOnly
    FROM sets
    WHERE code IS NOT NULL
  `).all();

  const insertSet = targetDb.prepare(`
    INSERT OR REPLACE INTO sets (
      code, name, type, release_date, block, base_set_size, total_set_size,
      keyrune_code, tcgplayer_group_id, is_online_only, is_foil_only
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSetsMany = targetDb.transaction((sets) => {
    for (const s of sets) {
      insertSet.run(
        s.code,
        s.name,
        s.type,
        s.releaseDate,
        s.block,
        s.baseSetSize,
        s.totalSetSize,
        s.keyruneCode,
        s.tcgplayerGroupId,
        s.isOnlineOnly ? 1 : 0,
        s.isFoilOnly ? 1 : 0
      );
    }
  });

  insertSetsMany(sourceSets);
  console.log(`✓ Imported ${sourceSets.length} sets`);
  summary.sets = sourceSets.length;

  // Import purchase URLs
  console.log('Importing purchase URLs...');
  report({ type: 'progress', done: 3, total: 7, unit: 'stages', detail: 'Importing purchase links' });
  const purchaseUrls = srcDb.prepare(`
    SELECT uuid, tcgplayer, cardmarket, cardKingdom
    FROM cardPurchaseUrls
    WHERE uuid IS NOT NULL
  `).all();

  const updatePrintingUrls = targetDb.prepare(`
    UPDATE printings
    SET tcgplayer_url = ?, cardmarket_url = ?, cardkingdom_url = ?
    WHERE uuid = ?
  `);

  const updateUrlsMany = targetDb.transaction((urls) => {
    for (const u of urls) {
      updatePrintingUrls.run(u.tcgplayer, u.cardmarket, u.cardKingdom, u.uuid);
    }
  });

  updateUrlsMany(purchaseUrls);
  console.log(`✓ Updated purchase URLs for ${purchaseUrls.length} printings`);

  // Import rulings
  console.log('Importing card rulings...');
  report({ type: 'progress', done: 4, total: 7, unit: 'stages', detail: 'Importing rulings' });
  const rulings = srcDb.prepare(`
    SELECT uuid, date, text
    FROM cardRulings
    WHERE uuid IS NOT NULL
  `).all();

  const insertRuling = targetDb.prepare(`
    INSERT OR IGNORE INTO rulings (uuid, date, text)
    VALUES (?, ?, ?)
  `);

  const insertRulingsMany = targetDb.transaction((rulingsList) => {
    for (const r of rulingsList) {
      insertRuling.run(r.uuid, r.date, r.text);
    }
  });

  insertRulingsMany(rulings);
  console.log(`✓ Imported ${rulings.length} card rulings`);

  // Import related cards
  console.log('Importing related cards...');
  report({ type: 'progress', done: 5, total: 7, unit: 'stages', detail: 'Importing related cards' });
  const relatedCards = srcDb.prepare(`
    SELECT name, relatedCards
    FROM cards
    WHERE relatedCards IS NOT NULL
  `).all();

  const insertRelated = targetDb.prepare(`
    INSERT OR IGNORE INTO related_cards (card_name, related_name, relation_type)
    VALUES (?, ?, ?)
  `);

  const insertRelatedMany = targetDb.transaction((relations) => {
    let count = 0;
    for (const card of relations) {
      if (!card.relatedCards) continue;

      try {
        const relatedObj = typeof card.relatedCards === 'string'
          ? JSON.parse(card.relatedCards)
          : card.relatedCards;

        // Handle all relation types in the relatedCards object
        for (const [relationType, relatedNames] of Object.entries(relatedObj)) {
          if (Array.isArray(relatedNames)) {
            for (const relatedName of relatedNames) {
              insertRelated.run(card.name, relatedName, relationType);
              count++;
            }
          }
        }
      } catch (e) {
        console.error(`Failed to parse relatedCards for ${card.name}:`, e.message);
      }
    }
    return count;
  });

  const relatedCount = insertRelatedMany(relatedCards);
  console.log(`✓ Imported ${relatedCount} related card relationships`);

  // Import foreign data
  console.log('Importing foreign card data...');
  report({ type: 'progress', done: 6, total: 7, unit: 'stages', detail: 'Importing translations' });
  const foreignData = srcDb.prepare(`
    SELECT c.name as english_name, fd.language, fd.name as faceName, fd.text, fd.type, fd.flavorText
    FROM cardForeignData fd
    JOIN cards c ON fd.uuid = c.uuid
    WHERE c.name IS NOT NULL AND fd.language IS NOT NULL
  `).all();

  const insertForeign = targetDb.prepare(`
    INSERT OR IGNORE INTO card_foreign_data
    (card_name, language, foreign_name, foreign_text, foreign_type, foreign_flavor_text)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertForeignMany = targetDb.transaction((data) => {
    let inserted = 0;
    for (const fd of data) {
      // Only insert if the card exists in our target database
      const cardExists = targetDb.prepare('SELECT 1 FROM cards WHERE name = ? LIMIT 1').get(fd.english_name);
      if (cardExists) {
        insertForeign.run(
          fd.english_name,  // card_name: English card name
          fd.language,
          fd.faceName,      // foreign_name: translated name
          fd.text,
          fd.type,
          fd.flavorText
        );
        inserted++;
      }
    }
    return inserted;
  });

  const insertedCount = insertForeignMany(foreignData);
  console.log(`✓ Imported ${insertedCount} foreign card translations`);

  srcDb.close();
  console.log('✓ Import complete');
}

/**
 * Import pricing data from MTGJSON
 */
async function importPricing(targetDb) {
  console.log('Importing pricing data...');

  const pricesData = JSON.parse(fs.readFileSync(PRICES_PATH, 'utf8'));
  const data = pricesData.data;

  const insertPrice = targetDb.prepare(`
    INSERT OR REPLACE INTO prices (
      printing_uuid, provider, price_type, price, updated_at
    ) VALUES (?, ?, ?, ?, datetime('now'))
  `);

  // Check which UUIDs exist in our printings table
  const checkUuid = targetDb.prepare(`SELECT 1 FROM printings WHERE uuid = ? LIMIT 1`);

  const insertPricesMany = targetDb.transaction((entries) => {
    let count = 0;
    let skipped = 0;
    for (const [uuid, prices] of entries) {
      // Skip if UUID doesn't exist in printings table
      if (!checkUuid.get(uuid)) {
        skipped++;
        continue;
      }

      // Helper function to extract price from date-based object
      const extractPrice = (priceObj) => {
        if (!priceObj) return null;
        // If it's already a number, return it (backward compatibility)
        if (typeof priceObj === 'number') return priceObj;
        // If it's an object with date keys, get the first/latest price
        if (typeof priceObj === 'object') {
          const dates = Object.keys(priceObj);
          if (dates.length > 0) {
            // Get the most recent date's price
            const latestDate = dates.sort().reverse()[0];
            return priceObj[latestDate];
          }
        }
        return null;
      };

      for (const provider of PRICE_PROVIDERS) {
        const retail = prices.paper?.[provider]?.retail;
        if (!retail) continue;
        for (const priceType of PRICE_TYPES) {
          const price = extractPrice(retail[priceType]);
          if (price) insertPrice.run(uuid, provider, priceType, price);
        }
      }

      count++;
      if (count % 5000 === 0) {
        report({ type: 'progress', done: count + skipped, total: entries.length, unit: 'printings' });
      }
    }
    if (skipped > 0) {
      console.log(`\nSkipped ${skipped} prices for UUIDs not in printings table`);
    }
  });

  insertPricesMany(Object.entries(data));
  console.log(`✓ Imported pricing for ${Object.keys(data).length} printings`);
  summary.prices = targetDb.prepare('SELECT COUNT(*) as count FROM prices').get().count;
}

/**
 * Main import process
 */
async function main() {
  let targetDb;
  try {
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Open target database to check if we need force reimport
    console.log('Opening target database...');
    targetDb = new Database(TARGET_DB_PATH);
    targetDb.pragma('journal_mode = WAL');

    // Check if cards table exists, if not run migrations
    const tableCheck = targetDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='cards'`).get();

    if (!tableCheck) {
      console.log('Running migrations...');
      // Import and run migrations
      const { runMigrations } = await import('../src/db/index.js');
      await runMigrations();
    }

    // Check if cards already imported
    const cardCount = targetDb.prepare('SELECT COUNT(*) as count FROM cards').get();
    const forceReimport = process.env.FORCE_REIMPORT === 'true';

    if (cardCount.count > 0 && !forceReimport) {
      console.log(`✓ Database already contains ${cardCount.count} cards`);
      console.log('Skipping import. Delete the database to re-import.');
      console.log('Or set FORCE_REIMPORT=true to force a fresh import.');
      targetDb.close();
      return;
    }

    const replacingData = cardCount.count > 0 && forceReimport;

    // Fetch everything before touching the database, so a failed download changes nothing.
    if (replacingData) {
      // Delete stale MTGJSON source files to force fresh download
      if (fs.existsSync(EXTRACTED_PATH)) {
        console.log('  🗑️  Deleting stale AllPrintings.sqlite...');
        fs.unlinkSync(EXTRACTED_PATH);
      }
      if (fs.existsSync(DOWNLOAD_PATH)) {
        console.log('  🗑️  Deleting stale AllPrintings.sqlite.bz2...');
        fs.unlinkSync(DOWNLOAD_PATH);
      }
      if (fs.existsSync(PRICES_PATH)) {
        console.log('  🗑️  Deleting stale AllPricesToday.json...');
        fs.unlinkSync(PRICES_PATH);
      }
    }

    if (!fs.existsSync(EXTRACTED_PATH)) {
      if (!fs.existsSync(DOWNLOAD_PATH)) {
        report({ type: 'step', id: 'download' });
        await downloadFile(MTGJSON_URL, DOWNLOAD_PATH);
      }

      report({ type: 'step', id: 'unpack' });
      await decompressBz2(DOWNLOAD_PATH, EXTRACTED_PATH);

      // Clean up compressed file
      fs.unlinkSync(DOWNLOAD_PATH);
    } else {
      console.log('✓ MTGJSON database already exists, skipping download');
    }

    if (!fs.existsSync(PRICES_PATH)) {
      report({ type: 'step', id: 'prices-download' });
      await downloadFile(PRICES_URL, PRICES_PATH);
    }

    // The swap is one transaction. Readers keep seeing the old data until it commits, and if
    // anything fails or the process dies, the database is left exactly as it was.
    report({ type: 'lock', locked: true });
    targetDb.exec('BEGIN IMMEDIATE');

    if (replacingData) {
      report({ type: 'step', id: 'backup' });
      console.log(`\n⚠️  FORCE_REIMPORT=true detected`);
      console.log(`Clearing existing MTGJSON data (preserving user data)...`);

      // STEP 1: CRITICAL - Save user data to disk BEFORE deleting anything
      console.log('  📦 Creating safety backup before sync...');

      // Cube metadata columns arrive with migration 022; older databases don't have them yet
      const deckCardColumns = new Set(targetDb.prepare(`PRAGMA table_info(deck_cards)`).all().map((c) => c.name));
      const cubeColumns = ['tags', 'color_category', 'notes'].filter((c) => deckCardColumns.has(c));
      const deckCardsBackup = targetDb.prepare(`
        SELECT dc.deck_id, dc.quantity, dc.is_sideboard, dc.is_commander, dc.board_type, p.uuid
          ${cubeColumns.map((c) => `, dc.${c}`).join('')}
        FROM deck_cards dc
        JOIN printings p ON dc.printing_id = p.id
      `).all();
      targetDb._deckCardCubeColumns = cubeColumns;

      const ownedCardsBackup = targetDb.prepare(`
        SELECT oc.user_id, oc.quantity, c.name as card_name
        FROM owned_cards oc
        JOIN cards c ON oc.card_id = c.id
      `).all();

      // Foil tracking arrives with migration 023; a foil and a nonfoil copy of one
      // printing are separate rows, so dropping finish would merge them on restore
      const hasFinish = targetDb.prepare(`PRAGMA table_info(owned_printings)`).all().some((c) => c.name === 'finish');
      targetDb._ownedPrintingsHaveFinish = hasFinish;
      const ownedPrintingsBackup = targetDb.prepare(`
        SELECT op.user_id, op.quantity, op.created_at, op.updated_at, p.uuid as printing_uuid
          ${hasFinish ? ', op.finish' : ''}
        FROM owned_printings op
        JOIN printings p ON op.printing_id = p.id
      `).all();

      // Create backup directory if it doesn't exist
      const BACKUP_DIR = path.join(DATA_DIR, 'backups');
      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }

      // Save to disk with timestamp
      const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      const safetyBackupPath = path.join(BACKUP_DIR, `pre-sync-safety-backup-${timestamp}.json`);

      const safetyBackup = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        type: 'pre-sync-safety',
        data: {
          deck_cards: deckCardsBackup,
          owned_cards: ownedCardsBackup,
          owned_printings: ownedPrintingsBackup
        }
      };

      fs.writeFileSync(safetyBackupPath, JSON.stringify(safetyBackup, null, 2), 'utf8');
      summary.safetyBackup = path.basename(safetyBackupPath);
      console.log(`  ✓ Safety backup saved to: ${path.basename(safetyBackupPath)}`);
      console.log(`  ✓ Backed up ${deckCardsBackup.length} deck card entries`);
      console.log(`  ✓ Backed up ${ownedCardsBackup.length} owned card entries`);
      console.log(`  ✓ Backed up ${ownedPrintingsBackup.length} owned printing entries`);

      // STEP 2: Delete MTGJSON-sourced data in correct order (preserve user data)
      targetDb.prepare('DELETE FROM prices').run();
      console.log('  ✓ Cleared prices');

      targetDb.prepare('DELETE FROM rulings').run();
      console.log('  ✓ Cleared rulings');

      targetDb.prepare('DELETE FROM related_cards').run();
      console.log('  ✓ Cleared related cards');

      targetDb.prepare('DELETE FROM card_foreign_data').run();
      console.log('  ✓ Cleared foreign data');

      // This will cascade delete deck_cards due to foreign key constraint
      targetDb.prepare('DELETE FROM printings').run();
      console.log('  ✓ Cleared printings');

      targetDb.prepare('DELETE FROM sets').run();
      console.log('  ✓ Cleared sets');

      targetDb.prepare('DELETE FROM cards').run();
      console.log('  ✓ Cleared cards');

      console.log(`\n✓ Database cleared. Starting fresh import...\n`);

      // STEP 3: Store backup data for restoration after import
      // Keep in memory for immediate use AND save path for recovery
      targetDb._deckCardsBackup = deckCardsBackup;
      targetDb._ownedCardsBackup = ownedCardsBackup;
      targetDb._ownedPrintingsBackup = ownedPrintingsBackup;
      targetDb._safetyBackupPath = safetyBackupPath;
    }

    report({ type: 'step', id: 'cards' });
    // Import cards and sets
    await importCards(EXTRACTED_PATH, targetDb);

    report({ type: 'step', id: 'prices' });
    // Import pricing data
    await importPricing(targetDb);

    report({ type: 'step', id: 'restore' });
    // STEP 4: Restore user deck data if we backed it up
    if (targetDb._deckCardsBackup && targetDb._deckCardsBackup.length > 0) {
      console.log('\n🔄 Restoring user deck data...');
      const backup = targetDb._deckCardsBackup;

      const cubeColumns = targetDb._deckCardCubeColumns || [];
      const insertDeckCard = targetDb.prepare(`
        INSERT INTO deck_cards (deck_id, printing_id, quantity, is_sideboard, is_commander, board_type${cubeColumns.map((c) => `, ${c}`).join('')})
        VALUES (?, ?, ?, ?, ?, ?${cubeColumns.map(() => ', ?').join('')})
      `);

      const getPrintingId = targetDb.prepare(`
        SELECT id FROM printings WHERE uuid = ? LIMIT 1
      `);

      const restoreMany = targetDb.transaction((entries) => {
        let restored = 0;
        let notFound = 0;

        for (const entry of entries) {
          const printing = getPrintingId.get(entry.uuid);
          if (printing) {
            try {
              insertDeckCard.run(
                entry.deck_id,
                printing.id,
                entry.quantity,
                entry.is_sideboard,
                entry.is_commander,
                entry.board_type || 'mainboard',
                ...cubeColumns.map((c) => entry[c] ?? null)
              );
              restored++;
            } catch (e) {
              // Might fail if deck was deleted, that's ok
              notFound++;
            }
          } else {
            // Printing doesn't exist in new import (rare but possible)
            notFound++;
          }
        }

        return { restored, notFound };
      });

      const result = restoreMany(backup);
      console.log(`✓ Restored ${result.restored} deck card entries`);
      summary.deckCardsRestored = result.restored;
      summary.deckCardsLost = result.notFound;
      if (result.notFound > 0) {
        console.log(`  ⚠️  ${result.notFound} cards not found in new import (may have been removed from MTGJSON)`);
      }
    }

    // STEP 5: Restore owned cards data if we backed it up
    if (targetDb._ownedCardsBackup && targetDb._ownedCardsBackup.length > 0) {
      console.log('\n🔄 Restoring owned cards data...');
      const backup = targetDb._ownedCardsBackup;

      const insertOwnedCard = targetDb.prepare(`
        INSERT OR IGNORE INTO owned_cards (user_id, card_id, quantity)
        VALUES (?, ?, ?)
      `);

      const getCardId = targetDb.prepare(`
        SELECT id FROM cards WHERE name = ? LIMIT 1
      `);

      const restoreOwnedMany = targetDb.transaction((entries) => {
        let restored = 0;
        let notFound = 0;

        for (const entry of entries) {
          const card = getCardId.get(entry.card_name);
          if (card) {
            try {
              insertOwnedCard.run(
                entry.user_id,
                card.id,
                entry.quantity
              );
              restored++;
            } catch (e) {
              // Might fail if user was deleted, that's ok
              notFound++;
            }
          } else {
            // Card doesn't exist in new import (rare but possible)
            notFound++;
          }
        }

        return { restored, notFound };
      });

      const ownedResult = restoreOwnedMany(backup);
      console.log(`✓ Restored ${ownedResult.restored} owned card entries`);
      summary.ownedCardsRestored = ownedResult.restored;
      summary.ownedCardsLost = ownedResult.notFound;
      if (ownedResult.notFound > 0) {
        console.log(`  ⚠️  ${ownedResult.notFound} cards not found in new import (may have been removed from MTGJSON)`);
      }
    }

    // STEP 6: Restore owned printings data if we backed it up
    if (targetDb._ownedPrintingsBackup && targetDb._ownedPrintingsBackup.length > 0) {
      console.log('\n🔄 Restoring owned printings data...');
      const backup = targetDb._ownedPrintingsBackup;

      const hasFinish = targetDb._ownedPrintingsHaveFinish;
      const insertOwnedPrinting = targetDb.prepare(hasFinish
        ? `INSERT OR IGNORE INTO owned_printings (user_id, printing_id, quantity, finish, created_at, updated_at)
           VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))`
        : `INSERT OR IGNORE INTO owned_printings (user_id, printing_id, quantity, created_at, updated_at)
           VALUES (?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))`);

      const getPrintingIdByUuid = targetDb.prepare(`
        SELECT id FROM printings WHERE uuid = ? LIMIT 1
      `);

      const restoreOwnedPrintingsMany = targetDb.transaction((entries) => {
        let restored = 0;
        let notFound = 0;

        for (const entry of entries) {
          const printing = getPrintingIdByUuid.get(entry.printing_uuid);
          if (printing) {
            try {
              insertOwnedPrinting.run(
                entry.user_id,
                printing.id,
                entry.quantity,
                ...(hasFinish ? [entry.finish || 'nonfoil'] : []),
                entry.created_at ?? null,
                entry.updated_at ?? null
              );
              restored++;
            } catch (e) {
              // Might fail if user was deleted, that's ok
              notFound++;
            }
          } else {
            // Printing doesn't exist in new import (rare but possible)
            notFound++;
          }
        }

        return { restored, notFound };
      });

      const ownedPrintingsResult = restoreOwnedPrintingsMany(backup);
      console.log(`✓ Restored ${ownedPrintingsResult.restored} owned printing entries`);
      summary.ownedPrintingsRestored = ownedPrintingsResult.restored;
      summary.ownedPrintingsLost = ownedPrintingsResult.notFound;
      if (ownedPrintingsResult.notFound > 0) {
        console.log(`  ⚠️  ${ownedPrintingsResult.notFound} printings not found in new import (may have been removed from MTGJSON)`);
      }
    }

    targetDb.exec('COMMIT');
    report({ type: 'committed' });

    report({ type: 'step', id: 'finish' });
    // Refresh query planner stats and fold the import's write-ahead log back into the database.
    targetDb.exec('ANALYZE');
    targetDb.pragma('wal_checkpoint(TRUNCATE)');
    targetDb.close();

    // Clean up temporary MTGJSON files to save disk space
    console.log('\n🧹 Cleaning up temporary files...');
    if (fs.existsSync(EXTRACTED_PATH)) {
      fs.unlinkSync(EXTRACTED_PATH);
      console.log('  ✓ Deleted AllPrintings.sqlite (~485MB saved)');
    }
    if (fs.existsSync(PRICES_PATH)) {
      fs.unlinkSync(PRICES_PATH);
      console.log('  ✓ Deleted AllPricesToday.json');
    }

    report({ type: 'summary', summary });
    report({ type: 'lock', locked: false });
    console.log('\n✓ All done! Card data imported successfully.');
    // Exit only once the messages are sent, or the server misses the summary.
    if (process.connected) process.send({ type: 'done' }, () => process.exit(0));
  } catch (error) {
    console.error('Error:', error.message);
    if (targetDb?.inTransaction) targetDb.exec('ROLLBACK');
    targetDb?.close();
    // Exit only once the message is sent, or the server never learns why this failed.
    if (process.connected) {
      process.send({ type: 'error', message: error.message }, () => process.exit(1));
    } else {
      process.exit(1);
    }
  }
}

// If the server dies, stop rather than keep writing with nobody watching. SQLite rolls back.
if (process.connected) process.on('disconnect', () => process.exit(1));

main();
