import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL_NAME = "google/gemini-2.5-flash";
const BATCH_SIZE = 50;
const TIMEOUT_MS = 180000;

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

function splitCsvIntoBatches(csvData: string, batchSize: number): { header: string; batches: string[][] } {
  const lines = csvData.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { header: lines[0] || "", batches: [] };
  const header = lines[0];
  const dataLines = lines.slice(1);
  const batches: string[][] = [];
  for (let i = 0; i < dataLines.length; i += batchSize) {
    batches.push(dataLines.slice(i, i + batchSize));
  }
  return { header, batches };
}

function extractNameFromCsvRow(row: string, nameColIndex: number): string {
  // Handle quoted CSV fields
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
  return idx >= 0 ? idx : 1; // fallback to column index 1 (Name is usually 2nd)
}

function getReturnedNames(result: any): Set<string> {
  const names = new Set<string>();
  for (const cat of result.categories || []) {
    for (const ch of cat.chatters || []) {
      if (ch.name) names.add(ch.name.toLowerCase().replace(/[_\s]+/g, " ").trim());
    }
  }
  return names;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

async function analyzeBatch(
  lovableApiKey: string,
  systemPrompt: string,
  header: string,
  batchLines: string[],
  activePlatform: string,
  modelsText: string,
  batchNum: number,
  totalBatches: number,
): Promise<any> {
  const batchCsv = [header, ...batchLines].join("\n");
  const userMessage = `Plattform: ${activePlatform}\nBatch ${batchNum}/${totalBatches} (${batchLines.length} Chatter)\n\nCSV-Daten:\n\n${batchCsv}\n\nModels (${activePlatform}):\n${modelsText}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
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
        max_tokens: 16384,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI error ${response.status}: ${errText.substring(0, 200)}`);
    }

    const aiResult = await response.json();
    const resultText = aiResult.choices?.[0]?.message?.content || "";
    console.log(`[analyze-csv] Batch ${batchNum}/${totalBatches}: ${resultText.length} chars`);
    return cleanAndParseJson(resultText);
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") throw new Error(`Batch ${batchNum} timeout`);
    throw err;
  }
}

