/**
 * Per-user colour theme for the web client. NULL means the default theme, so existing
 * users see no change and a theme id that is later removed falls back cleanly.
 */
export function up(db) {
  db.exec(`ALTER TABLE users ADD COLUMN theme TEXT;`);
  console.log('✓ Added theme to users');
}

export function down(db) {
  db.exec(`ALTER TABLE users DROP COLUMN theme;`);
  console.log('✓ Dropped theme from users');
}
