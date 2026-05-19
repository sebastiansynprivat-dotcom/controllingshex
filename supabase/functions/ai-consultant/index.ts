import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function round(n: number, d = 0) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { messages, platform, stream } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const activePlatform = platform || "Maloum";

    // Voller Kontext (14 Tage), aber wir aggregieren serverseitig zu kompaktem Format.
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const fromDate = fourteenDaysAgo.toISOString().split("T")[0];

    // Pagination um 1000-Zeilen Limit zu umgehen
    async function fetchAllHistory() {
      const all: any[] = [];
      let offset = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("chatter_history")
          .select("chatter_name,analysis_date,revenue_today,mass_dms,open_chats,response_delay_days,category,account")
          .eq("platform", activePlatform)
          .gte("analysis_date", fromDate)
          .order("analysis_date", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (error || !data) break;
        all.push(...data);
        if (data.length < pageSize) break;
        offset += pageSize;
        if (offset > 10000) break; // safety
      }
      return all;
    }

    const [historyData, notesRes, modelsRes] = await Promise.all([
      fetchAllHistory(),
      supabase
        .from("coaching_notes")
        .select("chatter_name,note_text,created_at")
        .eq("platform", activePlatform)
        .order("created_at", { ascending: false })
        .limit(60),
      supabase
        .from("models")
        .select("model_name,follower_count")
        .eq("platform", activePlatform),
    ]);

    const notesData = notesRes.data ?? [];
    const modelsData = modelsRes.data ?? [];

    // Aggregation pro Chatter
    const today = new Date().toISOString().split("T")[0];
    const byChatter = new Map<string, any[]>();
    for (const r of historyData) {
      const arr = byChatter.get(r.chatter_name) ?? [];
      arr.push(r);
      byChatter.set(r.chatter_name, arr);
    }

    type Agg = {
      name: string;
      account: string;
      category: string;
      days: number;
      totalRev: number;
      avgRev: number;
      maxRev: number;
      todayRev: number | null;
      todayDelay: number | null;
      todayOpen: number | null;
      todayDms: number | null;
      trend: number; // last3 vs prev (%)
    };

    const aggs: Agg[] = [];
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
        name,
        account: todayRow?.account ?? "",
        category: todayRow?.category ?? "-",
        days: rows.length,
        totalRev: round(total),
        avgRev: round(total / rows.length),
        maxRev: round(Math.max(...revs)),
        todayRev: todayRow ? Number(todayRow.revenue_today) || 0 : null,
        todayDelay: todayRow?.response_delay_days ?? null,
        todayOpen: todayRow?.open_chats ?? null,
        todayDms: todayRow?.mass_dms ?? null,
        trend: round(trend, 0),
      });
    }
    aggs.sort((a, b) => b.totalRev - a.totalRev);

    // Kompaktes Tabellen-Format (eine Zeile pro Chatter)
    const header = "name|account|cat|14dRev|avg|today|delay|open|dms|trend%";
    const tableLines = aggs.map((a) =>
      [
        a.name,
        a.account,
        a.category,
        a.totalRev,
        a.avgRev,
        a.todayRev ?? "-",
        a.todayDelay ?? "-",
        a.todayOpen ?? "-",
        a.todayDms ?? "-",
        a.trend > 0 ? `+${a.trend}` : a.trend,
      ].join("|")
    );

    const dataContext = `DATEN (${activePlatform}, 14 Tage, ${aggs.length} Chatter):

CHATTER (eine Zeile = Aggregat pro Chatter):
${header}
${tableLines.join("\n")}

NOTIZEN (${notesData.length}):
${notesData.length
  ? notesData.map((n: any) => `[${n.created_at?.slice(0, 10)}] ${n.chatter_name}: ${n.note_text}`).join("\n")
  : "keine"}

MODELS (${modelsData.length}):
${modelsData.length
  ? modelsData.map((m: any) => `${m.model_name}:${m.follower_count}`).join(", ")
  : "keine"}`;

    const systemPrompt = `Du bist Agency-Performance-Berater. Prägnant, faktenbasiert, auf Deutsch, mit Markdown. Antworten kurz und konkret, immer mit Zahlen (€) und Handlungsempfehlung. Wenn nach Rohwerten pro Tag gefragt wird, sag dass nur Aggregate vorliegen.

${dataContext}`;

    const wantStream = stream !== false;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        stream: wantStream,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m: any) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })),
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[ai-consultant] AI Gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit erreicht. Bitte warte kurz." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI-Credits aufgebraucht. Bitte Credits aufladen." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `AI Gateway Fehler: ${response.status}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (wantStream && response.body) {
      return new Response(response.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    const aiResult = await response.json();
    const text = aiResult.choices?.[0]?.message?.content || "";
    return new Response(JSON.stringify({ reply: text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[ai-consultant] error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
