export function up(db) {
  db.exec(`
    ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;
    CREATE INDEX idx_users_is_admin ON users(is_admin);
  `);
  console.log('✓ Added is_admin column to users table');
}

export function down(db) {
  // SQLite doesn't support DROP COLUMN easily, so recreate table
  db.exec(`
    CREATE TABLE users_backup AS
    SELECT id, username, email, password_hash, created_at, updated_at
    FROM users;

    DROP TABLE users;
    ALTER TABLE users_backup RENAME TO users;

    -- Recreate indexes
    CREATE INDEX idx_users_username ON users(username);
    CREATE INDEX idx_users_email ON users(email);
  `);
  console.log('✓ Removed is_admin column from users table');
}
