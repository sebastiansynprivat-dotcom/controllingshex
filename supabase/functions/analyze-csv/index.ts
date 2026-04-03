import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL_NAME = "google/gemini-2.5-pro";
const TIMEOUT_MS = 120000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { categorizedData, platform } = await req.json();

    if (!categorizedData || !Array.isArray(categorizedData.categories)) {
      return new Response(JSON.stringify({ error: "categorizedData mit categories-Array wird benötigt." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY ist nicht konfiguriert." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load custom system prompt
    const { data: promptData } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "system_prompt")
      .single();
    const basePrompt = promptData?.value || "Du bist ein erfahrener Management-Berater für Chatter-Teams.";

    const systemPrompt = `${basePrompt}

AUFGABE: Du erhältst bereits kategorisierte Chatter-Daten. Deine einzige Aufgabe ist es, für JEDEN Chatter eine strategische Empfehlung zu erstellen.

EMPFEHLUNGS-FORMEL: [Daten-Fakt] + [Insight] + [Konkretes To-Do]
Beispiel: "Tagesumsatz 151€ bei 12 offenen Chats → Chatter hat Potenzial, wird aber durch Verzug gebremst → Sofort die 5 ältesten Chats abarbeiten und in 2h Follow-up senden."

AUSGABEFORMAT (JSON):
{
  "recommendations": {
    "Max Mustermann": "Empfehlung hier...",
    "Anna Schmidt": "Empfehlung hier..."
  }
}

REGELN:
- Erstelle für JEDEN Chatter eine individuelle Empfehlung.
- Beziehe dich auf die konkreten KPIs des Chatters.
- Antworte mit NICHTS außer dem JSON. Kein Markdown, kein Text.
- Gib das JSON kompakt aus.`;

    // Build user message from categorized data
    const chattersText = categorizedData.categories
      .map((cat: any) => {
        const header = `\n=== ${cat.emoji} ${cat.categoryName} ===`;
        const items = (cat.chatters || [])
          .map((ch: any) => `- ${ch.name}: ${ch.data}`)
          .join("\n");
        return header + "\n" + items;
      })
      .join("\n");

    const userMessage = `Plattform: ${platform || "Unbekannt"}\n\nHier sind die bereits kategorisierten Chatter:\n${chattersText}`;

    console.log(`[analyze-csv] Step 3: Sende ${categorizedData.categories.reduce((s: number, c: any) => s + (c.chatters?.length || 0), 0)} Chatter an ${MODEL_NAME}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      const attempt = await fetch(AI_GATEWAY_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          max_tokens: 16384,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!attempt.ok) {
        const errText = await attempt.text();
        console.error(`[analyze-csv] ${MODEL_NAME} fehlgeschlagen (${attempt.status}): ${errText.substring(0, 300)}`);

        if (attempt.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit erreicht. Bitte warte kurz." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (attempt.status === 402) {
          return new Response(JSON.stringify({ error: "AI-Credits aufgebraucht." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ error: `${MODEL_NAME} Fehler (${attempt.status})` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      response = attempt;
      console.log(`[analyze-csv] ${MODEL_NAME} ✓`);
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      if (fetchErr.name === "AbortError") {
        return new Response(JSON.stringify({ error: `Timeout nach ${TIMEOUT_MS / 1000}s.` }), {
          status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw fetchErr;
    }

    const aiResult = await response.json();
    const resultText = aiResult.choices?.[0]?.message?.content || "";

    console.log(`[analyze-csv] Response: ${resultText.length} chars`);

    // Parse recommendations
    let recommendations: Record<string, string> = {};
    try {
      let cleaned = resultText
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start !== -1 && end > start) {
        cleaned = cleaned.substring(start, end + 1);
      }

      const parsed = JSON.parse(cleaned);
      recommendations = parsed.recommendations || parsed;
    } catch (parseErr) {
      console.error("[analyze-csv] JSON parse error:", parseErr);
      console.error("[analyze-csv] Raw (first 300):", resultText.substring(0, 300));
      return new Response(JSON.stringify({ recommendations: {}, error: "Empfehlungen konnten nicht gelesen werden." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save to chatter_history
    try {
      const today = new Date().toISOString().split("T")[0];
      const rows: any[] = [];

      for (const cat of categorizedData.categories) {
        for (const ch of cat.chatters || []) {
          const dataStr = ch.data || "";
          const revMatch = dataStr.match(/Tagesumsatz:\s*([\d.,]+)/);
          const dmMatch = dataStr.match(/MassDMs:\s*(\d+)/);
          const chatMatch = dataStr.match(/Offene Chats:\s*(\d+)/);
          const delayMatch = dataStr.match(/Ältester Chat:\s*(\d+)/);

          rows.push({
            chatter_name: ch.name,
            revenue_today: revMatch ? parseFloat(revMatch[1]) : 0,
            mass_dms: dmMatch ? parseInt(dmMatch[1]) : 0,
            open_chats: chatMatch ? parseInt(chatMatch[1]) : 0,
            response_delay_days: delayMatch ? Math.min(parseInt(delayMatch[1]), 30) : 0,
            platform: platform || "Maloum",
            analysis_date: today,
          });
        }
      }

      if (rows.length > 0) {
        await supabase.from("chatter_history").insert(rows);
        console.log(`[analyze-csv] Saved ${rows.length} history records`);
      }
    } catch (saveErr) {
      console.error("[analyze-csv] History save error:", saveErr);
    }

    return new Response(JSON.stringify({ recommendations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[analyze-csv] Fatal:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
