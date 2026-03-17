import { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, TrendingUp, RefreshCw, ExternalLink, Settings, ShieldCheck, AlertCircle } from 'lucide-react';
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
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [githubToken, setGithubToken] = useState(localStorage.getItem('gh_token') || '');
  const [showSettings, setShowSettings] = useState(!localStorage.getItem('gh_token'));

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
      const res = await axios.get('./price_history.json?t=' + Date.now());
      setHistoryData(res.data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch history data', err);
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

      setUrl('');
      alert('商品を追加しました！約30分以内に最初のデータが取得されます。');
    } catch (err: any) {
      console.error(err);
      setError(err.response?.status === 401 ? 'GitHub トークンが無効です。' : err.message);
    } finally {
      setAdding(false);
    }
  };

  const urls = Object.keys(historyData);

  return (
    <div className="container">
      <header>
        <h1>Mercari Price Tracker</h1>
        <p className="subtitle">GitHub Actions で 30分ごとに価格を自動チェック</p>
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
          {urls.map((url) => {
            const item = historyData[url];
            const currentPrice = item.history.length > 0 ? item.history[item.history.length - 1].price : 0;
            const lastUpdate = item.history.length > 0 ? new Date(item.history[item.history.length - 1].timestamp).toLocaleString() : '---';

            return (
              <div key={url} className="card item-card">
                <div className="item-header">
                  <img src={item.imageUrl} alt={item.name} className="item-image" />
                  <div className="item-info">
                    <div className="item-name">{item.name}</div>
                    <div className="item-price">¥{currentPrice.toLocaleString()}</div>
                  </div>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="delete-btn" style={{ padding: '8px' }}>
                    <ExternalLink size={18} />
                  </a>
                </div>
                
                <div className="chart-container">
                  <PriceChart data={item.history} />
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <RefreshCw size={12} /> 更新: {lastUpdate}
                  </div>
                  <div style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ShieldCheck size={14} /> 追跡中
                  </div>
                </div>
              </div>
            );
          })}

          {urls.length === 0 && (
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
