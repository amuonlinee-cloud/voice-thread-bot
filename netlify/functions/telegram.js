// netlify/functions/telegram.js
// Minimal test Netlify function for Telegram webhook
// Accepts POST from Telegram only when ?token=NETLIFY_WEBHOOK_SECRET matches env.

exports.handler = async function (event, context) {
  const secret = process.env.NETLIFY_WEBHOOK_SECRET || '';
  const gotToken = (event.queryStringParameters && event.queryStringParameters.token) || '';

  // quick auth check (return 404 to make token guessing harder)
  if (!secret || gotToken !== secret) {
    return {
      statusCode: 404,
      body: 'Not found'
    };
  }

  // parse body (Telegram sends JSON)
  let body;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (err) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Log the update for debugging (Netlify logs)
  console.log('Telegram webhook received update:', JSON.stringify(body).slice(0, 8000));

  // Quick automated reply for testing — return 200 OK so Telegram sees successful delivery
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, message: 'Webhook received' })
  };
};
