import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { messages, platform } = await req.json();
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
        if (offset > 10000) break;
      }
      return all;
    }

    const nowIso = new Date().toISOString();
    const [historyData, notesRes, modelsRes, dueMemosRes] = await Promise.all([
      fetchAllHistory(),
      supabase.from("coaching_notes").select("chatter_name,note_text,created_at")
        .eq("platform", activePlatform).eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(60),
      supabase.from("models").select("model_name,follower_count")
        .eq("platform", activePlatform).eq("user_id", userId),
      supabase.from("chatter_memos").select("id,chatter_name,text,follow_up_at,topic,created_at")
        .eq("platform", activePlatform).eq("user_id", userId).eq("status", "open")
        .lte("follow_up_at", nowIso).order("follow_up_at", { ascending: true }).limit(30),
    ]);

    const notesData = notesRes.data ?? [];
    const modelsData = modelsRes.data ?? [];
    const dueMemos = dueMemosRes.data ?? [];

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

    const dataContext = `DATEN (${activePlatform}, 14 Tage, ${aggs.length} Chatter):

CHATTER:
${header}
${tableLines.join("\n")}

NOTIZEN (${notesData.length}):
${notesData.length ? notesData.map((n: any) => `[${n.created_at?.slice(0, 10)}] ${n.chatter_name}: ${n.note_text}`).join("\n") : "keine"}

FÄLLIGE MEMOS / FRISTEN (heute oder überfällig):
${dueMemoBlock}

MODELS (${modelsData.length}):
${modelsData.length ? modelsData.map((m: any) => `${m.model_name}:${m.follower_count}`).join(", ") : "keine"}`;

    const systemPrompt = `Du bist Alex — der CEO-Berater dieser Agency. Sprich kurz, faktenbasiert, auf Deutsch, mit Markdown. Immer mit Zahlen (€) und konkreter Handlungsempfehlung.

WICHTIG — Memo-System:
- Du hast Zugriff auf "chatter_memos" via Tools (read_memos, create_memo, resolve_memo).
- Wenn der User sagt "notier:", "merk dir", "gib X noch N Tage", "erinner mich", "Frist X" → ruf SOFORT create_memo auf.
- Wenn der User fragt "was war mit X" / "welche Fristen laufen heute" → ruf read_memos auf.
- Bevor du eine Empfehlung zu einem konkreten Chatter machst, ruf read_memos für den Chatter — vermeide Vorschläge die ich schon angestoßen habe.
- Fällige Memos siehst du direkt im Kontext unten und sollst sie ungefragt am Anfang erwähnen wenn der User nach Tagesplan / Heute / Übersicht fragt.

Tone: knapp, COO-Energy, kein Smalltalk, keine Generic-Phrasen. "Sarah-Frist heute fällig — Mass-DMs 1, 0. Cut oder verlängern?" statt "Schau mal vorbei wenn du Zeit hast".

${dataContext}`;

    // ---------- Tool-Loop ----------
    const convo: any[] = [
      { role: "system", content: systemPrompt },
      ...messages.map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    ];

    const toolCallsTrace: any[] = [];

    for (let iter = 0; iter < 5; iter++) {
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: convo,
          tools,
          tool_choice: "auto",
        }),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        console.error("[ai-consultant] gateway err", aiRes.status, errText);
        if (aiRes.status === 429) return jsonResponse({ error: "Rate limit erreicht." }, 429);
        if (aiRes.status === 402) return jsonResponse({ error: "AI-Credits aufgebraucht." }, 402);
        return jsonResponse({ error: `AI Gateway: ${aiRes.status}` }, 500);
      }

      const aiJson = await aiRes.json();
      const msg = aiJson.choices?.[0]?.message;
      if (!msg) return jsonResponse({ error: "Leere AI-Antwort" }, 500);

      const toolCalls = msg.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return jsonResponse({
          reply: msg.content || "",
          tool_calls: toolCallsTrace,
        });
      }

      // append assistant + execute tools
      convo.push(msg);
      for (const tc of toolCalls) {
        const name = tc.function?.name;
        let args: any = {};
        try { args = JSON.parse(tc.function?.arguments || "{}"); } catch {}
        let result: any = { ok: false, error: "unknown tool" };

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
            result = error ? { ok: false, error: error.message } : { ok: true, memos: data };
          } else if (name === "create_memo") {
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
            result = error ? { ok: false, error: error.message } : { ok: true, memo: data };
          } else if (name === "resolve_memo") {
            const { error } = await supabase.from("chatter_memos")
              .update({ status: "resolved", resolved_at: new Date().toISOString() })
              .eq("id", args.memo_id).eq("user_id", userId);
            result = error ? { ok: false, error: error.message } : { ok: true };
          } else if (name === "delete_memo") {
            const { error } = await supabase.from("chatter_memos")
              .delete().eq("id", args.memo_id).eq("user_id", userId);
            result = error ? { ok: false, error: error.message } : { ok: true };
          }
        } catch (e: any) {
          result = { ok: false, error: e.message };
        }

        toolCallsTrace.push({ name, args, result });
        convo.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }

    return jsonResponse({ reply: "Tool-Loop Limit erreicht.", tool_calls: toolCallsTrace });
  } catch (err) {
    console.error("[ai-consultant] error", err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
