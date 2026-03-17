const cron = require('node-cron');
const { getAllItems, updateItemPrice } = require('./db');
const { scrapeMercariItem } = require('./scraper');

/**
 * すべての商品価格を更新する
 */
async function updateAllPrices() {
  console.log('Starting price update check...', new Date().toLocaleString());
  const items = getAllItems();
  
  for (const item of items) {
    try {
      console.log(`Checking price for: ${item.name}`);
      const scrapedData = await scrapeMercariItem(item.url);
      
      if (scrapedData.price !== item.current_price) {
        console.log(`Price change detected for ${item.name}: ${item.current_price} -> ${scrapedData.price}`);
        updateItemPrice(item.id, scrapedData.price);
        // 通知用のフラグやログをここで処理可能（今回はDB更新のみで履歴テーブルに保存される）
      }
    } catch (error) {
      console.error(`Failed to update price for ${item.url}:`, error.message);
    }
    // メルカリへの負荷を避けるため少し待機
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

// 30分ごとに実行 (*/30 * * * *)
function startScheduler() {
  cron.schedule('*/30 * * * *', () => {
    updateAllPrices();
  });
  console.log('Scheduler started: Price check every 30 minutes.');
}

module.exports = { startScheduler, updateAllPrices };
