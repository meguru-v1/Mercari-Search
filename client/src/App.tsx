import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Plus, TrendingUp, RefreshCw, ExternalLink, ShieldCheck, AlertCircle, Trash2, Zap, Bell, BellOff } from 'lucide-react';
import PriceChart from './components/PriceChart';
import './index.css';

// VAPIDの公開鍵（後でGitHub/Render Secretsと統一して設定します）
const PUBLIC_VAPID_KEY = 'BIHVKGHxqhmj2cEaZgNqG67Z2v-2Nl2z_qIuFqE51_B2q0K4hV9Zp8jO-9pTq1kS9yIlyMow-jqyct9qPqzxAx8Io';

// APIプロキシのURL
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://mercari-api-moq9.onrender.com';

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

function App() {
  const [historyData, setHistoryData] = useState<HistoryData>({});
  const [trackedItems, setTrackedItems] = useState<{url: string, name: string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  
  const [focusedUrl, setFocusedUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'sync' } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastCheckTimeAtStart, setLastCheckTimeAtStart] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    return localStorage.getItem('notifications_enabled') === 'true';
  });
  const prevHistoryRef = useRef<HistoryData>({});

  // Service Worker の登録
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
        .then(() => {
          console.log('ServiceWorker registration successful');
        })
        .catch(err => {
          console.error('ServiceWorker registration failed: ', err);
        });
    }
  }, []);

  const toggleNotifications = async () => {
    if (!notificationsEnabled) {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (!registration.pushManager) {
          setToast({ message: '通知機能がサポートされていません。iPhoneの場合は「ホーム画面に追加」をしてから開いてください。', type: 'error' });
          setTimeout(() => setToast(null), 8000);
          return;
        }

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
          });
        }
        
        // 購読情報をAPI Proxyに送信
        await axios.post(`${API_BASE_URL}/api/subscribe`, subscription);
        
        setNotificationsEnabled(true);
        localStorage.setItem('notifications_enabled', 'true');
        setToast({ message: '通知をONにしました。バックグラウンドでもお知らせが届きます！', type: 'success' });
        setTimeout(() => setToast(null), 5000);
      } catch (err: any) {
        console.error('Failed to subscribe:', err);
        setToast({ message: err.message || '通知の登録に失敗しました。', type: 'error' });
        setTimeout(() => setToast(null), 5000);
      }
    } else {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration.pushManager) {
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            // 解除リクエストをAPI Proxyに送信
            await axios.post(`${API_BASE_URL}/api/unsubscribe`, { endpoint: subscription.endpoint });
            await subscription.unsubscribe();
          }
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
      // API Proxyから取得（高速）
      const [historyRes, itemsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/history`),
        axios.get(`${API_BASE_URL}/api/items`)
      ]);
      const newData = historyRes.data as HistoryData;
      
      prevHistoryRef.current = newData;
      setHistoryData(newData);
      setTrackedItems(itemsRes.data);
      setError(null);
      return newData;
    } catch (err) {
      console.error('Failed to fetch data from API Proxy', err);
      // フォールバック: パブリックなGitHubから取得（API・サーバー構築前などのため）
      try {
        const baseUrl = import.meta.env.BASE_URL;
        const [hRes, iRes] = await Promise.all([
          axios.get(`${baseUrl}price_history.json?t=${Date.now()}`),
          axios.get(`${baseUrl}tracked_items.json?t=${Date.now()}`)
        ]);
        setHistoryData(hRes.data);
        setTrackedItems(iRes.data);
        setError(null);
        return hRes.data;
      } catch(e) {
        // setError('データの読み込みに失敗しました。');
      }
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isSyncing) return;
    const pollInterval = setInterval(async () => {
      const newData = await fetchData();
      if (newData) {
        const newestCheck = Object.values(newData as HistoryData)
          .map(item => item.lastChecked)
          .filter(Boolean)
          .sort()
          .reverse()[0];
        if (newestCheck && (!lastCheckTimeAtStart || newestCheck > lastCheckTimeAtStart)) {
          setIsSyncing(false);
          setToast({ message: '最新の価格データに更新されました！', type: 'success' });
          setTimeout(() => setToast(null), 5000);
        }
      }
    }, 15000);
    const timeout = setTimeout(() => {
      if (isSyncing) {
        setIsSyncing(false);
        setToast({ message: '同期がタイムアウトしました。', type: 'error' });
        setTimeout(() => setToast(null), 5000);
      }
    }, 1000 * 60 * 5);
    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, [isSyncing, lastCheckTimeAtStart]);

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    setAdding(true);
    setError(null);

    try {
      if (trackedItems.some(item => item.url === url)) {
        throw new Error('この商品は既に登録されています。');
      }

      await axios.post(`${API_BASE_URL}/api/items`, { url });

      // ローカル更新
      setTrackedItems([...trackedItems, { url, name: "取得中..." }]);
      setUrl('');

      // 同期モード
      const newestCheck = Object.values(historyData)
        .map(item => item.lastChecked)
        .filter(Boolean)
        .sort()
        .reverse()[0] || null;
      setLastCheckTimeAtStart(newestCheck);
      setIsSyncing(true);

      // スクレイプ起動
      await axios.post(`${API_BASE_URL}/api/scrape`);
      setToast({ message: '商品を追加しました。価格取得を開始します...', type: 'sync' });
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || err.message || '追加に失敗しました。APIサーバー側でGitHub Tokenなどの設定を確認してください。');
    } finally {
      setAdding(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setLoading(true);
      const newestCheck = Object.values(historyData)
        .map(item => item.lastChecked)
        .filter(Boolean)
        .sort()
        .reverse()[0] || null;
      setLastCheckTimeAtStart(newestCheck);

      await axios.post(`${API_BASE_URL}/api/scrape`);
      setIsSyncing(true);
      setToast({ message: '取得を開始しました。完了までお待ちください...', type: 'sync' });
    } catch (err: any) {
      console.error('Refresh error:', err);
      setError(`即時更新に失敗しました: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const deleteItem = async (targetUrl: string) => {
    if (!window.confirm('この商品の追跡を停止しますか？')) return;
    setError(null);
    try {
      await axios.post(`${API_BASE_URL}/api/items/delete`, { url: targetUrl });
      setTrackedItems(trackedItems.filter(i => i.url !== targetUrl));
      alert('商品を削除しました。');
    } catch (err: any) {
      console.error(err);
      setError('削除に失敗しました。');
    }
  };

  return (
    <div className="container">
      <header>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '8px' }}>
          <div>
            <h1>Mercari Price Tracker</h1>
            <p className="subtitle" style={{ margin: 0 }}>API Proxy で誰でも利用可能！</p>
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

      <form className="add-item-form" onSubmit={addItem}>
        <input
          type="url"
          placeholder="メルカリの商品のURLを貼り付け..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={adding}
        />
        <button type="submit" disabled={adding || !url}>
          {adding ? <div className="loading-spinner"></div> : <><Plus size={20} style={{marginRight: '8px'}} />追跡を開始</>}
        </button>
      </form>

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
            
            let priceDiff = 0;
            if (hasData && item.history.length >= 2) {
              priceDiff = item.history[item.history.length - 1].price - item.history[item.history.length - 2].price;
            }
            
            const chartData = hasData ? [...item.history] : [];
            if (hasData && item.lastChecked && item.history.length > 0) {
              const lastPoint = item.history[item.history.length - 1];
              if (new Date(item.lastChecked).getTime() > new Date(lastPoint.timestamp).getTime()) {
                chartData.push({ price: lastPoint.price, timestamp: item.lastChecked });
              }
            }

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
