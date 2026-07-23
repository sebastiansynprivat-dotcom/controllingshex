import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { token, lever_index, answer } = await req.json();
    if (typeof token !== 'string' || typeof lever_index !== 'number' || typeof answer !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!answer.trim() || answer.length > 2000) {
      return new Response(JSON.stringify({ error: 'Antwort ist leer oder zu lang' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: row, error } = await admin
      .from('coaching_analyses')
      .select('summary_json, chatter_name')
      .eq('share_token', token)
      .maybeSingle();
    if (error) throw error;
    if (!row) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const levers = (row.summary_json as any)?.top_3_levers ?? [];
    const lever = levers[lever_index];
    if (!lever?.simulation_prompt) {
      return new Response(JSON.stringify({ error: 'Kein Simulations-Prompt für diesen Hebel' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!aiKey) throw new Error('Missing LOVABLE_API_KEY');

    const system = `Du bist ein warmer, direkter Coach für Chatterinnen auf Erotik-Plattformen. Du bewertest EINE Antwort auf eine Simulations-Nachricht.

REGELN:
- Score 0-10 (10 = perfekt für die Situation)
- Sprich immer "du". Nie "Sie".
- Sei ehrlich aber nicht hart. Zeig was gut ist UND was noch besser geht.
- KEINE Preise/Geldbeträge in Beispiel-Formulierungen.
- Antworte NUR mit JSON: {"score": <0-10>, "feedback": "<max 80 Wörter, B1, konkret>"}`;

    const user = `HEBEL: ${lever.title}
KERN: ${lever.one_liner ?? ''}
KONTEXT DIESER SITUATION: ${lever.situation_summary ?? ''}
KUNDEN-PROFIL: ${lever.customer_profile ?? ''}
BEWERTUNGS-KRITERIEN: ${lever.simulation_prompt.evaluation_criteria}

KUNDE HAT GESCHRIEBEN:
${lever.simulation_prompt.customer_message}

DIE CHATTERIN (${row.chatter_name}) ANTWORTET:
${answer}

Bewerte diese Antwort. JSON only.`;

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
        temperature: 0.4,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return new Response(JSON.stringify({ error: `AI Gateway: ${res.status} ${text.slice(0, 200)}` }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content ?? '{}';
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    const score = Math.max(0, Math.min(10, Number(parsed.score ?? 0)));
    const feedback = String(parsed.feedback ?? 'Kein Feedback verfügbar.').slice(0, 800);

    return new Response(JSON.stringify({ score, feedback }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
