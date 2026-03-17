const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const TRACKED_ITEMS_PATH = path.join(__dirname, '../client/public/tracked_items.json');
const PRICE_HISTORY_PATH = path.join(__dirname, '../client/public/price_history.json');

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

      return {
        name: title?.replace(' - メルカリ', ''),
        price: parseInt(priceStr, 10),
        imageUrl: imageUrl
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
  const trackedItems = JSON.parse(fs.readFileSync(TRACKED_ITEMS_PATH, 'utf8'));
  let priceHistory = {};
  if (fs.existsSync(PRICE_HISTORY_PATH)) {
    priceHistory = JSON.parse(fs.readFileSync(PRICE_HISTORY_PATH, 'utf8'));
  }

  const timestamp = new Date().toISOString();

  for (const item of trackedItems) {
    console.log(`Scraping: ${item.name || item.url}...`);
    const result = await scrapeMercariItem(item.url);
    
    if (result && result.price) {
      if (!priceHistory[item.url]) {
        priceHistory[item.url] = {
          name: result.name,
          imageUrl: result.imageUrl,
          history: []
        };
      }
      
      // 直近の価格と同じでなければ追加（または常に記録するかはお好み）
      const lastEntry = priceHistory[item.url].history.slice(-1)[0];
      if (!lastEntry || lastEntry.price !== result.price) {
        priceHistory[item.url].history.push({
          price: result.price,
          timestamp: timestamp
        });
        // 履歴が多くなりすぎないように制限（例：直近100件）
        if (priceHistory[item.url].history.length > 100) {
          priceHistory[item.url].history.shift();
        }
      }
      
      // 名前や画像URLを最新に更新
      priceHistory[item.url].name = result.name;
      priceHistory[item.url].imageUrl = result.imageUrl;
      
      // trackedItems の名前も更新
      item.name = result.name;
      
      console.log(`Successfully updated ${item.url}: ¥${result.price}`);
    }
    
    // Wait to avoid rate limiting
    await new Promise(r => setTimeout(r, 5000));
  }

  fs.writeFileSync(PRICE_HISTORY_PATH, JSON.stringify(priceHistory, null, 2));
  fs.writeFileSync(TRACKED_ITEMS_PATH, JSON.stringify(trackedItems, null, 2));
  console.log('Update complete.');
}

main().catch(console.error);
