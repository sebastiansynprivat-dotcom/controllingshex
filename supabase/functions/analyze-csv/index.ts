import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current.trim());
  return fields;
}

function extractNameFromCsvRow(row: string, nameColIndex: number): string {
  return (parseCsvLine(row)[nameColIndex] || "").replace(/^[@\s]+/, "").trim();
}

function findColumnIndex(headers: string[], patterns: RegExp[]): number {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function findNameColumn(header: string): number {
  const cols = parseCsvLine(header).map((col) => col.toLowerCase().trim());
  const idx = cols.findIndex(c => c === "name" || c === "chatter" || c === "chatter_name");
  return idx >= 0 ? idx : 1;
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

function parseDecimal(value: string | undefined): number {
  if (!value) return 0;

  const cleaned = value.replace(/[^\d,.-]/g, "").trim();
  if (!cleaned) return 0;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (hasComma) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }

  return Number.parseFloat(normalized) || 0;
}

function parseInteger(value: string | undefined): number {
  if (!value) return 0;
  return Number.parseInt(value.replace(/\D/g, ""), 10) || 0;
}

function buildCsvMetricMap(csvData: string): Map<string, { name: string; startDate: string; account: string; revenueToday: number; massDms: number; openChats: number; responseDelayDays: number; }> {
  const lines = csvData.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const metrics = new Map<string, { name: string; startDate: string; account: string; revenueToday: number; massDms: number; openChats: number; responseDelayDays: number; }>();

  if (lines.length < 2) return metrics;

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().trim());
  const nameIndex = findColumnIndex(headers, [/^name$/, /chatter/i, /mitarbeiter/i]);
  const startDateIndex = findColumnIndex(headers, [/start\s*dat/i, /beginn/i, /onboard/i]);
  const accountIndex = findColumnIndex(headers, [/account/i, /model/i, /konto/i]);
  const revenueIndex = findColumnIndex(headers, [/tages\s*umsatz/i, /umsatz.*heute/i, /revenue\s*today/i, /daily.*rev/i, /^umsatz$/i, /^revenue$/i]);
  const openChatsIndex = findColumnIndex(headers, [/offene?\s*chats?/i, /open\s*chats?/i]);
  const oldestChatIndex = findColumnIndex(headers, [/oldest\s*chat/i, /älteste.*chat/i, /chat.*alter/i, /verzug/i, /delay/i]);
  const massDmsIndex = findColumnIndex(headers, [/mass\s*dm/i, /massdm/i]);

  if (nameIndex === -1) return metrics;

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const rawName = (values[nameIndex] || "").replace(/^[@\s]+/, "").trim();
    if (!rawName) continue;

    const openChatsRaw = openChatsIndex !== -1 ? values[openChatsIndex] : "";
    const oldestChatRaw = oldestChatIndex !== -1 ? values[oldestChatIndex] : openChatsRaw;
    const openChats = parseInteger(openChatsRaw);
    let responseDelayDays = parseInteger(oldestChatRaw);

    if (!responseDelayDays) {
      const match = openChatsRaw?.match(/seit\s*(\d+)/i);
      responseDelayDays = match ? Number.parseInt(match[1], 10) || 0 : 0;
    }

    if (responseDelayDays > 30) responseDelayDays = 0;

    metrics.set(normalizeName(rawName), {
      name: rawName.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      startDate: startDateIndex !== -1 ? values[startDateIndex] || "" : "",
      account: accountIndex !== -1 ? values[accountIndex] || "" : "",
      revenueToday: revenueIndex !== -1 ? parseDecimal(values[revenueIndex]) : 0,
      massDms: massDmsIndex !== -1 ? parseInteger(values[massDmsIndex]) : 0,
      openChats,
      responseDelayDays,
    });
  }

  return metrics;
}

