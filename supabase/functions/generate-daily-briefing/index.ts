// Generates an AI daily revenue roadmap ("Fahrplan") for one workspace/platform.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function normalizeName(n: string) {
  return (n || "").trim().toLowerCase().replace(/[_\s]+/g, " ");
}

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(String((error as any)?.message ?? error));
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

const SYSTEM_PROMPT = `Du bist der Head of Revenue eines Chatting-/Creator-Unternehmens. Du bekommst die kompletten Report- und Live-Daten EINER Plattform (Workspace) und erstellst daraus einen konkreten TAGES-FAHRPLAN, der maximal Umsatz bringt.

HARTE REGELN:
- Antworte ausschließlich auf Deutsch, direkt und ohne Coaching-Sprech.
- Der Fahrplan ist NACH GESCHÄTZTEM EURO-IMPACT SORTIERT (höchster Impact zuerst).
- KEINE Zeiterfassungs-/Anwesenheits-/Verzugs-Themen ("wer arbeitet gerade", "X Tage keine Antwort", "ist offline"). Das ist bereits an anderer Stelle gelöst. Verzugsdaten darfst du nur als KONTEXT nutzen, aber niemals als eigene Aufgabe formulieren.
- Jede Aufgabe muss aus den DATEN begründet sein: nenne konkrete Zahlen (Umsatz, Trend, Account, Mass-DMs, Peer-Schnitt).
- Kern-Metrik: Umsatz gemessen am POTENZIAL des Accounts/Models, nicht der absolute Betrag.
- Mass-DMs sind ein zentraler Hebel: Ziel bis zu 6 pro Chatter pro Tag.
- Keine erfundenen Namen. Nur Chatter/Accounts, die in den Daten vorkommen.
- Impact-Schätzungen realistisch und in Euro pro Tag.
- KEINE OBERGRENZE an Aufgaben. Es gibt kein "Top 10". Du lieferst JEDEN datenbelegten Hebel als eigene Aufgabe — für jeden Chatter und jeden Account, bei dem die Daten eine Umsatzchance zeigen. Wenn es 60 sind, dann liefere 60. Kürze niemals aus Platz-, Zeit- oder Übersichtsgründen.
- Vollständigkeit vor Kürze: prüfe am Ende, ob du wirklich alle Chatter/Accounts aus den Daten mit Potenzial-Gap, Trendbruch, Mass-DM-Defizit oder Umsatzkonzentration abgedeckt hast.
- Wording: nie "absäuft" — stattdessen "im Rückgang".
- Emojis: kein Punkt direkt vor einem Emoji; Hautton-Emojis immer mit hellem Modifier 🏻.

BUCKETS:
- "quick_win" = heute umsetzbar, wirkt sofort (Mass-DM-Push, Whale reaktivieren, Preisaktion, Chatter direkt briefen).
- "structural" = Account-Tausch, Besetzung, Coaching, Content-/Model-Themen, Prozess.

ZIEL-KONTEXT: Es gibt ein Monatsziel in Euro. Beziehe den Fahrplan explizit auf die Lücke zwischen Ist-Pace und Ziel.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const platform: string = (body.platform || "").toString();
    if (!platform) return json({ error: "Missing platform" }, 400);
    const force: boolean = !!body.force;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const today = new Date().toISOString().slice(0, 10);

    // Existing briefing?
    const { data: existing } = await admin
      .from("daily_briefings")
      .select("id, status, updated_at")
      .eq("user_id", userId)
      .eq("platform", platform)
      .eq("briefing_date", today)
      .maybeSingle();

    if (existing && !force) {
      if (existing.status === "ready") return json({ briefing_id: existing.id, status: "ready", cached: true });
      const age = Date.now() - new Date(existing.updated_at).getTime();
      if (existing.status === "running" && age < 5 * 60 * 1000) {
        return json({ briefing_id: existing.id, status: "running" });
      }
    }

    let briefingId = existing?.id as string | undefined;
    if (briefingId) {
      await admin.from("daily_briefings").update({
        status: "running", error_message: null, updated_at: new Date().toISOString(),
      }).eq("id", briefingId);
    } else {
      const { data: created, error: createErr } = await admin
        .from("daily_briefings")
        .insert({ user_id: userId, platform, briefing_date: today, status: "running" })
        .select("id")
        .single();
      if (createErr || !created) return json({ error: createErr?.message || "insert failed" }, 500);
      briefingId = created.id;
    }

    // Kick off async work, respond immediately
    const work = (async () => {
      try {
        const now = new Date();
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
        const from30 = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
        const monthKey = today.slice(0, 7);

        // --- Latest report (active roster) ---
        const { data: latestReport } = await admin
          .from("analysis_reports")
          .select("id, analysis_date, result_json")
          .eq("user_id", userId)
          .eq("platform", platform)
          .not("result_json", "is", null)
          .order("analysis_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const roster = new Set<string>();
        const rosterRows: any[] = [];
        const cats = (latestReport?.result_json as any)?.categories ?? [];
        for (const cat of cats) {
          for (const ch of cat.chatters ?? []) {
            if (!ch?.name) continue;
            roster.add(normalizeName(ch.name));
            rosterRows.push({
              name: ch.name,
              category: cat.name ?? cat.category ?? null,
              recommendation: ch.recommendation ?? null,
              account: ch.account ?? null,
              revenue_today: ch.revenueToday ?? ch.revenue_today ?? null,
              mass_dms: ch.massDms ?? ch.mass_dms ?? null,
              open_chats: ch.openChats ?? ch.open_chats ?? null,
            });
          }
        }

        // --- History 30d ---
        const history = await fetchAll<any>((f, t) =>
          admin.from("chatter_history")
            .select("chatter_name, account, analysis_date, revenue_today, mass_dms, open_chats, category")
            .eq("user_id", userId)
            .eq("platform", platform)
            .gte("analysis_date", from30)
            .order("analysis_date", { ascending: false })
            .range(f, t));

        // --- Live ---
        const live = await fetchAll<any>((f, t) =>
          admin.from("chatter_history_live")
            .select("chatter_name, revenue, mass_dms, unread_chats, date, stats_details, revenue_details, updated_at")
            .ilike("platform", platform)
            .order("updated_at", { ascending: false })
            .range(f, t));

        // --- Memos + memories ---
        const [{ data: memos }, { data: memories }, { data: goalRow }] = await Promise.all([
          admin.from("chatter_memos").select("chatter_name, text, topic, status")
            .eq("user_id", userId).eq("platform", platform).eq("status", "open"),
          admin.from("ai_memories").select("content, category")
            .eq("user_id", userId),
          admin.from("revenue_goals").select("goal_eur")
            .eq("user_id", userId).eq("platform", platform).eq("month_key", monthKey).maybeSingle(),
        ]);

        // --- Aggregate per chatter (active roster only) ---
        type Agg = {
          name: string; accounts: Set<string>; days: { d: string; rev: number; dms: number; open: number }[];
        };
        const byChatter = new Map<string, Agg>();
        for (const h of history) {
          const key = normalizeName(h.chatter_name ?? "");
          if (!key) continue;
          if (roster.size && !roster.has(key)) continue;
          let a = byChatter.get(key);
          if (!a) { a = { name: h.chatter_name, accounts: new Set(), days: [] }; byChatter.set(key, a); }
          if (h.account) a.accounts.add(h.account);
          a.days.push({
            d: h.analysis_date,
            rev: Number(h.revenue_today) || 0,
            dms: Number(h.mass_dms) || 0,
            open: Number(h.open_chats) || 0,
          });
        }

        const chatterStats = Array.from(byChatter.values()).map((a) => {
          const sorted = [...a.days].sort((x, y) => (x.d < y.d ? 1 : -1));
          const last7 = sorted.slice(0, 7);
          const prev7 = sorted.slice(7, 14);
          const sum = (arr: typeof sorted) => arr.reduce((s, r) => s + r.rev, 0);
          const avg = (arr: typeof sorted) => (arr.length ? sum(arr) / arr.length : 0);
          const best = sorted.reduce((m, r) => Math.max(m, r.rev), 0);
          const avg7 = avg(last7);
          const avgPrev7 = avg(prev7);
          const dmsAvg7 = last7.length ? last7.reduce((s, r) => s + r.dms, 0) / last7.length : 0;
          return {
            name: a.name,
            accounts: Array.from(a.accounts),
            revenue_30d: Math.round(sum(sorted)),
            avg_day_7d: Math.round(avg7),
            avg_day_prev7d: Math.round(avgPrev7),
            trend_pct: avgPrev7 > 0 ? Math.round(((avg7 - avgPrev7) / avgPrev7) * 100) : null,
            best_day_30d: Math.round(best),
            potential_gap_eur: Math.max(0, Math.round(best - avg7)),
            mass_dms_avg_7d: Math.round(dmsAvg7 * 10) / 10,
            open_chats_last: sorted[0]?.open ?? 0,
            zero_days_7d: last7.filter((r) => r.rev <= 0).length,
            days_tracked: sorted.length,
          };
        }).sort((x, y) => y.potential_gap_eur - x.potential_gap_eur);

        const peerAvgDay = chatterStats.length
          ? Math.round(chatterStats.reduce((s, c) => s + c.avg_day_7d, 0) / chatterStats.length)
          : 0;

        // --- Month revenue so far ---
        const monthRows = history.filter((h) => h.analysis_date >= monthStart);
        const monthRevenue = Math.round(monthRows.reduce((s, r) => s + (Number(r.revenue_today) || 0), 0));
        const dayOfMonth = now.getUTCDate();
        const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
        const goalEur = Number(goalRow?.goal_eur) || 0;
        const paceDaily = dayOfMonth > 0 ? Math.round(monthRevenue / dayOfMonth) : 0;
        const projected = paceDaily * daysInMonth;
        const remainingDays = Math.max(1, daysInMonth - dayOfMonth + 1);
        const neededDaily = goalEur > 0 ? Math.round(Math.max(0, goalEur - monthRevenue) / remainingDays) : 0;

        const goalSnapshot = {
          month_key: monthKey,
          goal_eur: goalEur,
          revenue_so_far: monthRevenue,
          day_of_month: dayOfMonth,
          days_in_month: daysInMonth,
          pace_daily: paceDaily,
          projected_month: projected,
          needed_daily: neededDaily,
          gap_eur: goalEur > 0 ? Math.round(goalEur - projected) : 0,
        };

        // --- Live snapshot (roster only) ---
        const liveSeen = new Set<string>();
        const liveRows: any[] = [];
        for (const l of live) {
          const key = normalizeName(l.chatter_name ?? "");
          if (!key || liveSeen.has(key)) continue;
          if (roster.size && !roster.has(key)) continue;
          liveSeen.add(key);
          liveRows.push({
            name: l.chatter_name,
            revenue_today: Number(l.revenue) || 0,
            mass_dms_today: Number(l.mass_dms) || 0,
            unread: Number(l.unread_chats) || 0,
            accounts: l.stats_details && typeof l.stats_details === "object" ? Object.keys(l.stats_details) : [],
          });
        }

        const payload = {
          platform,
          date: today,
          goal: goalSnapshot,
          peer_avg_day_7d: peerAvgDay,
          active_chatter_count: chatterStats.length,
          latest_report: {
            date: latestReport?.analysis_date ?? null,
            chatters: rosterRows,
          },
          chatter_stats: chatterStats,
          live_today: liveRows,
          open_memos: memos ?? [],
          memories: (memories ?? []).map((m: any) => m.content),
        };

        const ACTION_ITEM = {
          type: "object",
          properties: {
            chatter_name: { type: "string" },
            account: { type: "string" },
            title: { type: "string" },
            instruction: { type: "string" },
            reasoning: { type: "string" },
            impact_eur: { type: "number" },
            confidence: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
            bucket: { type: "string", enum: ["quick_win", "structural"] },
            action_type: { type: "string" },
          },
          required: ["title", "instruction", "reasoning", "impact_eur", "confidence", "bucket"],
          additionalProperties: false,
        };

        async function callAI(userContent: string, params: any, fnName: string): Promise<any | null> {
          const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-3.6-flash",
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userContent },
              ],
              tools: [{ type: "function", function: { name: fnName, description: "Strukturierte Ausgabe", parameters: params } }],
              tool_choice: { type: "function", function: { name: fnName } },
            }),
          });
          if (!resp.ok) {
            const t = await resp.text();
            console.error("AI error", resp.status, t.slice(0, 400));
            if (resp.status === 429) throw new Error("Rate limit erreicht, bitte später erneut versuchen.");
            if (resp.status === 402) throw new Error("AI-Credits aufgebraucht.");
            throw new Error(`AI Fehler (${resp.status})`);
          }
          const j = await resp.json();
          const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
          if (!args) return null;
          try { return JSON.parse(args); } catch { return null; }
        }

        // --- 1) Lagebild + Muster (Gesamtsicht) ---
        const overviewPrompt = `DATEN (JSON) für Workspace ${platform}, Stichtag ${today}:

