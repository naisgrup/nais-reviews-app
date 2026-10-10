const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function addColumn(db, table, col, ddl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS shops (
      domain TEXT PRIMARY KEY,
      name TEXT,
      imported_label TEXT NOT NULL DEFAULT 'Imported review',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      product_title TEXT,
      author TEXT NOT NULL,
      email TEXT,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      title TEXT,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      reply TEXT,
      replied_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Migraciones para bases de datos creadas con la versión de una sola tienda
  addColumn(db, 'reviews', 'shop', "TEXT NOT NULL DEFAULT 'default'");
  addColumn(db, 'reviews', 'source', "TEXT NOT NULL DEFAULT 'customer'");
  addColumn(db, 'reviews', 'verified', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reviews_shop_product ON reviews(shop, product_id, status);
    CREATE INDEX IF NOT EXISTS idx_reviews_shop_status ON reviews(shop, status, created_at);
  `);
  const orphan = db.prepare("SELECT COUNT(*) c FROM reviews WHERE shop = 'default'").get().c;
  if (orphan) db.prepare("INSERT OR IGNORE INTO shops (domain, name) VALUES ('default', 'Tienda original')").run();
  return db;
}

module.exports = { openDb };
