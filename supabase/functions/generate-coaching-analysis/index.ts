import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash';
const CONTROLLING_CHATS_ENDPOINT = 'https://acznyhzgbkdcmnbqvptt.supabase.co/functions/v1/controlling-chats';
const FETCH_CHATS_ENDPOINT = 'https://api.controlling.shexadmin.ngrok.pro/fetch-chats';

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

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
  model_username?: string | null;
  chat: any;
}

interface LiveToken {
  telegramId: string;
  token: string;
  platform: string;
  modelUsername: string | null;
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

function modelKeysFromRow(row: any): string[] {
  const keys = [
    ...jsonObjectKeys(row?.stats_details),
    ...jsonObjectKeys(row?.revenue_details),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    const normalized = normalizeKey(key);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(key);
  }
  return out;
}

function messageText(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (typeof content?.text === 'string') return content.text;
  if (typeof message?.text === 'string') return message.text;
  if (typeof message?.caption === 'string') return message.caption;
  if (typeof message?.message === 'string') return message.message;
  if (typeof message?.body === 'string') return message.body;
  return '';
}

function extractMessages(chat: any): any[] {
  const candidates = [
    chat?.messages,
    chat?.chat?.messages,
    chat?.chat,
    chat?.data?.messages,
    chat?.conversation,
    chat?.history,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
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
    const rawMessages = extractMessages(c);
    const messages = normalizeMessages(rawMessages);
    return {
      chat_id: String(c?.chat_id ?? c?.id ?? c?.user?.chat_id ?? crypto.randomUUID()),
      recipient_username: c?.recipient_username ?? c?.user?.username ?? c?.username ?? c?.recipient?.username ?? null,
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
    sample_messages_len: extractMessages(raw[0]).length,
    sample_chat_type: Array.isArray(raw[0]?.chat) ? 'array' : typeof raw[0]?.chat,
  };

  return { chats: withMessages, debug };
}

async function findLiveToken(input: {
  supabase: any;
  chatter_name: string;
  platform: string;
  model_username: string | null;
}): Promise<LiveToken[]> {
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
  const chatterRows = (liveRows ?? []).filter((row: any) => normalizeKey(row.chatter_name) === chatterKey);
  const exactRows = chatterRows.filter((row: any) => rowHasModel(row, model_username));
  const modelRows = (liveRows ?? []).filter((row: any) => rowHasModel(row, model_username));
  const scopedRows = exactRows.length ? exactRows : chatterRows.length ? chatterRows : modelRows;
  const liveRow = scopedRows[0] ?? null;
  const telegramId = liveRow?.telegram_id;

  if (!telegramId) {
    throw new Error(`Keine telegram_id für ${chatter_name} / ${model_username ?? '?'} auf ${platform} gefunden.`);
  }

  const preferredModelKeys = new Set<string>();
  if (normalizeKey(model_username)) preferredModelKeys.add(normalizeKey(model_username));
  for (const row of scopedRows) {
    for (const key of modelKeysFromRow(row)) preferredModelKeys.add(normalizeKey(key));
  }

  const controllingKey = Deno.env.get('CONTROLLING_CHAT_KEY')?.trim();
  if (!controllingKey) throw new Error('CONTROLLING_CHAT_KEY not configured');

  const ctrlResp = await fetchWithTimeout(CONTROLLING_CHATS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': controllingKey },
    body: JSON.stringify({ telegram_id: telegramId }),
  }, 10000);
  const ctrlText = await ctrlResp.text();
  if (!ctrlResp.ok) {
    throw new Error(`controlling-chats ${ctrlResp.status}: ${ctrlText || ctrlResp.statusText}`);
  }
  const ctrl = JSON.parse(ctrlText || '{}');
  const tokens: Array<{ platform: string; username: string; token: string }> = Array.isArray(ctrl?.tokens) ? ctrl.tokens : [];
  const platformKey = normalizeKey(platform);
  const platformTokens = tokens.filter((t) => normalizeKey(t.platform) === platformKey);
  const selected: LiveToken[] = [];
  const seenTokenKeys = new Set<string>();
  const addToken = (t: { platform: string; username: string; token: string }) => {
    const tokenKey = `${normalizeKey(t.platform)}:${normalizeKey(t.username)}`;
    if (seenTokenKeys.has(tokenKey)) return;
    seenTokenKeys.add(tokenKey);
    selected.push({ telegramId, token: t.token, platform: t.platform, modelUsername: t.username ?? null });
  };

  for (const key of preferredModelKeys) {
    const match = platformTokens.find((t) => normalizeKey(t.username) === key);
    if (match) addToken(match);
  }
  if (selected.length === 0) {
    for (const t of platformTokens.slice(0, 3)) addToken(t);
  }

  if (selected.length === 0) {
    throw new Error(`Kein Token für Model ${model_username ?? '?'} auf ${platform} gefunden.`);
  }

  return selected;
}

async function fetchFreshChats(input: {
  telegramId: string;
  platform: string;
  token: string;
  model_username?: string | null;
  date_from: string;
  date_to: string;
}): Promise<{ chats: ChatRow[]; debug: any }> {
  const res = await fetchWithTimeout(FETCH_CHATS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      telegram_id: input.telegramId,
      platform: input.platform,
      token: input.token,
      date_range: { start: input.date_from, end: input.date_to },
    }),
  }, 15000);
  const text = await res.text();
  if (!res.ok) {
    if (text.includes('ERR_NGROK_3200') || text.toLowerCase().includes('endpoint') && text.toLowerCase().includes('offline')) {
      throw new Error('Der externe Chat-Endpoint ist gerade offline. Bitte fetch-chats wieder starten und dann die Analyse erneut ausführen.');
    }
    throw new Error(`fetch-chats ${res.status}: ${text || res.statusText}`);
  }
  const payload = JSON.parse(text || '{}');
  const normalized = normalizeChatsPayload(payload);
  return {
    chats: normalized.chats.map((chat) => ({ ...chat, model_username: input.model_username ?? null })),
    debug: { ...normalized.debug, http_status: res.status, response_preview: text.slice(0, 300), model_username: input.model_username ?? null },
  };
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

  const res = await fetchWithTimeout(GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Lovable-API-Key': apiKey,
      'X-Lovable-AIG-SDK': 'edge-function',
    },
    body: JSON.stringify(body),
  }, 60000);

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
    const { chatter_name, platform, model_username, date_from, date_to, chats: incomingChats, fetch_only } = body ?? {};
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
    let fetchDebug: any = null;
    if (Array.isArray(incomingChats) && incomingChats.length > 0) {
      chats = normalizeChatsPayload({ chats: incomingChats }).chats;
    } else {
      const liveTokens = await findLiveToken({ supabase, chatter_name, platform, model_username });
      const fetched = await withConcurrency(liveTokens, 2, async (live) => {
        try {
          const result = await fetchFreshChats({
            telegramId: live.telegramId,
            platform: live.platform,
            token: live.token,
            model_username: live.modelUsername,
            date_from,
            date_to,
          });
          return { ok: true as const, live, result };
        } catch (error) {
          return { ok: false as const, live, error: (error as Error).message };
        }
      });

      const deduped = new Map<string, ChatRow>();
      for (const item of fetched) {
        if (!item.ok) continue;
        for (const chat of item.result.chats) {
          deduped.set(`${normalizeKey(chat.model_username)}:${chat.chat_id}`, chat);
        }
      }
      chats = Array.from(deduped.values());
      fetchDebug = {
        telegram_id: liveTokens[0]?.telegramId,
        platform,
        attempted_models: liveTokens.map((t) => t.modelUsername).filter(Boolean),
        raw_count: fetched.filter((i) => i.ok).reduce((sum, i) => sum + (i.result.debug.raw_count ?? 0), 0),
        with_messages_count: chats.length,
        attempts: fetched.map((item) => item.ok
          ? {
              model_username: item.live.modelUsername,
              platform: item.live.platform,
              raw_count: item.result.debug.raw_count,
              with_messages_count: item.result.debug.with_messages_count,
              http_status: item.result.debug.http_status,
              response_preview: item.result.debug.response_preview,
            }
          : {
              model_username: item.live.modelUsername,
              platform: item.live.platform,
              error: item.error,
            }),
      };
    }

    if (chats.length === 0) {
      const dbg = fetchDebug ?? {};
      const summary = `Keine Chats mit Nachrichten im Zeitraum ${date_from} – ${date_to} gefunden. ` +
        `fetch-chats gab ${dbg.raw_count ?? 0} Chats zurück, davon ${dbg.with_messages_count ?? 0} mit Nachrichten. ` +
        (dbg.attempted_models?.length ? `Versuchte Models: ${dbg.attempted_models.join(', ')}. ` : '') +
        (dbg.sample_chat_keys?.length ? `Chat-Felder: ${dbg.sample_chat_keys.join(', ')}. ` : '') +
        (dbg.attempts?.length ? `Details: ${JSON.stringify(dbg.attempts).slice(0, 700)}` : dbg.response_preview ? `Response: ${dbg.response_preview}` : '');
      return jsonResp(200, {
        overall_score: null,
        executive_summary: summary,
        patterns: [],
        chats: [],
        chats_analyzed: 0,
        debug: fetchDebug,
      });
    }

    if (fetch_only === true) {
      return jsonResp(200, {
        chats_total: chats.length,
        debug: fetchDebug,
      });
    }

    const systemPrompt = `Du bist ein erfahrener, sehr wertschätzender Sales-Coach für professionelles Chatting im Adult-Creator-Umfeld. Du schreibst diese Analyse DIREKT an den Chatter "${chatter_name}" — als persönliches Coaching von seinem Team-Lead. Ton: warm, persönlich, ehrlich, aber IMMER motivierend und aufbauend. Nie herablassend, nie hart. Sprich den Chatter mit "du" an.

WICHTIG:
- Formuliere Kritik IMMER positiv und lösungsorientiert ("Hier liegt richtig Umsatz-Potenzial für dich drin, wenn du…").
- Framing: jede Verbesserung = mehr Geld für den Chatter selbst (Prozent, Trinkgeld, Bonus).
- Nutze konkrete Zitate aus dem Chat als Belege — nie abstrakt bleiben.
- Bei "donts" gib immer eine konkrete bessere Formulierung, die er beim nächsten Mal 1:1 einsetzen kann.
- Beginne Sätze niemals mit Vorwürfen. Beginne mit Anerkennung oder Möglichkeit.

Das Coaching-Material des Team-Leads (verbindliche Basis):

${coachingText || '(Kein Coaching-Material hinterlegt – nutze Best Practices für Chat-Sales, Rapport-Building, Pricing-Psychologie und Upsells.)'}

Antworte IMMER als valides JSON gemäß Schema. Kein Markdown, kein Text drumherum.`;

    // Per-chat analysis
    const chatAnalyses = await withConcurrency(chats as ChatRow[], 3, async (row) => {
      const formatted = formatChatForAI(row);
      const userPrompt = `Analysiere diesen Chat zwischen ${chatter_name} (CHATTER) und dem Kunden ${row.recipient_username ?? 'unbekannt'}. Schreibe alle Bewertungen so, als würdest du ${chatter_name} persönlich erklären, was gut lief und wo Geld auf dem Tisch liegen bleibt.

CHAT-VERLAUF:
${formatted}

Gib genau dieses JSON zurück:
{
  "customer_username": "${row.recipient_username ?? 'unbekannt'}",
  "score": <0-100, Gesamtbewertung>,
  "one_line_verdict": "<ein warmer, direkter Satz an dich (${chatter_name}) zu diesem Chat>",
  "pricing_check": "<Bewertung des Pricings, direkt an dich adressiert, mit €-Beträgen aus dem Chat>",
  "dos": [{"quote": "<dein Original-Zitat>", "why_good": "<warum das stark war, motivierend, Bezug zum Coaching>"}],
  "donts": [{"quote": "<dein Original-Zitat>", "problem": "<freundlich erklärt, was hier Umsatz gekostet hat>", "better": "<konkrete bessere Formulierung, die du beim nächsten Mal einsetzen kannst>"}],
  "revenue_levers": ["<konkreter Hebel für mehr Umsatz beim nächsten Chat wie diesem>", "..."]
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
    let personalIntro = '';
    let personalClosing = '';
    let topFocus: string[] = [];
    if (valid.length > 0) {
      const metaPrompt = `Hier sind ${valid.length} Chat-Analysen von ${chatter_name}. Fasse das Coaching persönlich, warm und motivierend für ${chatter_name} zusammen — als hätte sein Team-Lead sich extra Zeit für ihn genommen. Framing: mehr Skill = mehr Cash für dich.

EINZEL-ANALYSEN:
${JSON.stringify(valid, null, 2).slice(0, 40000)}

Gib genau dieses JSON zurück:
{
  "personal_intro": "<2-3 warme, persönliche Sätze an ${chatter_name}. Anerkennung + Setup, warum dieses Coaching für ihn wertvoll ist. Direkte Anrede 'du'.>",
  "executive_summary": "<3-5 Sätze: die Kern-Story über alle Chats hinweg, direkt an ${chatter_name}, ehrlich aber motivierend>",
  "top_focus": ["<Top-Hebel 1 konkret an ${chatter_name}>", "<Top-Hebel 2>", "<Top-Hebel 3>"],
  "patterns": [
    {
      "title": "<kurzer Titel>",
      "type": "positive" | "negative",
      "description": "<was passiert wiederkehrend, direkt an ${chatter_name} adressiert, wertschätzend>",
      "example_quotes": ["<Zitat 1>", "<Zitat 2>"],
      "better_approach": "<nur bei negative: konkrete bessere Formulierung>"
    }
  ],
  "personal_closing": "<2-3 aufbauende Schlusssätze an ${chatter_name}. Fokus: was er als Nächstes umsetzt, warum das seinen Umsatz hebt, Vertrauen. Direkte Anrede 'du'.>"
}`;

      try {
        const raw = await callGemini(aiKey, systemPrompt, metaPrompt);
        const parsed = safeParseJSON<any>(raw, { executive_summary: '', patterns: [] });
        executiveSummary = parsed.executive_summary ?? '';
        patterns = Array.isArray(parsed.patterns) ? parsed.patterns : [];
        personalIntro = parsed.personal_intro ?? '';
        personalClosing = parsed.personal_closing ?? '';
        topFocus = Array.isArray(parsed.top_focus) ? parsed.top_focus : [];
      } catch (e) {
        executiveSummary = `Aggregation fehlgeschlagen: ${(e as Error).message}`;
      }
    }

    return jsonResp(200, {
      overall_score: overallScore,
      executive_summary: executiveSummary,
      personal_intro: personalIntro,
      personal_closing: personalClosing,
      top_focus: topFocus,
      patterns,
      chats: chatAnalyses,
      chats_analyzed: valid.length,
      chats_total: chats.length,
    });
  } catch (e) {
    return jsonResp(500, { error: (e as Error).message });
  }
});
