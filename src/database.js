// src/database.js
// Supabase wrapper used by the bot.
// Exports: supabase, ensureUserRow, createThread, getThreadByLink, insertVoiceComment,
// listCommentsByThread, getCommentById, insertReplyRow, insertReactionRow,
// addNotificationRow, listNotifications, markAllNotificationsRead,
// toggleFavoriteRow, listFavoritesForUser, searchCommentById, isFavorite

const { createClient } = require('@supabase/supabase-js');
const { normalizeVideoUrl } = require('./utils');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Supabase env vars missing: SUPABASE_URL, SUPABASE_KEY. Add them to your .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Ensure user row exists
async function ensureUserRow(telegramUser) {
  if (!telegramUser || !telegramUser.id) throw new Error('telegramUser missing');
  const payload = {
    telegram_id: telegramUser.id,
    username: telegramUser.username ?? null,
    first_name: telegramUser.first_name ?? null
  };
  const { error } = await supabase.from('users').upsert([payload], { onConflict: 'telegram_id' });
  if (error) throw error;
  return true;
}

// Create or return existing thread. Accepts raw social_link, and optional creator_telegram_id (owner/tracking)
async function createThread(social_link, creator_telegram_id = null) {
  // Try to normalize (canonical) first
  try {
    const norm = await normalizeVideoUrl(social_link);
    if (norm) {
      const payload = {
        social_link: norm.canonicalLink,
        platform: norm.platform,
        video_id: norm.videoId,
        creator_telegram_id: creator_telegram_id || null
      };
      // Try upsert on platform + video_id to avoid duplicates
      // Supabase upsert -> pass onConflict string with column list
      const { data, error } = await supabase
        .from('threads')
        .upsert([payload], { onConflict: 'platform,video_id' })
        .select()
        .maybeSingle();
      if (error) {
        // fallback: try selecting existing by platform/video_id
        const { data: existing } = await supabase.from('threads').select('*').eq('platform', payload.platform).eq('video_id', payload.video_id).limit(1).maybeSingle();
        if (existing) return existing;
        throw error;
      }
      return data;
    } else {
      // fallback: create thread with raw link (no platform/video_id)
      const payload = { social_link, creator_telegram_id: creator_telegram_id || null };
      const { data, error } = await supabase.from('threads').insert([payload]).select().maybeSingle();
      if (error) throw error;
      return data;
    }
  } catch (e) {
    // bubble up
    throw e;
  }
}

async function getThreadByLink(link) {
  const { data } = await supabase.from('threads').select('*').eq('social_link', link).limit(1).maybeSingle();
  return data || null;
}

async function insertVoiceComment(payload) {
  // payload: { thread_id, telegram_id, username, first_name, telegram_file_id, duration }
  const { data, error } = await supabase.from('voice_comments').insert([payload]).select().maybeSingle();
  return { data, error };
}

async function listCommentsByThread(threadId, offset = 0, limit = 15) {
  const from = offset;
  const to = offset + limit - 1;
  const { data, error } = await supabase.from('voice_comments').select('*').eq('thread_id', threadId).order('created_at', { ascending: true }).range(from, to);
  return { data, error };
}

async function getCommentById(id) {
  const { data } = await supabase.from('voice_comments').select('*').eq('id', id).limit(1).maybeSingle();
  return data || null;
}

async function insertReplyRow(payload) {
  // payload keys: comment_id, replier_telegram_id, replier_username, replier_first_name, telegram_file_id, telegram_photo_id, reply_text
  const { data, error } = await supabase.from('voice_replies').insert([payload]).select().maybeSingle();
  return { data, error };
}

async function insertReactionRow(payload) {
  // payload: { comment_id, user_id, type }
  try {
    const { data: existing, error: e1 } = await supabase.from('voice_reactions').select('*').eq('comment_id', payload.comment_id).eq('user_id', payload.user_id).limit(1).maybeSingle();
    if (e1) return { data: null, error: e1 };

    if (existing) {
      // If same type => remove (toggle off)
      if (existing.type === payload.type) {
        const { error: delErr } = await supabase.from('voice_reactions').delete().eq('id', existing.id);
        return { data: null, error: delErr, removed: true };
      } else {
        // update to new type
        const { data, error } = await supabase.from('voice_reactions').update({ type: payload.type, created_at: new Date().toISOString() }).eq('id', existing.id).select().maybeSingle();
        return { data, error, removed: false };
      }
    } else {
      const { data, error } = await supabase.from('voice_reactions').insert([payload]).select().maybeSingle();
      return { data, error, removed: false };
    }
  } catch (e) {
    return { data: null, error: e };
  }
}

async function addNotificationRow(payload) {
  // payload: { telegram_id, type, message, meta }
  const { data, error } = await supabase.from('notifications').insert([payload]).select().maybeSingle();
  return { data, error };
}

async function listNotifications(telegram_id, type = null, limit = 50) {
  try {
    let q = supabase.from('notifications').select('*').eq('telegram_id', telegram_id).order('created_at', { ascending: false }).limit(limit);
    if (type) q = q.eq('type', type);
    const { data, error } = await q;
    return { data, error };
  } catch (e) {
    return { data: null, error: e };
  }
}

async function markAllNotificationsRead(telegram_id) {
  const { data, error } = await supabase.from('notifications').update({ read: true }).eq('telegram_id', telegram_id);
  return { data, error };
}

async function toggleFavoriteRow(telegram_id, comment_id) {
  // if exists remove, else add
  const { data: existing, error: e } = await supabase.from('favorites').select('*').eq('telegram_id', telegram_id).eq('comment_id', comment_id).limit(1).maybeSingle();
  if (e) return { removed: false, error: e };
  if (existing) {
    const { error } = await supabase.from('favorites').delete().eq('id', existing.id);
    return { removed: true, error };
  } else {
    const { data, error } = await supabase.from('favorites').insert([{ telegram_id, comment_id }]).select().maybeSingle();
    return { removed: false, data, error };
  }
}

async function isFavorite(telegram_id, comment_id) {
  const { data } = await supabase.from('favorites').select('*').eq('telegram_id', telegram_id).eq('comment_id', comment_id).limit(1).maybeSingle();
  return !!data;
}

async function listFavoritesForUser(telegram_id) {
  const { data: favs, error } = await supabase.from('favorites').select('comment_id').eq('telegram_id', telegram_id).order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  if (!favs || favs.length === 0) return [];
  const ids = favs.map(f => f.comment_id);
  const { data: comments } = await supabase.from('voice_comments').select('*').in('id', ids).order('created_at', { ascending: false });
  return comments || [];
}

async function searchCommentById(id) {
  const { data } = await supabase.from('voice_comments').select('*').eq('id', id).limit(1).maybeSingle();
  return data || null;
}

module.exports = {
  supabase,
  ensureUserRow,
  createThread,
  getThreadByLink,
  insertVoiceComment,
  listCommentsByThread,
  getCommentById,
  insertReplyRow,
  insertReactionRow,
  addNotificationRow,
  listNotifications,
  markAllNotificationsRead,
  toggleFavoriteRow,
  listFavoritesForUser,
  searchCommentById,
  isFavorite
};
