import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "google/gemini-3.6-flash";

function round(n: number, d = 0) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------- Tools ----------
const tools = [
  {
    type: "function",
    function: {
      name: "read_memos",
      description:
        "Liest gespeicherte Memos (Notizen + Vereinbarungen) zu Chattern. Nutze das wenn der User fragt 'was war mit X zuletzt besprochen', 'welche Fristen laufen heute ab', oder bevor du Empfehlungen zu einem Chatter gibst.",
      parameters: {
        type: "object",
        properties: {
          chatter_name: { type: "string", description: "Optionaler Chatter-Filter (case-insensitive)" },
          status: { type: "string", enum: ["open", "resolved", "all"], description: "Default: open" },
          due_only: { type: "boolean", description: "Nur Memos mit follow_up_at <= jetzt (überfällig oder heute fällig)" },
          limit: { type: "number", description: "Default: 30" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_memo",
      description:
        "Legt ein Memo / Vereinbarung für einen Chatter an. IMMER nutzen wenn der User sagt 'notier:', 'merk dir', 'erinner mich', 'gib X noch N Tage', oder eine Frist setzt. follow_up_days = Tage bis Erinnerung (z.B. 2 für '2 Tage Frist').",
      parameters: {
        type: "object",
        properties: {
          chatter_name: { type: "string" },
          text: { type: "string", description: "Was wurde vereinbart / die Notiz" },
          follow_up_days: { type: "number", description: "Tage bis Reminder-Datum, optional" },
          topic: { type: "string", description: "Kurz-Tag, z.B. 'mass_dms_low', 'frist', 'krank'" },
        },
        required: ["chatter_name", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resolve_memo",
      description: "Markiert ein Memo als erledigt (z.B. wenn Chatter geliefert hat, oder du das Thema schließen willst).",
      parameters: {
        type: "object",
        properties: { memo_id: { type: "string" } },
        required: ["memo_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_memo",
      description: "Löscht ein Memo komplett (nur wenn der User explizit 'lösch' sagt).",
      parameters: {
        type: "object",
        properties: { memo_id: { type: "string" } },
        required: ["memo_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_live_status",
      description:
        "ECHTZEIT-Daten aus chatter_history_live: offene Chats, ältester unbeantworteter Chat (Verzug in Tagen), Umsatz heute, Mass-DMs — pro Chatter UND aufgeschlüsselt pro Model/Account. Nutze das IMMER bei Fragen zu Verzug, offenen Chats, 'wer ist im Rückstand', 'was ist gerade los'.",
      parameters: {
        type: "object",
        properties: {
          chatter_name: { type: "string", description: "Optionaler Chatter-Filter (Teilstring, case-insensitive)" },
          min_delay_days: { type: "number", description: "Nur Einträge mit ältestem Chat >= N Tage" },
          sort: { type: "string", enum: ["delay", "unread", "revenue"], description: "Default: delay" },
          limit: { type: "number", description: "Default: 40, max 150" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_chatter_history",
      description:
        "Tages-Zeitreihe eines Chatters aus chatter_history (Umsatz, Mass-DMs, offene Chats, Verzug, Account, Kategorie). Nutze das für Verlaufs-/Trend-Fragen zu einer konkreten Person.",
      parameters: {
        type: "object",
        properties: {
          chatter_name: { type: "string" },
          days: { type: "number", description: "Zeitfenster in Tagen, Default 30" },
        },
        required: ["chatter_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_account_history",
      description:
        "Chronologie eines Accounts/Models: welche Chatter saßen wann drauf und mit welchem Umsatz pro Tag. Nutze das für 'lief der Account früher besser', Besetzungs- und Tausch-Fragen.",
      parameters: {
        type: "object",
        properties: {
          account: { type: "string", description: "Account-/Model-Name (Teilstring)" },
          days: { type: "number", description: "Zeitfenster in Tagen, Default 90" },
        },
        required: ["account"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description:
        "Speichert dauerhaft eine Information über den User, seine Agency oder seine Arbeitsweise (Präferenzen, Regeln, Fakten, Ziele, Namen). Nutze das PROAKTIV und ohne zu fragen, sobald der User etwas nennt, das auch in künftigen Unterhaltungen relevant ist (z.B. 'ich will keine X', 'mein Ziel ist Y', 'Chatter Z ist mein bester'). NICHT für kurzfristige Chatter-Fristen — dafür create_memo.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Die Information, kurz und in dritter Person formuliert" },
          category: { type: "string", description: "z.B. 'praeferenz', 'regel', 'ziel', 'fakt', 'person'" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget_memory",
      description: "Löscht eine gespeicherte Gedächtnis-Notiz (nur wenn der User das will).",
      parameters: {
        type: "object",
        properties: { memory_id: { type: "string" } },
        required: ["memory_id"],
      },
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { messages, platform, thread_id } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return jsonResponse({ error: "messages array required" }, 400);
    }

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) return jsonResponse({ error: "LOVABLE_API_KEY missing" }, 500);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve user from auth header
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    let userId: string | null = null;
    if (token) {
      const { data } = await supabase.auth.getUser(token);
      userId = data.user?.id ?? null;
    }
    if (!userId) return jsonResponse({ error: "not authenticated" }, 401);

    const activePlatform = platform || "Maloum";

    // ---------- Thread validation + persist user message ----------
    let threadId: string | null = null;
    if (thread_id) {
      const { data: th } = await supabase
        .from("ai_threads").select("id,title").eq("id", thread_id).eq("user_id", userId).maybeSingle();
      if (!th) return jsonResponse({ error: "thread not found" }, 404);
      threadId = th.id;
      const lastUser = [...messages].reverse().find((m: any) => m.role === "user");
      if (lastUser) {
        const { error: insErr } = await supabase.from("ai_messages").insert({
          thread_id: threadId, user_id: userId, role: "user", content: String(lastUser.content ?? ""),
        });
        if (insErr) console.error("[ai-consultant] persist user msg", insErr.message);
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (!th.title || th.title === "Neue Unterhaltung") {
          patch.title = String(lastUser.content ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "Neue Unterhaltung";
        }
        await supabase.from("ai_threads").update(patch).eq("id", threadId).eq("user_id", userId);
      }
    }

    // ---------- Build data context ----------
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const fromDate = fourteenDaysAgo.toISOString().split("T")[0];

    async function fetchAllHistory() {
      const all: any[] = [];
      let offset = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("chatter_history")
          .select("chatter_name,analysis_date,revenue_today,mass_dms,open_chats,response_delay_days,category,account")
          .eq("platform", activePlatform)
          .eq("user_id", userId)
          .gte("analysis_date", fromDate)
          .order("analysis_date", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (error || !data) break;
        all.push(...data);
        if (data.length < pageSize) break;
        offset += pageSize;
        if (offset > 20000) break;
      }
      return all;
    }

    const nowIso = new Date().toISOString();
    const [historyData, notesRes, modelsRes, dueMemosRes, liveRes] = await Promise.all([
      fetchAllHistory(),
      supabase.from("coaching_notes").select("chatter_name,note_text,created_at")
        .eq("platform", activePlatform).eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(60),
      supabase.from("models").select("model_name,follower_count")
        .eq("platform", activePlatform).eq("user_id", userId),
      supabase.from("chatter_memos").select("id,chatter_name,text,follow_up_at,topic,created_at")
        .eq("platform", activePlatform).eq("user_id", userId).eq("status", "open")
        .lte("follow_up_at", nowIso).order("follow_up_at", { ascending: true }).limit(30),
      supabase.from("chatter_history_live")
        .select("chatter_name,unread_chats,oldest_chat,revenue,mass_dms,updated_at")
        .ilike("platform", activePlatform)
        .order("oldest_chat", { ascending: false, nullsFirst: false }).limit(60),
    ]);

    const notesData = notesRes.data ?? [];
    const modelsData = modelsRes.data ?? [];
    const dueMemos = dueMemosRes.data ?? [];
    const liveData = liveRes.data ?? [];

    const today = new Date().toISOString().split("T")[0];
    const byChatter = new Map<string, any[]>();
    for (const r of historyData) {
      const arr = byChatter.get(r.chatter_name) ?? [];
      arr.push(r);
      byChatter.set(r.chatter_name, arr);
    }

    const aggs: any[] = [];
    for (const [name, rows] of byChatter) {
      const sorted = [...rows].sort((a, b) => (a.analysis_date < b.analysis_date ? 1 : -1));
      const todayRow = sorted.find((r) => r.analysis_date === today) ?? sorted[0];
      const revs = sorted.map((r) => Number(r.revenue_today) || 0);
      const total = revs.reduce((s, v) => s + v, 0);
      const last3 = revs.slice(0, 3);
      const prev = revs.slice(3, 6);
      const avgLast3 = last3.length ? last3.reduce((s, v) => s + v, 0) / last3.length : 0;
      const avgPrev = prev.length ? prev.reduce((s, v) => s + v, 0) / prev.length : 0;
      const trend = avgPrev > 0 ? ((avgLast3 - avgPrev) / avgPrev) * 100 : 0;
      aggs.push({
        name, account: todayRow?.account ?? "", category: todayRow?.category ?? "-",
        days: rows.length, totalRev: round(total), avgRev: round(total / rows.length),
        maxRev: round(Math.max(...revs)),
        todayRev: todayRow ? Number(todayRow.revenue_today) || 0 : null,
        todayDelay: todayRow?.response_delay_days ?? null,
        todayOpen: todayRow?.open_chats ?? null, todayDms: todayRow?.mass_dms ?? null,
        trend: round(trend, 0),
      });
    }
    aggs.sort((a, b) => b.totalRev - a.totalRev);

    const header = "name|account|cat|14dRev|avg|today|delay|open|dms|trend%";
    const tableLines = aggs.map((a) =>
      [a.name, a.account, a.category, a.totalRev, a.avgRev, a.todayRev ?? "-",
       a.todayDelay ?? "-", a.todayOpen ?? "-", a.todayDms ?? "-",
       a.trend > 0 ? `+${a.trend}` : a.trend].join("|")
    );

    const dueMemoBlock = dueMemos.length
      ? dueMemos.map((m: any) => {
          const due = m.follow_up_at ? new Date(m.follow_up_at).toISOString().slice(0, 10) : "?";
          return `[FÄLLIG ${due}] ${m.chatter_name}: ${m.text}`;
        }).join("\n")
      : "keine fälligen Memos";

    const liveBlock = liveData.length
      ? liveData.map((l: any) =>
          `${l.chatter_name}|offen:${l.unread_chats ?? 0}|ältester:${l.oldest_chat ?? "-"}d|heute:${round(Number(l.revenue) || 0)}€|dms:${l.mass_dms ?? 0}`
        ).join("\n")
      : "keine Live-Daten";

    const dataContext = `DATEN (${activePlatform}, 14 Tage, ${aggs.length} Chatter):

CHATTER:
${header}
${tableLines.join("\n")}

ECHTZEIT (Top 60 nach Verzug):
${liveBlock}

NOTIZEN (${notesData.length}):
${notesData.length ? notesData.map((n: any) => `[${n.created_at?.slice(0, 10)}] ${n.chatter_name}: ${n.note_text}`).join("\n") : "keine"}

FÄLLIGE MEMOS / FRISTEN (heute oder überfällig):
${dueMemoBlock}

MODELS (${modelsData.length}):
${modelsData.length ? modelsData.map((m: any) => `${m.model_name}:${m.follower_count}`).join(", ") : "keine"}`;

    const systemPrompt = `Du bist Alex — der CEO-Berater dieser Agency. Sprich kurz, faktenbasiert, auf Deutsch, mit Markdown. Immer mit Zahlen (€) und konkreter Handlungsempfehlung.

ARBEITSWEISE:
- Du hast Tools für Echtzeit-Daten (get_live_status), Chatter-Verläufe (get_chatter_history), Account-Chronologien (get_account_history) und Memos. Nutze sie aktiv statt zu raten. Lieber 2–3 Tool-Calls als eine vage Antwort.
- Bei Fragen zu Verzug / offenen Chats IMMER get_live_status — Echtzeit schlägt Report-Daten.
- Verzug zählt erst ab 3 Tagen ältester unbeantworteter Chat.

PRIORISIERUNG (wenn ich nach "wen soll ich mir vornehmen" o.ä. frage), in dieser Reihenfolge:
1. Historisches Uplift-Potenzial (bestes €/Tag früher vs. heute)
2. Verzug (Alter des ältesten Chats)
3. Offene Chats
4. Aktueller Umsatz (0 €-Fälle zuerst)

WORDING:
- Nie "säuft ab" — sag "im Rückgang".
- Kein Punkt vor Emojis, Hautton-Emojis immer mit hellem Modifier 🏻.

MEMO-SYSTEM:
- "notier:", "merk dir", "gib X noch N Tage", "erinner mich", "Frist" → SOFORT create_memo.
- "was war mit X" / "welche Fristen laufen" → read_memos.
- Fällige Memos ungefragt erwähnen, wenn nach Tagesplan / Heute / Übersicht gefragt wird.

Tone: knapp, COO-Energy, kein Smalltalk, keine Generic-Phrasen. "Sarah-Frist heute fällig — Mass-DMs 1, 0. Cut oder verlängern?" statt "Schau mal vorbei wenn du Zeit hast".

${dataContext}`;

    // ---------- Tool executor ----------
    async function runTool(name: string, args: any): Promise<any> {
      try {
        if (name === "read_memos") {
          let q = supabase.from("chatter_memos")
            .select("id,chatter_name,text,topic,follow_up_at,status,created_at,resolved_at")
            .eq("user_id", userId).eq("platform", activePlatform);
          if (args.chatter_name) q = q.ilike("chatter_name", args.chatter_name);
          if (args.status && args.status !== "all") q = q.eq("status", args.status);
          else if (!args.status) q = q.eq("status", "open");
          if (args.due_only) q = q.lte("follow_up_at", new Date().toISOString());
          const { data, error } = await q
            .order("created_at", { ascending: false })
            .limit(Math.min(args.limit || 30, 100));
          return error ? { ok: false, error: error.message } : { ok: true, memos: data };
        }
        if (name === "create_memo") {
          let followUp: string | null = null;
          if (typeof args.follow_up_days === "number") {
            const d = new Date();
            d.setDate(d.getDate() + args.follow_up_days);
            d.setHours(8, 0, 0, 0);
            followUp = d.toISOString();
          }
          const { data, error } = await supabase.from("chatter_memos").insert({
            user_id: userId, platform: activePlatform,
            chatter_name: args.chatter_name, text: args.text,
            topic: args.topic ?? null, follow_up_at: followUp, status: "open",
          }).select().single();
          return error ? { ok: false, error: error.message } : { ok: true, memo: data };
        }
        if (name === "resolve_memo") {
          const { error } = await supabase.from("chatter_memos")
            .update({ status: "resolved", resolved_at: new Date().toISOString() })
            .eq("id", args.memo_id).eq("user_id", userId);
          return error ? { ok: false, error: error.message } : { ok: true };
        }
        if (name === "delete_memo") {
          const { error } = await supabase.from("chatter_memos")
            .delete().eq("id", args.memo_id).eq("user_id", userId);
          return error ? { ok: false, error: error.message } : { ok: true };
        }
        if (name === "get_live_status") {
          let q = supabase.from("chatter_history_live")
            .select("chatter_name,unread_chats,oldest_chat,revenue,mass_dms,stats_details,updated_at")
            .ilike("platform", activePlatform);
          if (args.chatter_name) q = q.ilike("chatter_name", `%${args.chatter_name}%`);
          if (typeof args.min_delay_days === "number") q = q.gte("oldest_chat", args.min_delay_days);
          const sortCol = args.sort === "unread" ? "unread_chats" : args.sort === "revenue" ? "revenue" : "oldest_chat";
          const { data, error } = await q
            .order(sortCol, { ascending: false, nullsFirst: false })
            .limit(Math.min(args.limit || 40, 150));
          if (error) return { ok: false, error: error.message };
          const rows = (data ?? []).map((r: any) => {
            const details = r.stats_details && typeof r.stats_details === "object" ? r.stats_details : null;
            let models: any = null;
            if (details) {
              try {
                models = Object.entries(details).map(([m, v]: any) => ({
                  model: m,
                  unread: v?.unread_chats ?? v?.unread ?? null,
                  oldest: v?.oldest_chat ?? null,
                  revenue: v?.revenue ?? null,
                }));
              } catch { models = null; }
            }
            return {
              chatter: r.chatter_name,
              unread: r.unread_chats,
              oldest_chat_days: r.oldest_chat,
              revenue_today: r.revenue,
              mass_dms: r.mass_dms,
              updated_at: r.updated_at,
              models,
            };
          });
          return { ok: true, count: rows.length, rows };
        }
        if (name === "get_chatter_history") {
          const days = Math.min(args.days || 30, 180);
          const from = new Date();
          from.setDate(from.getDate() - days);
          const { data, error } = await supabase.from("chatter_history")
            .select("analysis_date,account,revenue_today,mass_dms,open_chats,response_delay_days,category")
            .eq("user_id", userId).eq("platform", activePlatform)
            .ilike("chatter_name", `%${args.chatter_name}%`)
            .gte("analysis_date", from.toISOString().slice(0, 10))
            .order("analysis_date", { ascending: false })
            .limit(600);
          return error ? { ok: false, error: error.message } : { ok: true, count: data?.length ?? 0, rows: data };
        }
        if (name === "get_account_history") {
          const days = Math.min(args.days || 90, 365);
          const from = new Date();
          from.setDate(from.getDate() - days);
          const { data, error } = await supabase.from("chatter_history")
            .select("analysis_date,chatter_name,account,revenue_today,open_chats,response_delay_days")
            .eq("user_id", userId).eq("platform", activePlatform)
            .ilike("account", `%${args.account}%`)
            .gte("analysis_date", from.toISOString().slice(0, 10))
            .order("analysis_date", { ascending: false })
            .limit(1000);
          if (error) return { ok: false, error: error.message };
          const perChatter = new Map<string, { days: number; total: number; best: number; first: string; last: string }>();
          for (const r of data ?? []) {
            const k = r.chatter_name;
            const rev = Number(r.revenue_today) || 0;
            const e = perChatter.get(k) ?? { days: 0, total: 0, best: 0, first: r.analysis_date, last: r.analysis_date };
            e.days += 1; e.total += rev; e.best = Math.max(e.best, rev);
            if (r.analysis_date < e.first) e.first = r.analysis_date;
            if (r.analysis_date > e.last) e.last = r.analysis_date;
            perChatter.set(k, e);
          }
          const summary = [...perChatter.entries()].map(([chatter, e]) => ({
            chatter, days: e.days, total: round(e.total), avg_per_day: round(e.total / e.days, 1),
            best_day: round(e.best), from: e.first, to: e.last,
          })).sort((a, b) => b.avg_per_day - a.avg_per_day);
          return { ok: true, chatters: summary, rows: (data ?? []).slice(0, 200) };
        }
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
      return { ok: false, error: "unknown tool" };
    }

    // ---------- Streaming tool-loop ----------
    const convo: any[] = [
      { role: "system", content: systemPrompt },
      ...messages.map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

        try {
          for (let iter = 0; iter < 6; iter++) {
            const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: MODEL,
                messages: convo,
                tools,
                tool_choice: "auto",
                stream: true,
              }),
            });

            if (!aiRes.ok || !aiRes.body) {
              const errText = await aiRes.text().catch(() => "");
              console.error("[ai-consultant] gateway err", aiRes.status, errText);
              const m = aiRes.status === 429
                ? "Rate limit erreicht — kurz warten."
                : aiRes.status === 402
                ? "AI-Credits aufgebraucht."
                : `AI Gateway: ${aiRes.status}`;
              send({ t: "error", m });
              controller.close();
              return;
            }

            // parse SSE from gateway
            const reader = aiRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let content = "";
            const toolAcc = new Map<number, { id: string; name: string; args: string }>();
            let done = false;

            while (!done) {
              const { value, done: rd } = await reader.read();
              if (rd) break;
              buffer += decoder.decode(value, { stream: true });
              let nl: number;
              while ((nl = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (payload === "[DONE]") { done = true; break; }
                let chunk: any;
                try { chunk = JSON.parse(payload); } catch { continue; }
                const delta = chunk.choices?.[0]?.delta;
                if (!delta) continue;
                if (delta.content) {
                  content += delta.content;
                  send({ t: "delta", c: delta.content });
                }
                for (const tc of delta.tool_calls ?? []) {
                  const idx = tc.index ?? 0;
                  const cur = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
                  if (tc.id) cur.id = tc.id;
                  if (tc.function?.name) cur.name = tc.function.name;
                  if (tc.function?.arguments) cur.args += tc.function.arguments;
                  toolAcc.set(idx, cur);
                }
              }
            }

            if (toolAcc.size === 0) {
              send({ t: "done" });
              controller.close();
              return;
            }

            const calls = [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
            convo.push({
              role: "assistant",
              content: content || null,
              tool_calls: calls.map((c) => ({
                id: c.id, type: "function",
                function: { name: c.name, arguments: c.args || "{}" },
              })),
            });

            for (const c of calls) {
              let args: any = {};
              try { args = JSON.parse(c.args || "{}"); } catch { /* ignore */ }
              send({ t: "tool_start", name: c.name, args });
              const result = await runTool(c.name, args);
              send({ t: "tool", name: c.name, args, result });
              convo.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result).slice(0, 60000) });
            }
          }

          send({ t: "error", m: "Tool-Loop Limit erreicht." });
          controller.close();
        } catch (e: any) {
          console.error("[ai-consultant] stream error", e);
          try { send({ t: "error", m: e?.message ?? "Unbekannter Fehler" }); } catch { /* ignore */ }
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[ai-consultant] error", err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
