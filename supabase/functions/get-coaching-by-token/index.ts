import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { token } = await req.json();
    if (typeof token !== 'string' || token.length < 8) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await admin
      .from('coaching_analyses')
      .select('id, chatter_name, platform, model_username, date_from, date_to, pdf_path, summary_json, chats_analyzed, created_at, share_token, progress_json, completed_at')
      .eq('share_token', token)
      .maybeSingle();
    if (error) throw error;
    if (!data) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
