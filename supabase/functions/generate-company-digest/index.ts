// Generiert den täglichen „AI Company“-Digest für einen Workspace.
// Beobachtet alle aktiven Chatters/Accounts rollenbasiert (Head of Revenue,
// Operations Manager, Staffing Analyst, Account Strategist) und liefert
// Empfehlungen ohne selbst auszulösen.
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

interface Card {
  title: string;
  detail: string;
  severity: "info" | "warn" | "critical";
  recommendation: string;
  impact_eur: number;
  tags?: string[];
}

interface Section {
  section_key: string;
  section_title: string;
  summary: string;
  cards: Card[];
  signals: { severity: "info" | "warn" | "critical"; message: string }[];
}

const ROLES: { key: string; title: string; prompt: string }[] = [
  {
    key: "revenue",
    title: "Head of Revenue",
    prompt: `Du bist der Head of Revenue. Du bekommst das finanzielle Gesamtbild EINES Workspaces.

AUFGABE: Erstelle einen Abschnitt mit dem Titel "Head of Revenue".
- summary: 1–2 Sätze zum finanziellen Stand (Ziel-Pace, größter Hebel).
- cards: 3–8 Karten zu den wichtigsten finanziellen Signalen:
  * Chatter/Accounts mit dem größten negativen Trend vs. Vorwoche
  * Chatter, die historisch deutlich mehr konnten (Potential-Gap)
  * Umsatzkonzentration / Abhängigkeit von wenigen Top-Performern
  * Monatsziel-Lücke und was sie am schnellsten schließen würde
Jede Karte: title, detail (mit konkreten Zahlen in €), severity (info/warn/critical), recommendation (konkrete Handlung), impact_eur (geschätzte tägliche €-Wirkung, positiv = Chance, negativ = Verlust).
- signals: 1–3 kurze Alarm-Snippets für ein Badge (nur warn/critical).

REGELN:
- Keine erfundenen Namen. Nur Daten, die im Kontext stehen.
- Bewerte aus den Zahlen, nicht aus dem Bauch.
- Nenne konkrete €-Werte und Prozentzahlen.
- Wording: nie "absäuft" — sag "im Rückgang".
- Kein Punkt direkt vor Emojis; Hautton-Emojis immer mit hellem Modifier 🏻.`,
  },
  {
    key: "operations",
    title: "Operations Manager",
    prompt: `Du bist der Operations Manager. Du bekommst die Chatter-Gesundheit EINES Workspaces (Verzug, offene Chats, aktueller Umsatz, historische Bestwerte).

AUFGABE: Erstelle einen Abschnitt mit dem Titel "Operations Manager".
- summary: 1–2 Sätze zur Chatter-Gesundheit.
- cards: 3–8 Karten zu:
  * Chatters mit hohem Verzug (>3 Tage) oder vielen offenen Chats
  * Chatters, die heute 0 € machen, aber früher deutlich besser liefen
  * Burner / Coaching-Bedarf
  * Mass-DM-Defizite (Ziel bis zu 6 pro Tag)
Jede Karte: title, detail (mit Zahlen), severity, recommendation, impact_eur.
- signals: 1–3 Alarm-Snippets.

REGELN:
- Priorisiere nach: historisches Potenzial → Verzug → offene Chats → aktueller Umsatz.
- Nenne konkrete Tage, Chatter-Namen und Account-Namen.
- Wording: nie "absäuft" — sag "im Rückgang".
- Kein Punkt direkt vor Emojis; Hautton-Emojis immer mit hellem Modifier 🏻.`,
  },
  {
    key: "staffing",
    title: "Staffing Analyst",
    prompt: `Du bist der Staffing Analyst. Du bekommst die letzten Besetzungs-Entscheidungen (Account-Tausch, Account weggenommen, Chatter rein/raus) und deren Bewertungen.

AUFGABE: Erstelle einen Abschnitt mit dem Titel "Staffing Analyst".
- summary: 1–2 Sätze zur aktuellen Besetzungslage.
- cards: 3–8 Karten zu:
  * Negativ bewertete Tausch-Entscheidungen (Rückblick-Verdicts)
  * Neue Chatter, die beobachtet werden sollten
  * Rausgenommene Chatter / frei gewordene Accounts
  * Accounts, die unterbesetzt oder auf einem schlechten Chatter sitzen
Jede Karte: title, detail (mit Zahlen), severity, recommendation, impact_eur.
- signals: 1–3 Alarm-Snippets.

REGELN:
- Bewerte aus den Verdicts und den Vorher/Nachher-Zahlen.
- Sei direkt: "Tausch X → Y war schlecht (-Z €/Tag), prüfe Rückgabe".
- Wording: nie "absäuft" — sag "im Rückgang".
- Kein Punkt direkt vor Emojis; Hautton-Emojis immer mit hellem Modifier 🏻.`,
  },
  {
    key: "accounts",
    title: "Account Strategist",
    prompt: `Du bist der Account Strategist. Du bekommst die Account-Ebene EINES Workspaces: welcher Chatter auf welchem Account sitzt, Umsatz pro Account, historische Bestwerte, Buyer-Diversität (falls in den Daten vorhanden).

AUFGABE: Erstelle einen Abschnitt mit dem Titel "Account Strategist".
- summary: 1–2 Sätze zur Account-Lage.
- cards: 3–8 Karten zu:
  * Accounts, die aktuell unter ihrem historischen Bestwert liegen
  * Accounts mit hoher Umsatzkonzentration bei einem Buyer / einer Quelle
  * Accounts, die früher gut liefen und jetzt brachliegen
  * Accounts, die einen besseren Chatter verdienen würden
Jede Karte: title, detail (mit Zahlen), severity, recommendation, impact_eur.
- signals: 1–3 Alarm-Snippets.

REGELN:
- Konkrete Account-Namen und Chatter-Namen.
- Falls Buyer-Diversität nicht in den Daten erkennbar ist, schreibe das nicht dazu.
- Wording: nie "absäuft" — sag "im Rückgang".
- Kein Punkt direkt vor Emojis; Hautton-Emojis immer mit hellem Modifier 🏻.`,
  },
];

