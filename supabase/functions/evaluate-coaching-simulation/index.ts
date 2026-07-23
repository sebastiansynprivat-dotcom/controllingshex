import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash';

interface Turn {
  role: 'customer' | 'chatter';
  text: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    const {
      token,
      mode = 'evaluate_single',
      lever_index,
      answer,
      turn_history,
    }: {
      token: string;
      mode?: 'evaluate_single' | 'customer_reply' | 'boss_final';
      lever_index?: number;
      answer?: string;
      turn_history?: Turn[];
    } = body ?? {};

    if (typeof token !== 'string' || token.length < 8) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: row, error } = await admin
      .from('coaching_analyses')
      .select('summary_json, chatter_name')
      .eq('share_token', token)
      .maybeSingle();
    if (error) throw error;
    if (!row) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const aiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!aiKey) throw new Error('Missing LOVABLE_API_KEY');

    const summary = row.summary_json as any;
    const chatterName = row.chatter_name;

    // === MODE 1: single-turn per-lever evaluation (legacy) ===
    if (mode === 'evaluate_single') {
      if (typeof lever_index !== 'number' || typeof answer !== 'string' || !answer.trim() || answer.length > 2000) {
        return new Response(JSON.stringify({ error: 'lever_index and answer required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const lever = (summary?.top_3_levers ?? [])[lever_index];
      if (!lever?.simulation_prompt) {
        return new Response(JSON.stringify({ error: 'Kein Simulations-Prompt für diesen Hebel' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const system = `Du bist ein warmer, direkter Coach für Chatterinnen auf Erotik-Plattformen. Du bewertest EINE Antwort.
REGELN:
- Score 0-10 (10 = perfekt).
- "du"-Ansprache, kein "Sie".
- Ehrlich aber freundlich. Zeig was gut ist UND was besser geht.
- KEINE Preise/Geldbeträge in Beispiel-Formulierungen.
- Antworte NUR mit JSON: {"score": <0-10>, "feedback": "<max 80 Wörter, B1>", "improved_reply": "<max 200 Zeichen — im Stil des Chatters — bessere Version der Antwort. Kein Preis.>"}`;

      const user = `HEBEL: ${lever.title}
KERN: ${lever.one_liner ?? ''}
KONTEXT: ${lever.situation_summary ?? ''}
KUNDEN-PROFIL: ${lever.customer_profile ?? ''}
BEWERTUNG: ${lever.simulation_prompt.evaluation_criteria}

KUNDE HAT GESCHRIEBEN:
${lever.simulation_prompt.customer_message}

${chatterName} ANTWORTET:
${answer}

Bewerte diese Antwort. JSON only.`;

      const res = await callGateway(aiKey, system, user);
      const parsed = safeJson(res);
      const score = Math.max(0, Math.min(10, Number(parsed.score ?? 0)));
      const feedback = String(parsed.feedback ?? '').slice(0, 800);
      const improved_reply = String(parsed.improved_reply ?? '').slice(0, 400);
      return json({ score, feedback, improved_reply });
    }

    // === MODE 2: multi-turn boss-fight — KI antwortet als Kunde ===
    if (mode === 'customer_reply') {
      const scenario = summary?.boss_scenario;
      if (!scenario) return json({ error: 'Kein Boss-Scenario' }, 400);
      const history = Array.isArray(turn_history) ? turn_history : [];

      const system = `Du spielst einen Kunden auf einer Erotik-Chat-Plattform in einer Trainings-Simulation.
KUNDEN-ROLLE: ${scenario.customer_alias}
PROFIL: ${scenario.customer_profile}
ZIEL DES CHATTERS (nicht du!): ${scenario.goal}

REGELN:
- Bleib IN DER ROLLE. Antworte NUR als der Kunde.
- 1-2 Sätze pro Antwort, wie ein echter Fan tippt (locker, direkt, teils sexuell). Nicht zu lang.
- Reagiere natürlich auf das was der Chatter geschrieben hat — sei nicht zu leicht und nicht zu hart.
- Wenn der Chatter gut arbeitet: zeig Interesse, werde wärmer. Wenn schlecht: werde skeptischer/kühler.
- KEIN Meta-Kommentar. Kein Coach-Ton. Nur Kunden-Nachricht.
- Antworte NUR mit JSON: {"reply": "<Kunden-Nachricht, max 200 Zeichen>", "engagement_delta": <-2..2 wie sehr Interesse gestiegen/gesunken durch die letzte Chatter-Nachricht>}`;

      const historyText = history.map((t) => `${t.role === 'customer' ? 'KUNDE' : 'CHATTER'}: ${t.text}`).join('\n');
      const user = `BISHERIGER VERLAUF:\n${historyText || '(noch leer)'}\n\nDeine nächste Antwort als Kunde. JSON only.`;

      const res = await callGateway(aiKey, system, user);
      const parsed = safeJson(res);
      const reply = String(parsed.reply ?? '').slice(0, 400);
      const engagement_delta = Math.max(-2, Math.min(2, Number(parsed.engagement_delta ?? 0)));
      return json({ reply, engagement_delta });
    }

    // === MODE 3: boss-fight final scoring ===
    if (mode === 'boss_final') {
      const scenario = summary?.boss_scenario;
      const history = Array.isArray(turn_history) ? turn_history : [];
      const historyText = history.map((t) => `${t.role === 'customer' ? 'KUNDE' : 'CHATTER'}: ${t.text}`).join('\n');

      const system = `Du bist Team-Lead und bewertest das Ergebnis eines Boss-Fight-Simulators.
REGELN:
- Score 0-100.
- Bewerte: Bindungsaufbau, Verkaufs-Chance genutzt, Stil-Passung, KEINE Preis-Nennung.
- "du"-Ansprache an ${chatterName}.
- Antworte NUR mit JSON: {"score": <0-100>, "verdict": "<max 6 Wörter, z.B. 'Souverän geschlossen' / 'Chance vertan'>", "revenue_potential_eur": <geschätzter €-Betrag den ein Top-Chatter in dieser Situation gemacht hätte>, "feedback": "<max 100 Wörter, konkret, B1, mit 1 Verbesserung>"}`;

      const user = `SZENARIO: ${scenario?.customer_profile}\nZIEL: ${scenario?.goal}\n\nGESAMTER VERLAUF:\n${historyText}\n\nBewerte. JSON only.`;
      const res = await callGateway(aiKey, system, user);
      const parsed = safeJson(res);
      return json({
        score: Math.max(0, Math.min(100, Number(parsed.score ?? 0))),
        verdict: String(parsed.verdict ?? '').slice(0, 80),
        revenue_potential_eur: Math.max(0, Number(parsed.revenue_potential_eur ?? 0)),
        feedback: String(parsed.feedback ?? '').slice(0, 800),
      });
    }

    return json({ error: 'Unknown mode' }, 400);
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

async function callGateway(apiKey: string, system: string, user: string): Promise<string> {
  const res = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Lovable-API-Key': apiKey },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.6,
    }),
  });
  if (!res.ok) throw new Error(`AI Gateway ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j?.choices?.[0]?.message?.content ?? '{}';
}

function safeJson(raw: string): any {
  try { return JSON.parse(raw); } catch { return {}; }
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
