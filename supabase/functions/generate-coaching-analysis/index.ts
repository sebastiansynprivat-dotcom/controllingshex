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
    const rawType = (m?.type ?? '').toString().toLowerCase();
    const type = rawType || (m?.content?.url || m?.url ? 'image' : 'text');
    const text = messageText(m);
    const price = m?.price ?? m?.content?.price ?? m?.amount ?? m?.content?.amount ?? null;
    const purchased = m?.purchased ?? m?.content?.purchased ?? m?.is_purchased ?? m?.content?.is_purchased ?? null;
    return {
      id: String(m?.id ?? crypto.randomUUID()),
      type,
      sender: m?.sender ?? m?.from ?? m?.role ?? 'customer',
      content: {
        ...(m?.content && typeof m.content === 'object' ? m.content : {}),
        text,
        url: m?.content?.url ?? m?.url,
        price,
        purchased,
      },
    } as any;
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

function formatChatForAI(row: ChatRow, maxMessages = 200): { text: string; revenue: number; purchases: number; sends: number } {
  const messages: any[] = Array.isArray(row.chat?.messages) ? row.chat.messages : [];
  const trimmed = messages.slice(-maxMessages);
  let revenue = 0;
  let purchases = 0;
  let sends = 0;
  const lines = trimmed.map((m) => {
    const role = m.sender === 'model' ? 'CHATTER' : 'KUNDE';
    const type = (m.type ?? '').toLowerCase();
    const price = Number(m?.content?.price ?? m?.price ?? 0) || 0;
    const purchased = m?.content?.purchased === true || m?.purchased === true || (type === 'tip' && price > 0);
    if (type === 'chat_product') {
      sends += 1;
      if (purchased) { purchases += 1; revenue += price; }
      return `${role}: [PPV angeboten ${price ? price + '€' : ''}${purchased ? ' — GEKAUFT' : ' — nicht gekauft'}]`;
    }
    if (type === 'tip') {
      if (price > 0) { revenue += price; purchases += 1; }
      return `${role}: [TRINKGELD ${price}€]`;
    }
    if (type === 'media' || type === 'image' || type === 'video') {
      return `${role}: [${type === 'video' ? 'VIDEO' : 'BILD'} gesendet${price ? ' — ' + price + '€' : ''}]`;
    }
    const text = messageText(m);
    return `${role}: ${text}`;
  });
  return { text: lines.join('\n'), revenue, purchases, sends };
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

    // === Chatter-Gesamtperformance (alle Models) im Zeitraum vs. Vorperiode ===
    // Wichtig um korrekt zu unterscheiden zwischen
    //   "keine Verkäufe in den analysierten Chats" vs "gar keine Verkäufe insgesamt".
    async function loadChatterTotals(from: string, to: string) {
      const { data, error } = await supabase
        .from('chatter_history')
        .select('account, revenue_today, mass_dms, analysis_date')
        .eq('platform', platform)
        .eq('chatter_name', chatter_name)
        .gte('analysis_date', from)
        .lte('analysis_date', to);
      if (error) return { revenue: 0, mass_dms: 0, days: 0, per_model: {} as Record<string, number> };
      let revenue = 0;
      let mass_dms = 0;
      const daySet = new Set<string>();
      const per_model: Record<string, number> = {};
      for (const r of data ?? []) {
        const rev = Number((r as any).revenue_today) || 0;
        revenue += rev;
        mass_dms += Number((r as any).mass_dms) || 0;
        if ((r as any).analysis_date) daySet.add(String((r as any).analysis_date));
        const acc = String((r as any).account ?? '').trim();
        if (acc) per_model[acc] = (per_model[acc] ?? 0) + rev;
      }
      return { revenue, mass_dms, days: daySet.size, per_model };
    }
    function shiftDate(d: string, days: number): string {
      const dt = new Date(d + 'T00:00:00Z');
      dt.setUTCDate(dt.getUTCDate() + days);
      return dt.toISOString().slice(0, 10);
    }
    const rangeDays = Math.max(1, Math.round(
      (new Date(date_to + 'T00:00:00Z').getTime() - new Date(date_from + 'T00:00:00Z').getTime()) / 86400000
    ) + 1);
    const prevFrom = shiftDate(date_from, -rangeDays);
    const prevTo = shiftDate(date_from, -1);
    const [currentTotals, previousTotals] = await Promise.all([
      loadChatterTotals(date_from, date_to),
      loadChatterTotals(prevFrom, prevTo),
    ]);
    const deltaPct = previousTotals.revenue > 0
      ? Math.round(((currentTotals.revenue - previousTotals.revenue) / previousTotals.revenue) * 100)
      : null;

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

    const systemPrompt = `Du bist ein warmer, ehrlicher Sales-Coach für Chatting im Adult-Creator-Umfeld. Du schreibst DIREKT an "${chatter_name}" wie sein Team-Lead — freundlich, respektvoll, auf Augenhöhe.

DEIN AUFTRAG (radikal fokussiert):
Das PDF hat 6 Seiten. Es enthält GENAU 3 Hebel + GENAU 1 Stärke + GENAU 1 Wachstumsfeld + GENAU 1 Mikro-Aktion.
Keine Chat-für-Chat-Analyse. Keine Do/Dont-Listen. Keine Wiederholungen. Keine Muster-Sektion.
Weniger ist mehr. Mensch kann sich pro Coaching nur 3–4 Dinge merken.

SPRACHE — HARTE REGELN:
- KEINE Fachbegriffe. Nicht "Rapport", nicht "Upsell", nicht "Anchoring", nicht "Frame", nicht "Basic-First". Sag direkt was gemeint ist.
- Kurze Sätze. Alltagssprache. "Du"-Ansprache — IMMER Einzahl, direkt an ${chatter_name}.
- KEINE Emojis in Prosa-Feldern.
- VERBOTEN: jede Mehrzahl-/Kollektiv-Formulierung wie "habt ihr", "ihr auf ${platform}", "in euren Chats", "euer Team". Immer strikt Singular: "hast du", "deine Arbeit auf ${platform}", "in deinen Chats" (allgemein, ohne Zahl).
- NIE eine Chat-Anzahl nennen ("28 Chats", "X Chats gelesen" o.ä.). Halt es allgemein: "ich habe mir deine Arbeit auf ${platform} angeschaut".
- NIEMALS "wir" für den Chatter.

COACHING-TABU (absolute Regeln):
- Bring dem Chatter NIEMALS bei, den Kunden nach dem Preis zu fragen ("Was wärst du bereit zu zahlen?", "Was ist dir das wert?" usw.). Das ist verboten und widerspricht dem Coaching.
- Der Chatter setzt den Preis, nicht der Kunde.
- Wenn du einen besseren Vorschlag machst: korrigiere die konkrete Formulierung, die der CHATTER selbst gesagt hat. Zeig, wie er es besser formulieren würde — nicht, was er den Kunden fragen soll.

KONTEXT VOR KRITIK (sehr wichtig):
- Bewerte JEDEN Chatter-Move IMMER im Kontext, in dem er gefallen ist. Schau dir an, was der KUNDE davor gemacht hat.
- Wenn der Kunde selbst hart sexuell reingeht, ist es oft die richtige Entscheidung des Chatters, mitzugehen — sonst bricht die Spannung und der Kunde ist weg. Das darfst du NICHT als Schwäche framen.
- Erkenne den natürlichen Stil des Chatters aus den Digests (baut viel Bindung auf? geht tief? eher schnell auf den Verkauf? spielerisch? dominant?) und respektiere ihn. Hebel und Kritik dürfen dem Stil nicht widersprechen — sie sollen ihn schärfen.
- Wenn eine Situation dem Chatter kaum Handlungsspielraum ließ (z.B. Kunde eskaliert sofort sexuell, Kunde will nur Sexting), erwähne das im Feedback ausdrücklich, bevor du Verbesserungen vorschlägst. Sonst wirkt es kontextlos und unfair.
- Formuliere Feedback in dieser Struktur: erst kurz "die Situation war X" → dann "in dem Rahmen hast du Y gemacht" → dann "hier hättest du noch Z rausholen können, ohne den Kunden zu verlieren".

VERKÄUFE ZUERST ANSCHAUEN:
- Im Chat siehst du "[PPV angeboten Xe — GEKAUFT]" / "— nicht gekauft" / "[TRINKGELD Xe]".
- Wenn Verkäufe passiert sind: das ist die Stärke. Nicht kaputtreden.
- Wenn nichts gekauft wurde trotz Angeboten: da liegt der wichtigste Hebel — aber nur, wenn der Kontext einen Verkauf überhaupt zugelassen hätte.

Coaching-Material des Team-Leads (verbindliche Basis — Fachbegriffe daraus in Alltagssprache übersetzen):

${coachingText || '(Kein Material hinterlegt — nutze gesunden Menschenverstand für Verkauf, Vertrauen und Nähe im Chat.)'}

Antworte IMMER als valides JSON gemäß Schema. Kein Markdown drumherum.`;

    // Lightweight per-chat pass — nur um Rohmaterial (Zitate + Ergebnis) zu sammeln.
    // KEINE ausführliche Analyse pro Chat mehr — nur Datenpunkte für den Meta-Pass.
    const chatDigests = await withConcurrency(chats as ChatRow[], 3, async (row) => {
      const formatted = formatChatForAI(row);
      const digestPrompt = `Kurz-Zusammenfassung dieses Chats für die spätere Gesamt-Analyse.
Kunde: ${row.recipient_username ?? 'unbekannt'}
Umsatz: ${formatted.revenue.toFixed(2)}€, PPVs angeboten: ${formatted.sends}, Käufe/Tips: ${formatted.purchases}

CHAT:
${formatted.text}

Antworte als JSON:
{
  "customer": "${row.recipient_username ?? 'unbekannt'}",
  "revenue_eur": ${formatted.revenue.toFixed(2)},
  "outcome": "sale" | "attempt_no_sale" | "no_attempt",
  "score": <0-100 — bei Umsatz mindestens 65, bei starkem Umsatz 80+>,
  "strongest_moment": {"situation": "<1 Satz was vorher lief>", "quote": "<Original-Zitat vom Chatter, max 200 Zeichen>"} | null,
  "weakest_moment": {"situation": "<1 Satz>", "quote": "<Original-Zitat vom Chatter, max 200 Zeichen>"} | null,
  "one_liner": "<1 Satz was in diesem Chat besonders war>"
}`;
      try {
        const raw = await callGemini(aiKey, systemPrompt, digestPrompt);
        const parsed = safeParseJSON<any>(raw, null);
        if (!parsed) return { chat_id: row.chat_id, customer: row.recipient_username, error: 'parse fail' };
        return { chat_id: row.chat_id, revenue_eur: formatted.revenue, purchases: formatted.purchases, ppvs_sent: formatted.sends, ...parsed };
      } catch (e) {
        return { chat_id: row.chat_id, customer: row.recipient_username, error: (e as Error).message };
      }
    });

    const validDigests = chatDigests.filter((c: any) => !c.error && typeof c.score === 'number');
    const overallScore = validDigests.length
      ? Math.round(validDigests.reduce((s: number, c: any) => s + c.score, 0) / validDigests.length)
      : null;

    // Meta pass — der EINZIGE Analyse-Pass der zählt. Erzeugt genau das schlanke 6-Seiten-Schema.
    let focusedResult: any = null;
    if (validDigests.length > 0) {
      const totalRevenue = validDigests.reduce((s: number, c: any) => s + (Number(c.revenue_eur) || 0), 0);
      const chatsWithRevenue = validDigests.filter((c: any) => Number(c.revenue_eur) > 0).length;
      const bestChat = [...validDigests].sort((a: any, b: any) => (b.revenue_eur || 0) - (a.revenue_eur || 0))[0];
      const bestKpi = totalRevenue > 0
        ? `${totalRevenue.toFixed(0)}€ Umsatz aus ${validDigests.length} Chats (${chatsWithRevenue} mit Verkauf)`
        : `${validDigests.length} Chats analysiert, 0€ Umsatz`;

      const analyzedModelKey = normalizeKey(model_username);
      const overallRevenue = currentTotals.revenue;
      const overallHasSales = overallRevenue > 0;
      const analyzedHasSales = totalRevenue > 0;
      const perModelList = Object.entries(currentTotals.per_model)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([m, r]) => `${m}: ${r.toFixed(0)}€`)
        .join(', ') || '—';
      const analyzedModelRevenue = analyzedModelKey
        ? (Object.entries(currentTotals.per_model)
            .find(([m]) => normalizeKey(m) === analyzedModelKey)?.[1] ?? 0)
        : null;

      const salesContextBlock = `VERKAUFS-KONTEXT (WICHTIG — bestimmt den Ton des Intros):
- Analysierte Chats: ${bestKpi}${totalRevenue > 0 ? `. Bester analysierter Chat: ${bestChat?.customer} mit ${Number(bestChat?.revenue_eur).toFixed(0)}€.` : ''}
- Gesamtperformance ${chatter_name} auf ${platform} im Zeitraum ${date_from}—${date_to} (ALLE Models): ${overallRevenue.toFixed(0)}€ Umsatz an ${currentTotals.days} Tagen, ${currentTotals.mass_dms} MassDMs.
- Aufteilung nach Model: ${perModelList}
${analyzedModelKey ? `- Analysiertes Model "${model_username}" hat im Zeitraum insgesamt ${Number(analyzedModelRevenue ?? 0).toFixed(0)}€ gemacht.` : ''}
- Vorperiode (${prevFrom}—${prevTo}): ${previousTotals.revenue.toFixed(0)}€, ${previousTotals.mass_dms} MassDMs.
- Umsatz-Delta vs. Vorperiode: ${deltaPct === null ? 'keine Vergleichsdaten' : (deltaPct > 0 ? '+' : '') + deltaPct + '%'}.

REGEL für personal_intro:
- Formuliere allgemein — NIE eine Chat-Anzahl nennen ("28 Chats", "deine X Chats" o.ä. verboten). Sag stattdessen "ich habe mir deine Arbeit auf ${platform} angeschaut".
- Immer Singular / kollektiv: "habt ihr auf ${platform} diese Woche…", nicht "in deinen Chats".
- Sag NIE "leider keine Verkäufe" pauschal, wenn die Gesamt-Umsätze > 0 sind.
- Wenn analysierte Chats 0€ hatten ABER Gesamt-Umsatz > 0: sag ehrlich "in dem, was ich gesehen habe, war noch kein Abschluss dabei — insgesamt aber X€ auf ${platform}".
- Wenn analysierte Chats Umsatz hatten: würdige den konkreten Betrag, ohne Chat-Anzahlen zu erwähnen.
- Nur wenn Analysiert=0 UND Gesamt=0: dann darfst du sagen, dass in dem Zeitraum insgesamt noch nichts verkauft wurde.`;

      const metaPrompt = `Du hast dir die Arbeit von ${chatter_name} angeschaut. Baue daraus das FINALE 6-Seiten-Coaching. Nenne dabei NIE die Anzahl der Chats.
Regeln:
- GENAU 3 Hebel (top_3_levers). Nicht mehr, nicht weniger. Priorisiere den Hebel mit dem größten Cash-Impact zuerst.
- GENAU 1 Stärke (sbi_feedback.strength) und GENAU 1 Wachstumsfeld (sbi_feedback.growth). Nimm die stärksten Beispiele aus den Digests.
- GENAU 1 Mikro-Aktion (micro_action) — konkret, in 7 Tagen umsetzbar, an eine bestehende Routine gekoppelt.
- KEINE Fachbegriffe. Alltagssprache.
- Zitate NUR aus den Digests, wortwörtlich, nichts erfinden.

${salesContextBlock}

CHAT-DIGESTS:
${JSON.stringify(validDigests, null, 2).slice(0, 30000)}

JSON-Schema (EXAKT einhalten):
{
  "personal_intro": "<2 warme Sätze an ${chatter_name}. Beziehe dich präzise auf den VERKAUFS-KONTEXT oben. Analysierte Chats vs. Gesamtperformance klar trennen.>",
  "headline_promise": "<EIN Satz Versprechen für die Cover-Seite, z.B. 'Diese 3 Moves bringen dir nächste Woche mehr Verkäufe.'>",
  "weekly_comparison": {
    "current_revenue_eur": ${overallRevenue.toFixed(0)},
    "previous_revenue_eur": ${previousTotals.revenue.toFixed(0)},
    "delta_pct": ${deltaPct === null ? 'null' : deltaPct},
    "headline": "<Sehr kurzer Titel, max 5 Wörter, z.B. 'Stark verbessert', 'Leichter Rückgang', 'Erste Woche mit Daten'>",
    "summary": "<1 Satz, konkret mit Zahlen, z.B. 'Diese Periode 1.240€, Vorperiode 890€ — +39%.' Wenn keine Vorperiode: sag das ehrlich.>"
  },
  "top_3_levers": [
    {
      "icon_hint": "connection" | "close" | "timing" | "pricing" | "followup" | "listening",
      "title": "<3-5 Wörter, kein Fachbegriff>",
      "principle": "<1 Satz warum dieser Hebel Geld bringt>",
      "wrong_example": "<echtes kurzes Zitat des CHATTERS aus den Digests (nicht des Kunden), das man besser formulieren kann, max 140 Zeichen>",
      "better_example": "<Bessere Formulierung DIESES Chatter-Satzes, die er 1:1 statt der wrong_example sagen kann. NIEMALS den Kunden nach dem Preis fragen. Max 200 Zeichen.>",
      "if_then_script": "<Wenn X vom Kunden kommt, dann sage Y. Konkreter Satz des Chatters zum auswendig lernen. Kein Preis-Frage-Skript.>",
      "story": "<2-3 Sätze Mini-Story im Ton eines erfahrenen Kollegen: 'Ich hatte mal einen Fan, der... — als ich dann X gemacht habe, hat er Y gekauft.' Konkret, bildhaft, motivierend. Zeigt dem Chatter: 'Krass, das will ich auch.' Nutze plausible Situationen aus dem OnlyFans/Fansly-Alltag. Max 320 Zeichen.>",
      "money_example": "<1-2 Sätze mit KONKRETER Zahl, was dieser Hebel bringen kann. Beispiel: 'Ein guter Kennenlern-Chat bringt im Schnitt 40-80€ mehr pro Woche pro Fan — bei 10 Fans sind das schnell 500-800€ extra im Monat.' Manipulativ im Sinne von: das Geld liegt auf der Straße. Max 260 Zeichen.>"
    }
  ],
  "sbi_feedback": {
    "strength": {
      "situation": "<Situation: welcher Chat, was war los>",
      "behavior": "<Was ${chatter_name} konkret getan/gesagt hat — mit Zitat wenn möglich>",
      "impact": "<Was das bewirkt hat — Umsatz, Reaktion des Kunden>"
    },
    "growth": {
      "situation": "<Situation: welcher Chat, was war los>",
      "behavior": "<Was passiert ist, freundlich beschrieben — mit Zitat>",
      "impact": "<Welche Chance liegen geblieben ist>",
      "alternative_if_then": "<Wenn dieselbe Situation nochmal kommt: sage stattdessen dies (konkret, vom Chatter formuliert). NIEMALS den Kunden nach dem Preis fragen.>"
    }
  },
  "micro_action": "<EINE konkrete Handlung für die nächsten 7 Tage. An bestehende Routine koppeln, z.B. 'Vor jedem PPV-Angebot: erst 2 Fragen zum Kunden stellen.' NIEMALS eine Handlung wie 'frag den Kunden nach dem Preis'.>",
  "retrieval_question": "<Eine Frage, die den Chatter zwingt selbst nachzudenken, z.B. 'Wie formulierst du beim nächsten Kunden anders, der 'zu teuer' schreibt?'>"
}`;

      try {
        const raw = await callGemini(aiKey, systemPrompt, metaPrompt);
        focusedResult = safeParseJSON<any>(raw, null);
      } catch (e) {
        focusedResult = { error: (e as Error).message };
      }
    }

    return jsonResp(200, {
      overall_score: overallScore,
      chats_analyzed: validDigests.length,
      chats_total: chats.length,
      // New focused schema
      personal_intro: focusedResult?.personal_intro ?? '',
      headline_promise: focusedResult?.headline_promise ?? '',
      weekly_comparison: focusedResult?.weekly_comparison ?? {
        current_revenue_eur: Math.round(currentTotals.revenue),
        previous_revenue_eur: Math.round(previousTotals.revenue),
        delta_pct: deltaPct,
        headline: deltaPct === null ? 'Keine Vergleichsdaten' : (deltaPct >= 0 ? 'Verbesserung' : 'Rückgang'),
        summary: deltaPct === null
          ? `Zeitraum: ${Math.round(currentTotals.revenue)}€. Keine Vorperiode zum Vergleich.`
          : `Zeitraum: ${Math.round(currentTotals.revenue)}€, Vorperiode: ${Math.round(previousTotals.revenue)}€ (${deltaPct > 0 ? '+' : ''}${deltaPct}%).`,
      },
      period_totals: {
        current: { revenue_eur: Math.round(currentTotals.revenue), mass_dms: currentTotals.mass_dms, days: currentTotals.days, per_model: currentTotals.per_model },
        previous: { revenue_eur: Math.round(previousTotals.revenue), mass_dms: previousTotals.mass_dms, days: previousTotals.days, from: prevFrom, to: prevTo },
      },
      top_3_levers: Array.isArray(focusedResult?.top_3_levers) ? focusedResult.top_3_levers.slice(0, 3) : [],
      sbi_feedback: focusedResult?.sbi_feedback ?? null,
      micro_action: focusedResult?.micro_action ?? '',
      retrieval_question: focusedResult?.retrieval_question ?? '',
      // Kept for backward-compat with older readers, but no longer used by the PDF
      chats: [],
      patterns: [],
      executive_summary: '',
      top_focus: [],
      personal_closing: '',
    });
  } catch (e) {
    return jsonResp(500, { error: (e as Error).message });
  }
});
