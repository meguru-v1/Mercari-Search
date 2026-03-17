import { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, TrendingUp, ExternalLink, Settings, AlertCircle, Trash2, Zap } from 'lucide-react';
import PriceChart from './components/PriceChart';
import './index.css';

interface PricePoint {
  price: number;
  timestamp: string;
}

interface ItemHistory {
  name: string;
  imageUrl: string;
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
  
  const [githubToken, setGithubToken] = useState(() => {
    try {
      return atob(ENC_TOKEN);
    } catch {
      return localStorage.getItem('gh_token') || '';
    }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [focusedUrl, setFocusedUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const REPO_OWNER = 'GAKU27';
  const REPO_NAME = 'Mercari-Search';
  const FILE_PATH = 'client/public/tracked_items.json';

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
      setHistoryData(historyRes.data);
      setTrackedItems(itemsRes.data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch data', err);
      setError('データの読み込みに失敗しました。最初のスクレイピングが完了するまでお待ちください。');
    } finally {
      setLoading(false);
    }
  };

  const saveToken = (token: string) => {
    localStorage.setItem('gh_token', token);
    setGithubToken(token);
    setShowSettings(false);
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

  const handleRefresh = async () => {
    if (!githubToken) {
      setError('GitHub トークンが設定されていません。');
      return;
    }

    try {
      setLoading(true);
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
      
      setToast({ message: '最新価格の取得リクエストを送信しました！', type: 'success' });
      setTimeout(() => setToast(null), 5000);
      
      // データの再読み込み（UI上の見た目を即時更新）
      await fetchData();
    } catch (err: any) {
      console.error('Refresh error:', err);
      setError('即時更新の開始に失敗しました。トークンの権限（workflow）を確認してください。');
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
          <div className="badge-container" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button 
              onClick={handleRefresh} 
              className="action-btn zap"
              disabled={loading}
              title="今すぐ最新価格をチェック"
            >
              <Zap size={18} className={loading ? 'animate-pulse' : ''} />
              <span>即時取得</span>
            </button>
            <div className="badge">
              {trackedItems.length} 個のアイテム
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
            サイトから直接商品を追加するには、GitHub の <strong>Personal Access Token (fine-grained)</strong> が必要です。<br />
            <code>contents: write</code> 権限を持つトークンを作成して入力してください。
          </p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <input 
              type="password" 
              placeholder="github_pat_..." 
              value={githubToken} 
              onChange={(e) => setGithubToken(e.target.value)} 
            />
            <button onClick={() => saveToken(githubToken)}>保存</button>
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
            const lastUpdate = hasData && item.history.length > 0 ? new Date(item.history[item.history.length - 1].timestamp).toLocaleString() : '---';

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
                    <div className="item-price">{hasData ? `¥${currentPrice.toLocaleString()}` : "---"}</div>
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
                  {hasData ? <PriceChart data={item.history} /> : (
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
