// src/paginationHandler.js (CommonJS)
const { Markup } = require('telegraf');

function makeListenKeyboard(threadId, page = 0, total = 0, comments = []) {
  const buttons = [];
  buttons.push([Markup.button.callback('🔗 View thread', `cmd_viewthread_${threadId}`)]);
  buttons.push([Markup.button.callback('🎙 Add Voice Comment', `cmd_addvoice_${threadId}`), Markup.button.callback('🎧 Listen', `cmd_listen_${threadId}_${page}`)]);
  return Markup.inlineKeyboard(buttons);
}

function makeCommentControls(commentId, threadId, page = 0, likes = 0, dislikes = 0) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`▶`, `cmd_play_${commentId}`), Markup.button.callback(`💬`, `cmd_reply_${commentId}`)],
    [Markup.button.callback(`❤️ ${likes}`, `cmd_like_${commentId}_${threadId}_${page}`), Markup.button.callback(`👎 ${dislikes}`, `cmd_dislike_${commentId}_${threadId}_${page}`)]
  ]);
}

module.exports = {
  makeListenKeyboard,
  makeCommentControls
};
