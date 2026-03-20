const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

puppeteer.use(StealthPlugin());

const TRACKED_ITEMS_PATH = path.join(__dirname, '../client/public/tracked_items.json');
const PRICE_HISTORY_PATH = path.join(__dirname, '../client/public/price_history.json');
const PUSH_SUBS_PATH = path.join(__dirname, '../client/public/push_subscriptions.json');

// Web Push 設定 (GitHub Secrets から環境変数として渡される)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_EMAIL) {
  try {
    webpush.setVapidDetails(
      process.env.VAPID_EMAIL,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  } catch (error) {
    console.error('VAPID Configuration Error:', error.message);
    // VAPIDキーが無効な場合は undefined に戻してWeb Pushを無効化する
    delete process.env.VAPID_PUBLIC_KEY;
  }
} else {
  console.warn('VAPID keys not fully set in environment variables. Web Push is deactivated.');
}

async function sendPushNotifications(title, body) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  
  let subs = [];
  if (fs.existsSync(PUSH_SUBS_PATH)) {
    try {
      subs = JSON.parse(fs.readFileSync(PUSH_SUBS_PATH, 'utf8'));
    } catch (e) {
      console.error('Failed to read push subscriptions', e);
    }
  }

  const payload = JSON.stringify({
    title,
    body,
    url: 'https://gaku27.github.io/Mercari-Search/'
  });

  const promises = subs.map(sub => 
    webpush.sendNotification(sub, payload).catch(err => {
      console.error('Failed to notify a subscriber:', err.statusCode);
      // TODO: 必要に応じて 410 Gone 等のエラーで無効な購読を削除する処理を追加
    })
  );

  await Promise.allSettled(promises);
}

async function scrapeMercariItem(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    const data = await page.evaluate(() => {
      const getMeta = (property) => {
        const element = document.querySelector(`meta[property="${property}"]`) || 
                        document.querySelector(`meta[name="${property}"]`);
        return element ? element.getAttribute('content') : null;
      };

      const title = getMeta('og:title') || document.querySelector('h1')?.innerText;
      const priceStr = getMeta('product:price:amount') || 
                       document.querySelector('[data-testid="price"]')?.innerText?.replace(/[^0-9]/g, '') ||
                       document.querySelector('span[class*="price"]')?.innerText?.replace(/[^0-9]/g, '');
      const imageUrl = getMeta('og:image');

      const bodyText = document.body.innerText || '';
      const isDeleted = bodyText.includes('この商品は削除されました') || 
                        bodyText.includes('ページが見つかりません') ||
                        document.title.includes('エラー');

      return {
        name: title ? title.replace(' - メルカリ', '') : null,
        price: parseInt(priceStr, 10),
        imageUrl: imageUrl,
        isDeleted: isDeleted
      };
    });

    return data;
  } catch (error) {
    console.error(`Error scraping ${url}:`, error.message);
    // デバッグのため、失敗時のHTML構造を少しだけ出力する
    try {
      const htmlSnippet = await page.evaluate(() => document.body.innerText.substring(0, 200));
      console.log(`Page content snippet: ${htmlSnippet}`);
    } catch (e) {}
    return null;
  } finally {
    await browser.close();
  }
}

async function main() {
  let trackedItems = JSON.parse(fs.readFileSync(TRACKED_ITEMS_PATH, 'utf8'));
  let priceHistory = {};
  if (fs.existsSync(PRICE_HISTORY_PATH)) {
    priceHistory = JSON.parse(fs.readFileSync(PRICE_HISTORY_PATH, 'utf8'));
  }

  const timestamp = new Date().toISOString();
  let itemsToKeep = [];

  for (const item of trackedItems) {
    console.log(`Scraping: ${item.name || item.url}...`);
    const result = await scrapeMercariItem(item.url);
    
    // 削除済み判定
    if (result && result.isDeleted) {
      const displayName = result.name || item.name || '商品';
      console.log(`Item deleted: ${displayName}`);
      await sendPushNotifications(`❌ 削除済み: ${displayName}`, `この商品はメルカリから削除されたため、追跡を自動停止しました。`);
      
      // priceHistoryからも削除
      if (priceHistory[item.url]) {
        delete priceHistory[item.url];
      }
      continue; // itemsToKeepに追加しないことで自動リストラ
    }

    if (result && !isNaN(result.price)) {
      if (!priceHistory[item.url]) {
        priceHistory[item.url] = {
          name: result.name,
          imageUrl: result.imageUrl,
          lastChecked: timestamp,
          history: []
        };
      }
      
      // 価格が変化した場合のみ履歴に追記（重複排除）
      const lastEntry = priceHistory[item.url].history.slice(-1)[0];
      if (!lastEntry || lastEntry.price !== result.price) {
        priceHistory[item.url].history.push({
          price: result.price,
          timestamp: timestamp
        });
        
        // Push通知を送信する（初回以外）
        if (lastEntry) {
          const diff = result.price - lastEntry.price;
          const arrow = diff > 0 ? '↑' : '↓';
          const sign = diff > 0 ? '+' : '';
          const title = `${arrow} ${result.name}`;
          const body = `¥${lastEntry.price.toLocaleString()} → ¥${result.price.toLocaleString()} (${sign}¥${diff.toLocaleString()})`;
          await sendPushNotifications(title, body);
          console.log(`Push sent: ${title} / ${body}`);
        }

        // 履歴が多くなりすぎないように制限（直近100件）
        if (priceHistory[item.url].history.length > 100) {
          priceHistory[item.url].history.shift();
        }
      }
      
      // 名前・画像・最終チェック日時を毎回更新（価格変化がなくても更新される）
      priceHistory[item.url].name = result.name;
      priceHistory[item.url].imageUrl = result.imageUrl;
      priceHistory[item.url].lastChecked = timestamp;
      
      // trackedItems の名前も更新
      item.name = result.name;
      
      console.log(`Successfully updated ${item.url}: ¥${result.price}`);
    }
    
    // エラーで取れなかった場合(一時的)や、正常に更新できた場合はキープ
    itemsToKeep.push(item);

    // レート制限対策
    await new Promise(r => setTimeout(r, 5000));
  }

  // 削除済みアイテムを除外した新しいリストを保存
  fs.writeFileSync(PRICE_HISTORY_PATH, JSON.stringify(priceHistory, null, 2));
  fs.writeFileSync(TRACKED_ITEMS_PATH, JSON.stringify(itemsToKeep, null, 2));
  console.log('Update complete.');
}

main().catch(console.error);
