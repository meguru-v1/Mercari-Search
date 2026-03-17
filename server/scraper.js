const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

/**
 * メルカリの商品ページから情報を抽出
 */
async function scrapeMercariItem(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // User-Agentを設定（一応）
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // 価格、名前、画像URLを抽出
    const data = await page.evaluate(() => {
      // メタタグから情報を取得するのが確実
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

    if (!data.price) {
      throw new Error('価格の取得に失敗しました。');
    }

    return data;
  } catch (error) {
    console.error(`Scraping error for ${url}:`, error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeMercariItem };
