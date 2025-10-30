// index.js — webhook-friendly, single-server approach
require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_URL = process.env.BASE_URL; // e.g. https://voice-thread-bot-6.onrender.com
const LOCAL_POLLING = process.env.LOCAL_POLLING === '1';

if (!BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in env');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = `/bot${BOT_TOKEN}`; // exact path used when registering webhook
const WEBHOOK_URL = (BASE_URL ? `${BASE_URL}${WEBHOOK_PATH}` : null);

const bot = new Telegraf(BOT_TOKEN);

// IMPORTANT: Do NOT call bot.launch({ webhook: ... }) when using this express approach.
// We'll set webhook via Telegram API and let express route receive updates.

const app = express();
app.use(express.json({ limit: '1mb' })); // accept JSON body from Telegram

// Basic health route
app.get('/', (req, res) => res.send('World Voice Comment Bot (webhook mode)'));

// Webhook route for Telegram
app.post(WEBHOOK_PATH, (req, res) => {
  // Immediately acknowledge Telegram to avoid timeouts (must be fast)
  res.sendStatus(200);

  // Then let Telegraf process update (asynchronously)
  (async () => {
    try {
      await bot.handleUpdate(req.body);
    } catch (err) {
      console.error('Error processing update:', err);
    }
  })();
});

// Start Express server
app.listen(PORT, async () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  if (LOCAL_POLLING) {
    // Polling mode: start the bot using polling (for local tests only)
    console.log('🚀 Starting bot in LOCAL POLLING mode...');
    await bot.launch({ polling: true });
  } else {
    // Webhook mode: register webhook URL with Telegram
    if (!BASE_URL) {
      console.error('BASE_URL is required for webhook mode. Set BASE_URL env var (https://...)');
      process.exit(1);
    }
    try {
      console.log(`🚀 Setting webhook to ${WEBHOOK_URL}`);
      await bot.telegram.setWebhook(WEBHOOK_URL);
      console.log(`🚀 Webhook set at ${WEBHOOK_URL}`);
      // Do NOT call bot.launch() here — express will deliver updates via handleUpdate
    } catch (err) {
      console.error('Failed to set webhook:', err);
      process.exit(1);
    }
  }
});

// Graceful stop handlers
process.once('SIGINT', () => {
  console.log('SIGINT — stopping');
  bot.stop('SIGINT');
  process.exit(0);
});
process.once('SIGTERM', () => {
  console.log('SIGTERM — stopping');
  bot.stop('SIGTERM');
  process.exit(0);
});
