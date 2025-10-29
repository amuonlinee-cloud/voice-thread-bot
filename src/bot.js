// src/bot.js
const { Telegraf, Markup } = require('telegraf');
const db = require('./database');
const { encodeShortCode, decodeShortCode, extractFirstUrl, isSupportedLink } = require('./utils');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN in .env');

const MY_PAGE_SIZE = 4;
const LISTEN_PAGE_SIZE = parseInt(process.env.LISTEN_PAGE_SIZE || '15', 10);
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean).map(Number);
const isAdmin = id => ADMIN_IDS.includes(Number(id));

async function initBot() {
  const bot = new Telegraf(BOT_TOKEN);
  const pending = new Map();

  function mainKeyboard() {
    return Markup.keyboard([
      ['🎥 Add Comment', '➕ Add My Video'],
      ['🔖 Track Video', '🎧 Listen Comments'],
      ['💬 My Comments', '🔎 Search'],
      ['⭐ Favorites', '🔔 Notifications']
    ]).resize();
  }

  async function getReactionCounts(commentId) {
    try {
      const types = ['heart', 'laugh', 'dislike'];
      const out = {};
      for (const t of types) {
        const res = await db.supabase.from('voice_reactions').select('id', { head: true, count: 'exact' }).eq('comment_id', commentId).eq('type', t);
        out[t] = (res && res.count) ? res.count : 0;
      }
      return out;
    } catch (e) {
      console.error('getReactionCounts', e);
      return { heart: 0, laugh: 0, dislike: 0 };
    }
  }

  async function getReactionCountsForReply(replyId) {
    try {
      const types = ['heart', 'laugh', 'dislike'];
      const out = {};
      for (const t of types) {
        const res = await db.supabase.from('reply_reactions').select('id', { head: true, count: 'exact' }).eq('reply_id', replyId).eq('type', t);
        out[t] = (res && res.count) ? res.count : 0;
      }
      return out;
    } catch (e) {
      console.error('getReactionCountsForReply', e);
      return { heart: 0, laugh: 0, dislike: 0 };
    }
  }

  async function buildActionsKeyboard(commentId, userId) {
    const counts = await getReactionCounts(commentId);
    const fav = await db.isFavorite(userId, commentId);
    const starLabel = fav ? '★ Favorite' : '☆ Favorite';
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(`❤️ ${counts.heart}`, `react_${commentId}_heart`),
        Markup.button.callback(`😂 ${counts.laugh}`, `react_${commentId}_laugh`),
        Markup.button.callback(`👎 ${counts.dislike}`, `react_${commentId}_dislike`)
      ],
      [
        Markup.button.callback(starLabel, `fav_${commentId}`),
        Markup.button.callback('▶️ Show replies', `show_replies_${commentId}`),
        Markup.button.callback('💬 Reply', `replymenu_${commentId}`)
      ],
      [
        Markup.button.callback('🚩 Report', `report_${commentId}`),
        Markup.button.callback('🔗 Share code', `share_comment_${commentId}`),
        Markup.button.callback('🗑 Delete', `delete_comment_${commentId}`)
      ]
    ]);
  }

  async function buildReplyActionsKeyboard(replyId, commentId, userId) {
    const counts = await getReactionCountsForReply(replyId);
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('▶️ Play', `play_reply_${replyId}`),
        Markup.button.callback(`❤️ ${counts.heart}`, `react_reply_${replyId}_heart`),
        Markup.button.callback(`😂 ${counts.laugh}`, `react_reply_${replyId}_laugh`),
        Markup.button.callback(`👎 ${counts.dislike}`, `react_reply_${replyId}_dislike`)
      ],
      [
        Markup.button.callback('🚩 Report', `report_reply_${replyId}`),
        Markup.button.callback('🔗 Share code', `share_reply_${replyId}`),
        Markup.button.callback('↩️ Reply to reply', `replymenu_${commentId}`)
      ]
    ]);
  }

  // ---------- start ----------
  bot.start(async (ctx) => {
    try {
      await db.ensureUserRow(ctx.from);
      const { data: user } = await db.supabase.from('users').select('*').eq('telegram_id', ctx.from.id).limit(1).maybeSingle();
      const name = ctx.from.first_name || ctx.from.username || 'there';
      if (user) {
        await ctx.reply(`Hi ${name} — welcome back!\nFree comments: ${user.free_comments || 0}\nUnread replies: ${user.unread_replies_count || 0}`, mainKeyboard());
      } else {
        await ctx.reply(`Hi ${name}! I'm Mr World Voice Comment Bot 🎙️\nSend a TikTok/YouTube link to create a thread or use 🔎 Search to find voices by code.`, mainKeyboard());
      }
    } catch (e) {
      console.error('/start error', e);
      await ctx.reply('Hi! Minor internal error on start — try again.', mainKeyboard());
    }
  });

  // favorites command
  bot.command('favorites', async (ctx) => {
    try {
      const comments = await db.listFavoritesForUser(ctx.from.id);
      if (!comments || comments.length === 0) return ctx.reply('No favorites yet.', mainKeyboard());
      for (const c of comments) {
        try { await ctx.replyWithVoice(c.telegram_file_id, { caption: `${c.first_name || c.username || 'User'}` }); } catch (e) {}
        await ctx.reply(encodeShortCode(c.id));
      }
      return ctx.reply('End of favorites.', mainKeyboard());
    } catch (e) {
      console.error('/favorites', e);
      return ctx.reply('Could not fetch favorites.', mainKeyboard());
    }
  });

  // help, dashboard, search, notifications etc — keep similar behavior (unchanged)
  bot.command('help', (ctx) => ctx.reply(
    `/help — this menu
🎥 Add Comment — create public thread
➕ Add My Video — track your video
🔖 Track Video — list/delete tracked videos
🎧 Listen Comments — listen (paginated)
🔎 Search CODE — find a voice
⭐ Favorites — saved voices
💬 My Comments — your voices
/weekly_top — weekly most-liked voices
/delete_comment CODE — delete your comment
/report CODE [reason] — report a comment`,
    mainKeyboard()
  ));

  bot.command('dashboard', async (ctx) => {
    try {
      const { data } = await db.supabase.from('users').select('*').eq('telegram_id', ctx.from.id).limit(1).maybeSingle();
      if (!data) return ctx.reply('No stats yet.', mainKeyboard());
      return ctx.reply(`Your stats:\n• Free comments left: ${data.free_comments}\n• Voices sent: ${data.voice_comments_sent}\n• Unread replies: ${data.unread_replies_count}`, mainKeyboard());
    } catch (e) {
      console.error('dashboard error', e);
      return ctx.reply('Could not fetch dashboard.', mainKeyboard());
    }
  });

  // search
  bot.command('search', async (ctx) => {
    const parts = (ctx.message.text || '').split(/\s+/).slice(1);
    if (!parts.length) {
      pending.set(ctx.from.id, { type: 'search_prompt' });
      return ctx.reply('🔎 Send the short code (e.g. 0000A9) or use /search CODE.', mainKeyboard());
    }
    return handleSearch(ctx, parts[0].trim());
  });

  async function handleSearch(ctx, code) {
    try {
      const id = decodeShortCode((code || '').toUpperCase());
      if (!id) return ctx.reply('Invalid code.', mainKeyboard());
      const comment = await db.searchCommentById(id);
      if (!comment) return ctx.reply('No voice found for that code.', mainKeyboard());
      const counts = await getReactionCounts(id);
      await ctx.replyWithVoice(comment.telegram_file_id, { caption: `${comment.first_name || comment.username || 'User'} • ${new Date(comment.created_at).toLocaleString()}` });
      await ctx.reply(encodeShortCode(comment.id));
      const threadRow = await db.getThreadById(comment.thread_id);
      const videoLink = threadRow ? threadRow.social_link : '(video unknown)';
      const actionsKb = await buildActionsKeyboard(comment.id, ctx.from.id);
      await ctx.reply(`Stats: ❤️ ${counts.heart}  😂 ${counts.laugh}  👎 ${counts.dislike}\nVideo: ${videoLink}`, actionsKb);
    } catch (e) {
      console.error('handleSearch', e);
      return ctx.reply('Search failed.', mainKeyboard());
    }
  }

  // notifications
  bot.command('notifications', async (ctx) => {
    try {
      const { data } = await db.listNotifications(ctx.from.id);
      if (!data || data.length === 0) return ctx.reply('No notifications yet.', mainKeyboard());
      for (const n of data) {
        let text = n.message;
        try {
          const meta = n.meta || {};
          if (meta.comment_id) {
            const counts = await getReactionCounts(meta.comment_id);
            const comment = await db.getCommentById(meta.comment_id);
            const threadRow = comment ? await db.getThreadById(comment.thread_id) : null;
            const videoLink = threadRow ? threadRow.social_link : '(video unknown)';
            text = `${encodeShortCode(meta.comment_id)} — Stats: ❤️ ${counts.heart}  😂 ${counts.laugh}  👎 ${counts.dislike}\nVideo: ${videoLink}\n${n.message}`;
          }
        } catch (e) { /* ignore */ }
        await ctx.reply(text);
      }
      return ctx.reply('End of notifications.', mainKeyboard());
    } catch (e) {
      console.error('/notifications error', e);
      return ctx.reply('Could not fetch notifications.', mainKeyboard());
    }
  });

  bot.command('clear-notifications', async (ctx) => {
    try {
      await db.markAllNotificationsRead(ctx.from.id);
      return ctx.reply('Notifications cleared.', mainKeyboard());
    } catch (e) {
      console.error('clear-notifs error', e);
      return ctx.reply('Could not clear notifications.', mainKeyboard());
    }
  });

  // my comments (paginated)
  bot.command('my', async (ctx) => sendMyCommentsPage(ctx, 1));
  async function sendMyCommentsPage(ctx, page = 1) {
    try {
      const uid = ctx.from.id;
      const offset = (page - 1) * MY_PAGE_SIZE;
      const { data: comments } = await db.supabase.from('voice_comments').select('*').eq('telegram_id', uid).order('created_at', { ascending: false }).range(offset, offset + MY_PAGE_SIZE - 1);
      const countRes = await db.supabase.from('voice_comments').select('id', { head: true, count: 'exact' }).eq('telegram_id', uid);
      const total = (countRes && countRes.count) ? countRes.count : 0;
      if (!comments || comments.length === 0) return ctx.reply('You have no comments yet.', mainKeyboard());
      for (const c of comments) {
        try { await ctx.replyWithVoice(c.telegram_file_id, { caption: `${c.first_name || c.username || 'User'} • ${new Date(c.created_at).toLocaleString()}` }); } catch (e) {}
        await ctx.reply(encodeShortCode(c.id));
        const actionsKb = await buildActionsKeyboard(c.id, ctx.from.id);
        await ctx.reply('Actions:', actionsKb);
      }
      const shown = Math.min(offset + comments.length, total);
      if (shown < total) {
        await ctx.reply('▶️ See more', Markup.inlineKeyboard([[Markup.button.callback('▶️ More', `my_${page + 1}`)]]));
      } else {
        await ctx.reply('End of your comments.', mainKeyboard());
      }
    } catch (e) {
      console.error('sendMyCommentsPage', e);
      return ctx.reply('Could not fetch your comments.', mainKeyboard());
    }
  }

  // ---------- text handler ----------
  bot.on('text', async (ctx) => {
    const text = (ctx.message && ctx.message.text) || '';
    const uid = ctx.from.id;
    const p = pending.get(uid);

    // search continuation
    if (p && p.type === 'search_prompt') {
      pending.delete(uid);
      return handleSearch(ctx, text.trim());
    }

    // reply text continuation
    if (p && p.type === 'reply_text') {
      const commentId = p.commentId;
      pending.delete(uid);
      try {
        const payload = {
          comment_id: commentId,
          replier_telegram_id: ctx.from.id,
          replier_username: ctx.from.username ?? null,
          replier_first_name: ctx.from.first_name ?? null,
          reply_text: text
        };
        const { data, error } = await db.insertReplyRow(payload);
        if (error) throw error;
        await ctx.reply(`↳ ${ctx.from.first_name || ctx.from.username || 'User'}: ${text}`);

        // notify owner (compact), include audio when reply has it (this is a text reply, so no audio to include)
        try {
          const comment = await db.getCommentById(commentId);
          if (comment && comment.telegram_id && comment.telegram_id !== ctx.from.id) {
            const short = encodeShortCode(commentId);
            const counts = await getReactionCounts(commentId);
            const threadRow = comment ? await db.getThreadById(comment.thread_id) : null;
            const videoLink = threadRow ? threadRow.social_link : '(video unknown)';
            const msg = `${ctx.from.first_name || ctx.from.username} replied to your comment.\n${short}\nStats: ❤️ ${counts.heart}  😂 ${counts.laugh}  👎 ${counts.dislike}\nVideo: ${videoLink}`;
            await db.addNotificationRow({ telegram_id: comment.telegram_id, type: 'reply', message: msg, meta: { comment_id: commentId, reply_id: data?.id ?? null } });
            try { await bot.telegram.sendMessage(comment.telegram_id, `${short}\n${msg}`); } catch (_) {}
          }
        } catch (e) { console.error('notify owner on text reply', e); }

        return ctx.reply('Reply saved and posted publicly.', mainKeyboard());
      } catch (e) {
        console.error('reply_text save error', e);
        return ctx.reply('Could not save reply.', mainKeyboard());
      }
    }

    // keyboard text flows
    if (text === '🎥 Add Comment') {
      pending.set(uid, { type: 'create_thread_public' });
      return ctx.reply('🎥 Send me the TikTok/YouTube link and you can add a voice comment for it.', mainKeyboard());
    }
    if (text === '➕ Add My Video') {
      pending.set(uid, { type: 'create_thread_owned' });
      return ctx.reply('➕ Send the TikTok/YouTube link to track it. You will be notified (with code + counts) when someone comments.', mainKeyboard());
    }
    if (text === '🔖 Track Video') {
      try {
        const { data } = await db.supabase.from('threads').select('*').eq('creator_telegram_id', ctx.from.id).order('created_at', { ascending: false });
        if (!data || data.length === 0) return ctx.reply('No tracked videos yet.', mainKeyboard());
        for (const t of data) {
          await ctx.reply(t.social_link, Markup.inlineKeyboard([
            [Markup.button.callback('🎧 Listen Comments', `listen_${t.id}_1`), Markup.button.callback('🎙 Add Voice Comment', `addvoice_${t.id}`)],
            [Markup.button.callback('🗑 Delete', `delete_thread_${t.id}`)]
          ]));
        }
        return;
      } catch (e) {
        console.error('Track Video', e);
        return ctx.reply('Could not list tracked videos.', mainKeyboard());
      }
    }
    if (text === '🎧 Listen Comments') {
      pending.set(uid, { type: 'listen_prompt' });
      return ctx.reply('🎧 Send the TikTok/YouTube link or click a tracked video to listen to comments (paginated).', mainKeyboard());
    }
    if (text === '💬 My Comments') {
      return sendMyCommentsPage(ctx, 1);
    }
    if (text === '⭐ Favorites') {
      return bot.handleUpdate(ctx.update); // fallback to ensure favorites command triggers - usually handled by bot.command('favorites')
    }
    if (text === '🔎 Search') {
      pending.set(uid, { type: 'search_prompt' });
      return ctx.reply('🔎 Send the short code (e.g. 0000A9) or use /search CODE.', mainKeyboard());
    }

    // thread creation flows
    if (p && (p.type === 'create_thread_public' || p.type === 'create_thread_owned')) {
      const url = extractFirstUrl(text);
      if (!url) return ctx.reply('I could not find a link. Send a TikTok/YouTube URL.', mainKeyboard());
      try {
        await db.ensureUserRow(ctx.from);
        const thread = await db.createThread(url, p.type === 'create_thread_owned' ? ctx.from.id : null);
        pending.delete(uid);
        await ctx.reply(`✅ Thread created: ${thread.social_link}`, mainKeyboard());
        const chooseKb = Markup.inlineKeyboard([[Markup.button.callback('🎙 Add Voice Comment', `addvoice_${thread.id}`), Markup.button.callback('🎧 Listen Comments', `listen_${thread.id}_1`)]]);
        await ctx.reply('Choose:', chooseKb);
        return;
      } catch (e) {
        console.error('create thread error', e);
        pending.delete(uid);
        return ctx.reply('Could not create thread (DB error).', mainKeyboard());
      }
    }

    // direct link -> create public thread
    if (isSupportedLink(text) || extractFirstUrl(text)) {
      const url = extractFirstUrl(text);
      try {
        await db.ensureUserRow(ctx.from);
        const thread = await db.createThread(url, null);
        await ctx.reply(`✅ Thread created for: ${url}`, mainKeyboard());
        const chooseKb = Markup.inlineKeyboard([[Markup.button.callback('🎙 Add Voice Comment', `addvoice_${thread.id}`), Markup.button.callback('🎧 Listen Comments', `listen_${thread.id}_1`)]]);
        await ctx.reply('Choose:', chooseKb);
        return;
      } catch (e) {
        console.error('direct create thread error', e);
        return ctx.reply('Database error while saving your link.', mainKeyboard());
      }
    }

    // admin actions and reports (unchanged)
    if (text.startsWith('/admin_delete_comment')) {
      if (!isAdmin(ctx.from.id)) return ctx.reply('You are not an admin.');
      const parts = text.split(/\s+/).slice(1);
      if (!parts.length) return ctx.reply('Usage: /admin_delete_comment CODE');
      const id = decodeShortCode(parts[0]);
      if (!id) return ctx.reply('Invalid code.');
      try {
        const { error } = await db.supabase.from('voice_comments').delete().eq('id', id);
        if (error) throw error;
        return ctx.reply('Deleted by admin.', mainKeyboard());
      } catch (e) {
        console.error('admin delete', e);
        return ctx.reply('Could not delete.', mainKeyboard());
      }
    }

    if (text.startsWith('/delete_comment')) {
      const parts = text.split(/\s+/).slice(1);
      if (!parts.length) return ctx.reply('Usage: /delete_comment CODE');
      const id = decodeShortCode(parts[0]);
      if (!id) return ctx.reply('Invalid code.');
      try {
        const { data: comment } = await db.supabase.from('voice_comments').select('*').eq('id', id).limit(1).maybeSingle();
        if (!comment) return ctx.reply('Not found.');
        if (comment.telegram_id !== ctx.from.id && !isAdmin(ctx.from.id)) return ctx.reply('You can only delete your own comment.');
        const { error } = await db.supabase.from('voice_comments').delete().eq('id', id);
        if (error) throw error;
        return ctx.reply('Comment deleted.', mainKeyboard());
      } catch (e) {
        console.error('delete_comment', e);
        return ctx.reply('Could not delete.', mainKeyboard());
      }
    }

    if (text.startsWith('/report')) {
      const parts = text.split(/\s+/).slice(1);
      if (!parts.length) return ctx.reply('Usage: /report CODE [reason]');
      const id = decodeShortCode(parts[0]);
      if (!id) return ctx.reply('Invalid code.');
      const reason = parts.slice(1).join(' ') || null;
      try {
        await db.supabase.from('reports').insert([{ reporter_telegram_id: ctx.from.id, comment_id: id, reason }]);
        for (const adm of ADMIN_IDS) {
          try { await bot.telegram.sendMessage(adm, `🚨 Report: ${ctx.from.first_name || ctx.from.username} reported ${encodeShortCode(id)}${reason ? `\nReason: ${reason}` : ''}`); } catch (_) {}
        }
        return ctx.reply('Report submitted. Admins notified.', mainKeyboard());
      } catch (e) {
        console.error('report', e);
        return ctx.reply('Could not submit report.', mainKeyboard());
      }
    }

    return ctx.reply(`Hi ${ctx.from.first_name || ''}! I didn't detect a supported link. Press a button or send a TikTok/YouTube URL.`, mainKeyboard());
  });

  // ---------- callback queries ----------
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery && ctx.callbackQuery.data;
    const uid = ctx.from.id;
    if (!data) return ctx.answerCbQuery();

    try {
      // pagination for "my"
      if (data.startsWith('my_')) {
        const page = Number(data.split('_')[1]) || 1;
        await sendMyCommentsPage(ctx, page);
        return ctx.answerCbQuery();
      }

      // add voice
      if (data.startsWith('addvoice_')) {
        const threadId = Number(data.split('_')[1]);
        pending.set(uid, { type: 'add_comment', threadId });
        await ctx.answerCbQuery('Send voice now');
        return ctx.reply('🎙 Send your voice message now; it will attach to that thread.');
      }

      // listen - IMPORTANT: show only main comments (no replies inline)
      if (data.startsWith('listen_')) {
        const [ , threadIdStr, pageStr ] = data.split('_');
        const threadId = Number(threadIdStr);
        const page = Number(pageStr || '1');
        const offset = (page - 1) * LISTEN_PAGE_SIZE;
        const { data: comments, error } = await db.listCommentsByThread(threadId, offset, LISTEN_PAGE_SIZE);
        if (error) { console.error('listen error', error); await ctx.answerCbQuery('Could not fetch'); return; }
        if (!comments || comments.length === 0) { await ctx.answerCbQuery(); return ctx.reply('No comments yet.'); }

        for (const c of comments) {
          const caption = `${c.first_name || c.username || 'User'} • ${new Date(c.created_at).toLocaleString()}`;
          try { await ctx.replyWithVoice(c.telegram_file_id, { caption }); } catch (e) { console.error('send voice', e); }
          await ctx.reply(encodeShortCode(c.id));
          // actions: reactions + Show replies button (no inline replies)
          const actionsKb = await buildActionsKeyboard(c.id, ctx.from.id);
          await ctx.reply('Actions:', actionsKb);
        }

        const countRes = await db.supabase.from('voice_comments').select('id', { head: true, count: 'exact' }).eq('thread_id', threadId);
        const total = countRes && countRes.count ? countRes.count : 0;
        if (offset + comments.length < total) {
          await ctx.reply('▶️ See more', Markup.inlineKeyboard([[Markup.button.callback('▶️ More', `listen_${threadId}_${page + 1}`)]]));
        }
        return ctx.answerCbQuery();
      }

      // show_replies (only when user requests)
      if (data.startsWith('show_replies_')) {
        const commentId = Number(data.split('_')[2]);
        const { data: replies, error } = await db.listRepliesByComment(commentId);
        if (error) { console.error('listReplies error', error); await ctx.answerCbQuery('Could not fetch replies'); return; }
        if (!replies || replies.length === 0) { await ctx.answerCbQuery(); return ctx.reply('No replies yet.'); }
        await ctx.answerCbQuery();
        for (const r of replies) {
          const who = r.replier_first_name || r.replier_username || 'User';
          const when = new Date(r.created_at).toLocaleString();
          if (r.telegram_file_id) {
            await ctx.reply(`${who} • ${when} — voice reply`);
            try {
              const actionsKb = await buildReplyActionsKeyboard(r.id, commentId, ctx.from.id);
              // We send the voice then actions. For a nicer compact view you could send <caption> in voice, but some clients hide inline keyboard on voice; both ways are acceptable.
              await ctx.replyWithVoice(r.telegram_file_id, { caption: `${who} • ${when}` });
              await ctx.reply('Reply actions:', actionsKb);
            } catch (e) { console.error('send reply voice', e); }
          } else if (r.telegram_photo_id) {
            try {
              await ctx.replyWithPhoto(r.telegram_photo_id, { caption: `${who} • ${when} — photo reply` });
              const actionsKb = await buildReplyActionsKeyboard(r.id, commentId, ctx.from.id);
              await ctx.reply('Reply actions:', actionsKb);
            } catch (e) { console.error('send reply photo', e); }
          } else if (r.reply_text) {
            try {
              const actionsKb = await buildReplyActionsKeyboard(r.id, commentId, ctx.from.id);
              await ctx.reply(`↳ ${who} • ${when}: ${r.reply_text}`, actionsKb);
            } catch (e) { console.error('send reply text', e); }
          } else {
            await ctx.reply(`↳ ${who} • ${when}: (empty reply)`);
          }
        }
        return;
      }

      // play reply audio (in case we want a separate play action)
      if (data.startsWith('play_reply_')) {
        const replyId = Number(data.split('_')[2]);
        const reply = await db.getReplyById(replyId);
        if (!reply) return ctx.answerCbQuery('Reply not found');
        if (reply.telegram_file_id) {
          await ctx.answerCbQuery();
          try { await ctx.replyWithVoice(reply.telegram_file_id, { caption: `${reply.replier_first_name || reply.replier_username || 'User'} • ${new Date(reply.created_at).toLocaleString()}` }); } catch (e) { console.error('play reply', e); return ctx.answerCbQuery('Could not play'); }
        } else {
          return ctx.answerCbQuery('No audio for that reply');
        }
        return;
      }

      // reply-level reactions
      if (data.startsWith('react_reply_')) {
        const parts = data.split('_'); // react_reply_<replyId>_<type>
        const replyId = Number(parts[2]);
        const type = parts[3];
        const allowed = new Set(['heart','laugh','dislike']);
        if (!allowed.has(type)) return ctx.answerCbQuery('Unknown reaction');
        const { data: inserted, error } = await db.insertReplyReactionRow({ reply_id: replyId, user_id: ctx.from.id, type });
        if (error) { console.error('insertReplyReactionRow', error); return ctx.answerCbQuery('DB error'); }

        // notify reply owner compactly (include code + video link)
        try {
          const reply = await db.getReplyById(replyId);
          if (reply && reply.replier_telegram_id && reply.replier_telegram_id !== ctx.from.id) {
            const counts = await getReactionCountsForReply(replyId);
            const comment = await db.getCommentById(reply.comment_id);
            const threadRow = comment ? await db.getThreadById(comment.thread_id) : null;
            const videoLink = threadRow ? threadRow.social_link : '(video unknown)';
            const short = encodeShortCode(replyId);
            const msgText = `${ctx.from.first_name || ctx.from.username || 'Someone'} reacted (${type}) to your reply.\nReply code: ${short}\nStats: ❤️ ${counts.heart}  😂 ${counts.laugh}  👎 ${counts.dislike}\nVideo: ${videoLink}`;
            await db.addNotificationRow({ telegram_id: reply.replier_telegram_id, type: 'reply_reaction', message: msgText, meta: { reply_id: replyId, comment_id: reply.comment_id } });
            try { await bot.telegram.sendMessage(reply.replier_telegram_id, `${short}\n${msgText}`); } catch (_) {}
          }
        } catch (e) { console.error('notify reply owner', e); }

        return ctx.answerCbQuery('Reaction saved.');
      }

      // comment-level reactions
      if (data.startsWith('react_')) {
        const [, idStr, type] = data.split('_');
        const commentId = Number(idStr);
        const allowed = new Set(['heart','laugh','dislike']);
        if (!allowed.has(type)) return ctx.answerCbQuery('Unknown reaction');
        const { data: reactionData, error } = await db.insertReactionRow({ comment_id: commentId, user_id: ctx.from.id, type });
        if (error) { console.error('insertReactionRow', error); return ctx.answerCbQuery('DB error'); }

        // update markup if possible
        try {
          const msg = ctx.callbackQuery.message;
          if (msg && msg.chat && msg.message_id) {
            const newKb = await buildActionsKeyboard(commentId, ctx.from.id);
            try { await ctx.telegram.editMessageReplyMarkup(msg.chat.id, msg.message_id, null, newKb.reply_markup); } catch (e) { /* ignore edit errors */ }
          }
        } catch (e) { console.error('edit keyboard error', e); }

        // notify comment owner compactly
        try {
          const comment = await db.getCommentById(commentId);
          if (comment && comment.telegram_id && comment.telegram_id !== ctx.from.id) {
            const short = encodeShortCode(commentId);
            const counts2 = await getReactionCounts(commentId);
            const threadRow = comment ? await db.getThreadById(comment.thread_id) : null;
            const videoLink = threadRow ? threadRow.social_link : '(video unknown)';
            const msgText = `${ctx.from.first_name || ctx.from.username || 'Someone'} reacted (${type}) to your comment.\n${short}\nStats: ❤️ ${counts2.heart}  😂 ${counts2.laugh}  👎 ${counts2.dislike}\nVideo: ${videoLink}`;
            await db.addNotificationRow({ telegram_id: comment.telegram_id, type: 'reaction', message: msgText, meta: { comment_id: commentId } });
            try { await bot.telegram.sendMessage(comment.telegram_id, `${short}\n${msgText}`); } catch (_) {}
          }
        } catch (e) { console.error('notify owner on reaction', e); }

        return ctx.answerCbQuery('Reaction saved.');
      }

      // favorite toggle
      if (data.startsWith('fav_')) {
        const commentId = Number(data.split('_')[1]);
        try {
          const r = await db.toggleFavoriteRow(ctx.from.id, commentId);
          const msg = ctx.callbackQuery.message;
          if (msg && msg.chat && msg.message_id) {
            const newKb = await buildActionsKeyboard(commentId, ctx.from.id);
            try { await ctx.telegram.editMessageReplyMarkup(msg.chat.id, msg.message_id, null, newKb.reply_markup); } catch (e) { /* ignore */ }
          }
          return ctx.answerCbQuery(r.removed ? 'Favorite removed' : 'Favorite added');
        } catch (e) {
          console.error('fav toggle', e);
          return ctx.answerCbQuery('Could not toggle favorite.');
        }
      }

      // reply menu start
      if (data.startsWith('replymenu_')) {
        const commentId = Number(data.split('_')[1]);
        pending.set(ctx.from.id, { type: 'reply_choice', commentId });
        await ctx.answerCbQuery();
        return ctx.reply('Reply options:\n• Send voice now to add voice reply\n• Send text now to add text reply\n• Send photo now to add photo reply\n(Your next message or media will be treated as the reply.)');
      }

      // reply text/voice quick starts (optional inline)
      if (data.startsWith('replytext_')) {
        const commentId = Number(data.split('_')[1]);
        pending.set(ctx.from.id, { type: 'reply_text', commentId });
        await ctx.answerCbQuery('Send reply text now');
        return ctx.reply('✍️ Send your reply text now.');
      }
      if (data.startsWith('replyvoice_')) {
        const commentId = Number(data.split('_')[1]);
        pending.set(ctx.from.id, { type: 'reply_voice', commentId });
        await ctx.answerCbQuery('Send voice reply now');
        return ctx.reply('🎙 Send your voice reply now.');
      }

      // list replies (full list) - kept for compatibility
      if (data.startsWith('list_replies_')) {
        const commentId = Number(data.split('_')[1]);
        const { data: replies } = await db.listRepliesByComment(commentId);
        if (!replies || replies.length === 0) { await ctx.answerCbQuery(); return ctx.reply('No replies yet.'); }
        await ctx.answerCbQuery();
        for (const r of replies) {
          if (r.telegram_file_id) {
            try { await ctx.replyWithVoice(r.telegram_file_id, { caption: `↳ ${r.replier_first_name || r.replier_username || 'User'}` }); } catch (e) {}
          } else if (r.telegram_photo_id) {
            try { await ctx.replyWithPhoto(r.telegram_photo_id, { caption: `↳ ${r.replier_first_name || r.replier_username || 'User'} (photo)` }); } catch (e) {}
          } else if (r.reply_text) {
            await ctx.reply(`↳ ${r.replier_first_name || r.replier_username || 'User'}: ${r.reply_text}`);
          }
        }
        return;
      }

      // report comment
      if (data.startsWith('report_')) {
        const commentId = Number(data.split('_')[1]);
        await db.supabase.from('reports').insert([{ reporter_telegram_id: ctx.from.id, comment_id: commentId, reason: null }]);
        for (const adm of ADMIN_IDS) {
          try { await bot.telegram.sendMessage(adm, `🚨 Report: ${ctx.from.first_name || ctx.from.username} reported ${encodeShortCode(commentId)}`); } catch (_) {}
        }
        return ctx.answerCbQuery('Reported. Admins notified.');
      }

      // report reply
      if (data.startsWith('report_reply_')) {
        const replyId = Number(data.split('_')[2]);
        await db.supabase.from('reports').insert([{ reporter_telegram_id: ctx.from.id, reply_id: replyId, reason: null }]);
        for (const adm of ADMIN_IDS) {
          try { await bot.telegram.sendMessage(adm, `🚨 Report: ${ctx.from.first_name || ctx.from.username} reported reply ${encodeShortCode(replyId)}`); } catch (_) {}
        }
        return ctx.answerCbQuery('Reported. Admins notified.');
      }

      // delete comment inline
      if (data.startsWith('delete_comment_')) {
        const commentId = Number(data.split('_')[1]);
        const { data: comment } = await db.supabase.from('voice_comments').select('*').eq('id', commentId).limit(1).maybeSingle();
        if (!comment) return ctx.answerCbQuery('Not found.');
        if (comment.telegram_id !== ctx.from.id && !isAdmin(ctx.from.id)) return ctx.answerCbQuery('You can only delete your own comment.');
        await db.supabase.from('voice_comments').delete().eq('id', commentId);
        return ctx.answerCbQuery('Deleted.');
      }

      // share comment code
      if (data.startsWith('share_comment_')) {
        const commentId = Number(data.split('_')[2]);
        await ctx.answerCbQuery();
        return ctx.reply(encodeShortCode(commentId));
      }

      // share reply code
      if (data.startsWith('share_reply_')) {
        const replyId = Number(data.split('_')[2]);
        await ctx.answerCbQuery();
        return ctx.reply(encodeShortCode(replyId));
      }

      await ctx.answerCbQuery();
    } catch (e) {
      console.error('callback_query handler', e);
      try { await ctx.answerCbQuery('Error'); } catch (_) {}
    }
  });

  // ---------- voice handler ----------
  bot.on('voice', async (ctx) => {
    const uid = ctx.from.id;
    const p = pending.get(uid);

    // reply voice continuation
    if (p && (p.type === 'reply_voice' || (p.type === 'reply_choice' && p.commentId))) {
      const commentId = p.commentId;
      pending.delete(uid);
      try {
        const voice = ctx.message.voice;
        const payload = {
          comment_id: commentId,
          replier_telegram_id: ctx.from.id,
          replier_username: ctx.from.username ?? null,
          replier_first_name: ctx.from.first_name ?? null,
          telegram_file_id: voice.file_id
        };
        const { data, error } = await db.insertReplyRow(payload);
        if (error) throw error;

        await ctx.replyWithVoice(voice.file_id, { caption: `↳ Reply by ${ctx.from.first_name || ctx.from.username}` });

        // notify comment owner and include audio in notification when possible
        try {
          const comment = await db.getCommentById(commentId);
          if (comment && comment.telegram_id && comment.telegram_id !== ctx.from.id) {
            const short = encodeShortCode(commentId);
            const counts = await getReactionCounts(commentId);
            const tr = await db.getThreadById(comment.thread_id);
            const videoLink = tr ? tr.social_link : '(video unknown)';
            const msg = `${ctx.from.first_name || ctx.from.username} replied to your comment.\n${short}\nStats: ❤️ ${counts.heart}  😂 ${counts.laugh}  👎 ${counts.dislike}\nVideo: ${videoLink}`;
            await db.addNotificationRow({ telegram_id: comment.telegram_id, type: 'reply', message: msg, meta: { comment_id: commentId, reply_id: data?.id ?? null } });
            if (data && data.telegram_file_id) {
              try {
                await bot.telegram.sendVoice(comment.telegram_id, data.telegram_file_id, { caption: `${encodeShortCode(data.id)} — reply to ${short}\n${msg}` });
              } catch (err) {
                console.error('Failed to send reply voice to owner:', err);
                try { await bot.telegram.sendMessage(comment.telegram_id, `${encodeShortCode(data.id)}\n${msg}`); } catch (_) {}
              }
            } else {
              try { await bot.telegram.sendMessage(comment.telegram_id, `${encodeShortCode(data?.id ?? 0)}\n${msg}`); } catch (_) {}
            }
          }
        } catch (e) { console.error('notify owner reply voice', e); }

        return ctx.reply('Reply saved and posted publicly.', mainKeyboard());
      } catch (e) {
        console.error('reply voice save', e);
        return ctx.reply('Could not save reply.', mainKeyboard());
      }
    }

    // add comment voice flow
    if (!p || p.type !== 'add_comment') {
      return ctx.reply('No pending add-comment action. Click "Add Voice Comment" first.', mainKeyboard());
    }
    try {
      const threadId = p.threadId;
      const voice = ctx.message.voice;
      const { data: thread } = await db.supabase.from('threads').select('*').eq('id', threadId).limit(1).maybeSingle();
      if (!thread) { pending.delete(uid); return ctx.reply('Thread not found.', mainKeyboard()); }
      await db.ensureUserRow(ctx.from);

      const payload = {
        thread_id: threadId,
        telegram_id: ctx.from.id,
        username: ctx.from.username ?? null,
        first_name: ctx.from.first_name ?? null,
        telegram_file_id: voice.file_id,
        duration: voice.duration ?? 0
      };
      const { data, error } = await db.insertVoiceComment(payload);
      pending.delete(uid);
      if (error) { console.error('insertVoiceComment', error); return ctx.reply('DB error saving voice.', mainKeyboard()); }

      const short = encodeShortCode(data.id);
      await ctx.reply('✅ Voice saved!');
      await ctx.reply(short);

      // notify thread owner if they are tracker (compact)
      if (thread.creator_telegram_id && thread.creator_telegram_id !== ctx.from.id) {
        const notif = `🔔 New voice comment on your tracked video by ${ctx.from.first_name || ctx.from.username}\nVideo: ${thread.social_link}\nCode: ${short}`;
        await db.addNotificationRow({ telegram_id: thread.creator_telegram_id, type: 'reply', message: notif, meta: { thread_id: threadId, comment_id: data.id } });
        try { await bot.telegram.sendMessage(thread.creator_telegram_id, `${short}\n${notif}`); } catch (_) {}
      }
      return;
    } catch (e) {
      console.error('voice add error', e);
      pending.delete(uid);
      return ctx.reply('Could not save voice comment.', mainKeyboard());
    }
  });

  // photo handler for photo-replies
  bot.on('photo', async (ctx) => {
    const uid = ctx.from.id;
    const p = pending.get(uid);
    if (!p || !p.commentId || p.type !== 'reply_choice') {
      return ctx.reply('No pending reply action. Use reply options first.', mainKeyboard());
    }
    pending.delete(uid);
    try {
      const photos = ctx.message.photo || [];
      if (photos.length === 0) return ctx.reply('No photo found.');
      const photo = photos[photos.length - 1];
      const payload = {
        comment_id: p.commentId,
        replier_telegram_id: ctx.from.id,
        replier_username: ctx.from.username ?? null,
        replier_first_name: ctx.from.first_name ?? null,
        telegram_photo_id: photo.file_id
      };
      const { data, error } = await db.insertReplyRow(payload);
      if (error) throw error;

      await ctx.replyWithPhoto(photo.file_id, { caption: `↳ Photo reply by ${ctx.from.first_name || ctx.from.username}` });

      try {
        const comment = await db.getCommentById(p.commentId);
        if (comment && comment.telegram_id && comment.telegram_id !== ctx.from.id) {
          const short = encodeShortCode(p.commentId);
          const counts = await getReactionCounts(p.commentId);
          const tr = await db.getThreadById(comment.thread_id);
          const videoLink = tr ? tr.social_link : '(video unknown)';
          const msg = `${ctx.from.first_name || ctx.from.username} replied to your comment with a photo.\n${short}\nStats: ❤️ ${counts.heart}  😂 ${counts.laugh}  👎 ${counts.dislike}\nVideo: ${videoLink}`;
          await db.addNotificationRow({ telegram_id: comment.telegram_id, type: 'reply', message: msg, meta: { comment_id: p.commentId, reply_id: data?.id ?? null } });
          try { await bot.telegram.sendMessage(comment.telegram_id, `${encodeShortCode(data?.id ?? 0)}\n${msg}`); } catch (_) {}
        }
      } catch (e) { console.error('notify owner photo reply', e); }

      return ctx.reply('Photo reply saved and posted publicly.', mainKeyboard());
    } catch (e) {
      console.error('photo reply error', e);
      return ctx.reply('Could not save photo reply.', mainKeyboard());
    }
  });

  // message fallback for reply_choice -> text
  bot.on('message', async (ctx) => {
    const p = pending.get(ctx.from.id);
    if (p && p.type === 'reply_choice' && ctx.message && ctx.message.text) {
      pending.set(ctx.from.id, { type: 'reply_text', commentId: p.commentId });
      return;
    }
  });

  // weekly_top (kept)
  bot.command('weekly_top', async (ctx) => {
    try {
      const raw = await db.supabase.from('voice_reactions').select('comment_id,created_at');
      const rows = raw.data || [];
      const cutoff = Date.now() - 7*24*3600*1000;
      const agg = {};
      rows.forEach(r => {
        if (new Date(r.created_at).getTime() >= cutoff) agg[r.comment_id] = (agg[r.comment_id]||0)+1;
      });
      const arr = Object.keys(agg).map(k => ({ comment_id: Number(k), cnt: agg[k] }));
      arr.sort((a,b)=>b.cnt-a.cnt);
      const topRows = arr.slice(0,10);
      if (!topRows || topRows.length === 0) return ctx.reply('No top voices this week yet.', mainKeyboard());
      let i = 0;
      for (const t of topRows) {
        i++;
        const comment = await db.getCommentById(t.comment_id);
        if (!comment) continue;
        await ctx.reply(`${i}. ${comment.first_name || comment.username || 'User'} — ${t.cnt} reactions — Code: ${encodeShortCode(comment.id)}`, Markup.inlineKeyboard([[Markup.button.callback('▶️ Play', `play_comment_${comment.id}`), Markup.button.callback('🗨 Replies', `list_replies_${comment.id}`)]]));
      }
      return ctx.reply('End of weekly top.', mainKeyboard());
    } catch (e) {
      console.error('weekly_top', e);
      return ctx.reply('Could not compute weekly top.', mainKeyboard());
    }
  });

  bot.catch((err) => {
    console.error('Bot error', err);
  });

  return bot;
}

module.exports = { initBot };
