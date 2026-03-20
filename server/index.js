const express = require('express');
const cors = require('cors');
const github = require('./github');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors({
  origin: '*', // どこからでもアクセス可能に
  methods: ['GET', 'POST', 'DELETE']
}));
app.use(express.json());

// ヘルスチェック
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Mercari Tracker API Proxy' });
});

// 現在追跡中のアイテムと価格履歴を一緒に返す（フロント側で扱いやすいため）
// ※実際は履歴の中から抽出する
app.get('/api/history', async (req, res) => {
  try {
    const history = await github.getPriceHistory();
    res.json(history);
  } catch (error) {
    console.error('Error fetching history:', error.message);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

app.get('/api/items', async (req, res) => {
  const userId = req.query.userId || req.headers['x-user-id'];
  try {
    const items = await github.getTrackedItems(userId);
    res.json(items);
  } catch (error) {
    console.error('Error fetching items:', error.message);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// 新しい商品を追加（GitHubに保存）
app.post('/api/items', async (req, res) => {
  const { url, userId } = req.body;
  const uid = userId || req.headers['x-user-id'];
  if (!url) return res.status(400).json({ error: 'URLが必要です。' });

  try {
    const result = await github.addTrackedItem(url, uid);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: result.message });
    }
  } catch (error) {
    console.error('Error adding item:', error.message);
    res.status(500).json({ error: '商品の追加に失敗しました。' });
  }
});

// 商品の削除（GitHubから削除）
app.post('/api/items/delete', async (req, res) => {
  // DELETEメソッドだとボディが送りにくい場合があるためPOSTでもURL削除を許容
  const { url, userId } = req.body;
  const uid = userId || req.headers['x-user-id'];
  if (!url) return res.status(400).json({ error: 'URLが必要です。' });

  try {
    await github.deleteTrackedItem(url, uid);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting item:', error.message);
    res.status(500).json({ error: '商品の削除に失敗しました。' });
  }
});

// 即時取得ワークフローをトリガー
app.post('/api/scrape', async (req, res) => {
  try {
    await github.triggerWorkflow();
    res.json({ success: true });
  } catch (error) {
    console.error('Error triggering scrape:', error.message);
    res.status(500).json({ error: 'ワークフローの起動に失敗しました。' });
  }
});

// PWA Notificationの登録
app.post('/api/subscribe', async (req, res) => {
  const subscription = req.body;
  // userIdはサブスクリプションオブジェクトに持たせる
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }

  try {
    await github.addPushSubscription(subscription);
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding subscription:', error.message);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// PWA Notificationの解除
app.post('/api/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: 'Invalid endpoint' });
  }

  try {
    await github.removePushSubscription(endpoint);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing subscription:', error.message);
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

app.listen(port, () => {
  console.log(`API Proxy Server running at port ${port}`);
});
