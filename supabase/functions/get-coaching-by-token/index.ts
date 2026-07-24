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
      .select('id, user_id, chatter_name, platform, model_username, date_from, date_to, pdf_path, summary_json, chats_analyzed, created_at, share_token, progress_json, completed_at')
      .eq('share_token', token)
      .maybeSingle();
    if (error) throw error;
    if (!data) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Load memos + signed URLs
    const { data: memoRows } = await admin
      .from('coaching_memos')
      .select('id, card_key, audio_path, duration_ms, created_at, updated_at')
      .eq('coaching_id', data.id);
    const memos: any[] = [];
    for (const m of memoRows ?? []) {
      let url: string | null = null;
      try {
        const { data: signed } = await admin.storage.from('coaching-memos').createSignedUrl(m.audio_path, 60 * 60 * 6);
        url = signed?.signedUrl ?? null;
      } catch { /* noop */ }
      memos.push({ ...m, audio_url: url });
    }

    return new Response(JSON.stringify({ ...data, memos }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
