// src/replyHandler.js (CommonJS)
const db = require('./database');

async function handleReplySave(ctx, parentCommentId, fileId = null, replyText = null) {
  try {
    const saved = await db.addReply(parentCommentId, ctx.from.id, ctx.from.username, ctx.from.first_name, fileId, replyText);
    if (!saved) {
      await ctx.reply('❌ Could not save reply.');
      return null;
    }
    await ctx.reply('✅ Voice reply saved.');
    return saved;
  } catch (e) {
    console.error('handleReplySave error', e);
    try { await ctx.reply('❌ Could not save reply (server error).'); } catch {}
    return null;
  }
}

module.exports = { handleReplySave };
