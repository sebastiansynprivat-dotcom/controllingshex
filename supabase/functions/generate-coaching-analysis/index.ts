import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-3.5-flash';

interface ChatMessage {
  id?: string;
  type?: string;
  sender?: string;
  content?: { text?: string; url?: string };
}

interface ChatRow {
  chat_id: string;
  recipient_username: string | null;
  updated_at: string;
  chat: any;
}

function formatChatForAI(row: ChatRow, maxMessages = 200): string {
  const messages: ChatMessage[] = Array.isArray(row.chat?.messages) ? row.chat.messages : [];
  const trimmed = messages.slice(-maxMessages);
  const lines = trimmed.map((m) => {
    const role = m.sender === 'model' ? 'CHATTER' : 'KUNDE';
    if (m.type === 'image') return `${role}: [BILD verkauft/gesendet]`;
    if (m.type === 'video') return `${role}: [VIDEO verkauft/gesendet]`;
    const text = m.content?.text ?? '';
    return `${role}: ${text}`;
  });
  return lines.join('\n');
}

async function callGemini(apiKey: string, systemPrompt: string, userPrompt: string, jsonMode = true) {
  const body: any = {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI Gateway ${res.status}: ${err}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? '';
}

function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

async function withConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const jsonResp = (status: number, body: any) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResp(401, { error: 'Missing Authorization header' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user) return jsonResp(401, { error: 'Unauthorized' });

    const aiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!aiKey) return jsonResp(500, { error: 'LOVABLE_API_KEY missing' });

    const body = await req.json().catch(() => ({}));
    const { chatter_name, platform, model_username, date_from, date_to } = body ?? {};
    if (!chatter_name || !platform || !date_from || !date_to) {
      return jsonResp(400, { error: 'chatter_name, platform, date_from, date_to required' });
    }

    // Load coaching material
    const { data: materials } = await supabase
      .from('coaching_materials')
      .select('title, content')
      .eq('is_active', true);

    const coachingText = (materials ?? [])
      .map((m: any) => `# ${m.title}\n${m.content}`)
      .join('\n\n---\n\n')
      .slice(0, 60000);

    // Load chats for this model+platform in date range (by row updated_at)
    let query = supabase
      .from('chats_preview')
      .select('chat_id, recipient_username, updated_at, chat, model_username, platform')
      .eq('platform', platform)
      .gte('updated_at', `${date_from}T00:00:00Z`)
      .lte('updated_at', `${date_to}T23:59:59Z`);

    if (model_username) query = query.eq('model_username', model_username);

    const { data: chats, error: chatsErr } = await query.order('updated_at', { ascending: false }).limit(50);
    if (chatsErr) return jsonResp(500, { error: `Chats-Query fehlgeschlagen: ${chatsErr.message}` });

    if (!chats || chats.length === 0) {
      return jsonResp(200, {
        overall_score: null,
        executive_summary: 'Keine Chats im gewählten Zeitraum gefunden.',
        patterns: [],
        chats: [],
        chats_analyzed: 0,
      });
    }

    const systemPrompt = `Du bist ein erfahrener Sales-Coach für professionelles Chatting im Adult-Creator-Umfeld.

Der User (Team-Lead) hat folgendes Coaching-Material erstellt, das für seine Chatter verbindlich ist:

${coachingText || '(Kein Coaching-Material hinterlegt – bewerte nach Best Practices für Chat-Sales, Rapport-Building, Pricing-Psychologie und Upsells.)'}

Analysiere Chats gegen dieses Material. Bewerte immer konkret mit Zitaten aus dem Chat. Sei ehrlich und konstruktiv. Gib pro "don't" immer ein "besser so"-Beispiel als konkrete Alternativformulierung.

Antworte IMMER als valides JSON gemäß dem angeforderten Schema. Kein Markdown, kein Text drumherum.`;

    // Per-chat analysis
    const chatAnalyses = await withConcurrency(chats as ChatRow[], 3, async (row) => {
      const formatted = formatChatForAI(row);
      const userPrompt = `Analysiere diesen Chat zwischen dem CHATTER (unser Mitarbeiter) und dem KUNDE ${row.recipient_username ?? 'unbekannt'}.

CHAT-VERLAUF:
${formatted}

Gib genau dieses JSON zurück:
{
  "customer_username": "${row.recipient_username ?? 'unbekannt'}",
  "score": <0-100, Gesamtbewertung>,
  "one_line_verdict": "<ein Satz, was hier gut/schlecht lief>",
  "pricing_check": "<Bewertung des Pricings in diesem Chat, mit konkreten €-Beträgen aus dem Chat>",
  "dos": [{"quote": "<Original-Zitat des Chatters>", "why_good": "<warum gut, Bezug zum Coaching>"}],
  "donts": [{"quote": "<Original-Zitat des Chatters>", "problem": "<was ist falsch>", "better": "<so hätte er es sagen sollen (konkrete Formulierung)>"}],
  "revenue_levers": ["<konkreter Hebel 1>", "<konkreter Hebel 2>", "..."]
}`;

      try {
        const raw = await callGemini(aiKey, systemPrompt, userPrompt);
        const parsed = safeParseJSON<any>(raw, null);
        if (!parsed) {
          return { chat_id: row.chat_id, customer_username: row.recipient_username, error: 'AI-Antwort nicht parsbar' };
        }
        return { chat_id: row.chat_id, ...parsed };
      } catch (e) {
        return { chat_id: row.chat_id, customer_username: row.recipient_username, error: (e as Error).message };
      }
    });

    const valid = chatAnalyses.filter((c: any) => !c.error && typeof c.score === 'number');
    const overallScore = valid.length ? Math.round(valid.reduce((s: number, c: any) => s + c.score, 0) / valid.length) : null;

    // Meta / pattern aggregation
    let patterns: any[] = [];
    let executiveSummary = '';
    if (valid.length > 0) {
      const metaPrompt = `Hier sind ${valid.length} Chat-Analysen desselben Chatters (${chatter_name}). Identifiziere wiederkehrende Muster über alle Chats und liefere ein präzises Executive-Summary.

EINZEL-ANALYSEN:
${JSON.stringify(valid, null, 2).slice(0, 40000)}

Gib genau dieses JSON zurück:
{
  "executive_summary": "<3-5 Sätze: was ist die Kern-Story dieses Chatters über alle Chats hinweg>",
  "patterns": [
    {
      "title": "<kurzer Titel des Musters>",
      "type": "positive" | "negative",
      "description": "<was passiert wiederkehrend>",
      "example_quotes": ["<Zitat 1>", "<Zitat 2>"],
      "better_approach": "<nur bei negative: konkretes Beispiel wie es richtig geht>"
    }
  ]
}`;

      try {
        const raw = await callGemini(aiKey, systemPrompt, metaPrompt);
        const parsed = safeParseJSON<any>(raw, { executive_summary: '', patterns: [] });
        executiveSummary = parsed.executive_summary ?? '';
        patterns = Array.isArray(parsed.patterns) ? parsed.patterns : [];
      } catch (e) {
        executiveSummary = `Aggregation fehlgeschlagen: ${(e as Error).message}`;
      }
    }

    return jsonResp(200, {
      overall_score: overallScore,
      executive_summary: executiveSummary,
      patterns,
      chats: chatAnalyses,
      chats_analyzed: valid.length,
      chats_total: chats.length,
    });
  } catch (e) {
    return jsonResp(500, { error: (e as Error).message });
  }
});
