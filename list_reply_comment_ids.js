// list_reply_comment_ids.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

(async () => {
  const { data, error } = await supabase
    .from('voice_replies')
    .select('comment_id, telegram_file_id, reply_text, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('ERR', error);
    return process.exit(1);
  }
  console.log('Latest replies (showing up to 200):');
  (data || []).slice(0, 200).forEach(r => console.log('comment_id=', r.comment_id, 'file=', r.telegram_file_id ? '[voice]' : '-', 'text=', r.reply_text ? r.reply_text.slice(0,60) : '-', 'at=', r.created_at));
})();