async function analyzeBatchWithRetry(
  lovableApiKey: string,
  systemPrompt: string,
  header: string,
  batchLines: string[],
  activePlatform: string,
  modelsText: string,
  batchNum: number,
  totalBatches: number,
  nameColIndex: number,
): Promise<any> {
  const MAX_RETRIES = 2;
  let currentLines = batchLines;
  const allResults: any[] = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await analyzeBatch(lovableApiKey, systemPrompt, header, currentLines, activePlatform, modelsText, batchNum, totalBatches);
    allResults.push(result);

    // Check which names from the CSV are missing in the result
    const returnedNames = getReturnedNames(mergeResults(allResults));
    const missingLines = currentLines.filter(line => {
      const csvName = extractNameFromCsvRow(line, nameColIndex);
      return csvName && !returnedNames.has(normalizeName(csvName));
    });

    if (missingLines.length === 0) {
      console.log(`[analyze-csv] Batch ${batchNum}: 100% coverage after attempt ${attempt + 1}`);
      break;
    }

    if (attempt < MAX_RETRIES) {
      console.log(`[analyze-csv] Batch ${batchNum}: ${missingLines.length} missing, retry ${attempt + 1}…`);
      currentLines = missingLines;
    } else {
      console.warn(`[analyze-csv] Batch ${batchNum}: ${missingLines.length} still missing after ${MAX_RETRIES + 1} attempts`);
    }
  }

  return mergeResults(allResults);
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
    const { csvData, platform, fileName, filePath } = await req.json();

    // Extract user_id from JWT
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        userId = payload.sub || null;
      } catch { /* ignore */ }
    }
    if (!csvData || typeof csvData !== "string") {
      return new Response(JSON.stringify({ error: "csvData is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (fileName !== undefined && typeof fileName !== "string") {
      return new Response(JSON.stringify({ error: "fileName must be a string" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (filePath !== undefined && typeof filePath !== "string") {
      return new Response(JSON.stringify({ error: "filePath must be a string" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY nicht konfiguriert" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const validPlatforms = ["Maloum", "Brezzels", "FansyMe"];
    const activePlatform = validPlatforms.includes(platform) ? platform : "Maloum";

    const { data: models } = await supabase.from("models").select("model_name, follower_count").eq("platform", activePlatform);
    const modelsText = models?.length ? models.map((m: any) => `${m.model_name}: ${m.follower_count} Follower`).join("\n") : "Keine Models vorhanden.";

    // Load last 14 days of history for this platform
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const { data: historyData } = await supabase
      .from("chatter_history")
      .select("chatter_name, analysis_date, revenue_today, mass_dms, open_chats, category")
      .eq("platform", activePlatform)
      .gte("analysis_date", fourteenDaysAgo.toISOString().split("T")[0])
      .order("analysis_date", { ascending: true });

    let historyBlock = "";
    if (historyData && historyData.length > 0) {
      const byChatter = new Map<string, string[]>();
      for (const row of historyData) {
        const name = row.chatter_name;
        if (!byChatter.has(name)) byChatter.set(name, []);
        byChatter.get(name)!.push(`${row.analysis_date}: ${row.revenue_today}€, ${row.mass_dms} DMs, ${row.open_chats} offene Chats${row.category ? `, Kat: ${row.category}` : ""}`);
      }
      const lines: string[] = [];
      for (const [name, entries] of byChatter) {
        lines.push(`${name}:\n  ${entries.join("\n  ")}`);
      }
      historyBlock = `\n\nHISTORISCHE DATEN (letzte 14 Tage, Plattform: ${activePlatform}):\n${lines.join("\n")}\n\nNutze diese Historie um Trends zu erkennen: 0€-Streaks, Account-Einbrüche, Umsatz-Streaks, Onboarding-Tage, etc.`;
    }

    const { data: promptData } = await supabase.from("settings").select("value").eq("key", "system_prompt").single();
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

KATEGORIE-DEFINITIONEN (nutze NUR diese categoryName-Werte!):

⚠️ ACCOUNT-EINBRUCH — Account war historisch stark, bricht plötzlich massiv ein ODER neuer Chatter performt viel schlechter als Vorgänger. PRIORISIERE DIES!
🔄 MODEL-TAUSCH — Chatter ist zu groß/klein für den Account. Mache einen konkreten Wechsel-Vorschlag mit einem freien Account.
🔵 ONBOARDING TAG 1 — Seit gestern aktiv. Fokus: Ist er fleißig angefangen?
🔵 ONBOARDING TAG 2 — Seit 2 Tagen aktiv. Fokus: Baut er Rückstände auf?
🔵 ONBOARDING TAG 3 — Seit 3 Tagen aktiv. Fokus: Kommen die ersten Abschlüsse?
🔵 ONBOARDING TAG 4 — Seit 4 Tagen aktiv. Fokus: Woran hakt es, wenn noch 0€?
🔵 ONBOARDING TAG 5 — Seit 5 Tagen aktiv. Letzter Tag vor den harten Metriken.
🌟 BREAKOUT-STAR — Tagesumsatz extrem viel höher als bisher.
🟢 ACCOUNT UPGRADE (UMSATZ-STREAK) — 5 Tage in Folge >= 30€.
🚀 KURZ VOR UPGRADE — Exakt 4 Tage in Folge >= 30€.
🟢 ACCOUNT UPGRADE (TRAFFIC TEST) — > 3 MassDMs/Tag, aber 0€ Umsatz. Verbrennt er Traffic oder ist der Account zu klein?
📉 0€ UMSATZ TAG 1 — Heute erster Tag 0€ (außerhalb Onboarding).
📉 0€ UMSATZ TAG 2 — 2 Tage in Folge 0€.
📉 0€ UMSATZ TAG 3 — 3 Tage in Folge 0€. Scharfer Warnschuss nötig!
📉 0€ UMSATZ TAG 4 — 4 Tage in Folge 0€.
📉 0€ UMSATZ TAG 5 — 5 Tage in Folge 0€.
📉 0€ UMSATZ TAG 6 — 6 Tage in Folge 0€.
📉 0€ UMSATZ TAG 7+ — 7+ Tage in Folge 0€. Klare Empfehlung zur Kündigung/Austausch!
🟠 WARNUNG — Chats offen, die älter als 2 Tage sind.
📼 VIDEO-COACHING — Seit >= 5 Tagen aktiv UND in den letzten 5 Tagen insgesamt < 15€.
🟡 COACHING / ENGERE KONTROLLE — Seit > 5 Tagen aktiv UND insgesamt < 20€ eingenommen.
⚪ WEITER SO / MITTELFELD — Restliche Chatter, die in keine andere Kategorie passen.

Regeln:
- Nutze NUR die oben genannten categoryName-Werte exakt wie geschrieben.
- Jeder Chatter gehört in GENAU EINE Kategorie (die wichtigste/dringendste).
- "kpis" enthält alle relevanten Kennzahlen als Key-Value-Paare. Geldbeträge mit € formatieren.
- WICHTIG: Das Feld "Offene Chats" MUSS im Format "X Chats seit Y Tagen" sein.
- Gib das JSON kompakt aus.
- "recommendation" ist die konkrete Handlungsempfehlung nach der Formel: [Daten-Fakt] + [Insight] + [Konkretes To-Do].
- KEINE Einleitung, KEINE Zusammenfassung – NUR das JSON-Objekt.
- Antworte mit NICHTS außer dem JSON.
- CRITICAL: Include EVERY SINGLE CHATTER from the CSV. DO NOT skip anyone. Each row = one chatter.`;

    const systemPrompt = userSystemPrompt + formatInstructions + historyBlock;

    // Split CSV into batches
    const { header, batches } = splitCsvIntoBatches(csvData, BATCH_SIZE);
    const totalEntries = batches.reduce((s, b) => s + b.length, 0);
    const totalBatches = batches.length;
    const nameColIndex = findNameColumn(header);
    console.log(`[analyze-csv] ${totalEntries} Chatter in ${totalBatches} Batches à ${BATCH_SIZE} (name col: ${nameColIndex})`);

    if (totalBatches === 0) {
      return new Response(JSON.stringify({ error: "Keine Daten gefunden." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Process batches sequentially with auto-retry for missing chatters
    const batchResults: any[] = [];
    const errors: string[] = [];

    for (let i = 0; i < totalBatches; i++) {
      try {
        console.log(`[analyze-csv] Starte Batch ${i + 1}/${totalBatches} (${batches[i].length} Chatter)…`);
        const result = await analyzeBatchWithRetry(lovableApiKey, systemPrompt, header, batches[i], activePlatform, modelsText, i + 1, totalBatches, nameColIndex);
        batchResults.push(result);
        const chattersInBatch = (result.categories || []).reduce((s: number, c: any) => s + (c.chatters?.length || 0), 0);
        console.log(`[analyze-csv] Batch ${i + 1} ✓ → ${chattersInBatch}/${batches[i].length} Chatter`);
      } catch (err: any) {
        console.error(`[analyze-csv] Batch ${i + 1} failed:`, err.message);
        errors.push(`Batch ${i + 1}: ${err.message}`);
      }
    }

    if (batchResults.length === 0) {
      return new Response(JSON.stringify({ error: `Alle Batches fehlgeschlagen: ${errors.join("; ")}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Merge all batch results
    const merged = mergeResults(batchResults);
    const totalChatters = merged.categories.reduce((s: number, c: any) => s + c.chatters.length, 0);
    console.log(`[analyze-csv] Merged: ${totalChatters} Chatter in ${merged.categories.length} Kategorien (${errors.length} Batch-Fehler)`);

    // Save to chatter_history
    try {
      const today = new Date().toISOString().split("T")[0];
      const rows: any[] = [];
      for (const cat of merged.categories || []) {
        for (const chatter of cat.chatters || []) {
          const name = (chatter.name || "").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
          const kpis = chatter.kpis || {};
          let revenue = 0;
          const revKey = Object.keys(kpis).find((k) => /umsatz|revenue/i.test(k));
          if (revKey) revenue = parseFloat(kpis[revKey].replace(/[^\d,.\-]/g, "").replace(",", ".")) || 0;
          let massDms = 0;
          const dmKey = Object.keys(kpis).find((k) => /mass\s*dm/i.test(k));
          if (dmKey) massDms = parseInt(kpis[dmKey].replace(/\D/g, ""), 10) || 0;
          let openChats = 0, responseDelay = 0;
          const chatKey = Object.keys(kpis).find((k) => /offene?\s*chats?|open\s*chats?/i.test(k));
          if (chatKey) {
            const chatVal = kpis[chatKey];
            const m = chatVal.match(/(\d+)\s*(?:chats?)\s*seit\s*(\d+)/i);
            if (m) { openChats = parseInt(m[1]) || 0; responseDelay = parseInt(m[2]) || 0; }
            else { openChats = parseInt((chatVal.match(/(\d+)/) || [])[1] || "0") || 0; }
          }
          if (responseDelay > 30) responseDelay = 0;
          rows.push({ chatter_name: name, revenue_today: revenue, mass_dms: massDms, open_chats: openChats, response_delay_days: responseDelay, platform: activePlatform, analysis_date: today, category: cat.categoryName || null, recommendation: chatter.recommendation || null, user_id: userId });
        }
      }
      if (rows.length > 0) {
        await supabase.from("chatter_history").upsert(rows, { onConflict: "chatter_name,platform,analysis_date" });
        console.log(`[analyze-csv] Saved ${rows.length} records`);
      }
    } catch (saveErr) {
      console.error("[analyze-csv] History save error:", saveErr);
    }

    try {
      if (filePath) {
        const total = merged.categories.reduce((sum: number, category: any) => sum + (category.chatters?.length || 0), 0);
        const today = new Date().toISOString().split("T")[0];
        const reportPayload = {
          platform: activePlatform,
          analysis_date: today,
          file_name: fileName || `Report_${today}.csv`,
          file_path: filePath,
          result_json: merged,
          chatter_count: total,
          user_id: userId,
        };

        const { error: reportError } = await supabase
          .from("analysis_reports")
          .insert(reportPayload);

        if (reportError) {
          console.error("[analyze-csv] Report save error:", reportError);
        } else {
          console.log(`[analyze-csv] Saved report for ${filePath}`);
        }
      }
    } catch (reportSaveErr) {
      console.error("[analyze-csv] Report save fatal:", reportSaveErr);
    }

    return new Response(JSON.stringify({
      result: merged,
      batchInfo: { total: totalBatches, succeeded: batchResults.length, failed: errors.length, totalChatters, inputRows: totalEntries },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[analyze-csv] Fatal:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