function sectionSchema() {
  return {
    type: "object",
    properties: {
      section_key: { type: "string" },
      section_title: { type: "string" },
      summary: { type: "string" },
      cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            detail: { type: "string" },
            severity: { type: "string", enum: ["info", "warn", "critical"] },
            recommendation: { type: "string" },
            impact_eur: { type: "number" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["title", "detail", "severity", "recommendation", "impact_eur"],
          additionalProperties: false,
        },
      },
      signals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["info", "warn", "critical"] },
            message: { type: "string" },
          },
          required: ["severity", "message"],
          additionalProperties: false,
        },
      },
    },
    required: ["section_key", "section_title", "summary", "cards", "signals"],
    additionalProperties: false,
  };
}

async function callAI(
  role: typeof ROLES[number],
  context: string,
  apiKey: string,
): Promise<Section | null> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.6-flash",
      messages: [
        { role: "system", content: role.prompt },
        { role: "user", content: context },
      ],
      tools: [{
        type: "function",
        function: {
          name: "deliver_section",
          description: `Liefere den Abschnitt für ${role.title}`,
          parameters: sectionSchema(),
        },
      }],
      tool_choice: { type: "function", function: { name: "deliver_section" } },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    console.error(`AI error for ${role.key}`, resp.status, t.slice(0, 400));
    return null;
  }
  const j = await resp.json();
  const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return null;
  try {
    const parsed = JSON.parse(args);
    return {
      section_key: role.key,
      section_title: parsed.section_title ?? role.title,
      summary: parsed.summary ?? "",
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
      signals: Array.isArray(parsed.signals) ? parsed.signals : [],
    };
  } catch {
    return null;
  }
}

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
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const platform: string = (body.platform || "").toString();
    if (!platform) return json({ error: "Missing platform" }, 400);
    const force: boolean = !!body.force;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const today = new Date().toISOString().slice(0, 10);

    const { data: existing } = await admin
      .from("company_digests")
      .select("id, status, updated_at")
      .eq("user_id", userId)
      .eq("platform", platform)
      .eq("digest_date", today)
      .maybeSingle();

    if (existing && !force) {
      if (existing.status === "ready") return json({ digest_id: existing.id, status: "ready", cached: true });
      const age = Date.now() - new Date(existing.updated_at).getTime();
      if (existing.status === "running" && age < 5 * 60 * 1000) {
        return json({ digest_id: existing.id, status: "running" });
      }
    }

    let digestId = existing?.id as string | undefined;
    if (digestId) {
      await admin.from("company_digests").update({ status: "running", error_message: null, updated_at: new Date().toISOString() }).eq("id", digestId);
    } else {
      const { data: created, error: createErr } = await admin
        .from("company_digests")
        .insert({ user_id: userId, platform, digest_date: today, status: "running" })
        .select("id")
        .single();
      if (createErr || !created) return json({ error: createErr?.message || "insert failed" }, 500);
      digestId = created.id;
    }

    const work = (async () => {
      try {
        const now = new Date();
        const from45 = new Date(now.getTime() - 45 * 86400000).toISOString().slice(0, 10);
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
        const monthKey = today.slice(0, 7);

        const [{ data: latestReport }, { data: goalRow }] = await Promise.all([
          admin
            .from("analysis_reports")
            .select("id, analysis_date, result_json")
            .eq("user_id", userId)
            .eq("platform", platform)
            .not("result_json", "is", null)
            .order("analysis_date", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          admin.from("revenue_goals").select("goal_eur").eq("user_id", userId).eq("platform", platform).eq("month_key", monthKey).maybeSingle(),
        ]);

        const roster = new Set<string>();
        const rosterRows: any[] = [];
        const cats = (latestReport?.result_json as any)?.categories ?? [];
        for (const cat of cats) {
          for (const ch of cat.chatters ?? []) {
            if (!ch?.name) continue;
            const key = normalizeName(ch.name);
            roster.add(key);
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

        const [history, live, actionEvents, briefing, memos, memories] = await Promise.all([
          fetchAll<any>((f, t) =>
            admin.from("chatter_history")
              .select("chatter_name, account, analysis_date, revenue_today, mass_dms, open_chats, category")
              .eq("user_id", userId)
              .eq("platform", platform)
              .gte("analysis_date", from45)
              .order("analysis_date", { ascending: false })
              .range(f, t)),
          fetchAll<any>((f, t) =>
            admin.from("chatter_history_live")
              .select("chatter_name, revenue, mass_dms, unread_chats, oldest_chat, stats_details, revenue_details, date, updated_at")
              .ilike("platform", platform)
              .order("updated_at", { ascending: false })
              .range(f, t)),
          (async () => {
            const since = new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);
            const { data, error } = await admin
              .from("action_events")
              .select("event_type, chatter_name, counterpart_chatter, account, prev_account, detected_on, verdict, verdict_reason, recommendation, impact_eur, baseline_json, outcome_json, status")
              .eq("user_id", userId)
              .eq("platform", platform)
              .gte("detected_on", since)
              .neq("status", "archived")
              .order("detected_on", { ascending: false });
            if (error) throw error;
            return data ?? [];
          })(),
          admin
            .from("daily_briefings")
            .select("headline, situation, patterns, goal_snapshot, total_impact_eur")
            .eq("user_id", userId)
            .eq("platform", platform)
            .eq("briefing_date", today)
            .maybeSingle(),
          admin.from("chatter_memos").select("chatter_name, text, topic, status").eq("user_id", userId).eq("platform", platform).eq("status", "open"),
          admin.from("ai_memories").select("content, category").eq("user_id", userId).eq("platform", platform),
        ]);

        // Per-chatter aggregates (active roster only)
        type DayRec = { d: string; rev: number; dms: number; open: number; account: string | null };
        const byChatter = new Map<string, { name: string; accounts: Set<string>; days: DayRec[] }>();
        for (const h of history) {
          const key = normalizeName(h.chatter_name ?? "");
          if (!key) continue;
          if (roster.size && !roster.has(key)) continue;
          let e = byChatter.get(key);
          if (!e) { e = { name: h.chatter_name, accounts: new Set(), days: [] }; byChatter.set(key, e); }
          if (h.account) e.accounts.add(h.account);
          e.days.push({ d: h.analysis_date, rev: Number(h.revenue_today) || 0, dms: Number(h.mass_dms) || 0, open: Number(h.open_chats) || 0, account: h.account ?? null });
        }

        const liveSeen = new Set<string>();
        const liveByChatter = new Map<string, any>();
        for (const l of live) {
          const key = normalizeName(l.chatter_name ?? "");
          if (!key || liveSeen.has(key)) continue;
          if (roster.size && !roster.has(key)) continue;
          liveSeen.add(key);
          liveByChatter.set(key, l);
        }

        const chatterStats = Array.from(byChatter.values()).map((a) => {
          const sorted = [...a.days].sort((x, y) => (x.d < y.d ? 1 : -1));
          const last7 = sorted.slice(0, 7);
          const prev7 = sorted.slice(7, 14);
          const sum = (arr: DayRec[]) => arr.reduce((s, r) => s + r.rev, 0);
          const avg = (arr: DayRec[]) => (arr.length ? sum(arr) / arr.length : 0);
          const best = sorted.reduce((m, r) => Math.max(m, r.rev), 0);
          const avg7 = avg(last7);
          const avgPrev7 = avg(prev7);
          const live = liveByChatter.get(normalizeName(a.name));
          const accounts = Array.from(a.accounts);
          return {
            name: a.name,
            accounts,
            avg_day_7d: Math.round(avg7),
            avg_day_prev7d: Math.round(avgPrev7),
            trend_pct: avgPrev7 > 0 ? Math.round(((avg7 - avgPrev7) / avgPrev7) * 100) : null,
            best_day_45d: Math.round(best),
            potential_gap_eur: Math.max(0, Math.round(best - avg7)),
            mass_dms_avg_7d: last7.length ? Math.round((last7.reduce((s, r) => s + r.dms, 0) / last7.length) * 10) / 10 : 0,
            zero_days_7d: last7.filter((r) => r.rev <= 0).length,
            live_revenue_today: live ? Number(live.revenue) || 0 : null,
            live_unread: live ? Number(live.unread_chats) || 0 : null,
            live_oldest_chat_days: live ? Number(live.oldest_chat) || 0 : null,
            live_mass_dms_today: live ? Number(live.mass_dms) || 0 : null,
            live_accounts: live && live.stats_details && typeof live.stats_details === "object" ? Object.keys(live.stats_details) : accounts,
          };
        });

        const peerAvgDay = chatterStats.length
          ? Math.round(chatterStats.reduce((s, c) => s + c.avg_day_7d, 0) / chatterStats.length)
          : 0;

        // Account-level aggregates
        const byAccount = new Map<string, { days: Map<string, number>; chatters: Set<string>; best: number; current: Set<string> }>();
        for (const h of history) {
          const ak = normalizeName(h.account ?? "");
          if (!ak) continue;
          let e = byAccount.get(ak);
          if (!e) { e = { days: new Map(), chatters: new Set(), best: 0, current: new Set() }; byAccount.set(ak, e); }
          const rev = Number(h.revenue_today) || 0;
          e.days.set(h.analysis_date, (e.days.get(h.analysis_date) || 0) + rev);
          e.chatters.add(normalizeName(h.chatter_name ?? ""));
          e.best = Math.max(e.best, rev);
        }
        // current chatter per account from latest report roster rows
        for (const r of rosterRows) {
          if (r.account) {
            const ak = normalizeName(r.account);
            const e = byAccount.get(ak);
            if (e) e.current.add(normalizeName(r.name));
          }
        }
        const accountStats = Array.from(byAccount.entries()).map(([key, e]) => {
          const days = Array.from(e.days.values());
          const total = days.reduce((s, v) => s + v, 0);
          const avg = days.length ? total / days.length : 0;
          return {
            account: key,
            avg_day_45d: Math.round(avg),
            best_day_45d: Math.round(e.best),
            total_revenue_45d: Math.round(total),
            chatter_count: e.current.size || e.chatters.size,
          };
        });

        // Month goal snapshot
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

        const baseContext = `Workspace: ${platform}
Stichtag: ${today}
Aktive Chatter: ${chatterStats.length}
Peer-Schnitt Umsatz/Tag (7d): ${peerAvgDay} €
Monatsziel-Snapshot: ${JSON.stringify(goalSnapshot)}
Aktueller Fahrplan: ${JSON.stringify({ headline: briefing?.headline ?? null, situation: briefing?.situation ?? null, patterns: briefing?.patterns ?? [], total_impact_eur: briefing?.total_impact_eur ?? 0 })}
Offene Memos: ${JSON.stringify(memos ?? [])}
Gedächtnis: ${JSON.stringify((memories ?? []).map((m: any) => m.content))}`;

        const contexts: Record<string, string> = {
          revenue: `${baseContext}

CHATTER-STATS (finanzielle Sicht): ${JSON.stringify(chatterStats.slice().sort((a, b) => b.potential_gap_eur - a.potential_gap_eur))}`,
          operations: `${baseContext}

CHATTER-STATS (Operations-Sicht): ${JSON.stringify(chatterStats.slice().sort((a, b) => (b.live_oldest_chat_days || 0) - (a.live_oldest_chat_days || 0)))}`,
          staffing: `${baseContext}

BESCHTZUNGS-EREIGNISSE (letzte 14 Tage): ${JSON.stringify(actionEvents)}

CHATTER-ACCOUNTS: ${JSON.stringify(chatterStats.map((c) => ({ name: c.name, accounts: c.accounts, avg_day_7d: c.avg_day_7d, potential_gap_eur: c.potential_gap_eur })))}`,
          accounts: `${baseContext}

ACCOUNT-STATS: ${JSON.stringify(accountStats)}

CHATTER-PRO-ACCOUNT: ${JSON.stringify(chatterStats.map((c) => ({ name: c.name, accounts: c.live_accounts, avg_day_7d: c.avg_day_7d, best_day_45d: c.best_day_45d })))}`,
        };

        const sections: Section[] = [];
        const signals: { severity: "info" | "warn" | "critical"; message: string }[] = [];

        // Run all 4 role prompts in parallel
        const roleResults = await Promise.all(
          ROLES.map((role) => callAI(role, contexts[role.key], LOVABLE_API_KEY)),
        );
        for (const r of roleResults) {
          if (!r) continue;
          sections.push(r);
          signals.push(...(r.signals ?? []));
        }

        await admin.from("company_digests").update({
          status: "ready",
          sections_json: sections,
          signals_json: signals,
          error_message: null,
          updated_at: new Date().toISOString(),
        }).eq("id", digestId).eq("user_id", userId);
      } catch (e: any) {
        console.error("generate-company-digest work error:", e);
        await admin.from("company_digests").update({
          status: "error",
          error_message: String(e?.message ?? e).slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq("id", digestId).eq("user_id", userId);
      }
    })();

    return json({ digest_id: digestId, status: "running" });
  } catch (e) {
    console.error("generate-company-digest error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
