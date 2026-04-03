import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL_NAME = "google/gemini-2.5-flash";
const TIMEOUT_MS = 60000;

function repairJsonString(value: string) {
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === "{") braces += 1;
    if (char === "}") braces -= 1;
    if (char === "[") brackets += 1;
    if (char === "]") brackets -= 1;
  }

  let repaired = value;
  while (brackets > 0) { repaired += "]"; brackets -= 1; }
  while (braces > 0) { repaired += "}"; braces -= 1; }
  return repaired;
}

function cleanAndParseJson(raw: string): any {
  // Strip markdown code fences
  let cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // Extract JSON object
  const jsonStart = cleaned.indexOf("{");
  if (jsonStart === -1) throw new Error("No JSON object found in response");

  const jsonEnd = cleaned.lastIndexOf("}");
  cleaned = jsonEnd > jsonStart
    ? cleaned.substring(jsonStart, jsonEnd + 1)
    : cleaned.substring(jsonStart);

  // Fix common issues
  cleaned = cleaned
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    console.error("[analyze-csv] First parse failed, attempting repair. First 100 chars:", cleaned.substring(0, 100));
    return JSON.parse(repairJsonString(cleaned));
  }
}

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
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
            "Offene Chats": "12 Chats seit 3 Tagen",
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
- WICHTIG: Das Feld "Offene Chats" MUSS im Format "X Chats seit Y Tagen" sein (z.B. "12 Chats seit 3 Tagen"), damit wir die Anzahl und den Verzug separat parsen können.
- Gib das JSON kompakt aus: keine unnötigen Leerzeilen, keine Einrückungen, keine zusätzlichen Whitespaces.
- "recommendation" ist die konkrete Handlungsempfehlung.
- KEINE Einleitung, KEINE Zusammenfassung – NUR das JSON-Objekt.
- Antworte mit NICHTS außer dem JSON. Kein \`\`\`json Block, kein Text davor oder danach.

CRITICAL INSTRUCTION: You are given a dataset of chatters. You MUST process, analyze, and include EVERY SINGLE CHATTER in your final JSON output. DO NOT summarize, DO NOT group them together, and DO NOT skip anyone to save space. If the input contains 100 chatters, your output MUST contain exactly 100 chatters. Compare your output against the input before finishing to ensure 100% completeness.`;

    const systemPrompt = userSystemPrompt + formatInstructions;

    const userMessage = `Plattform: ${activePlatform}\n\nHier sind die CSV-Daten der heutigen Analyse:\n\n${csvData}\n\nHier ist die Liste der Models und ihrer Followerzahlen (nur ${activePlatform}):\n${modelsText}`;

    console.log(`[analyze-csv] Nutze Modell: ${MODEL_NAME}`);
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
          return new Response(JSON.stringify({ error: "Rate limit erreicht. Bitte warte kurz und versuche es erneut." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (attempt.status === 402) {
          return new Response(JSON.stringify({ error: "AI-Credits aufgebraucht. Bitte Credits aufladen." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ error: `Modell ${MODEL_NAME} Fehler (${attempt.status}): ${errText.substring(0, 200)}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      response = attempt;
      console.log(`[analyze-csv] ${MODEL_NAME} ✓ Antwort erhalten`);
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      if (fetchErr.name === "AbortError") {
        console.error(`[analyze-csv] ${MODEL_NAME} Timeout nach ${TIMEOUT_MS / 1000}s`);
        return new Response(JSON.stringify({ error: `Timeout nach ${TIMEOUT_MS / 1000}s. Versuche es mit weniger Daten.` }), {
          status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw fetchErr;
    }

    const aiResult = await response.json();
    const resultText = aiResult.choices?.[0]?.message?.content || "";

    console.log(`[analyze-csv] Response received, length: ${resultText.length} chars`);
    console.log(`[analyze-csv] First 200 chars: ${resultText.substring(0, 200)}`);

    let parsed;
    try {
      parsed = cleanAndParseJson(resultText);
    } catch (parseErr) {
      console.error("[analyze-csv] JSON parse failed:", parseErr);
      console.error("[analyze-csv] Raw response (first 300 chars):", resultText.substring(0, 300));
      return new Response(JSON.stringify({ result: null, error: "Analyse konnte nicht als JSON gelesen werden. Rohdaten in den Logs.", rawResponse: resultText.substring(0, 500) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save to chatter_history
    try {
      const today = new Date().toISOString().split("T")[0];
      const rows: any[] = [];

      for (const cat of parsed.categories || []) {
        for (const chatter of cat.chatters || []) {
          const name = (chatter.name || "").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
          const kpis = chatter.kpis || {};

          let revenue = 0;
          const revKey = Object.keys(kpis).find((k) => /umsatz|revenue/i.test(k));
          if (revKey) {
            const revStr = kpis[revKey].replace(/[^\d,.\-]/g, "").replace(",", ".");
            revenue = parseFloat(revStr) || 0;
          }

          let massDms = 0;
          const dmKey = Object.keys(kpis).find((k) => /mass\s*dm|massdm/i.test(k));
          if (dmKey) {
            massDms = parseInt(kpis[dmKey].replace(/\D/g, ""), 10) || 0;
          }

          let openChats = 0;
          let responseDelay = 0;
          const chatKey = Object.keys(kpis).find((k) => /offene?\s*chats?|open\s*chats?/i.test(k));
          if (chatKey) {
            const chatVal = kpis[chatKey];
            const fullMatch = chatVal.match(/(\d+)\s*(?:chats?)\s*seit\s*(\d+)\s*(?:tagen?|days?)/i);
            if (fullMatch) {
              openChats = parseInt(fullMatch[1], 10) || 0;
              responseDelay = parseInt(fullMatch[2], 10) || 0;
            } else {
              const chatCountMatch = chatVal.match(/(\d+)/);
              openChats = chatCountMatch ? parseInt(chatCountMatch[1], 10) || 0 : 0;
              const delayMatch = chatVal.match(/seit\s*(\d+)\s*(?:tagen?|days?)/i);
              if (delayMatch) {
                responseDelay = parseInt(delayMatch[1], 10) || 0;
              }
            }
          }

          // Verzug-Schutz: Werte > 30 sind Parsing-Fehler
          if (responseDelay > 30) {
            responseDelay = 0;
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
        console.log(`[analyze-csv] Saved ${rows.length} chatter records`);
      }
    } catch (saveErr) {
      console.error("[analyze-csv] Failed to save chatter history:", saveErr);
    }

    return new Response(JSON.stringify({ result: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[analyze-csv] Fatal error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
