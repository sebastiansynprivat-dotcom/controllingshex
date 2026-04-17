import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL_NAME = "google/gemini-2.5-flash";
const TIMEOUT_MS = 150000;
const MAX_RETRIES = 3;

function repairJsonString(value: string): string {
  let s = value.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "").replace(/,\s*$/, "");
  let braces = 0, brackets = 0, inString = false, escaped = false;
  for (const char of s) {
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === "{") braces++;
    if (char === "}") braces--;
    if (char === "[") brackets++;
    if (char === "]") brackets--;
  }
  if (inString) s += '"';
  while (brackets > 0) { s = s.replace(/,\s*$/, "") + "]"; brackets--; }
  while (braces > 0) { s = s.replace(/,\s*$/, "") + "}"; braces--; }
  return s;
}

function cleanAndParseJson(raw: string): any {
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const jsonStart = cleaned.indexOf("{");
  if (jsonStart === -1) throw new Error("No JSON object found");
  const jsonEnd = cleaned.lastIndexOf("}");
  cleaned = jsonEnd > jsonStart ? cleaned.substring(jsonStart, jsonEnd + 1) : cleaned.substring(jsonStart);
  cleaned = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/[\x00-\x1F\x7F]/g, " ");
  try { return JSON.parse(cleaned); }
  catch {
    try { return JSON.parse(repairJsonString(cleaned)); }
    catch { return JSON.parse(repairJsonString(cleaned.replace(/[\u0000-\u001F]/g, ""))); }
  }
}

function extractNameFromCsvRow(row: string, nameColIndex: number): string {
  const fields: string[] = [];
  let current = "", inQuotes = false;
  for (const ch of row) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  fields.push(current.trim());
  return (fields[nameColIndex] || "").replace(/^[@\s]+/, "").trim();
}

