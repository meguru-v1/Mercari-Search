const express = require('express');
const cors = require('cors');
const { getAllItems, upsertItem, getPriceHistory, deleteItem } = require('./db');
const { scrapeMercariItem } = require('./scraper');
const { startScheduler } = require('./scheduler');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// 商品一覧の取得
app.get('/api/items', (req, res) => {
  try {
    const items = getAllItems();
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 価格履歴の取得
app.get('/api/items/:id/history', (req, res) => {
  try {
    const history = getPriceHistory(req.params.id);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 新しい商品を追加
app.post('/api/items', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URLが必要です。' });

  try {
    const data = await scrapeMercariItem(url);
    const itemId = upsertItem(url, data.name, data.price, data.imageUrl);
    res.json({ id: itemId, ...data });
  } catch (error) {
    res.status(500).json({ error: '商品の追加に失敗しました。URLを確認してください。' });
  }
});

// 商品の削除
app.delete('/api/items/:id', (req, res) => {
  try {
    deleteItem(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  startScheduler();
});
