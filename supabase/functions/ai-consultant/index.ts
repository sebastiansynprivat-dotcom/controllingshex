import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // Leaner context: 7 Tage statt 14, max 200 Zeilen statt 500
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [historyRes, notesRes, modelsRes] = await Promise.all([
      supabase
        .from("chatter_history")
        .select("chatter_name,analysis_date,revenue_today,mass_dms,open_chats,response_delay_days,category_name")
        .eq("platform", activePlatform)
        .gte("analysis_date", sevenDaysAgo.toISOString().split("T")[0])
        .order("analysis_date", { ascending: false })
        .limit(200),
      supabase
        .from("coaching_notes")
        .select("chatter_name,note_text,created_at")
        .eq("platform", activePlatform)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("models")
        .select("model_name,follower_count")
        .eq("platform", activePlatform)
        .limit(50),
    ]);

    const historyData = historyRes.data ?? [];
    const notesData = notesRes.data ?? [];
    const modelsData = modelsRes.data ?? [];

    const dataContext = `DATEN (${activePlatform}, 7 Tage):

CHATTER (${historyData.length} Einträge):
${historyData.length
  ? historyData.map((r: any) => `${r.chatter_name}|${r.analysis_date}|€${r.revenue_today}|DMs:${r.mass_dms}|Offen:${r.open_chats}|Verzug:${r.response_delay_days}|${r.category_name ?? "-"}`).join("\n")
  : "keine"}

NOTIZEN:
${notesData.length
  ? notesData.map((n: any) => `[${n.created_at?.slice(0,10)}] ${n.chatter_name}: ${n.note_text}`).join("\n")
  : "keine"}

MODELS:
${modelsData.length
  ? modelsData.map((m: any) => `${m.model_name}:${m.follower_count}`).join(", ")
  : "keine"}`;

    const systemPrompt = `Du bist Agency-Performance-Berater. Prägnant, faktenbasiert, auf Deutsch, mit Markdown. Nutze die Daten unten, nenne Zahlen mit € und gib konkrete Empfehlungen.

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
      // Pass-through SSE stream to client
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
