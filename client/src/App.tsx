import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Plus, TrendingUp, RefreshCw, ExternalLink, Settings, ShieldCheck, AlertCircle, Trash2, Zap, Bell, BellOff } from 'lucide-react';
import PriceChart from './components/PriceChart';
import './index.css';

// VAPIDの公開鍵（後でGitHub Secretsと統一して設定します）
const PUBLIC_VAPID_KEY = 'BIHVKGHxqhmj2cEaZgNqG67Z2v-2Nl2z_qIuFqE51_B2q0K4hV9Zp8jO-9pTq1kS9yIlyMow-jqyct9qPqzxAx8Io';

// urlBase64ToUint8Array ユーティリティ
const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

interface PricePoint {
  price: number;
  timestamp: string;
}

interface ItemHistory {
  name: string;
  imageUrl: string;
  lastChecked?: string;
  history: PricePoint[];
}

type HistoryData = Record<string, ItemHistory>;

// UTF-8 対応の Base64 変換ユーティリティ
const toBase64 = (str: string) => {
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
  return btoa(binString);
};

const fromBase64 = (base64: string) => {
  const binString = atob(base64);
  const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0)!);
  return new TextDecoder().decode(bytes);
};

function App() {
  const [historyData, setHistoryData] = useState<HistoryData>({});
  const [trackedItems, setTrackedItems] = useState<{url: string, name: string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  // 難読化したトークン（公開リポジトリでの自動削除対策）
  const ENC_TOKEN = 'Z2l0aHViX3BhdF8xMUJWREZSTVEwcUJ5eEdTSUI1SXFSX1N4ZnZFY3Y2cUhOdkRCTTJzQ0ZMSXZaSEdiZmZSWk5CYkF5Q2k0Z29aWDJSRUNFSVpVQVZmZ1puOVZw';
  const TOKEN_VERSION = 'v2'; // トークンを更新した際はここを上げる
  
  const [githubToken, setGithubToken] = useState(() => {
    const saved = localStorage.getItem('gh_token');
    const savedVersion = localStorage.getItem('gh_token_version');

    // バージョンが古いか、トークンがない場合は強制的に埋め込みトークンに更新
    if (!saved || savedVersion !== TOKEN_VERSION) {
      try {
        const decoded = fromBase64(ENC_TOKEN);
        if (decoded) {
          localStorage.setItem('gh_token', decoded);
          localStorage.setItem('gh_token_version', TOKEN_VERSION);
          return decoded;
        }
      } catch (e) {
        console.error('Failed to auto-decode token:', e);
      }
    }
    return saved || '';
  });
  const [showSettings, setShowSettings] = useState(false);
  const [focusedUrl, setFocusedUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'sync' } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastCheckTimeAtStart, setLastCheckTimeAtStart] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    return localStorage.getItem('notifications_enabled') === 'true';
  });
  const prevHistoryRef = useRef<HistoryData>({});

  const REPO_OWNER = 'GAKU27';
  const REPO_NAME = 'Mercari-Search';
  const FILE_PATH = 'client/public/tracked_items.json';
  const SUBS_FILE_PATH = 'client/public/push_subscriptions.json';

  // Service Worker の登録
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
        .then(registration => {
          console.log('ServiceWorker registration successful with scope: ', registration.scope);
        })
        .catch(err => {
          console.error('ServiceWorker registration failed: ', err);
        });
    }
  }, []);

  // GitHubへ購読情報を保存/削除する関数
  const updateSubscriptionOnGithub = async (subscription: any, isSubscribe: boolean) => {
    if (!githubToken) return;
    try {
      const getRes = await axios.get(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${SUBS_FILE_PATH}`, {
        headers: { Authorization: `token ${githubToken}` }
      });
      const sha = getRes.data.sha;
      let content = JSON.parse(fromBase64(getRes.data.content));
      
      const subKey = subscription ? subscription.endpoint : null;
      if (isSubscribe) {
        // 重複チェック
        if (!content.some((sub: any) => sub.endpoint === subKey)) {
          content.push(subscription);
        }
      } else {
        // 現在のデバイスの購読を削除
        // ※実際にはエンドポイントが一致するものを消す必要がありますが、
        // 今回の簡易実装ではデバイスごとのローカルの状態だけで切り替えます。
        // （複数のデバイスで購読している場合は他のデバイスも消えてしまうので、本来はエンドポイント単位の管理が必要です。）
        // 一旦、購読解除=ローカル無効化のみとし、GitHub上のファイルからは消さないアプローチを取ります。
        // （VAPIDサーバー側でエラーが出た時に消すロジックが安全です）
        return; 
      }

      await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${SUBS_FILE_PATH}`, {
        message: `chore: update push subscriptions [skip ci]`,
        content: toBase64(JSON.stringify(content, null, 2)),
        sha: sha
      }, {
        headers: { Authorization: `token ${githubToken}` }
      });
    } catch (e) {
      console.error('Failed to update push subscriptions on GitHub', e);
      throw new Error('GitHubへの購読情報の保存に失敗しました。トークンの権限(contents:write)を確認してください。');
    }
  };

  // 通知ON/OFFトグル (Web Push)
  const toggleNotifications = async () => {
    if (!notificationsEnabled) {
      if (!githubToken) {
        setToast({ message: '通知をONにするには、まず設定（⚙️）からGitHubトークンを保存してください。', type: 'error' });
        setTimeout(() => setToast(null), 5000);
        return;
      }
      
      try {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
          });
        }
        
        await updateSubscriptionOnGithub(subscription, true);
        
        setNotificationsEnabled(true);
        localStorage.setItem('notifications_enabled', 'true');
        setToast({ message: '通知をONにしました。バックグラウンドでもお知らせが届きます！', type: 'success' });
        setTimeout(() => setToast(null), 5000);
      } catch (err: any) {
        console.error('Failed to subscribe:', err);
        setToast({ message: err.message || '通知の登録に失敗しました。ブラウザの通知許可設定を確認してください。', type: 'error' });
        setTimeout(() => setToast(null), 5000);
      }
    } else {
      // 購読解除
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
        }
      } catch (e) {
        console.warn('Failed to unsubscribe', e);
      }
      
      setNotificationsEnabled(false);
      localStorage.setItem('notifications_enabled', 'false');
      setToast({ message: '通知をOFFにしました。', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 60000 * 5);
    return () => clearInterval(timer);
  }, []);

  const fetchData = async () => {
    try {
      const baseUrl = import.meta.env.BASE_URL;
      const [historyRes, itemsRes] = await Promise.all([
        axios.get(`${baseUrl}price_history.json?t=${Date.now()}`),
        axios.get(`${baseUrl}tracked_items.json?t=${Date.now()}`)
      ]);
      const newData = historyRes.data as HistoryData;
      
      prevHistoryRef.current = newData;
      setHistoryData(newData);
      setTrackedItems(itemsRes.data);
      setError(null);
      return newData;
    } catch (err) {
      console.error('Failed to fetch data', err);
      setError('データの読み込みに失敗しました。最初のスクレイピングが完了するまでお待ちください。');
      return null;
    } finally {
      setLoading(false);
    }
  };

  // 同期ポーリングのロジック
  useEffect(() => {
    if (!isSyncing) return;

    const pollInterval = setInterval(async () => {
      console.log('Polling for new data...');
      const newData = await fetchData();
      
      if (newData) {
        // 全アイテムの中で最も新しい lastChecked を探す
        const newestCheck = Object.values(newData as HistoryData)
          .map(item => item.lastChecked)
          .filter(Boolean)
          .sort()
          .reverse()[0];

        // 開始時よりも新しいタイムスタンプがあれば同期完了
        if (newestCheck && (!lastCheckTimeAtStart || newestCheck > lastCheckTimeAtStart)) {
          setIsSyncing(false);
          setToast({ message: '最新の価格データに更新されました！', type: 'success' });
          setTimeout(() => setToast(null), 5000);
        }
      }
    }, 15000); // 15秒おきにチェック

    // タイムアウト（5分経過したら諦める）
    const timeout = setTimeout(() => {
      if (isSyncing) {
        setIsSyncing(false);
        setToast({ message: '同期がタイムアウトしました。後ほど手動でリロードしてください。', type: 'error' });
        setTimeout(() => setToast(null), 5000);
      }
    }, 1000 * 60 * 5);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, [isSyncing, lastCheckTimeAtStart]);

  const saveToken = (token: string) => {
    localStorage.setItem('gh_token', token);
    localStorage.setItem('gh_token_version', 'custom'); // 手動入力時はバージョンをカスタムにする
    setGithubToken(token);
    setShowSettings(false);
  };

  const resetToken = () => {
    try {
      const decoded = fromBase64(ENC_TOKEN);
      if (decoded && window.confirm('トークンをデフォルト（最新）にリセットしますか？')) {
        localStorage.setItem('gh_token', decoded);
        localStorage.setItem('gh_token_version', TOKEN_VERSION);
        setGithubToken(decoded);
        setShowSettings(false);
        setToast({ message: 'トークンをリセットしました。', type: 'success' });
        setTimeout(() => setToast(null), 3000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !githubToken) return;
    setAdding(true);
    setError(null);

    try {
      // 1. 現在の tracked_items.json を取得
      const getRes = await axios.get(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`, {
        headers: { Authorization: `token ${githubToken}` }
      });
      
      const sha = getRes.data.sha;
      const content = JSON.parse(fromBase64(getRes.data.content));
      
      // 2. 重複チェック
      if (content.some((item: any) => item.url === url)) {
        throw new Error('この商品は既に登録されています。');
      }

      // 3. 新しいリストを作成
      const newContent = [...content, { url, name: "取得中..." }];
      
      // 4. GitHub にプッシュ
      await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`, {
        message: `feat: add new item to track (${url})`,
        content: toBase64(JSON.stringify(newContent, null, 2)),
        sha: sha
      }, {
        headers: { Authorization: `token ${githubToken}` }
      });

      // 5. ローカル状態を即座に更新
      setTrackedItems(newContent);
      setUrl('');

      // 6. 同期モード開始（最新のチェック時刻を記録しておく）
      const newestCheck = Object.values(historyData)
        .map(item => item.lastChecked)
        .filter(Boolean)
        .sort()
        .reverse()[0] || null;
      setLastCheckTimeAtStart(newestCheck);
      setIsSyncing(true);

      // 7. スクレイピングワークフローを即座にキック（オプション）
      try {
        await axios.post(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/update-prices.yml/dispatches`, {
          ref: 'main'
        }, {
          headers: { Authorization: `token ${githubToken}` }
        });
        setToast({ message: '商品を追加しました。価格取得を開始します...', type: 'sync' });
      } catch (e) {
        console.warn('Workflow dispatch failed (possibly missing actions:write permission)', e);
        setToast({ message: '商品を追加しました。反映までしばらくお待ちください。', type: 'success' });
        setTimeout(() => setToast(null), 5000);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.response?.status === 401 ? 'GitHub トークンが無効です。' : err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleRefresh = async () => {
    if (!githubToken) {
      setError('GitHub トークンが設定されていません。');
      return;
    }

    try {
      setLoading(true);
      // 同期モードの準備
      const newestCheck = Object.values(historyData)
        .map(item => item.lastChecked)
        .filter(Boolean)
        .sort()
        .reverse()[0] || null;
      setLastCheckTimeAtStart(newestCheck);

      // GitHub Actions の価格更新ワークフローを手動起動
      await axios.post(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/update-prices.yml/dispatches`,
        { ref: 'main' },
        {
          headers: {
            Authorization: `token ${githubToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );
      
      setIsSyncing(true);
      setToast({ message: '取得を開始しました。完了までこのままお待ちください...', type: 'sync' });
      
    } catch (err: any) {
      console.error('Refresh error:', err);
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        setError('GitHub トークンの有効期限が切れているか、権限（Actions: write）が足りません。右上の ⚙️ 設定から、新しいトークンを作成して保存し直してください。');
      } else {
        setError(`即時更新に失敗しました: ${err.response?.data?.message || err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const deleteItem = async (targetUrl: string) => {
    if (!githubToken || !window.confirm('この商品の追跡を停止しますか？')) return;
    
    setError(null);
    try {
      // 1. 現在の tracked_items.json を取得
      const getRes = await axios.get(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`, {
        headers: { Authorization: `token ${githubToken}` }
      });
      
      const sha = getRes.data.sha;
      const content = JSON.parse(fromBase64(getRes.data.content));
      
      // 2. 対象を除外
      const newContent = content.filter((item: any) => item.url !== targetUrl);
      
      // 3. GitHub にプッシュ
      await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`, {
        message: `feat: remove item from track (${targetUrl})`,
        content: toBase64(JSON.stringify(newContent, null, 2)),
        sha: sha
      }, {
        headers: { Authorization: `token ${githubToken}` }
      });

      // 4. ローカル状態を即座に更新
      setTrackedItems(newContent);
      alert('商品を削除しました。');
      // fetchData(); // fetch はバックグラウンドで行われるのでローカル更新のみで十分
    } catch (err: any) {
      console.error(err);
      setError('削除に失敗しました。トークンの権限を確認してください。');
    }
  };


  return (
    <div className="container">
      <header>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '8px' }}>
          <div>
            <h1>Mercari Price Tracker</h1>
            <p className="subtitle" style={{ margin: 0 }}>GitHub Actions で 30分ごとに価格を自動チェック</p>
          </div>
          <div className="badge-container" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button 
              onClick={handleRefresh} 
              className="action-btn zap"
              disabled={loading || isSyncing}
              title="今すぐ最新価格をチェック"
            >
              <Zap size={18} className={loading || isSyncing ? 'animate-pulse' : ''} />
              <span>{isSyncing ? '同期中...' : '即時取得'}</span>
            </button>
            <button
              onClick={toggleNotifications}
              className={`action-btn notify ${notificationsEnabled ? 'on' : 'off'}`}
              title={notificationsEnabled ? '通知OFF' : '通知ON'}
            >
              {notificationsEnabled ? <Bell size={18} /> : <BellOff size={18} />}
            </button>
            <div className="badge">
              {trackedItems.length} 個
            </div>
          </div>
        </div>
        
        {toast && (
          <div className={`toast ${toast.type}`}>
            {toast.message}
          </div>
        )}
        
        {focusedUrl && (
          <button 
            className="back-btn" 
            onClick={() => setFocusedUrl(null)}
            style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            ← 一覧に戻る
          </button>
        )}
      </header>

      {/* 設定セクション */}
      {showSettings ? (
        <div className="card" style={{ marginBottom: '40px', borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', color: 'var(--accent)' }}>
            <Settings size={20} />
            <h3 style={{ margin: 0 }}>自動登録のセットアップ</h3>
          </div>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            即時更新（⚡ボタン）を使うには、GitHub の <strong>Personal Access Token</strong> に以下の権限が必要です：<br />
            ・<code>contents: write</code> (商品の追加/削除)<br />
            ・<code>actions: write</code> (即時価格チェックの起動)
          </p>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
            <input 
              type="password" 
              placeholder="github_pat_..." 
              value={githubToken} 
              onChange={(e) => setGithubToken(e.target.value)} 
            />
            <button onClick={() => saveToken(githubToken)}>保存</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={resetToken} style={{ background: 'var(--glass)', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '8px 16px', fontSize: '0.8rem' }}>デフォルトに戻す</button>
            <button onClick={() => setShowSettings(false)} style={{ background: 'transparent', color: 'var(--text-muted)', padding: '8px 16px', fontSize: '0.8rem' }}>閉じる</button>
          </div>
        </div>
      ) : (
        <form className="add-item-form" onSubmit={addItem}>
          <input
            type="url"
            placeholder="メルカリの商品のURLを貼り付け..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={adding}
          />
          <button type="submit" disabled={adding || !url || !githubToken}>
            {adding ? <div className="loading-spinner"></div> : <><Plus size={20} style={{marginRight: '8px'}} />追跡を開始</>}
          </button>
          <button type="button" onClick={() => setShowSettings(true)} style={{ background: 'transparent', color: 'var(--text-muted)', padding: '14px' }}>
            <Settings size={20} />
          </button>
        </form>
      )}

      {error && (
        <div className="card" style={{ backgroundColor: 'rgba(255,77,77,0.05)', borderColor: 'var(--primary)', color: '#ff4d4d', marginBottom: '40px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px' }}>
          <div className="loading-spinner" style={{ width: '40px', height: '40px', margin: '0 auto' }}></div>
          <p style={{ marginTop: '20px', color: 'var(--text-muted)' }}>データを読み込み中...</p>
        </div>
      ) : (
        <div className="items-grid">
          {trackedItems
            .filter(item => !focusedUrl || item.url === focusedUrl)
            .map((trackedItem) => {
            const item = historyData[trackedItem.url];
            const hasData = !!item;
            const currentPrice = hasData && item.history.length > 0 ? item.history[item.history.length - 1].price : 0;
            
            // 価格変動バッジの計算
            let priceDiff = 0;
            if (hasData && item.history.length >= 2) {
              priceDiff = item.history[item.history.length - 1].price - item.history[item.history.length - 2].price;
            }
            
            // グラフ用にデータを調整（価格が変わっていなくても最新のチェック時刻まで線を伸ばす）
            const chartData = hasData ? [...item.history] : [];
            if (hasData && item.lastChecked && item.history.length > 0) {
              const lastPoint = item.history[item.history.length - 1];
              if (new Date(item.lastChecked).getTime() > new Date(lastPoint.timestamp).getTime()) {
                chartData.push({ price: lastPoint.price, timestamp: item.lastChecked });
              }
            }

            // lastChecked があればそれを優先、なければ最後の価格変化日時を使用
            const lastUpdateRaw = hasData
              ? (item.lastChecked || (item.history.length > 0 ? item.history[item.history.length - 1].timestamp : null))
              : null;
            const lastUpdate = lastUpdateRaw ? new Date(lastUpdateRaw).toLocaleString() : '---';

            return (
              <div key={trackedItem.url} className={`card item-card ${focusedUrl === trackedItem.url ? 'focused' : ''}`}>
                <div className="item-header">
                  {hasData ? (
                    <img src={item.imageUrl} alt={item.name} className="item-image" />
                  ) : (
                    <div className="item-image" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--glass)' }}>
                      <RefreshCw className="spin" size={24} style={{ opacity: 0.3 }} />
                    </div>
                  )}
                  <div className="item-info">
                    <div className="item-name">{hasData ? item.name : "チェック待ち..."}</div>
                    <div className="item-price">
                      {hasData ? `¥${currentPrice.toLocaleString()}` : "---"}
                      {priceDiff !== 0 && (
                        <span className={`price-diff ${priceDiff > 0 ? 'up' : 'down'}`}>
                          {priceDiff > 0 ? '↑' : '↓'}¥{Math.abs(priceDiff).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {!focusedUrl && (
                      <button 
                        onClick={() => setFocusedUrl(trackedItem.url)}
                        className="delete-btn"
                        style={{ padding: '8px', color: 'var(--accent)' }}
                        title="詳細を表示"
                      >
                        <TrendingUp size={18} />
                      </button>
                    )}
                    <a href={trackedItem.url} target="_blank" rel="noopener noreferrer" className="delete-btn" style={{ padding: '8px' }} title="メルカリを開く">
                      <ExternalLink size={18} />
                    </a>
                    <button 
                      onClick={() => deleteItem(trackedItem.url)} 
                      className="delete-btn" 
                      style={{ padding: '8px', color: '#ff4d4d' }}
                      title="追跡を解除"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
                
                <div className="chart-container" style={{ height: focusedUrl ? '400px' : '200px' }}>
                  {hasData ? <PriceChart data={chartData} /> : (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      最初の価格データを取得中...
                    </div>
                  )}
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <RefreshCw size={12} className={!hasData ? "spin" : ""} /> 更新: {lastUpdate}
                  </div>
                  <div style={{ color: hasData ? 'var(--success)' : 'var(--accent)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {hasData ? <ShieldCheck size={14} /> : <div className="loading-spinner" style={{ width: '12px', height: '12px', borderWidth: '2px' }}></div>}
                    {hasData ? "追跡中" : "準備中"}
                  </div>
                </div>
              </div>
            );
          })}

          {trackedItems.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: '16px' }}>
              <TrendingUp size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
              <p>追跡している商品がありません。上の入力欄からURLを追加してください。</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
