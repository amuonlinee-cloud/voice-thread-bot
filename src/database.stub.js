// src/database.stub.js
export async function initDatabase(){ return false; }
export async function getOrCreateUser(telegram_id, info = {}) {
  return { telegram_id, username: info.username ?? null, first_name: info.first_name ?? null, free_comments: 35, voice_comments_sent: 0, unread_replies_count: 0 };
}
export async function createCommentThread(social_link, creator_telegram_id = null) { return { id: 1, social_link, creator_telegram_id, created_at: new Date().toISOString() }; }
export async function getThreadById(){ return null; }
export async function addVoiceComment(thread_id, telegram_id, username, first_name, telegram_file_id){ return { id: Date.now(), thread_id, telegram_id, username, first_name, telegram_file_id, created_at: new Date().toISOString() }; }
export async function getThreadComments(){ return []; }
export async function getCommentById(){ return null; }
export async function addReply(){ return { id: Date.now() }; }
export async function getCommentReplies(){ return []; }
export async function addReaction(){ return { likes:0, dislikes:0, thread_id:null }; }
export default { initDatabase, getOrCreateUser, createCommentThread, addVoiceComment, getThreadComments, getCommentById, addReply, getCommentReplies, addReaction };