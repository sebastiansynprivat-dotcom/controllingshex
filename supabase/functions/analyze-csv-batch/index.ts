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

KATEGORIE-ZUORDNUNG — STRIKTE ENTSCHEIDUNGSLOGIK (prüfe von oben nach unten, ERSTE zutreffende Kategorie gewinnt!):

SCHRITT 1 — ONBOARDING prüfen (Startdatum ≤ 5 Tage her):
→ 🔵 ONBOARDING TAG 1 — Seit gestern aktiv. Fokus: Ist er fleißig angefangen?
→ 🔵 ONBOARDING TAG 2 — Seit 2 Tagen aktiv. Fokus: Baut er Rückstände auf?
→ 🔵 ONBOARDING TAG 3 — Seit 3 Tagen aktiv. Fokus: Kommen die ersten Abschlüsse?
→ 🔵 ONBOARDING TAG 4 — Seit 4 Tagen aktiv. Fokus: Woran hakt es, wenn noch 0€?
→ 🔵 ONBOARDING TAG 5 — Seit 5 Tagen aktiv. Letzter Tag vor den harten Metriken.
WENN Onboarding zutrifft → STOPP, diese Kategorie verwenden. Nicht weiter prüfen!

SCHRITT 2 — WARNUNG prüfen (Antwortzeit):
→ 🟠 WARNUNG — NUR wenn "Offene Chats seit X Tagen" und X > 2. Prüfe den Verzug-Wert aus den CSV-Daten.
WENN Warnung zutrifft → STOPP.

SCHRITT 3 — ACCOUNT-EINBRUCH prüfen (SEHR RESTRIKTIV!):
→ ⚠️ ACCOUNT-EINBRUCH — NUR verwenden wenn ALLE diese Bedingungen erfüllt sind:
  1. Es gibt historische Daten für diesen Account/Chatter in den HISTORISCHEN DATEN
  2. Der aktuelle Tagesumsatz ist mindestens 50% NIEDRIGER als der historische Durchschnitt dieses Accounts
  3. Der Einbruch ist über mindestens 2-3 Tage sichtbar (kein einzelner schlechter Tag)
  OHNE historische Daten → NIEMALS "ACCOUNT-EINBRUCH" verwenden!
  Bei Zweifel → NICHT "ACCOUNT-EINBRUCH", sondern weiter prüfen.

SCHRITT 4 — MODEL-TAUSCH prüfen:
→ 🔄 MODEL-TAUSCH — Chatter ist deutlich zu groß/klein für den Account (Follower vs. Performance-Mismatch). Konkreten Wechsel-Vorschlag machen.

SCHRITT 4b — ACCOUNT UPGRADE (ZUVERLÄSSIG) prüfen:
→ 🔼 ACCOUNT UPGRADE (ZUVERLÄSSIG) — NUR wenn ALLE Bedingungen erfüllt sind:
  1. Chatter hat mindestens 5 Tage in den HISTORISCHEN DATEN
  2. An mindestens 70% dieser Tage war der Tagesumsatz > 0€ (siehe "Aktive Tage" in der Zusammenfassung)
  3. Chatter ist NICHT bereits in WARNUNG oder ACCOUNT-EINBRUCH
  → Empfehlung: "Zuverlässiger Chatter (X% aktive Tage, Ø Y€). Upgrade auf größeren Account empfohlen."
  WICHTIG: Nutze die vorberechnete Zusammenfassung "Aktive Tage: X/Y (Z%)" aus den HISTORISCHEN DATEN!
WENN ACCOUNT UPGRADE (ZUVERLÄSSIG) zutrifft → STOPP.

