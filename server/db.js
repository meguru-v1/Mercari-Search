const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data.db');
const db = new Database(dbPath);

// テーブルの初期化
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL,
    name TEXT,
    image_url TEXT,
    current_price INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    price INTEGER NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE CASCADE
  );
`);

/**
 * すべての商品を取得
 */
function getAllItems() {
  return db.prepare('SELECT * FROM items').all();
}

/**
 * 商品を追加または更新
 */
function upsertItem(url, name, price, imageUrl) {
  const info = db.prepare(`
    INSERT INTO items (url, name, current_price, image_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      name = excluded.name,
      current_price = excluded.current_price,
      image_url = excluded.image_url
  `).run(url, name, price, imageUrl);

  const itemId = info.lastInsertRowid || db.prepare('SELECT id FROM items WHERE url = ?').get(url).id;

  // 価格履歴に追加
  db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(itemId, price);

  return itemId;
}

/**
 * 商品の現在の価格を更新し、履歴に追加
 */
function updateItemPrice(id, price) {
  db.prepare('UPDATE items SET current_price = ? WHERE id = ?').run(price, id);
  db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(id, price);
}

/**
 * 特定の商品の価格履歴を取得
 */
function getPriceHistory(itemId) {
  return db.prepare('SELECT * FROM price_history WHERE item_id = ? ORDER BY timestamp ASC').all(itemId);
}

/**
 * 商品を削除
 */
function deleteItem(id) {
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
}

module.exports = {
  getAllItems,
  upsertItem,
  updateItemPrice,
  getPriceHistory,
  deleteItem
};
