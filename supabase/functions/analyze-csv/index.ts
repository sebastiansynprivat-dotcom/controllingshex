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
    const { csvData, platform } = await req.json();
    if (!csvData || typeof csvData !== "string") {
      return new Response(JSON.stringify({ error: "csvData is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validPlatforms = ["Maloum", "Brezzels", "FansyMe"];
    const activePlatform = validPlatforms.includes(platform) ? platform : "Maloum";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: models } = await supabase
      .from("models")
      .select("model_name, follower_count")
      .eq("platform", activePlatform);

    const modelsText = models && models.length > 0
      ? models.map((m: any) => `${m.model_name}: ${m.follower_count} Follower`).join("\n")
      : "Keine Models vorhanden.";

    const { data: promptData } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "system_prompt")
      .single();
    const userSystemPrompt = promptData?.value || "Du bist ein hilfreicher Assistent für Datenanalyse.";

    const formatInstructions = `

KRITISCH – AUSGABEFORMAT (JSON):
Du MUSST deine gesamte Antwort als ein einziges, valides JSON-Objekt ausgeben. Kein Markdown, kein Fließtext, keine Erklärungen – NUR JSON.

Das JSON muss exakt dieses Schema haben:
{
  "categories": [
    {
      "emoji": "⚠️",
      "categoryName": "ACCOUNT-EINBRUCH",
      "chatters": [
        {
          "name": "Max Mustermann",
          "startDate": "01.04.2026",
          "account": "modelname",
          "kpis": {
            "Tagesumsatz": "151,19 €",
            "Offene Chats": "12",
            "MassDMs": "5"
          },
          "recommendation": "Konkrete Handlungsempfehlung hier"
        }
      ]
    }
  ]
}

Regeln:
- "categories" ist ein Array aller erkannten Kategorien.
- Typische Kategorien: ⚠️ ACCOUNT-EINBRUCH, 🔵 ONBOARDING TAG 1, 🌟 BREAKOUT-STAR, 🔴 KÜNDIGUNG/ABWANDERUNG, 📉 0€ UMSATZ, 🟢 TOP-PERFORMER, 🔄 ACCOUNT-TAUSCH, 💰 UPSELL-POTENZIAL, 🚀 WACHSTUM
- "kpis" enthält alle relevanten Kennzahlen als Key-Value-Paare. Keys sind die Labels (z.B. "Tagesumsatz", "Offene Chats"). Geldbeträge mit € formatieren.
- "recommendation" ist die konkrete Handlungsempfehlung.
- KEINE Einleitung, KEINE Zusammenfassung – NUR das JSON-Objekt.
- Antworte mit NICHTS außer dem JSON. Kein \`\`\`json Block, kein Text davor oder danach.

CRITICAL INSTRUCTION: You are given a dataset of chatters. You MUST process, analyze, and include EVERY SINGLE CHATTER in your final JSON output. DO NOT summarize, DO NOT group them together, and DO NOT skip anyone to save space. If the input contains 100 chatters, your output MUST contain exactly 100 chatters. Compare your output against the input before finishing to ensure 100% completeness.`;

    const systemPrompt = userSystemPrompt + formatInstructions;

    const userMessage = `Plattform: ${activePlatform}\n\nHier sind die CSV-Daten der heutigen Analyse:\n\n${csvData}\n\nHier ist die Liste der Models und ihrer Followerzahlen (nur ${activePlatform}):\n${modelsText}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ error: `Anthropic API error: ${response.status}`, details: errText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();
    const resultText = aiResult.content?.[0]?.text || "";

    // Parse JSON from Claude's response — robust extraction
    let parsed;
    try {
      let cleaned = resultText
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      // Find actual JSON boundaries
      const jsonStart = cleaned.indexOf("{");
      const jsonEnd = cleaned.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON found");
      cleaned = cleaned.substring(jsonStart, jsonEnd + 1);

      // Fix common LLM issues
      cleaned = cleaned
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/[\x00-\x1F\x7F]/g, "");

      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(JSON.stringify({ result: null, raw: resultText }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save chatter history from parsed JSON
    try {
      const today = new Date().toISOString().split("T")[0];
      const rows: any[] = [];

      for (const cat of parsed.categories || []) {
        for (const chatter of cat.chatters || []) {
          const name = (chatter.name || "").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
          const kpis = chatter.kpis || {};

          // Parse revenue
          let revenue = 0;
          const revKey = Object.keys(kpis).find((k) => /umsatz|revenue/i.test(k));
          if (revKey) {
            const revStr = kpis[revKey].replace(/[^\d,.\-]/g, "").replace(",", ".");
            revenue = parseFloat(revStr) || 0;
          }

          // Parse massDMs
          let massDms = 0;
          const dmKey = Object.keys(kpis).find((k) => /mass\s*dm|massdm/i.test(k));
          if (dmKey) {
            massDms = parseInt(kpis[dmKey].replace(/\D/g, ""), 10) || 0;
          }

          // Parse open chats
          let openChats = 0;
          const chatKey = Object.keys(kpis).find((k) => /offene?\s*chats?|open\s*chats?/i.test(k));
          if (chatKey) {
            openChats = parseInt(kpis[chatKey].replace(/\D/g, ""), 10) || 0;
          }

          // Parse response delay days (e.g. "Seit 3 Tagen", "5 Tage")
          let responseDelay = 0;
          const delayKey = Object.keys(kpis).find((k) => /seit|verzug|delay|tage/i.test(k));
          if (delayKey) {
            responseDelay = parseInt(kpis[delayKey].replace(/\D/g, ""), 10) || 0;
          }

          rows.push({
            chatter_name: name,
            revenue_today: revenue,
            mass_dms: massDms,
            open_chats: openChats,
            response_delay_days: responseDelay,
            platform: activePlatform,
            analysis_date: today,
          });
        }
      }

      if (rows.length > 0) {
        await supabase.from("chatter_history").insert(rows);
      }
    } catch (saveErr) {
      console.error("Failed to save chatter history:", saveErr);
    }

    return new Response(JSON.stringify({ result: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
