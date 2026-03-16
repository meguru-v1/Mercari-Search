import { useState, useEffect } from 'react';
import axios from 'axios';
import { Trash2, TrendingUp, RefreshCw, ExternalLink, Info } from 'lucide-react';
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

function App() {
  const [historyData, setHistoryData] = useState<HistoryData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 60000 * 5); // 5分ごとにチェック
    return () => clearInterval(timer);
  }, []);

  const fetchData = async () => {
    try {
      // GitHub Pages では同じオリジンの JSON を取得
      const res = await axios.get('./price_history.json?t=' + Date.now());
      setHistoryData(res.data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch history data', err);
      setError('データの読み込みに失敗しました。まだデータが生成されていない可能性があります。');
    } finally {
      setLoading(false);
    }
  };

  const urls = Object.keys(historyData);

  return (
    <div className="container">
      <header>
        <h1>Mercari Price Tracker</h1>
        <p className="subtitle">GitHub Actions で 30分ごとに価格を自動チェック中</p>
      </header>

      <div className="info-banner card" style={{ marginBottom: '40px', display: 'flex', alignItems: 'center', gap: '16px', background: 'rgba(0, 212, 255, 0.05)', borderColor: 'var(--accent)' }}>
        <Info color="var(--accent)" size={24} />
        <div style={{ fontSize: '0.9rem' }}>
          <strong>新しい商品を追加するには：</strong> 
          リポジトリの <code>client/public/tracked_items.json</code> にURLを追加してください。GitHub Actions が自動的に追跡を開始します。
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '100px' }}>
          <div className="loading-spinner" style={{ width: '40px', height: '40px', margin: '0 auto' }}></div>
          <p style={{ marginTop: '20px', color: 'var(--text-muted)' }}>データを読み込み中...</p>
        </div>
      )}

      {error && (
        <div className="card" style={{ textAlign: 'center', padding: '40px', borderColor: 'var(--primary)' }}>
          <p style={{ color: 'var(--primary)' }}>{error}</p>
          <button onClick={fetchData} style={{ marginTop: '20px' }}>再試行</button>
        </div>
      )}

      {!loading && !error && (
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
                    <RefreshCw size={12} /> 最終更新: {lastUpdate}
                  </div>
                  <div style={{ color: 'var(--success)', fontWeight: 'bold' }}>
                    追跡中
                  </div>
                </div>
              </div>
            );
          })}

          {urls.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: '16px' }}>
              <TrendingUp size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
              <p>追跡している商品がありません。リポジトリのJSONを更新してください。</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
