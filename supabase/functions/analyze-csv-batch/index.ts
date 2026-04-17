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

function findAccountColumn(header: string): number {
  const cols = header.toLowerCase().split(",").map(c => c.trim());
  return cols.findIndex(c => /account|model|konto/i.test(c));
}

function extractFieldFromCsvRow(row: string, colIndex: number): string {
  if (colIndex < 0) return "";
  const fields: string[] = [];
  let current = "", inQuotes = false;
  for (const ch of row) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  fields.push(current.trim());
  return (fields[colIndex] || "").replace(/^[@\s]+/, "").trim();
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

/* ------------------------------------------------------------------ */
/*  PEER-BENCHMARK ENGINE (Deno-Port von src/lib/peer-benchmarks.ts)   */
/* ------------------------------------------------------------------ */

type Confidence = "low" | "medium" | "high";

interface PeerCluster {
  minFollowers: number;
  maxFollowers: number;
  p25: number;
  median: number;
  p75: number;
  sampleSize: number;
  accountCount: number;
  confidence: Confidence;
  label: string;
}

interface AccountBaseline {
  account: string;
  avgRevenue: number;
  dayCount: number;
  followers: number;
}

interface BenchmarkBundle {
  clusters: PeerCluster[];
  accountBaselines: Map<string, AccountBaseline>;
  globalMedian: number;
  globalP25: number;
  globalP75: number;
  globalConfidence: Confidence;
  totalAccounts: number;
  totalDataPoints: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

function confidenceFor(sampleSize: number): Confidence {
  if (sampleSize >= 16) return "high";
  if (sampleSize >= 6) return "medium";
  return "low";
}

function formatFollowerRange(min: number, max: number): string {
  const fmt = (n: number) => {
    if (n === Infinity) return "∞";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1000)}K`;
    return String(n);
  };
  return `${fmt(min)}–${fmt(max)} Follower`;
}

async function buildBenchmarkBundle(
  supabase: any,
  platform: string,
  historyDays: number = 30
): Promise<BenchmarkBundle> {
  const { data: models } = await supabase
    .from("models")
    .select("model_name, follower_count")
    .eq("platform", platform);

  const followerMap = new Map<string, number>();
  for (const m of models || []) {
    followerMap.set((m.model_name || "").toLowerCase().trim(), m.follower_count || 0);
  }

  const since = new Date();
  since.setDate(since.getDate() - historyDays);
  const sinceStr = since.toISOString().split("T")[0];

  const { data: historyRows } = await supabase
    .from("chatter_history")
    .select("account, revenue_today, analysis_date")
    .eq("platform", platform)
    .gte("analysis_date", sinceStr)
    .not("account", "is", null);

  const byAccount = new Map<string, number[]>();
  for (const row of historyRows || []) {
    const acc = (row.account || "").toLowerCase().trim();
    if (!acc) continue;
    const rev = Number(row.revenue_today) || 0;
    if (!byAccount.has(acc)) byAccount.set(acc, []);
    byAccount.get(acc)!.push(rev);
  }

  const accountBaselines = new Map<string, AccountBaseline>();
  const accountStats: Array<{ account: string; followers: number; revenues: number[] }> = [];
  for (const [acc, revenues] of byAccount) {
    const followers = followerMap.get(acc) || 0;
    const avg = revenues.length > 0 ? revenues.reduce((s, v) => s + v, 0) / revenues.length : 0;
    accountBaselines.set(acc, { account: acc, avgRevenue: avg, dayCount: revenues.length, followers });
    if (followers > 0) accountStats.push({ account: acc, followers, revenues });
  }

  // Clustering
  const valid = accountStats.filter(a => a.revenues.length > 0);
  valid.sort((a, b) => a.followers - b.followers);
  let clusterCount: number;
  if (valid.length < 10) clusterCount = 1;
  else if (valid.length < 30) clusterCount = 3;
  else clusterCount = 5;

  const clusters: PeerCluster[] = [];
  if (valid.length > 0) {
    const followerVals = valid.map(a => a.followers);
    const cutoffs: number[] = [];
    for (let i = 1; i < clusterCount; i++) cutoffs.push(quantile(followerVals, i / clusterCount));
    const buckets: typeof valid[] = Array.from({ length: clusterCount }, () => []);
    for (const acc of valid) {
      let bucketIdx = 0;
      for (let i = 0; i < cutoffs.length; i++) if (acc.followers > cutoffs[i]) bucketIdx = i + 1;
      buckets[bucketIdx].push(acc);
    }
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      if (bucket.length === 0) continue;
      const allRevs: number[] = [];
      for (const acc of bucket) allRevs.push(...acc.revenues);
      allRevs.sort((a, b) => a - b);
      const minF = bucket[0].followers;
      const maxF = i === buckets.length - 1 ? Infinity : (buckets[i + 1]?.[0]?.followers ?? Infinity);
      clusters.push({
        minFollowers: minF, maxFollowers: maxF,
        p25: quantile(allRevs, 0.25), median: quantile(allRevs, 0.5), p75: quantile(allRevs, 0.75),
        sampleSize: allRevs.length, accountCount: bucket.length,
        confidence: confidenceFor(allRevs.length),
        label: formatFollowerRange(minF, maxF),
      });
    }
  }

  const allRevs: number[] = [];
  for (const [, revs] of byAccount) allRevs.push(...revs);
  allRevs.sort((a, b) => a - b);

  return {
    clusters, accountBaselines,
    globalMedian: quantile(allRevs, 0.5),
    globalP25: quantile(allRevs, 0.25),
    globalP75: quantile(allRevs, 0.75),
    globalConfidence: confidenceFor(allRevs.length),
    totalAccounts: byAccount.size,
    totalDataPoints: allRevs.length,
  };
}

function findCluster(bundle: BenchmarkBundle, followers: number): PeerCluster | null {
  for (const c of bundle.clusters) {
    if (followers >= c.minFollowers && followers < c.maxFollowers) return c;
  }
  return null;
}

/**
 * Erzeugt für jeden Account-Eintrag in der CSV einen kompakten Benchmark-String,
 * den die AI im Prompt sieht.
 */
function buildPerAccountBenchmarkBlock(
  bundle: BenchmarkBundle,
  csvAccountSet: Set<string>,
  followerLookup: Map<string, number>,
): string {
  if (bundle.totalDataPoints === 0) {
    return "\n\n⚠️ KEINE HISTORISCHEN BENCHMARKS verfügbar (Cold-Start). Nutze absolute Schwellen-Heuristiken.";
  }

  const lines: string[] = [];
  lines.push(`\n\n==============================================================`);
  lines.push(`PEER-BENCHMARKS (lebend, aus deinen letzten 30 Tagen)`);
  lines.push(`==============================================================`);
  lines.push(`Datenbasis: ${bundle.totalAccounts} Accounts, ${bundle.totalDataPoints} Tagesdatenpunkte. Confidence global: ${bundle.globalConfidence}.`);
  lines.push(`Globaler Median: ${bundle.globalMedian.toFixed(0)}€ | P25: ${bundle.globalP25.toFixed(0)}€ | P75: ${bundle.globalP75.toFixed(0)}€`);

  if (bundle.clusters.length > 0) {
    lines.push(`\nCluster (dynamisch nach Follower-Größe):`);
    for (const c of bundle.clusters) {
      lines.push(`  • ${c.label}: Median ${c.median.toFixed(0)}€ | P25 ${c.p25.toFixed(0)}€ | P75 ${c.p75.toFixed(0)}€ (${c.accountCount} Accounts, ${c.sampleSize} Datenpunkte, confidence: ${c.confidence})`);
    }
  }

  // Per-Account-Übersicht für die im Batch vorkommenden Accounts
  const accLines: string[] = [];
  for (const accRaw of csvAccountSet) {
    const acc = accRaw.toLowerCase().trim();
    if (!acc) continue;
    const followers = followerLookup.get(acc) || 0;
    const baseline = bundle.accountBaselines.get(acc);
    const cluster = findCluster(bundle, followers);

    const parts: string[] = [`"${accRaw}"`];
    if (followers > 0) parts.push(`${followers} Follower`);
    else parts.push(`Follower unbekannt`);

    if (baseline && baseline.dayCount >= 7) {
      parts.push(`Account-Ø: ${baseline.avgRevenue.toFixed(0)}€/Tag (${baseline.dayCount} Tage History) → PRIMÄRER BENCHMARK`);
    } else if (cluster && cluster.confidence !== "low") {
      parts.push(`Peer-Cluster: ${cluster.label} → Median ${cluster.median.toFixed(0)}€, P25 ${cluster.p25.toFixed(0)}€, P75 ${cluster.p75.toFixed(0)}€ (${cluster.confidence})`);
    } else if (bundle.globalConfidence !== "low") {
      parts.push(`nur globaler Median nutzbar: ${bundle.globalMedian.toFixed(0)}€`);
    } else {
      parts.push(`zu wenig Daten → absolute Schwellen nutzen`);
    }
    accLines.push(`  - ${parts.join(" | ")}`);
  }

  if (accLines.length > 0) {
    lines.push(`\nAccount-spezifisch (nur die in diesem Batch vorkommenden):`);
    lines.push(...accLines);
  }

  lines.push(`\n→ Klassifiziere RELATIV zu diesen Werten, nicht absolut:`);
  lines.push(`   • Tagesumsatz < 40% des P25 (oder < 30% vom Account-Ø) → starker Underperformer-Indikator (SOFORT EINGREIFEN / COACHING NÖTIG)`);
  lines.push(`   • 40–80% des Median → COACHING NÖTIG`);
  lines.push(`   • 80–120% des Median → BEOBACHTEN (im Schnitt)`);
  lines.push(`   • > P75 → BELOHNEN`);
  lines.push(`   • > 150% des P75 (oder > 200% vom Account-Ø) → BELOHNEN + subTag "🌟 Outlier"`);
  lines.push(`   • Bei confidence=low → Fallback auf absolute €-Schwellen + subTag-Hinweis "Benchmark unsicher"`);
  lines.push(`   • Account-Baseline (wenn vorhanden, ≥7 Tage) ÜBERSTIMMT Peer-Cluster.`);

  return lines.join("\n");
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

    // Build benchmark bundle (peer-clusters + per-account-baseline) — vollautomatisch
    const benchmarkBundle = await buildBenchmarkBundle(supabase, activePlatform, 30);

    // Extract account values from this batch's CSV lines (for targeted benchmark block)
    const accountColIdx = findAccountColumn(header);
    const csvAccountSet = new Set<string>();
    if (accountColIdx >= 0) {
      for (const line of batchLines) {
        const acc = extractFieldFromCsvRow(line, accountColIdx);
        if (acc) csvAccountSet.add(acc);
      }
    }
    const benchmarkBlock = buildPerAccountBenchmarkBlock(benchmarkBundle, csvAccountSet, modelFollowers);
    console.log(`[batch] ${batchNum} benchmarks: ${benchmarkBundle.totalAccounts} accounts, ${benchmarkBundle.totalDataPoints} datapoints, ${benchmarkBundle.clusters.length} clusters, global confidence: ${benchmarkBundle.globalConfidence}`);

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
KATEGORIE-SYSTEM — ONBOARDING-SPLIT + 6 ACTION-KATEGORIEN
==============================================================
Jeder Chatter gehört in GENAU EINE Kategorie.
Prüfe von oben nach unten — die ERSTE zutreffende gewinnt, dann STOPP.
Zusätzlich vergibst du einen "subTag" (kurzer beschreibender Text) und einen "trend" ("rising" | "declining" | "stable" | "volatile" | "unknown").

──────────────────────────────────────────────
🔵 ONBOARDING TAG 1-5  (HÖCHSTE PRIORITÄT — überschreibt ALLES)
──────────────────────────────────────────────
Wenn Startdatum 1, 2, 3, 4 oder 5 Tage her ist (heute = Tag 0 zählt NICHT), MUSS der Chatter in eine eigene Onboarding-Kategorie:
- categoryName: EXAKT "ONBOARDING TAG 1" / "ONBOARDING TAG 2" / "ONBOARDING TAG 3" / "ONBOARDING TAG 4" / "ONBOARDING TAG 5"
- emoji: "🔵"
- Diese Chatter dürfen NIEMALS in einer anderen Kategorie (PUSHEN, BELOHNEN, BEOBACHTEN etc.) auftauchen — auch nicht bei Top-Performance, auch nicht bei 0€.
- Startdatum = heute (Tag 0) oder > 5 Tage → NICHT Onboarding (normale Kategorisierung unten).
subTag-Beispiele: "Tag 3 — 0€", "Tag 2 — 🔥 80€ Start", "Tag 5 — solide"

──────────────────────────────────────────────
🆘 SOFORT EINGREIFEN  (categoryName: "SOFORT EINGREIFEN", emoji: "🆘")
──────────────────────────────────────────────
NUR wenn KEIN Onboarding (Tag 1-5). Trifft zu wenn EINE dieser Bedingungen erfüllt ist:
- Antwortverzug ≥ 7 Tage ("Offene Chats seit X Tagen", X ≥ 7)
- 5 oder mehr Tage in Folge 0€ Tagesumsatz (laut Historie)
- Account-Einbruch: aktueller Tagesumsatz ≥ 70% niedriger als historischer Schnitt UND mind. 3 Tage sichtbar
subTag-Beispiele: "Verzug 8 Tage", "0€ seit 6 Tagen", "Einbruch -85%"

──────────────────────────────────────────────
💬 COACHING NÖTIG  (categoryName: "COACHING NÖTIG", emoji: "💬")
──────────────────────────────────────────────
NUR wenn KEIN Onboarding (Tag 1-5). Trifft zu wenn EINE dieser Bedingungen erfüllt ist (und SOFORT EINGREIFEN NICHT zutrifft):
- Antwortverzug 4-6 Tage
- 2-4 Tage in Folge 0€ Tagesumsatz
- Trend abwärts: 7-Tage-Schnitt mind. 30% niedriger als 14-Tage-Schnitt (war-Top-jetzt-Mid)
- Hoher Traffic, keine Conversion: > 3 MassDMs heute, aber 0€ Umsatz
- Seit ≥ 7 Tagen aktiv UND in den letzten 7 Tagen insgesamt < 20€
subTag-Beispiele: "Trend ↓ 35%", "0€ seit 3 Tagen", "Verzug 5 Tage", "Traffic ohne Conversion"

──────────────────────────────────────────────
🚀 PUSHEN  (categoryName: "PUSHEN", emoji: "🚀")
──────────────────────────────────────────────
NUR wenn KEIN Onboarding (Tag 1-5). Trifft zu wenn EINE dieser Bedingungen erfüllt ist:
- Kurz vor Upgrade: exakt 4 Tage in Folge ≥ 30€ laut Historie
- Comeback: hatte 3+ Tage in Folge 0€, hat HEUTE wieder Umsatz > 0€
subTag-Beispiele: "Kurz vor Upgrade", "Comeback nach 4 Tagen"

──────────────────────────────────────────────
🎉 BELOHNEN  (categoryName: "BELOHNEN", emoji: "🎉")
──────────────────────────────────────────────
NUR wenn KEIN Onboarding (Tag 1-5). Trifft zu für Top-Performer (KEIN Verzug > 2 Tage). Differenziere im subTag:
- 👑 WHALE: Tagesumsatz heute ≥ 300€ ODER 7-Tage-Summe ≥ 2000€
- 💎 STAR: Tagesumsatz heute ≥ 100€ ODER 7-Tage-Summe ≥ 700€
- 🟢 SOLID: Tagesumsatz heute ≥ 30€ UND mindestens 5 aktive Tage (>0€) in letzten 7 Tagen
- 🌟 BREAKOUT: Tagesumsatz heute mind. 2x höher als historischer Durchschnitt
- 📈 RISING: 7-Tage-Schnitt mind. 30% höher als 14-Tage-Schnitt
subTag MUSS exakt einer der obigen Tags sein (z.B. "💎 Star — 850€ heute", "📈 Rising +42%").

──────────────────────────────────────────────
📊 RE-ASSIGNEN  (categoryName: "RE-ASSIGNEN", emoji: "📊")
──────────────────────────────────────────────
NUR wenn KEIN Onboarding (Tag 1-5). Trifft zu wenn der Chatter offensichtlich auf dem falschen Account sitzt:
- Großer Account (Follower > 20k) UND Chatter macht konstant < 50€/Tag über mind. 5 Tage
- Kleiner Account (Follower < 5k) UND Chatter generiert > 200€/Tag konstant (zu groß für den Account)
- Klarer Follower vs. Performance Mismatch
subTag-Beispiele: "Account zu groß (50k Follower, Ø 35€)", "Account zu klein für Performance"

──────────────────────────────────────────────
👀 BEOBACHTEN  (categoryName: "BEOBACHTEN", emoji: "👀")
──────────────────────────────────────────────
NUR wenn KEIN Onboarding (Tag 1-5). Auffangkorb für ALLE die in keine der obigen passen — stabil, kein Eingriff nötig.
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
- Erlaubte categoryName-Werte EXAKT: "ONBOARDING TAG 1", "ONBOARDING TAG 2", "ONBOARDING TAG 3", "ONBOARDING TAG 4", "ONBOARDING TAG 5", "SOFORT EINGREIFEN", "COACHING NÖTIG", "PUSHEN", "BELOHNEN", "RE-ASSIGNEN", "BEOBACHTEN"
- Jeder Chatter gehört in GENAU EINE Kategorie. Onboarding (Tag 1-5) hat IMMER Vorrang.
- Ein Onboarding-Chatter darf unter KEINEN Umständen zusätzlich oder stattdessen in einer anderen Kategorie auftauchen.
- "kpis" enthält alle relevanten Kennzahlen als Key-Value-Paare. Geldbeträge mit € formatieren.
- Das Feld "Offene Chats" MUSS im Format "X Chats seit Y Tagen" sein.
- Gib das JSON kompakt aus.
- "recommendation" ist die konkrete Handlungsempfehlung nach der Formel: [Daten-Fakt] + [Insight] + [Konkretes To-Do].
- KEINE Einleitung, KEINE Zusammenfassung – NUR das JSON-Objekt.
- CRITICAL: Include EVERY SINGLE CHATTER from the CSV. DO NOT skip anyone. Each row = one chatter.`;

    const systemPrompt = userSystemPrompt + formatInstructions + historyBlock + benchmarkBlock;
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
