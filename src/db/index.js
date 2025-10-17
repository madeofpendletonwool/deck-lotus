import { getDb, closeDb, DbAdapter } from './connection.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Run database migrations
 */
export async function runMigrations() {
  const db = getDb();

  // Create migrations table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const migrationsDir = join(__dirname, 'migrations');
  const migrationFiles = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.js'))
    .sort();

  console.log(`Found ${migrationFiles.length} migration file(s)`);

  for (const file of migrationFiles) {
    const migrationName = file.replace('.js', '');

    // Check if migration was already applied
    const applied = db.prepare('SELECT * FROM migrations WHERE name = ?').get(migrationName);

    if (!applied) {
      console.log(`Applying migration: ${migrationName}`);

      const migrationPath = join(migrationsDir, file);
      const migration = await import(`file://${migrationPath}`);

      // Run migration in a transaction
      const runMigration = db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
      });

      runMigration();
      console.log(`✓ Applied migration: ${migrationName}`);
    } else {
      console.log(`⊘ Skipping already applied migration: ${migrationName}`);
    }
  }

  console.log('All migrations completed');
}

export { getDb, closeDb, DbAdapter };
export default DbAdapter;
