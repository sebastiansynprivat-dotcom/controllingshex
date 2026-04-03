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
    const { messages, platform } = await req.json();
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

    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const { data: historyData } = await supabase
      .from("chatter_history")
      .select("*")
      .eq("platform", activePlatform)
      .gte("analysis_date", twoWeeksAgo.toISOString().split("T")[0])
      .order("analysis_date", { ascending: false })
      .limit(500);

    const { data: notesData } = await supabase
      .from("coaching_notes")
      .select("*")
      .eq("platform", activePlatform)
      .order("created_at", { ascending: false })
      .limit(100);

    const { data: modelsData } = await supabase
      .from("models")
      .select("model_name, follower_count")
      .eq("platform", activePlatform);

    const dataContext = `
DATENBANK-KONTEXT (${activePlatform}):

CHATTER-PERFORMANCE (letzte 14 Tage):
${historyData && historyData.length > 0
  ? historyData.map((r: any) => `${r.chatter_name} | ${r.analysis_date} | Umsatz: ${r.revenue_today}€ | MassDMs: ${r.mass_dms} | Offene Chats: ${r.open_chats} | Verzug: ${r.response_delay_days} Tage`).join("\n")
  : "Keine Daten vorhanden."}

COACHING-NOTIZEN:
${notesData && notesData.length > 0
  ? notesData.map((n: any) => `[${n.created_at}] ${n.chatter_name}: ${n.note_text}`).join("\n")
  : "Keine Notizen vorhanden."}

MODELS:
${modelsData && modelsData.length > 0
  ? modelsData.map((m: any) => `${m.model_name}: ${m.follower_count} Follower`).join("\n")
  : "Keine Models vorhanden."}`;

    const systemPrompt = `Du bist ein exklusiver Agency-Berater und Performance-Analyst. Du hast Zugriff auf die Chatter-Daten, Coaching-Notizen und Model-Informationen einer Content-Agentur.

Dein Stil:
- Professionell, prägnant, auf den Punkt
- Nutze Zahlen und konkrete Fakten aus den Daten
- Gib konkrete Handlungsempfehlungen
- Antworte auf Deutsch
- Formatiere deine Antworten mit Markdown (fett, Listen, Überschriften)
- Wenn du Umsätze nennst, formatiere sie mit € 
- Vergleiche Trends über die verfügbaren Tage

${dataContext}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m: any) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })),
        ],
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[ai-consultant] AI Gateway error:", response.status, errText);

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit erreicht. Bitte warte kurz." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI-Credits aufgebraucht. Bitte Credits aufladen." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: `AI Gateway Fehler: ${response.status}`, details: errText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();
    const text = aiResult.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ reply: text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[ai-consultant] error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