${JSON.stringify(payload)}

AUFGABE:
1. "headline": ein Satz, wo wir heute stehen (mit Zahlen).
2. "situation": 3–5 Sätze Lagebild inkl. Monatsziel-Pace und Lücke in Euro.
3. "patterns": ALLE relevanten erkannten Muster (Trendbrüche, Mass-DM-Defizite, Accounts unter eigenem Bestwert, Peer-Ausreißer, Umsatzkonzentration). Jeweils mit Zahlen.
Nichts über Verzug/Anwesenheit.`;

        const overview = await callAI(overviewPrompt, {
          type: "object",
          properties: {
            headline: { type: "string" },
            situation: { type: "string" },
            patterns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  detail: { type: "string" },
                  severity: { type: "string", enum: ["info", "warn", "critical"] },
                },
                required: ["title", "detail", "severity"],
                additionalProperties: false,
              },
            },
          },
          required: ["headline", "situation", "patterns"],
          additionalProperties: false,
        }, "deliver_overview");

        const parsed: any = overview ?? {};

        // --- 2) Aktionen in Chunks: jeder Chatter wird garantiert bewertet ---
        const liveByName = new Map(liveRows.map((l) => [normalizeName(l.name), l]));
        const CHUNK = 8;
        const chunks: any[][] = [];
        for (let i = 0; i < chatterStats.length; i += CHUNK) chunks.push(chatterStats.slice(i, i + CHUNK));

        const actionParams = {
          type: "object",
          properties: { actions: { type: "array", items: ACTION_ITEM } },
          required: ["actions"],
          additionalProperties: false,
        };

        const collected: any[] = [];
        const CONCURRENCY = 4;
        for (let i = 0; i < chunks.length; i += CONCURRENCY) {
          const batch = chunks.slice(i, i + CONCURRENCY).map(async (chunk) => {
            const chunkPayload = chunk.map((c) => ({ ...c, live_today: liveByName.get(normalizeName(c.name)) ?? null }));
            const prompt = `Workspace ${platform}, Stichtag ${today}.