SCHRITT 5 — 0€ UMSATZ-STREAK prüfen (nur wenn Tagesumsatz = 0€ UND kein Onboarding):
Zähle aus den HISTORISCHEN DATEN, wie viele aufeinanderfolgende Tage der Chatter 0€ hatte (inklusive heute).
→ 📉 0€ UMSATZ TAG 1 — Heute erster Tag 0€.
→ 📉 0€ UMSATZ TAG 2 — 2 Tage in Folge 0€.
→ 📉 0€ UMSATZ TAG 3 — 3 Tage in Folge 0€. Scharfer Warnschuss nötig!
→ 📉 0€ UMSATZ TAG 4 — 4 Tage in Folge 0€.
→ 📉 0€ UMSATZ TAG 5 — 5 Tage in Folge 0€.
→ 📉 0€ UMSATZ TAG 6 — 6 Tage in Folge 0€.
→ 📉 0€ UMSATZ TAG 7+ — 7+ Tage in Folge 0€. Klare Empfehlung zur Kündigung/Austausch!
WENN 0€ heute UND kein Onboarding → eine der obigen Kategorien verwenden, STOPP.

SCHRITT 5b — COMEBACK prüfen:
→ 🔄 COMEBACK — Chatter hatte laut Historie 3+ Tage in Folge 0€, hat aber HEUTE wieder Umsatz > 0€.
  → Empfehlung: "Comeback nach X Tagen Pause. Positiv bestärken und eng begleiten."
WENN COMEBACK zutrifft → STOPP.

SCHRITT 6 — POSITIVE KATEGORIEN prüfen:
→ 🌟 BREAKOUT-STAR — Tagesumsatz ist mindestens 2x höher als der historische Durchschnitt (braucht Historie!).
→ 🟢 ACCOUNT UPGRADE (UMSATZ-STREAK) — 5 Tage in Folge >= 30€ laut Historie.
→ 🚀 KURZ VOR UPGRADE — Exakt 4 Tage in Folge >= 30€ laut Historie.
→ 📊 HOHER TRAFFIC / KEINE CONVERSION — > 3 MassDMs heute, aber 0€ Umsatz.
  → Empfehlung: Coaching zur Conversion-Optimierung. Der Chatter generiert Traffic, schließt aber nicht ab.

SCHRITT 7 — COACHING prüfen:
→ 📼 VIDEO-COACHING — Seit >= 7 Tagen aktiv UND in den letzten 7 Tagen insgesamt < 20€.
  Langzeit-Underperformer, braucht Video-Schulung.
→ 🟡 COACHING / ENGERE KONTROLLE — Seit 5-6 Tagen aktiv UND in den letzten 5 Tagen insgesamt < 15€.
  Noch früh genug für engere Begleitung.

SCHRITT 8 — MITTELFELD segmentieren (Fallback):
→ ⭐ TOP PERFORMER — Tagesumsatz heute > Ø aller Chatter im Batch. Starke Leistung!
→ ⚪ WEITER SO — Tagesumsatz > 0€, aber ≤ Batch-Durchschnitt. Solide, aber Luft nach oben.
→ 👀 UNTER BEOBACHTUNG — Tagesumsatz = 0€ heute, aber kein 0€-Streak (nur 1 Tag). Noch kein Alarm.

WICHTIGE VERBOTE:
- Ein Chatter mit positivem Tagesumsatz (> 0€) UND ohne klaren historischen Einbruchsnachweis gehört NICHT in ACCOUNT-EINBRUCH.
- Ein Chatter mit 0€ Umsatz gehört in die 0€-UMSATZ-Kategorien, NICHT in ACCOUNT-EINBRUCH.

Regeln:
- Nutze NUR die oben genannten categoryName-Werte exakt wie geschrieben.
- Jeder Chatter gehört in GENAU EINE Kategorie (die ERSTE zutreffende von oben nach unten).
- "kpis" enthält alle relevanten Kennzahlen als Key-Value-Paare. Geldbeträge mit € formatieren.
- WICHTIG: Das Feld "Offene Chats" MUSS im Format "X Chats seit Y Tagen" sein.
- Gib das JSON kompakt aus.
- "recommendation" ist die konkrete Handlungsempfehlung nach der Formel: [Daten-Fakt] + [Insight] + [Konkretes To-Do].
- KEINE Einleitung, KEINE Zusammenfassung – NUR das JSON-Objekt.
- Antworte mit NICHTS außer dem JSON.
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
