import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Placeholder: returns a hardcoded list of assigned models for a chatter.
// TODO: replace with real upstream call.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    let telegramId: string | undefined;
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.telegram_id === 'string') telegramId = body.telegram_id;
    }

    const models = [
      { platform: 'maloum', username: 'lena.rose' },
      { platform: 'maloum', username: 'mia.k' },
      { platform: '4based', username: 'sophie_x' },
      { platform: 'brezzels', username: 'ava.moon' },
    ];

    return new Response(
      JSON.stringify({ telegram_id: telegramId ?? null, models }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    );
  }
});
