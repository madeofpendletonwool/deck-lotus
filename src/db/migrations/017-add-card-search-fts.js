export function up(db) {
  // FTS5 table for fast multilingual searching across card names and foreign names
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS card_search USING fts5(
      name,
      foreign_names,
      card_id UNINDEXED
    );
  `);
  console.log('Created card_search FTS5 table');
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS card_search;`);
  console.log('Dropped card_search FTS5 table');
}
