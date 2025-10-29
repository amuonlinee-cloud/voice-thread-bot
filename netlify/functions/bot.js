import 'dotenv/config';
import express from 'express';
import serverless from 'serverless-http';
import bot from '../../src/bot.js';

const app = express();
app.use(express.json());

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN missing for Netlify function');
}

// Mount Telegraf webhook callback on path /bot<TOKEN>
const path = `/bot${token}`;
app.use(path, bot.webhookCallback(path));

// Provide a simple health endpoint for the function
app.get('/.netlify/functions/bot/health', (_req, res) => res.json({ ok: true }));

export const handler = serverless(app);