function formatEuro(value: number): string {
  return `${value.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function hydrateResultWithCsvMetrics(result: any, csvData: string): any {
  const csvMetrics = buildCsvMetricMap(csvData);

  return {
    categories: (result.categories || []).map((category: any) => ({
      ...category,
      chatters: (category.chatters || []).map((chatter: any) => {
        const metrics = csvMetrics.get(normalizeName(chatter.name || ""));
        if (!metrics) return chatter;

        return {
          ...chatter,
          name: metrics.name,
          startDate: metrics.startDate || chatter.startDate,
          account: metrics.account || chatter.account,
          kpis: {
            ...chatter.kpis,
            Tagesumsatz: formatEuro(metrics.revenueToday),
            "Offene Chats": `${metrics.openChats} Chats seit ${metrics.responseDelayDays} Tagen`,
            MassDMs: String(metrics.massDms),
          },
        };
      }),
    })),
  };
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
  const MAX_RETRIES = 3;
  let currentLines = batchLines;
  const allResults: any[] = [];
  let parseFailures = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let result: any;
    try {
      result = await analyzeBatch(lovableApiKey, systemPrompt, header, currentLines, activePlatform, modelsText, batchNum, totalBatches);
    } catch (err: any) {
      parseFailures++;
      console.warn(`[analyze-csv] Batch ${batchNum} attempt ${attempt + 1} error: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        console.log(`[analyze-csv] Batch ${batchNum}: retrying after error (attempt ${attempt + 2})…`);
        continue;
      }
      throw err;
    }

    allResults.push(result);

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

    let resolvedCsvData = typeof csvData === "string" ? csvData : "";

    if (!resolvedCsvData && filePath) {
      const { data: fileData, error: downloadError } = await supabase.storage
        .from("report-files")
        .download(filePath);

      if (downloadError || !fileData) {
        throw new Error(`Datei konnte serverseitig nicht geladen werden: ${downloadError?.message || "Unbekannter Fehler"}`);
      }

      if (/\.(xlsx|xls)$/i.test(filePath)) {
        const workbook = XLSX.read(await fileData.arrayBuffer(), { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        resolvedCsvData = XLSX.utils.sheet_to_csv(firstSheet);
      } else {
        resolvedCsvData = await fileData.text();
      }
    }

    if (!resolvedCsvData || typeof resolvedCsvData !== "string") {
      return new Response(JSON.stringify({ error: "csvData oder filePath is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

KATEGORIE-ZUORDNUNG — STRIKTE ENTSCHEIDUNGSLOGIK (prüfe von oben nach unten, ERSTE zutreffende Kategorie gewinnt!):

SCHRITT 1 — ONBOARDING prüfen (Startdatum 1-14 Tage her, heute = Tag 0 zählt NICHT):
→ 🔵 ONBOARDING TAG N — N = exakte Anzahl Tage seit Startdatum (1, 2, 3, ..., 14)
   categoryName MUSS EXAKT so lauten: "ONBOARDING TAG 1", "ONBOARDING TAG 2", ..., "ONBOARDING TAG 14"
   Beispiele: Start vor 7 Tagen → "ONBOARDING TAG 7". Start vor 12 Tagen → "ONBOARDING TAG 12".
   Fokus Tag 1-5: erster Aufbau / 0€-Toleranz. Tag 6-10: Erste Performance-Erwartung. Tag 11-14: Endspurt vor harten Metriken.
WENN Onboarding (Startdatum 1-14 Tage her) zutrifft → STOPP, diese Kategorie verwenden. Nicht weiter prüfen!
Startdatum = heute (0 Tage) oder > 14 Tage → KEIN Onboarding, weiter mit Schritt 2.

SCHRITT 2 — WARNUNG prüfen (Antwortzeit):
→ 🟠 WARNUNG — NUR wenn "Offene Chats seit X Tagen" und X > 2. Prüfe den Verzug-Wert aus den CSV-Daten.
WENN Warnung zutrifft → STOPP.

SCHRITT 3 — ACCOUNT-EINBRUCH prüfen (streng logikbasiert!):
→ ⚠️ ACCOUNT-EINBRUCH — NUR verwenden wenn ALLE diese Bedingungen GLEICHZEITIG erfüllt sind:
  1. Es gibt historische Daten für diesen Chatter in den HISTORISCHEN DATEN
  2. Der historische Ø-Tagesumsatz war mindestens 20€/Tag
  3. Der AKTUELLE Tagesumsatz ist mindestens 50% NIEDRIGER als der historische Durchschnitt
  4. Der Einbruch ist über mindestens 2-3 Tage sichtbar (kein einzelner schlechter Tag)
  OHNE historische Daten → NIEMALS "ACCOUNT-EINBRUCH" verwenden!
  Chatter mit positivem Tagesumsatz der ÜBER oder NAH am historischen Schnitt liegt → KEIN EINBRUCH!
  Chatter mit 0€ Umsatz → gehört in 0€-UMSATZ-Kategorien, NICHT in ACCOUNT-EINBRUCH!

SCHRITT 4 — MODEL-TAUSCH prüfen:
→ 🔄 MODEL-TAUSCH — Chatter ist deutlich zu groß/klein für den Account (Follower vs. Performance-Mismatch). Konkreten Wechsel-Vorschlag machen.

SCHRITT 4b — ACCOUNT UPGRADE (ZUVERLÄSSIG) prüfen:
→ 🔼 ACCOUNT UPGRADE (ZUVERLÄSSIG) — NUR wenn ALLE Bedingungen erfüllt sind:
  1. Chatter hat mindestens 5 Tage in den HISTORISCHEN DATEN
  2. An mindestens 70% dieser Tage war der Tagesumsatz > 0€
  3. Chatter ist NICHT bereits in WARNUNG oder ACCOUNT-EINBRUCH
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
WENN COMEBACK zutrifft → STOPP.

SCHRITT 6 — POSITIVE KATEGORIEN prüfen:
→ 🌟 BREAKOUT-STAR — Tagesumsatz ist mindestens 2x höher als der historische Durchschnitt (braucht Historie!).
→ 🟢 ACCOUNT UPGRADE (UMSATZ-STREAK) — 5 Tage in Folge >= 30€ laut Historie.
→ 🚀 KURZ VOR UPGRADE — Exakt 4 Tage in Folge >= 30€ laut Historie.
→ 📊 HOHER TRAFFIC / KEINE CONVERSION — > 3 MassDMs heute, aber 0€ Umsatz.

SCHRITT 7 — COACHING prüfen:
→ 📼 VIDEO-COACHING — Seit >= 7 Tagen aktiv UND in den letzten 7 Tagen insgesamt < 20€.
→ 🟡 COACHING / ENGERE KONTROLLE — Seit 5-6 Tagen aktiv UND in den letzten 5 Tagen insgesamt < 15€.

SCHRITT 8 — MITTELFELD segmentieren (Fallback):
→ ⭐ TOP PERFORMER — Tagesumsatz heute > Ø aller Chatter im Batch. Starke Leistung!
→ ⚪ WEITER SO — Tagesumsatz > 0€, aber ≤ Batch-Durchschnitt. Solide, aber Luft nach oben.
→ 👀 UNTER BEOBACHTUNG — Tagesumsatz = 0€ heute, aber kein 0€-Streak (nur 1 Tag).

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

    // Split CSV into batches
    const { header, batches } = splitCsvIntoBatches(resolvedCsvData, BATCH_SIZE);
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

    // Merge all batch results and overwrite KPI values with the raw CSV metrics
    const merged = hydrateResultWithCsvMetrics(mergeResults(batchResults), resolvedCsvData);
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
          rows.push({ chatter_name: name, revenue_today: revenue, mass_dms: massDms, open_chats: openChats, response_delay_days: responseDelay, platform: activePlatform, analysis_date: today, category: cat.categoryName || null, recommendation: chatter.recommendation || null, user_id: userId, account: chatter.account || "" });
        }
      }
      if (rows.length > 0) {
        await supabase.from("chatter_history").upsert(rows, { onConflict: "chatter_name,account,platform,analysis_date" });
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

        const { data: existingReport } = await supabase
          .from("analysis_reports")
          .select("id")
          .eq("file_path", filePath)
          .limit(1)
          .maybeSingle();

        const reportError = existingReport
          ? (await supabase
              .from("analysis_reports")
              .update(reportPayload)
              .eq("id", existingReport.id)).error
          : (await supabase
              .from("analysis_reports")
              .insert(reportPayload)).error;

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
