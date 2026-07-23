import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { token, lever_index, answer } = await req.json();
    if (typeof token !== 'string' || typeof lever_index !== 'number' || typeof answer !== 'string') {
      return resp({ error: 'Invalid payload' }, 400);
    }
    const trimmed = answer.trim();
    if (!trimmed || trimmed.length > 1500) return resp({ error: 'Antwort leer oder zu lang' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: row, error } = await admin
      .from('coaching_analyses')
      .select('summary_json, chatter_name')
      .eq('share_token', token)
      .maybeSingle();
    if (error) throw error;
    if (!row) return resp({ error: 'Not found' }, 404);

    const lever = ((row.summary_json as any)?.top_3_levers ?? [])[lever_index];
    const drill = lever?.drill;
    if (!drill) return resp({ error: 'Kein Drill für diesen Hebel' }, 400);

    const aiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!aiKey) throw new Error('Missing LOVABLE_API_KEY');

    const system = `Du bist ein warmer Team-Lead im Adult-Chat-Business. Du bewertest eine getippte Antwort auf eine kurze Übung.
REGELN:
- Score 0-10.
- "du"-Ansprache an ${row.chatter_name}.
- Ehrlich, aber motivierend. Kein Coach-Deutsch.
- KEINE Preise/Geldbeträge in Vorschlägen.
- Vergleiche implizit mit der als besser markierten Option (${drill.better_option === 'a' ? 'A' : 'B'}).
- Antworte NUR mit JSON: {"score": <0-10>, "feedback": "<max 60 Wörter, B1, konkret>", "polished": "<max 180 Zeichen — deine polierte Version der Antwort im Stil des Chatters>"}`;

    const user = `SITUATION: ${drill.prompt}
BESSERE MUSTERANTWORT (Referenz, nicht zeigen): ${drill.better_option === 'a' ? drill.option_a : drill.option_b}
WARUM DIE BESSER IST: ${drill.why}

${row.chatter_name} HAT GETIPPT:
${trimmed}

Bewerte. JSON only.`;

    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Lovable-API-Key': aiKey },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
      }),
    });
    if (!res.ok) return resp({ error: `AI Gateway ${res.status}` }, 502);
    const j = await res.json();
    let parsed: any = {};
    try { parsed = JSON.parse(j?.choices?.[0]?.message?.content ?? '{}'); } catch { /* noop */ }
    return resp({
      score: Math.max(0, Math.min(10, Number(parsed.score ?? 0))),
      feedback: String(parsed.feedback ?? '').slice(0, 500),
      polished: String(parsed.polished ?? '').slice(0, 400),
    });
  } catch (e) {
    return resp({ error: (e as Error).message }, 500);
  }
});

function resp(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
