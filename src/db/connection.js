import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db = null;

/**
 * Get or create database connection
 */
export function getDb() {
  if (db) return db;

  const dbPath = process.env.DATABASE_PATH || join(__dirname, '../../data/deck-lotus.db');
  const dbDir = dirname(dbPath);

  // Ensure data directory exists
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath, { verbose: process.env.NODE_ENV === 'development' ? console.log : null });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return db;
}

/**
 * Close database connection
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Database abstraction layer for portability
 */
export class DbAdapter {
  constructor() {
    this.db = getDb();
  }

  /**
   * Execute a query and return all results
   */
  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.all(params);
  }

  /**
   * Execute a query and return first result
   */
  get(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.get(params);
  }

  /**
   * Execute a query that modifies data (INSERT, UPDATE, DELETE)
   */
  run(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.run(params);
  }

  /**
   * Execute multiple statements in a transaction
   */
  transaction(fn) {
    return this.db.transaction(fn)();
  }

  /**
   * Prepare a statement for reuse
   */
  prepare(sql) {
    return this.db.prepare(sql);
  }

  /**
   * Execute raw SQL (for migrations)
   */
  exec(sql) {
    return this.db.exec(sql);
  }
}

export default new DbAdapter();
