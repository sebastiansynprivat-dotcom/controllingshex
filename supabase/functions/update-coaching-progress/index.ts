import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    const { token, progress, xp_earned, current_card_index, commitment_text, boss_fight_result } = body ?? {};
    if (typeof token !== 'string' || token.length < 8) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const patch: Record<string, unknown> = {};

    if (progress && typeof progress === 'object') {
      patch.progress_json = progress;
      if ((progress as any).completed === true) patch.completed_at = new Date().toISOString();
    }
    if (typeof xp_earned === 'number' && Number.isFinite(xp_earned)) {
      patch.xp_earned = Math.max(0, Math.floor(xp_earned));
    }
    if (typeof current_card_index === 'number' && Number.isFinite(current_card_index)) {
      patch.current_card_index = Math.max(0, Math.floor(current_card_index));
    }
    if (typeof commitment_text === 'string') {
      patch.commitment_text = commitment_text.slice(0, 500);
    }
    if (boss_fight_result && typeof boss_fight_result === 'object') {
      patch.boss_fight_result = boss_fight_result;
    }

    if (Object.keys(patch).length === 0) {
      return new Response(JSON.stringify({ ok: true, noop: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { error } = await admin.from('coaching_analyses').update(patch).eq('share_token', token);
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