KONTEXT (Gesamtbild):
- Monatsziel-Snapshot: ${JSON.stringify(goalSnapshot)}
- Peer-Schnitt Umsatz/Tag (7d) aller aktiven Chatter: ${peerAvgDay} €
- Aktive Chatter gesamt: ${chatterStats.length}
- Offene Memos: ${JSON.stringify(memos ?? [])}

ZU BEWERTENDE CHATTER (JSON):
${JSON.stringify(chunkPayload)}

AUFGABE: Erzeuge für JEDEN dieser Chatter mindestens eine Aufgabe, sofern die Daten irgendeine Umsatzchance zeigen (Potenzial-Gap zum eigenen Bestwert, Trendbruch, Mass-DMs unter 6/Tag, Nulltage, Umsatz unter Peer-Schnitt, Account unter Potenzial). Mehrere Hebel = mehrere Aufgaben. Keine Zusammenfassung mehrerer Chatter in einer Aufgabe. Keine Verzugs-/Anwesenheitsaufgaben. Jede Aufgabe mit chatter_name, account (falls zuordenbar), title, instruction (konkret, heute umsetzbar), reasoning (mit Zahlen aus den Daten), impact_eur (realistisch, € pro Tag), confidence, bucket.`;
            try {
              const r = await callAI(prompt, actionParams, "deliver_actions");
              return (r?.actions ?? []) as any[];
            } catch (e) {
              console.error("chunk failed", e);
              return [];
            }
          });
          const res = await Promise.all(batch);
          for (const r of res) collected.push(...r);
        }

        if (!overview && collected.length === 0) {
          await admin.from("daily_briefings").update({
            status: "error", error_message: "AI lieferte kein strukturiertes Ergebnis",
          }).eq("id", briefingId);
          return;
        }

        const seenAction = new Set<string>();
        const actions = collected
          .map((a: any) => ({ ...a, impact_eur: Number(a.impact_eur) || 0 }))
          .filter((a: any) => {
            const k = `${normalizeName(a.chatter_name ?? "")}|${(a.title ?? "").trim().toLowerCase()}`;
            if (seenAction.has(k)) return false;
            seenAction.add(k);
            return true;
          })
          .sort((x: any, y: any) => y.impact_eur - x.impact_eur);

        const totalImpact = actions.reduce((s: number, a: any) => s + a.impact_eur, 0);


        await admin.from("briefing_actions").delete().eq("briefing_id", briefingId);
        if (actions.length) {
          await admin.from("briefing_actions").insert(actions.map((a: any, i: number) => ({
            briefing_id: briefingId,
            user_id: userId,
            platform,
            rank: i + 1,
            chatter_name: a.chatter_name ?? null,
            account: a.account ?? null,
            action_type: a.action_type ?? "revenue",
            title: a.title,
            instruction: a.instruction,
            reasoning: a.reasoning ?? null,
            impact_eur: a.impact_eur,
            confidence: a.confidence ?? null,
            bucket: a.bucket === "structural" ? "structural" : "quick_win",
            evidence: {},
          })));
        }

        await admin.from("daily_briefings").update({
          status: "ready",
          report_id: latestReport?.id ?? null,
          headline: parsed.headline ?? null,
          situation: parsed.situation ?? null,
          patterns: parsed.patterns ?? [],
          quick_wins: [],
          structural: [],
          goal_snapshot: goalSnapshot,
          total_impact_eur: Math.round(totalImpact),
          error_message: null,
        }).eq("id", briefingId);
      } catch (e) {
        console.error("briefing work error", e);
        await admin.from("daily_briefings").update({
          status: "error",
          error_message: e instanceof Error ? e.message : "Unbekannter Fehler",
        }).eq("id", briefingId);
      }
    })();

    // @ts-ignore Deno edge runtime
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
    else await work;

    return json({ briefing_id: briefingId, status: "running" });
  } catch (e) {
    console.error("generate-daily-briefing", e);
    return json({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});
