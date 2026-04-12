import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL_NAME = "google/gemini-2.5-flash";
const TIMEOUT_MS = 120000;
const MAX_RETRIES = 2;

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

    let historyBlock = "";
    if (historyData && historyData.length > 0) {
      const byChatter = new Map<string, string[]>();
      for (const row of historyData) {
        if (!byChatter.has(row.chatter_name)) byChatter.set(row.chatter_name, []);
        byChatter.get(row.chatter_name)!.push(`${row.analysis_date}: ${row.revenue_today}€, ${row.mass_dms} DMs, ${row.open_chats} offene Chats${row.category ? `, Kat: ${row.category}` : ""}`);
      }
      const lines: string[] = [];
      for (const [name, entries] of byChatter) {
        lines.push(`${name}:\n  ${entries.join("\n  ")}`);
      }
      historyBlock = `\n\nHISTORISCHE DATEN (letzte 14 Tage, Plattform: ${activePlatform}):\n${lines.join("\n")}\n\nNutze diese Historie um Trends zu erkennen.`;
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

SCHRITT 6 — POSITIVE KATEGORIEN prüfen:
→ 🌟 BREAKOUT-STAR — Tagesumsatz ist mindestens 3x höher als der historische Durchschnitt (braucht Historie!).
→ 🟢 ACCOUNT UPGRADE (UMSATZ-STREAK) — 5 Tage in Folge >= 30€ laut Historie.
→ 🚀 KURZ VOR UPGRADE — Exakt 4 Tage in Folge >= 30€ laut Historie.
→ 🟢 ACCOUNT UPGRADE (TRAFFIC TEST) — > 3 MassDMs heute, aber 0€ Umsatz.

SCHRITT 7 — COACHING prüfen:
→ 📼 VIDEO-COACHING — Seit >= 5 Tagen aktiv UND in den letzten 5 Tagen insgesamt < 15€.
→ 🟡 COACHING / ENGERE KONTROLLE — Seit > 5 Tagen aktiv UND insgesamt < 20€ eingenommen.

SCHRITT 8 — FALLBACK:
→ ⚪ WEITER SO / MITTELFELD — Alle Chatter, die in KEINE der obigen Kategorien passen.
  Das ist die STANDARD-Kategorie. Im Zweifel gehört ein Chatter hierher!

WICHTIGE VERBOTE:
- ACCOUNT-EINBRUCH darf MAXIMAL 10-15% aller Chatter betreffen. Wenn du mehr als ~15 Chatter dort einordnest, hast du die Kriterien zu locker angewandt!
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
    const batchCsv = [header, ...batchLines].join("\n");
    const userMessage = `Plattform: ${activePlatform}\nBatch ${batchNum}/${totalBatches} (${batchLines.length} Chatter)\n\nCSV-Daten:\n\n${batchCsv}\n\nModels (${activePlatform}):\n${modelsText}`;

    // AI call with retries
    let result: any = null;
    let lastError = "";

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
            max_tokens: 16384,
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
        console.log(`[batch] ${batchNum}/${totalBatches}: ${resultText.length} chars, attempt ${attempt + 1}`);
        result = cleanAndParseJson(resultText);
        break;
      } catch (err: any) {
        lastError = err.message || "Unknown error";
        console.warn(`[batch] ${batchNum} attempt ${attempt + 1} failed: ${lastError}`);
        if (attempt === MAX_RETRIES) {
          return new Response(JSON.stringify({ error: `Batch ${batchNum} failed after ${MAX_RETRIES + 1} attempts: ${lastError}` }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    const chattersReturned = (result.categories || []).reduce((s: number, c: any) => s + (c.chatters?.length || 0), 0);
    console.log(`[batch] ${batchNum}/${totalBatches} done: ${chattersReturned}/${batchLines.length} chatters`);

    return new Response(JSON.stringify({ result, chattersReturned, batchNum }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[batch] Fatal:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
