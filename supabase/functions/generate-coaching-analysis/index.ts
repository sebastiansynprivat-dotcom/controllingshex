import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash';
const CONTROLLING_CHATS_ENDPOINT = 'https://acznyhzgbkdcmnbqvptt.supabase.co/functions/v1/controlling-chats';
const FETCH_CHATS_ENDPOINT = 'https://api.controlling.shexadmin.ngrok.pro/fetch-chats';

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

function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\uFE00-\uFE0F\u200B-\u200D\u2060]/g, '')
    .trim()
    .toLowerCase();
}

function jsonObjectKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>);
}

function rowHasModel(row: any, modelUsername: string | null | undefined): boolean {
  const modelKey = normalizeKey(modelUsername);
  if (!modelKey) return true;
  const keys = [
    ...jsonObjectKeys(row?.stats_details),
    ...jsonObjectKeys(row?.revenue_details),
  ].map(normalizeKey);
  return keys.includes(modelKey);
}

function messageText(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  return content?.text ?? message?.text ?? message?.caption ?? '';
}

function normalizeMessages(rawMessages: unknown): ChatMessage[] {
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages.map((m: any) => {
    const type = m?.type ?? (m?.content?.url || m?.url ? 'image' : 'text');
    const text = messageText(m);
    return {
      id: String(m?.id ?? crypto.randomUUID()),
      type,
      sender: m?.sender ?? m?.from ?? m?.role ?? 'customer',
      content: {
        ...(m?.content && typeof m.content === 'object' ? m.content : {}),
        text,
        url: m?.content?.url ?? m?.url,
      },
    };
  });
}

function normalizeChatsPayload(payload: any): { chats: ChatRow[]; debug: any } {
  const raw: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.chats)
      ? payload.chats
      : Array.isArray(payload?.data?.chats)
        ? payload.data.chats
        : [];

  const mapped = raw.map((c: any) => {
    const messages = normalizeMessages(c?.messages ?? c?.chat?.messages ?? []);
    return {
      chat_id: String(c?.chat_id ?? c?.id ?? crypto.randomUUID()),
      recipient_username: c?.recipient_username ?? c?.user?.username ?? c?.username ?? null,
      updated_at: c?.updated_at ?? new Date().toISOString(),
      chat: { ...c, messages },
    };
  });
  const withMessages = mapped.filter((c) => Array.isArray(c.chat.messages) && c.chat.messages.length > 0);

  const debug = {
    payload_keys: payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 10) : [],
    raw_count: raw.length,
    with_messages_count: withMessages.length,
    sample_chat_keys: raw[0] && typeof raw[0] === 'object' ? Object.keys(raw[0]).slice(0, 20) : [],
    sample_messages_len: Array.isArray(raw[0]?.messages) ? raw[0].messages.length : null,
  };

  return { chats: withMessages, debug };
}

async function findLiveToken(input: {
  supabase: any;
  chatter_name: string;
  platform: string;
  model_username: string | null;
}) {
  const { supabase, chatter_name, platform, model_username } = input;
  const { data: liveRows, error } = await supabase
    .from('chatter_history_live')
    .select('telegram_id, chatter_name, platform, stats_details, revenue_details, updated_at, date')
    .eq('platform', platform)
    .not('telegram_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1000);

  if (error) throw new Error(`Live-Daten nicht abrufbar: ${error.message}`);

  const chatterKey = normalizeKey(chatter_name);
  const exact = (liveRows ?? []).find((row: any) => normalizeKey(row.chatter_name) === chatterKey && rowHasModel(row, model_username));
  const byModel = (liveRows ?? []).find((row: any) => rowHasModel(row, model_username));
  const byChatter = (liveRows ?? []).find((row: any) => normalizeKey(row.chatter_name) === chatterKey);
  const liveRow = exact ?? byModel ?? byChatter;
  const telegramId = liveRow?.telegram_id;

  if (!telegramId) {
    throw new Error(`Keine telegram_id für ${chatter_name} / ${model_username ?? '?'} auf ${platform} gefunden.`);
  }

  const controllingKey = Deno.env.get('CONTROLLING_CHAT_KEY')?.trim();
  if (!controllingKey) throw new Error('CONTROLLING_CHAT_KEY not configured');

  const ctrlResp = await fetch(CONTROLLING_CHATS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': controllingKey },
    body: JSON.stringify({ telegram_id: telegramId }),
  });
  const ctrlText = await ctrlResp.text();
  if (!ctrlResp.ok) {
    throw new Error(`controlling-chats ${ctrlResp.status}: ${ctrlText || ctrlResp.statusText}`);
  }
  const ctrl = JSON.parse(ctrlText || '{}');
  const tokens: Array<{ platform: string; username: string; token: string }> = Array.isArray(ctrl?.tokens) ? ctrl.tokens : [];
  const platformKey = normalizeKey(platform);
  const modelKey = normalizeKey(model_username);
  const match = tokens.find((t) => normalizeKey(t.platform) === platformKey && (!modelKey || normalizeKey(t.username) === modelKey));
  if (!match) {
    throw new Error(`Kein Token für Model ${model_username ?? '?'} auf ${platform} gefunden.`);
  }

  return { telegramId, token: match.token, platform: match.platform };
}

async function fetchFreshChats(input: {
  telegramId: string;
  platform: string;
  token: string;
  date_from: string;
  date_to: string;
}): Promise<{ chats: ChatRow[]; debug: any }> {
  const res = await fetch(FETCH_CHATS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      telegram_id: input.telegramId,
      platform: input.platform,
      token: input.token,
      date_range: { start: input.date_from, end: input.date_to },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    if (text.includes('ERR_NGROK_3200') || text.toLowerCase().includes('endpoint') && text.toLowerCase().includes('offline')) {
      throw new Error('Der externe Chat-Endpoint ist gerade offline. Bitte fetch-chats wieder starten und dann die Analyse erneut ausführen.');
    }
    throw new Error(`fetch-chats ${res.status}: ${text || res.statusText}`);
  }
  const payload = JSON.parse(text || '{}');
  const normalized = normalizeChatsPayload(payload);
  return { chats: normalized.chats, debug: { ...normalized.debug, http_status: res.status, response_preview: text.slice(0, 300) } };
}

function formatChatForAI(row: ChatRow, maxMessages = 200): string {
  const messages: ChatMessage[] = Array.isArray(row.chat?.messages) ? row.chat.messages : [];
  const trimmed = messages.slice(-maxMessages);
  const lines = trimmed.map((m) => {
    const role = m.sender === 'model' ? 'CHATTER' : 'KUNDE';
    if (m.type === 'image') return `${role}: [BILD verkauft/gesendet]`;
    if (m.type === 'video') return `${role}: [VIDEO verkauft/gesendet]`;
    const text = messageText(m);
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
    const { chatter_name, platform, model_username, date_from, date_to, chats: incomingChats } = body ?? {};
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

    // Prefer chats passed directly from the client for backward compatibility.
    // Normal path: fetch fresh chats server-side so the browser never depends on CORS or manual chats_preview saves.
    let chats: ChatRow[] = [];
    if (Array.isArray(incomingChats) && incomingChats.length > 0) {
      chats = normalizeChatsPayload({ chats: incomingChats });
    } else {
      const live = await findLiveToken({ supabase, chatter_name, platform, model_username });
      chats = await fetchFreshChats({
        telegramId: live.telegramId,
        platform: live.platform,
        token: live.token,
        date_from,
        date_to,
      });
    }

    if (chats.length === 0) {
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
