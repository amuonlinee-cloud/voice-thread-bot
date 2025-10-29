// index.js
require('dotenv').config();
const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3000;
const LOCAL_POLLING = process.env.LOCAL_POLLING === '1' || process.env.LOCAL_POLLING === 'true';

const botModule = require('./src/bot');

(async () => {
  const bot = await botModule.initBot();

  const app = express();
  app.use(express.json());
  app.get('/', (req, res) => res.send('World Voice Comment Bot running'));

  if (LOCAL_POLLING) {
    console.log('🚀 Starting bot in LOCAL POLLING mode...');
    await bot.launch(); // default is long polling
    console.log('🚀 Bot launched (polling).');
  } else {
    // webhook mode
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) throw new Error('BASE_URL required for webhook mode (set in .env)');
    const hookPath = `/bot${token}`;
    await bot.launch({
      webhook: {
        domain: baseUrl,
        hookPath
      }
    });
    app.post(hookPath, (req, res) => res.sendStatus(200));
    console.log(`🚀 Webhook running at ${baseUrl}${hookPath}`);
  }

  app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
})();