function findNameColumn(header: string): number {
  const cols = header.toLowerCase().split(",").map(c => c.trim());
  const idx = cols.findIndex(c => c === "name" || c === "chatter" || c === "chatter_name");
  return idx >= 0 ? idx : 1;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

function getReturnedNames(result: any): Set<string> {
  const names = new Set<string>();
  for (const cat of result.categories || []) {
    for (const ch of cat.chatters || []) {
      if (ch.name) names.add(normalizeName(ch.name));
    }
  }
  return names;
}

function mergeResults(results: any[]): any {
  const categoryMap = new Map<string, any>();
  for (const result of results) {
    for (const cat of result.categories || []) {
      const key = cat.categoryName;
      if (categoryMap.has(key)) {
        categoryMap.get(key).chatters.push(...(cat.chatters || []));
      } else {
        categoryMap.set(key, { ...cat, chatters: [...(cat.chatters || [])] });
      }
    }
  }
  return { categories: Array.from(categoryMap.values()) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { header, batchLines, platform, batchNum, totalBatches } = await req.json();

    if (!header || !Array.isArray(batchLines) || batchLines.length === 0) {
      return new Response(JSON.stringify({ error: "header and batchLines required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY nicht konfiguriert" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract user_id from JWT
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader) {
      try {
        const token = authHeader.replace("Bearer ", "");
        const payload = JSON.parse(atob(token.split(".")[1]));
        userId = payload.sub || null;
      } catch { /* ignore */ }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const validPlatforms = ["Maloum", "Brezzels", "FansyMe"];
    const activePlatform = validPlatforms.includes(platform) ? platform : "Maloum";

    // Load models
    const { data: models } = await supabase.from("models").select("model_name, follower_count").eq("platform", activePlatform);
    const modelsText = models?.length ? models.map((m: any) => `${m.model_name}: ${m.follower_count} Follower`).join("\n") : "Keine Models vorhanden.";

    // Load history (last 14 days)
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const { data: historyData } = await supabase
      .from("chatter_history")
      .select("chatter_name, analysis_date, revenue_today, mass_dms, open_chats, category")
      .eq("platform", activePlatform)
      .gte("analysis_date", fourteenDaysAgo.toISOString().split("T")[0])
      .order("analysis_date", { ascending: true });

    // Build model lookup for follower counts
    const modelFollowers = new Map<string, number>();
    if (models?.length) {
      for (const m of models) {
        modelFollowers.set(m.model_name.toLowerCase(), m.follower_count);
      }
    }

    let historyBlock = "";
    if (historyData && historyData.length > 0) {
      const byChatter = new Map<string, any[]>();
      for (const row of historyData) {
        if (!byChatter.has(row.chatter_name)) byChatter.set(row.chatter_name, []);
        byChatter.get(row.chatter_name)!.push(row);
      }
      const lines: string[] = [];
      for (const [name, rows] of byChatter) {
        const totalDays = rows.length;
        const activeDays = rows.filter((r: any) => (r.revenue_today || 0) > 0).length;
        const activePct = Math.round((activeDays / totalDays) * 100);
        const avgRevenue = (rows.reduce((s: number, r: any) => s + (r.revenue_today || 0), 0) / totalDays).toFixed(2);
        const detailLines = rows.map((r: any) => `${r.analysis_date}: ${r.revenue_today}€, ${r.mass_dms} DMs, ${r.open_chats} offene Chats${r.category ? `, Kat: ${r.category}` : ""}`);
        const summary = `Aktive Tage: ${activeDays}/${totalDays} (${activePct}%), Ø Tagesumsatz: ${avgRevenue}€`;
        lines.push(`${name} [${summary}]:\n  ${detailLines.join("\n  ")}`);
      }
      historyBlock = `\n\nHISTORISCHE DATEN (letzte 14 Tage, Plattform: ${activePlatform}):\n${lines.join("\n")}\n\nNutze diese Historie um Trends zu erkennen. Die Zusammenfassung (Aktive Tage %, Ø Umsatz) hilft bei der Zuverlässigkeitsbewertung.`;
    }

    // Load system prompt
    const { data: promptData } = await supabase.from("settings").select("value").eq("key", "system_prompt").eq("user_id", userId).single();
    const userSystemPrompt = promptData?.value || "Du bist ein hilfreicher Assistent für Datenanalyse.";

    const formatInstructions = `

KRITISCH – AUSGABEFORMAT (JSON):
Du MUSST deine gesamte Antwort als ein einziges, valides JSON-Objekt ausgeben. Kein Markdown, kein Fließtext, keine Erklärungen – NUR JSON.

Das JSON muss exakt dieses Schema haben:
{
  "categories": [
    {
      "emoji": "🆘",
      "categoryName": "SOFORT EINGREIFEN",
      "chatters": [
        {
          "name": "Max Mustermann",
          "startDate": "01.04.2026",
          "account": "modelname",
          "subTag": "Verzug 7+ Tage",
          "trend": "declining",
          "kpis": {
            "Tagesumsatz": "0,00 €",
            "Offene Chats": "12 Chats seit 8 Tagen",
            "MassDMs": "5"
          },
          "recommendation": "Konkrete Handlungsempfehlung hier"
        }
      ]
    }
  ]
}

==============================================================
NEUES KATEGORIE-SYSTEM — 6 ACTION-KATEGORIEN (strikte Prio!)
==============================================================
Jeder Chatter gehört in GENAU EINE der 6 Haupt-Kategorien.
Prüfe von oben nach unten — die ERSTE zutreffende gewinnt, dann STOPP.
Zusätzlich vergibst du einen "subTag" (kurzer beschreibender Text) und einen "trend" ("rising" | "declining" | "stable" | "volatile" | "unknown").

──────────────────────────────────────────────
🆘 SOFORT EINGREIFEN  (categoryName: "SOFORT EINGREIFEN", emoji: "🆘")
──────────────────────────────────────────────
Trifft zu wenn EINE dieser Bedingungen erfüllt ist:
- Antwortverzug ≥ 7 Tage ("Offene Chats seit X Tagen", X ≥ 7)
- 5 oder mehr Tage in Folge 0€ Tagesumsatz (laut Historie)
- Account-Einbruch: aktueller Tagesumsatz ≥ 70% niedriger als historischer Schnitt UND mind. 3 Tage sichtbar
subTag-Beispiele: "Verzug 8 Tage", "0€ seit 6 Tagen", "Einbruch -85%"

──────────────────────────────────────────────
💬 COACHING NÖTIG  (categoryName: "COACHING NÖTIG", emoji: "💬")
──────────────────────────────────────────────
Trifft zu wenn EINE dieser Bedingungen erfüllt ist (und SOFORT EINGREIFEN NICHT zutrifft):
- Antwortverzug 4-6 Tage
- 2-4 Tage in Folge 0€ Tagesumsatz
- Trend abwärts: 7-Tage-Schnitt mind. 30% niedriger als 14-Tage-Schnitt (war-Top-jetzt-Mid)
- Hoher Traffic, keine Conversion: > 3 MassDMs heute, aber 0€ Umsatz
- Seit ≥ 7 Tagen aktiv UND in den letzten 7 Tagen insgesamt < 20€
subTag-Beispiele: "Trend ↓ 35%", "0€ seit 3 Tagen", "Verzug 5 Tage", "Traffic ohne Conversion"

──────────────────────────────────────────────
🚀 PUSHEN  (categoryName: "PUSHEN", emoji: "🚀")
──────────────────────────────────────────────
Trifft zu wenn EINE dieser Bedingungen erfüllt ist:
- Onboarding Tag 1-5 (Startdatum ≤ 5 Tage her)
- Rocket Start: Onboarding (Tag 1-5) UND Tagesumsatz heute > 100€
- Kurz vor Upgrade: exakt 4 Tage in Folge ≥ 30€ laut Historie
- Comeback: hatte 3+ Tage in Folge 0€, hat HEUTE wieder Umsatz > 0€
subTag-Beispiele: "Onboarding Tag 3", "🔥 Rocket Start", "Kurz vor Upgrade", "Comeback nach 4 Tagen"

──────────────────────────────────────────────
🎉 BELOHNEN  (categoryName: "BELOHNEN", emoji: "🎉")
──────────────────────────────────────────────
Trifft zu für Top-Performer (KEIN Verzug > 2 Tage). Differenziere im subTag:
- 👑 WHALE: Tagesumsatz heute ≥ 300€ ODER 7-Tage-Summe ≥ 2000€
- 💎 STAR: Tagesumsatz heute ≥ 100€ ODER 7-Tage-Summe ≥ 700€
- 🟢 SOLID: Tagesumsatz heute ≥ 30€ UND mindestens 5 aktive Tage (>0€) in letzten 7 Tagen
- 🌟 BREAKOUT: Tagesumsatz heute mind. 2x höher als historischer Durchschnitt
- 📈 RISING: 7-Tage-Schnitt mind. 30% höher als 14-Tage-Schnitt
subTag MUSS exakt einer der obigen Tags sein (z.B. "💎 Star — 850€ heute", "📈 Rising +42%").

──────────────────────────────────────────────
📊 RE-ASSIGNEN  (categoryName: "RE-ASSIGNEN", emoji: "📊")
──────────────────────────────────────────────
Trifft zu wenn der Chatter offensichtlich auf dem falschen Account sitzt (nur wenn KEINE der höheren Kategorien zutrifft):
- Großer Account (Follower > 20k) UND Chatter macht konstant < 50€/Tag über mind. 5 Tage
- Kleiner Account (Follower < 5k) UND Chatter generiert > 200€/Tag konstant (zu groß für den Account)
- Klarer Follower vs. Performance Mismatch
subTag-Beispiele: "Account zu groß (50k Follower, Ø 35€)", "Account zu klein für Performance"

──────────────────────────────────────────────
👀 BEOBACHTEN  (categoryName: "BEOBACHTEN", emoji: "👀")
──────────────────────────────────────────────
Auffangkorb für ALLE die in keine der obigen passen — stabil, kein Eingriff nötig.
- Solide Mittelfeld-Performance (5-30€/Tag)
- Heute 0€ aber gestern Umsatz (nur 1 Tag pause, kein Streak)
- Noch zu wenig Daten für Trend-Aussage
subTag-Beispiele: "Stabil", "Slow Day (gestern 45€)", "Zu wenig Daten"

==============================================================
ZUSÄTZLICHE FELDER (PFLICHT pro Chatter)
==============================================================
- "subTag": Kurzer beschreibender Text (max 40 Zeichen) — gibt den spezifischen Grund
- "trend": Genau einer dieser Werte:
  - "rising"    → 7-Tage-Schnitt > 14-Tage-Schnitt (mind. +20%)
  - "declining" → 7-Tage-Schnitt < 14-Tage-Schnitt (mind. -20%)
  - "stable"    → 7-Tage-Schnitt ≈ 14-Tage-Schnitt (±20%)
  - "volatile"  → extreme Tagesschwankungen (Std-Abw > Schnitt)
  - "unknown"   → zu wenig Historie (< 5 Tage)

==============================================================
WICHTIGE REGELN
==============================================================
- Nutze NUR die 6 categoryName-Werte exakt: "SOFORT EINGREIFEN", "COACHING NÖTIG", "PUSHEN", "BELOHNEN", "RE-ASSIGNEN", "BEOBACHTEN"
- Jeder Chatter gehört in GENAU EINE Kategorie (die ERSTE zutreffende von oben nach unten).
- "kpis" enthält alle relevanten Kennzahlen als Key-Value-Paare. Geldbeträge mit € formatieren.
- Das Feld "Offene Chats" MUSS im Format "X Chats seit Y Tagen" sein.
- Gib das JSON kompakt aus.
- "recommendation" ist die konkrete Handlungsempfehlung nach der Formel: [Daten-Fakt] + [Insight] + [Konkretes To-Do].
- KEINE Einleitung, KEINE Zusammenfassung – NUR das JSON-Objekt.
- CRITICAL: Include EVERY SINGLE CHATTER from the CSV. DO NOT skip anyone. Each row = one chatter.`;

    const systemPrompt = userSystemPrompt + formatInstructions + historyBlock;
    const nameColIndex = findNameColumn(header);

    // AI call with missing-chatter retry
    const allResults: any[] = [];
    let currentLines = batchLines;
    const MAX_MISSING_RETRIES = 2;

    for (let round = 0; round <= MAX_MISSING_RETRIES; round++) {
      const batchCsv = [header, ...currentLines].join("\n");
      const userMessage = round === 0
        ? `Plattform: ${activePlatform}\nBatch ${batchNum}/${totalBatches} (${currentLines.length} Chatter)\n\nCSV-Daten:\n\n${batchCsv}\n\nModels (${activePlatform}):\n${modelsText}`
        : `NACHLIEFERUNG: Die folgenden ${currentLines.length} Chatter fehlen noch in deiner Antwort. Analysiere sie jetzt!\n\nCSV-Daten:\n\n${batchCsv}\n\nModels (${activePlatform}):\n${modelsText}`;

      let result: any = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

          const response = await fetch(AI_GATEWAY_URL, {
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
              max_tokens: 32768,
              response_format: { type: "json_object" },
            }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`AI ${response.status}: ${errText.substring(0, 200)}`);
          }

          const aiResult = await response.json();
          const resultText = aiResult.choices?.[0]?.message?.content || "";
          console.log(`[batch] ${batchNum}/${totalBatches} round ${round + 1}: ${resultText.length} chars, attempt ${attempt + 1}`);
          result = cleanAndParseJson(resultText);
          break;
        } catch (err: any) {
          const lastError = err.message || "Unknown error";
          console.warn(`[batch] ${batchNum} round ${round + 1} attempt ${attempt + 1} failed: ${lastError}`);
          if (attempt === MAX_RETRIES) {
            if (round === 0 && allResults.length === 0) {
              return new Response(JSON.stringify({ error: `Batch ${batchNum} failed: ${lastError}` }), {
                status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            // If we have partial results from earlier rounds, continue with what we have
            break;
          }
        }
      }

      if (result) allResults.push(result);

      // Check for missing chatters
      const merged = mergeResults(allResults);
      const returnedNames = getReturnedNames(merged);
      const missingLines = currentLines.filter(line => {
        const csvName = extractNameFromCsvRow(line, nameColIndex);
        return csvName && !returnedNames.has(normalizeName(csvName));
      });

      if (missingLines.length === 0) {
        console.log(`[batch] ${batchNum}: 100% coverage after round ${round + 1}`);
        break;
      }

      if (round < MAX_MISSING_RETRIES) {
        console.log(`[batch] ${batchNum}: ${missingLines.length} missing after round ${round + 1}, retrying…`);
        currentLines = missingLines;
      } else {
        console.warn(`[batch] ${batchNum}: ${missingLines.length} still missing after all rounds`);
      }
    }

    const finalResult = mergeResults(allResults);
    const chattersReturned = (finalResult.categories || []).reduce((s: number, c: any) => s + (c.chatters?.length || 0), 0);
    console.log(`[batch] ${batchNum}/${totalBatches} done: ${chattersReturned}/${batchLines.length} chatters`);

    return new Response(JSON.stringify({ result: finalResult, chattersReturned, batchNum }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[batch] Fatal:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
