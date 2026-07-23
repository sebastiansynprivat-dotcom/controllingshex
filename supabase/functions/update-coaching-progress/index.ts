import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { token, progress } = await req.json();
    if (typeof token !== 'string' || token.length < 8) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!progress || typeof progress !== 'object') {
      return new Response(JSON.stringify({ error: 'Invalid progress' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const patch: Record<string, unknown> = { progress_json: progress };
    if (progress.completed === true) patch.completed_at = new Date().toISOString();

    const { error } = await admin
      .from('coaching_analyses')
      .update(patch)
      .eq('share_token', token);
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
