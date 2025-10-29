// src/database.js
// Supabase wrapper used by src/bot.js
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Supabase env vars missing: SUPABASE_URL, SUPABASE_KEY. Add them to your .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

/**
 * Basic helpers
 */
async function ensureUserRow(telegramUser) {
  if (!telegramUser || !telegramUser.id) throw new Error('telegramUser missing');
  const payload = {
    telegram_id: telegramUser.id,
    username: telegramUser.username ?? null,
    first_name: telegramUser.first_name ?? null
  };
  const { error } = await supabase.from('users').upsert([payload], { onConflict: 'telegram_id' });
  return { error };
}

async function createThread(social_link, creator_telegram_id = null) {
  // return existing thread if present
  const { data: existing, error: selErr } = await supabase.from('threads').select('*').eq('social_link', social_link).limit(1).maybeSingle();
  if (selErr) return Promise.reject(selErr);
  if (existing) return existing;
  const payload = { social_link };
  if (creator_telegram_id) payload.creator_telegram_id = creator_telegram_id;
  const { data, error } = await supabase.from('threads').insert([payload]).select().maybeSingle();
  if (error) throw error;
  return data;
}

async function getThreadById(id) {
  const { data, error } = await supabase.from('threads').select('*').eq('id', id).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getThreadByLink(link) {
  const { data, error } = await supabase.from('threads').select('*').eq('social_link', link).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Voice comments
 */
async function insertVoiceComment(payload) {
  // payload: { thread_id, telegram_id, username, first_name, telegram_file_id, duration }
  const { data, error } = await supabase.from('voice_comments').insert([payload]).select().maybeSingle();
  return { data, error };
}

async function listCommentsByThread(threadId, offset = 0, limit = 15) {
  const from = offset;
  const to = offset + limit - 1;
  const { data, error } = await supabase
    .from('voice_comments')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .range(from, to);
  return { data, error };
}

async function getCommentById(id) {
  const { data, error } = await supabase.from('voice_comments').select('*').eq('id', id).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Replies
 */
async function insertReplyRow(payload) {
  // payload: { comment_id, replier_telegram_id, replier_username, replier_first_name, telegram_file_id, telegram_photo_id, reply_text }
  const { data, error } = await supabase.from('voice_replies').insert([payload]).select().maybeSingle();
  return { data, error };
}

async function listRepliesByComment(commentId, offset = 0, limit = 100) {
  const from = offset;
  const to = offset + limit - 1;
  const { data, error } = await supabase
    .from('voice_replies')
    .select('*')
    .eq('comment_id', commentId)
    .order('created_at', { ascending: true })
    .range(from, to);
  return { data, error };
}

async function getReplyById(id) {
  const { data, error } = await supabase.from('voice_replies').select('*').eq('id', id).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Reactions for comments
 */
async function insertReactionRow(payload) {
  // payload: { comment_id, user_id, type }
  // we just insert; dedup/constraints can be handled by DB if desired
  const { data, error } = await supabase.from('voice_reactions').insert([payload]).select().maybeSingle();
  return { data, error };
}

/**
 * Reactions for replies (reply_reactions table expected)
 */
async function insertReplyReactionRow(payload) {
  // payload: { reply_id, user_id, type }
  const { data, error } = await supabase.from('reply_reactions').insert([payload]).select().maybeSingle();
  return { data, error };
}

/**
 * Notifications
 */
async function addNotificationRow(payload) {
  // payload: { telegram_id, type, message, meta }
  const { data, error } = await supabase.from('notifications').insert([payload]).select().maybeSingle();
  return { data, error };
}

async function listNotifications(telegram_id, type = null, limit = 50) {
  let q = supabase.from('notifications').select('*').eq('telegram_id', telegram_id).order('created_at', { ascending: false }).limit(limit);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  return { data, error };
}

async function markAllNotificationsRead(telegram_id) {
  const { data, error } = await supabase.from('notifications').update({ read: true }).eq('telegram_id', telegram_id);
  return { data, error };
}

/**
 * Favorites (toggle)
 * favorites table schema: id, telegram_id, comment_id, created_at
 */
async function toggleFavoriteRow(telegram_id, comment_id) {
  const { data: existing, error: e } = await supabase
    .from('favorites')
    .select('*')
    .eq('telegram_id', telegram_id)
    .eq('comment_id', comment_id)
    .limit(1)
    .maybeSingle();
  if (e) return { error: e };
  if (existing) {
    const { error } = await supabase.from('favorites').delete().eq('id', existing.id);
    return { removed: true, error };
  } else {
    const { data, error } = await supabase.from('favorites').insert([{ telegram_id, comment_id }]).select().maybeSingle();
    return { removed: false, data, error };
  }
}

async function isFavorite(telegram_id, comment_id) {
  const { data, error } = await supabase
    .from('favorites')
    .select('id')
    .eq('telegram_id', telegram_id)
    .eq('comment_id', comment_id)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function listFavoritesForUser(telegram_id) {
  const { data: favs, error } = await supabase.from('favorites').select('comment_id').eq('telegram_id', telegram_id).order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  if (!favs || favs.length === 0) return [];
  const ids = favs.map(f => f.comment_id);
  const { data: comments, error: cErr } = await supabase.from('voice_comments').select('*').in('id', ids).order('created_at', { ascending: false });
  if (cErr) throw cErr;
  return comments || [];
}

/**
 * Search
 */
async function searchCommentById(id) {
  const { data, error } = await supabase.from('voice_comments').select('*').eq('id', id).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Helper: lightweight wrapper to run arbitrary queries if needed (not used directly by bot)
 */
async function rawSql(sql, params = {}) {
  const { data, error } = await supabase.rpc('pg_exec', { sql_text: sql }).catch(() => ({ data: null, error: new Error('rpc pg_exec not available') }));
  return { data, error };
}

module.exports = {
  supabase,

  // users/threads
  ensureUserRow,
  createThread,
  getThreadById,
  getThreadByLink,

  // comments
  insertVoiceComment,
  listCommentsByThread,
  getCommentById,

  // replies
  insertReplyRow,
  listRepliesByComment,
  getReplyById,

  // reactions
  insertReactionRow,
  insertReplyReactionRow,

  // notifications
  addNotificationRow,
  listNotifications,
  markAllNotificationsRead,

  // favorites
  toggleFavoriteRow,
  isFavorite,
  listFavoritesForUser,

  // search
  searchCommentById,

  // raw helper
  rawSql
};
