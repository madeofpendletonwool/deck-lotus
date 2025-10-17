import https from 'https';
import http from 'http';
import fs from 'fs';
import { createBrotliDecompress } from 'zlib';
import { pipeline } from 'stream/promises';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MTGJSON_URL = process.env.MTGJSON_URL || 'https://mtgjson.com/api/v5/AllPrintings.sqlite.bz2';
const PRICES_URL = 'https://mtgjson.com/api/v5/AllPricesToday.json';
const DATA_DIR = path.join(__dirname, '../data');
const DOWNLOAD_PATH = path.join(DATA_DIR, 'AllPrintings.sqlite.bz2');
const EXTRACTED_PATH = path.join(DATA_DIR, 'AllPrintings.sqlite');
const PRICES_PATH = path.join(DATA_DIR, 'AllPricesToday.json');
const TARGET_DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'deck-lotus.db');

/**
 * Download file from URL
 */
async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading from ${url}...`);

    const file = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;

    client.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`Failed to download: ${response.statusCode}`));
      }

      let downloaded = 0;
      const total = parseInt(response.headers['content-length'], 10);

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        const percent = ((downloaded / total) * 100).toFixed(2);
        process.stdout.write(`\rProgress: ${percent}% (${(downloaded / 1024 / 1024).toFixed(2)} MB)`);
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log('\n✓ Download complete');
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(dest);
      reject(err);
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

  try {
    // Try using system bzip2
    await execPromise(`bzip2 -d -k -c "${source}" > "${dest}"`);
    console.log('✓ Decompression complete');
  } catch (error) {
    throw new Error('Failed to decompress. Please install bzip2: brew install bzip2 (macOS) or apt-get install bzip2 (Linux)');
  }
}

/**
 * Import cards from MTGJSON database
 */
async function importCards(sourceDb, targetDb) {
  console.log('Importing cards...');

  // Open source database
  const srcDb = new Database(sourceDb, { readonly: true });

  // Get all unique cards
  console.log('Importing atomic cards...');
  const sourceCards = srcDb.prepare(`
    SELECT DISTINCT name, manaCost, manaValue, colors, colorIdentity,
           type, text, power, toughness, loyalty, keywords,
           isReserved, edhrecRank
    FROM cards
    WHERE name IS NOT NULL
  `).all();

  const insertCard = targetDb.prepare(`
    INSERT OR IGNORE INTO cards (
      name, mana_cost, cmc, colors, color_identity,
      type_line, oracle_text, power, toughness, loyalty,
      keywords, legalities, is_reserved, edhrec_rank
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        null,
        card.isReserved ? 1 : 0,
        card.edhrecRank
      );
    }
  });

  insertMany(sourceCards);
  console.log(`✓ Imported ${sourceCards.length} unique cards`);

  // Import printings
  console.log('Importing card printings...');
  const sourcePrintings = srcDb.prepare(`
    SELECT c.uuid, c.name, c.setCode, c.number, c.rarity, c.artist,
           c.flavorText, c.finishes, c.isPromo, c.isFullArt,
           c.frameVersion, c.borderColor, c.watermark,
           ci.scryfallId
    FROM cards c
    LEFT JOIN cardIdentifiers ci ON c.uuid = ci.uuid
    WHERE c.uuid IS NOT NULL
  `).all();

  const insertPrinting = targetDb.prepare(`
    INSERT OR IGNORE INTO printings (
      card_id, uuid, set_code, collector_number, rarity,
      artist, flavor_text, finishes, is_promo, is_full_art,
      frame_version, border_color, watermark, language, image_url
    ) VALUES (
      (SELECT id FROM cards WHERE name = ? LIMIT 1),
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', ?
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
        imageUrl
      );
    }
  });

  insertPrintingsMany(sourcePrintings);
  console.log(`✓ Imported ${sourcePrintings.length} card printings`);

  // Import sets
  console.log('Importing sets...');
  const sourceSets = srcDb.prepare(`
    SELECT code, name, type, releaseDate, block, baseSetSize, totalSetSize,
           keyruneCode, tcgplayerGroupId, isOnlineOnly, isFoilOnly
    FROM sets
    WHERE code IS NOT NULL
  `).all();

  const insertSet = targetDb.prepare(`
    INSERT OR IGNORE INTO sets (
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

  // Import purchase URLs
  console.log('Importing purchase URLs...');
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
  const rulings = srcDb.prepare(`
    SELECT uuid, date, text
    FROM rulings
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

  srcDb.close();
  console.log('✓ Import complete');
}

/**
 * Import pricing data from MTGJSON
 */
async function importPricing(targetDb) {
  console.log('Importing pricing data...');

  // Download pricing data if not exists
  if (!fs.existsSync(PRICES_PATH)) {
    await downloadFile(PRICES_URL, PRICES_PATH);
  }

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

      // TCGPlayer prices
      if (prices.paper?.tcgplayer) {
        const tcp = prices.paper.tcgplayer;
        if (tcp.retail) {
          const normalPrice = extractPrice(tcp.retail.normal);
          const foilPrice = extractPrice(tcp.retail.foil);
          if (normalPrice) insertPrice.run(uuid, 'tcgplayer', 'normal', normalPrice);
          if (foilPrice) insertPrice.run(uuid, 'tcgplayer', 'foil', foilPrice);
        }
      }

      // Cardmarket prices
      if (prices.paper?.cardmarket) {
        const cm = prices.paper.cardmarket;
        if (cm.retail) {
          const normalPrice = extractPrice(cm.retail.normal);
          const foilPrice = extractPrice(cm.retail.foil);
          if (normalPrice) insertPrice.run(uuid, 'cardmarket', 'normal', normalPrice);
          if (foilPrice) insertPrice.run(uuid, 'cardmarket', 'foil', foilPrice);
        }
      }

      // Card Kingdom prices
      if (prices.paper?.cardkingdom) {
        const ck = prices.paper.cardkingdom;
        if (ck.retail) {
          const normalPrice = extractPrice(ck.retail.normal);
          const foilPrice = extractPrice(ck.retail.foil);
          if (normalPrice) insertPrice.run(uuid, 'cardkingdom', 'normal', normalPrice);
          if (foilPrice) insertPrice.run(uuid, 'cardkingdom', 'foil', foilPrice);
        }
      }

      count++;
      if (count % 5000 === 0) {
        process.stdout.write(`\rProcessed ${count} cards...`);
      }
    }
    if (skipped > 0) {
      console.log(`\nSkipped ${skipped} prices for UUIDs not in printings table`);
    }
  });

  insertPricesMany(Object.entries(data));
  console.log(`\n✓ Imported pricing for ${Object.keys(data).length} printings`);
}

/**
 * Main import process
 */
async function main() {
  try {
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Check if we need to download
    if (!fs.existsSync(EXTRACTED_PATH)) {
      if (!fs.existsSync(DOWNLOAD_PATH)) {
        await downloadFile(MTGJSON_URL, DOWNLOAD_PATH);
      }

      await decompressBz2(DOWNLOAD_PATH, EXTRACTED_PATH);

      // Clean up compressed file
      fs.unlinkSync(DOWNLOAD_PATH);
    } else {
      console.log('✓ MTGJSON database already exists, skipping download');
    }

    // Open target database
    console.log('Opening target database...');
    const targetDb = new Database(TARGET_DB_PATH);
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

    if (cardCount.count > 0) {
      console.log(`✓ Database already contains ${cardCount.count} cards`);
      console.log('Skipping import. Delete the database to re-import.');
      targetDb.close();
      return;
    }

    // Import cards and sets
    await importCards(EXTRACTED_PATH, targetDb);

    // Import pricing data
    await importPricing(targetDb);

    targetDb.close();

    console.log('\n✓ All done! Card data imported successfully.');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
