const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey, {
  realtime: { transport: ws },
});

function createUserClient(accessToken) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    realtime: { transport: ws },
  });
}

module.exports = { supabaseAdmin, createUserClient };
