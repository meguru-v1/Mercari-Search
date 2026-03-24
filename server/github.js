const axios = require('axios');
require('dotenv').config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER || 'meguru-v1';
const REPO_NAME = process.env.REPO_NAME || 'Mercari-Search';

if (!GITHUB_TOKEN) {
  console.warn('WARN: GITHUB_TOKEN environment variable is missing.');
}

const toBase64 = str => Buffer.from(str).toString('base64');
const fromBase64 = base64 => Buffer.from(base64.replace(/[\n\r\s]/g, ''), 'base64').toString('utf8');

const getAuthHeaders = () => ({
  'Authorization': `token ${GITHUB_TOKEN}`,
  'Accept': 'application/vnd.github.v3+json'
});

// 直列化してGitHub上でコンフリクト（409 Error）が起きるのを防ぐためのキュー
let writeMutex = Promise.resolve();
function enqueueWrite(operation) {
  writeMutex = writeMutex.then(() => operation()).catch(err => {
    console.error('Write operation failed:', err);
    throw err;
  });
  return writeMutex;
}

async function getFileContent(filePath) {
  try {
    // キャッシュを防ぐために現在時刻のパラメータと no-cache ヘッダーを追加
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}?ref=main&t=${Date.now()}`;
    const headers = { ...getAuthHeaders(), 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' };
    const res = await axios.get(url, { headers });
    return {
      content: JSON.parse(fromBase64(res.data.content)),
      sha: res.data.sha
    };
  } catch (e) {
    if (e.response && e.response.status === 404) {
      return { content: [], sha: null };
    }
    throw e;
  }
}

async function updateFileContent(filePath, contentObj, sha, message) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
  await axios.put(url, {
    message,
    content: toBase64(JSON.stringify(contentObj, null, 2)),
    sha
  }, { headers: getAuthHeaders() });
}

// --- 公開API ---

async function getTrackedItems(userId) {
  const result = await getFileContent('client/public/tracked_items.json');
  const items = result.content || [];
  
  if (!userId) return items;
  
  // ユーザーIDが指定されている場合はフィルタリング（古いフォーマットの場合は全員に見せるか、空のusersにする）
  return items.filter(item => {
    if (!item.users) return true; // 古い互換性のため、usersがないアイテムは共有とする（新規は必ずusersが付く）
    return item.users.includes(userId);
  });
}

async function getPriceHistory() {
  const result = await getFileContent('client/public/price_history.json');
  return result.content || {};
}

async function addTrackedItem(url, userId) {
  return enqueueWrite(async () => {
    const { content: items, sha } = await getFileContent('client/public/tracked_items.json');
    
    let existingItem = items.find(item => item.url === url);
    if (existingItem) {
      if (!existingItem.users) existingItem.users = [];
      if (!existingItem.users.includes(userId)) {
        existingItem.users.push(userId);
        await updateFileContent('client/public/tracked_items.json', items, sha, `feat: add user ${userId || 'anonymous'} to tracked item via API proxy`);
        return { success: true };
      }
      return { success: true, message: '既に追跡中です' };
    }
    
    items.push({ url, name: '', users: userId ? [userId] : [] });
    await updateFileContent('client/public/tracked_items.json', items, sha, 'feat: add tracked item via API proxy');
    return { success: true };
  });
}

async function deleteTrackedItem(url, userId) {
  return enqueueWrite(async () => {
    const { content: items, sha } = await getFileContent('client/public/tracked_items.json');
    
    let isChanged = false;
    const newItems = items.filter(item => {
      if (item.url === url) {
        if (item.users && userId) {
          item.users = item.users.filter(u => u !== userId);
          isChanged = true;
          // まだ他のユーザーが追跡しているなら残す
          if (item.users.length > 0) return true;
        }
        // usersが空になった、あるいは元々users管理されてないアイテムは完全に削除
        isChanged = true;
        return false;
      }
      return true;
    });

    if (isChanged) {
      await updateFileContent('client/public/tracked_items.json', newItems, sha, 'feat: remove tracked item via API proxy');
    }
    return { success: true };
  });
}

async function addPushSubscription(subscription) {
  return enqueueWrite(async () => {
    const { content: subs, sha } = await getFileContent('client/public/push_subscriptions.json');
    // エンドポイントが同じなら、userIdなどで更新する
    const existingIndex = subs.findIndex(sub => sub.endpoint === subscription.endpoint);
    if (existingIndex >= 0) {
      subs[existingIndex] = subscription;
      await updateFileContent('client/public/push_subscriptions.json', subs, sha, 'feat: update push subscription via API proxy');
    } else {
      subs.push(subscription);
      await updateFileContent('client/public/push_subscriptions.json', subs, sha, 'feat: add push subscription via API proxy');
    }
    return { success: true };
  });
}

async function removePushSubscription(endpoint) {
  return enqueueWrite(async () => {
    const { content: subs, sha } = await getFileContent('client/public/push_subscriptions.json');
    const newSubs = subs.filter(sub => sub.endpoint !== endpoint);
    if (newSubs.length !== subs.length) {
      await updateFileContent('client/public/push_subscriptions.json', newSubs, sha, 'feat: remove push subscription via API proxy');
    }
    return { success: true };
  });
}

async function triggerWorkflow() {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/update-prices.yml/dispatches`;
  await axios.post(url, { ref: 'main' }, { headers: getAuthHeaders() });
}

module.exports = {
  getTrackedItems,
  getPriceHistory,
  addTrackedItem,
  deleteTrackedItem,
  addPushSubscription,
  removePushSubscription,
  triggerWorkflow
};
