import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const SOURCE_DB_PATH = path.join(DATA_DIR, 'AllPrintings.sqlite');
const TARGET_DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'deck-lotus.db');

async function main() {
  console.log('Populating layout column from AllPrintings.sqlite...');

  const sourceDb = new Database(SOURCE_DB_PATH, { readonly: true });
  const targetDb = new Database(TARGET_DB_PATH);

  // Get all unique card names and their layouts from source
  const sourceLayouts = sourceDb.prepare(`
    SELECT DISTINCT name, layout
    FROM cards
    WHERE name IS NOT NULL AND layout IS NOT NULL
  `).all();

  console.log(`Found ${sourceLayouts.length} cards with layout data`);

  // Update cards in target database
  const updateLayout = targetDb.prepare('UPDATE cards SET layout = ? WHERE name = ?');

  const updateMany = targetDb.transaction((layouts) => {
    let updated = 0;
    for (const card of layouts) {
      const result = updateLayout.run(card.layout, card.name);
      if (result.changes > 0) updated++;
    }
    return updated;
  });

  const updatedCount = updateMany(sourceLayouts);

  console.log(`✓ Updated layout for ${updatedCount} cards`);

  sourceDb.close();
  targetDb.close();

  console.log('✓ Layout population complete!');
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
