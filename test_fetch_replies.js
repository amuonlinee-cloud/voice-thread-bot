// test_fetch_replies.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

(async () => {
  const commentId = Number(process.argv[2] || 0);
  if (!commentId) {
    console.log('Usage: node test_fetch_replies.js <comment_id>');
    return process.exit(1);
  }
  const { data, error } = await supabase
    .from('voice_replies')
    .select('*')
    .eq('comment_id', commentId)
    .order('created_at', { ascending: false })
    .limit(50);
  console.log({ error });
  console.log('rows:', (data || []).length);
  console.dir(data, { depth: 2 });
})();
