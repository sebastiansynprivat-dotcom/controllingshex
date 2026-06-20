// Generate Boss→Chatter goal message from a user-defined TEMPLATE (no AI).
// Monthly placeholders: {name}, {ziel}, {woche1}, {monat}
// Weekly placeholders:  {name}, {ziel}, {tagesziel}, {letztewoche_umsatz}
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type MonthlyScenario = "growth" | "flat" | "decline";
type WeeklyScenario = "weekly_growth" | "weekly_flat" | "weekly_decline";
type Scenario = MonthlyScenario | WeeklyScenario;

const DEFAULT_MONTHLY: Record<MonthlyScenario, string> = {
  growth:
    "Hey {name}, starker Monat 💪🏻 Läuft richtig gut – nächsten Monat legen wir nochmal eine Schippe drauf. Fans haben jetzt frisches Gehalt, leicht zu verkaufen.\n\n*Woche 1* Vollgas: Mass-DMs raus, solange du online bist. Danach wird's entspannter.\n\nNeues Ziel für {monat}: *{ziel}*, davon *{woche1}* in *Woche 1*.",
  flat:
    "Hey {name}, Monat war okay – kein Riesensprung, halb so wild. Nächsten Monat holen wir die Steigerung locker rein. Fans haben jetzt frisches Gehalt, leicht zu verkaufen.\n\n*Woche 1* Vollgas: Mass-DMs raus, solange du online bist. Danach wird's entspannter.\n\nNeues Ziel für {monat}: *{ziel}*, davon *{woche1}* in *Woche 1*.",
  decline:
    "Hey {name}, war nicht unser Monat – halb so wild. Nächsten Monat drehen wir das sauber. Fans haben jetzt frisches Gehalt, leicht zu verkaufen.\n\n*Woche 1* Vollgas: Mass-DMs raus, solange du online bist. Danach wird's entspannter.\n\nNeues Ziel für {monat}: *{ziel}*, davon *{woche1}* in *Woche 1*.",
};

const DEFAULT_WEEKLY: Record<WeeklyScenario, string> = {
  weekly_growth:
    "Hey {name}, starke Woche 🔥 Genau so weiter – diese Woche ziehen wir das Tempo nochmal an. Fans sind warm, jetzt nachlegen.\n\nZiel diese Woche: *{ziel}* — heißt Ø *{tagesziel}/Tag*.\nLetzte Woche: {letztewoche_umsatz}. Machbar.",
  weekly_flat:
    "Hey {name}, Woche war okay – nichts Wildes. Diese Woche holen wir die kleine Steigerung sauber rein.\n\nZiel diese Woche: *{ziel}* — Ø *{tagesziel}/Tag*.\nLetzte Woche: {letztewoche_umsatz}.",
  weekly_decline:
    "Hey {name}, letzte Woche war nicht unsere – halb so wild. Diese Woche drehen wir das sauber.\n\nZiel diese Woche: *{ziel}* — Ø *{tagesziel}/Tag*.\nLetzte Woche: {letztewoche_umsatz}.",
};

const MONTHS_DE = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

const fmtEUR = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

function substitute(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

// ISO week helpers (UTC)
function isoWeekday(d: Date): number {
  const wd = d.getUTCDay();
  return wd === 0 ? 7 : wd;
}
function startOfIsoWeek(d: Date): Date {
  const wd = isoWeekday(d);
  const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  s.setUTCDate(s.getUTCDate() - (wd - 1));
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const chatterName: string = (body.chatter_name || "").toString().trim();
    const platform: string = (body.platform || "").toString().trim();
    const proposedGoal = Number(body.proposed_goal);
    const currentGoal = body.current_goal != null ? Number(body.current_goal) : null;
    const goalType: "weekly" | "monthly" = body.goal_type === "weekly" ? "weekly" : "monthly";

    if (!chatterName || !platform || !Number.isFinite(proposedGoal) || proposedGoal <= 0) {
      return new Response(JSON.stringify({ error: "Missing or invalid input" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    // Strip invisible/variation-selector chars and emoji-modifiers from the start,
    // then take the first whitespace-separated token as the first name.
    const cleanedName = chatterName
      .replace(/[\u200B-\u200D\uFE00-\uFE0F\u2640-\u2642\u2600-\u27BF]/gu, "")
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    const firstName = (cleanedName.split(/\s+/)[0] || cleanedName || chatterName).trim();

    // ===== WEEKLY =====
    if (goalType === "weekly") {
      const scenarioOverride: WeeklyScenario | null =
        body.scenario_override === "weekly_growth" ||
        body.scenario_override === "weekly_flat" ||
        body.scenario_override === "weekly_decline"
          ? body.scenario_override
          : // Erlaube auch Monats-Keys als Bequemlichkeit (mapped auf weekly_*)
            body.scenario_override === "growth" ? "weekly_growth"
          : body.scenario_override === "flat" ? "weekly_flat"
          : body.scenario_override === "decline" ? "weekly_decline"
          : null;

      const startThis = startOfIsoWeek(today);
      const startLast = new Date(startThis); startLast.setUTCDate(startLast.getUTCDate() - 7);
      const startPrior = new Date(startThis); startPrior.setUTCDate(startPrior.getUTCDate() - 14);
      const endLast = new Date(startThis); endLast.setUTCDate(endLast.getUTCDate() - 1);
      const endPrior = new Date(startLast); endPrior.setUTCDate(endPrior.getUTCDate() - 1);

      const [histRes, tplRes] = await Promise.all([
        admin
          .from("chatter_history")
          .select("revenue_today, analysis_date")
          .eq("user_id", userId)
          .eq("platform", platform)
          .eq("chatter_name", chatterName)
          .gte("analysis_date", iso(startPrior))
          .lte("analysis_date", iso(endLast)),
        admin
          .from("goal_message_templates")
          .select("scenario, template")
          .eq("user_id", userId)
          .in("scenario", ["weekly_growth", "weekly_flat", "weekly_decline"]),
      ]);
      if (histRes.error) throw histRes.error;

      // Aggregate per bucket+date (max value per day to avoid double counts)
      const dayMap = new Map<string, { rev: number; bucket: "last" | "prior" }>();
      for (const h of histRes.data ?? []) {
        const d = h.analysis_date as string;
        const rev = Number(h.revenue_today ?? 0);
        let bucket: "last" | "prior" | null = null;
        if (d >= iso(startLast) && d <= iso(endLast)) bucket = "last";
        else if (d >= iso(startPrior) && d <= iso(endPrior)) bucket = "prior";
        if (!bucket) continue;
        const key = `${bucket}|${d}`;
        const cur = dayMap.get(key) ?? { rev: 0, bucket };
        cur.rev += rev;
        dayMap.set(key, cur);
      }
      let lastRev = 0, lastDays = 0, priorRev = 0, priorDays = 0;
      for (const v of dayMap.values()) {
        if (v.bucket === "last") { lastRev += v.rev; lastDays += 1; }
        else { priorRev += v.rev; priorDays += 1; }
      }
      const vsPrior = priorRev > 0 ? ((lastRev - priorRev) / priorRev) * 100 : null;

      let autoScenario: WeeklyScenario;
      if (vsPrior == null) autoScenario = "weekly_flat";
      else if (vsPrior >= 5) autoScenario = "weekly_growth";
      else if (vsPrior <= -5) autoScenario = "weekly_decline";
      else autoScenario = "weekly_flat";
      const scenario: WeeklyScenario = scenarioOverride ?? autoScenario;

      const userTemplates = new Map<WeeklyScenario, string>();
      for (const t of (tplRes.data ?? []) as Array<{ scenario: WeeklyScenario; template: string }>) {
        if (t.template && t.template.trim()) userTemplates.set(t.scenario, t.template);
      }
      const template = userTemplates.get(scenario) ?? DEFAULT_WEEKLY[scenario];

      const dailyTarget = Math.round((proposedGoal / 7) / 10) * 10;
      const message = substitute(template, {
        name: firstName,
        ziel: fmtEUR(proposedGoal),
        tagesziel: fmtEUR(dailyTarget),
        letztewoche_umsatz: fmtEUR(lastRev),
      });

      return new Response(
        JSON.stringify({
          message,
          scenario,
          auto_scenario: autoScenario,
          context: {
            goal_type: "weekly",
            last_week_revenue: lastRev,
            last_week_days: lastDays,
            prior_week_revenue: priorRev,
            prior_week_days: priorDays,
            vs_prev_pct: vsPrior,
            daily_target: dailyTarget,
            last_month_name: "Letzte Woche",
            last_month_revenue: lastRev,
            last_worked_days: lastDays,
            days_in_last_month: 7,
            prior_goal: currentGoal,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ===== MONTHLY (unverändert) =====
    const scenarioOverride: MonthlyScenario | null =
      body.scenario_override === "growth" || body.scenario_override === "flat" || body.scenario_override === "decline"
        ? body.scenario_override
        : null;

    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    const firstOfNextMonth = new Date(Date.UTC(y, m + 1, 1));
    const lastOfNextMonth = new Date(Date.UTC(y, m + 2, 0));
    const firstOfThisMonth = new Date(Date.UTC(y, m, 1));
    const lastOfThisMonth = new Date(Date.UTC(y, m + 1, 0));
    const firstOfLastMonth = new Date(Date.UTC(y, m - 1, 1));
    const lastOfLastMonth = new Date(Date.UTC(y, m, 0));

    const [histRes, tplRes] = await Promise.all([
      admin
        .from("chatter_history")
        .select("revenue_today, analysis_date")
        .eq("user_id", userId)
        .eq("platform", platform)
        .eq("chatter_name", chatterName)
        .gte("analysis_date", iso(firstOfLastMonth))
        .lte("analysis_date", iso(today)),
      admin
        .from("goal_message_templates")
        .select("scenario, template")
        .eq("user_id", userId)
        .in("scenario", ["growth", "flat", "decline"]),
    ]);

    if (histRes.error) throw histRes.error;

    const recapFrom = iso(firstOfThisMonth);
    const recapTo = iso(today);
    const priorFrom = iso(firstOfLastMonth);
    const priorTo = iso(lastOfLastMonth);

    const dayMap = new Map<string, { rev: number; bucket: "recap" | "prior" }>();
    for (const h of histRes.data ?? []) {
      const d = h.analysis_date as string;
      const rev = Number(h.revenue_today ?? 0);
      let bucket: "recap" | "prior" | null = null;
      if (d >= recapFrom && d <= recapTo) bucket = "recap";
      else if (d >= priorFrom && d <= priorTo) bucket = "prior";
      if (!bucket) continue;
      const key = `${bucket}|${d}`;
      const cur = dayMap.get(key) ?? { rev: 0, bucket };
      cur.rev += rev;
      dayMap.set(key, cur);
    }

    let recapRev = 0, recapWorkedDays = 0;
    let priorRev = 0, priorWorkedDays = 0;
    for (const v of dayMap.values()) {
      if (v.bucket === "recap") { recapRev += v.rev; recapWorkedDays += 1; }
      else { priorRev += v.rev; priorWorkedDays += 1; }
    }

    const daysInRecapSoFar = today.getUTCDate();
    const daysInRecapMonth = lastOfThisMonth.getUTCDate();
    const daysInGoalMonth = lastOfNextMonth.getUTCDate();
    const projectedRecap = daysInRecapSoFar > 0
      ? (recapRev / daysInRecapSoFar) * daysInRecapMonth
      : 0;
    const vsPrior = priorRev > 0 ? ((projectedRecap - priorRev) / priorRev) * 100 : null;

    let autoScenario: MonthlyScenario;
    if (vsPrior == null) autoScenario = "flat";
    else if (vsPrior >= 5) autoScenario = "growth";
    else if (vsPrior <= -5) autoScenario = "decline";
    else autoScenario = "flat";
    const scenario: MonthlyScenario = scenarioOverride ?? autoScenario;

    const userTemplates = new Map<MonthlyScenario, string>();
    for (const t of (tplRes.data ?? []) as Array<{ scenario: MonthlyScenario; template: string }>) {
      if (t.template && t.template.trim()) userTemplates.set(t.scenario, t.template);
    }
    const template = userTemplates.get(scenario) ?? DEFAULT_MONTHLY[scenario];

    const goalMonthName = MONTHS_DE[firstOfNextMonth.getUTCMonth()];
    const recapMonthName = MONTHS_DE[firstOfThisMonth.getUTCMonth()];
    const priorMonthName = MONTHS_DE[firstOfLastMonth.getUTCMonth()];
    const week1 = Math.round((proposedGoal * 0.30) / 50) * 50;

    const message = substitute(template, {
      name: firstName,
      ziel: fmtEUR(proposedGoal),
      woche1: fmtEUR(week1),
      monat: goalMonthName,
    });

    return new Response(
      JSON.stringify({
        message,
        scenario,
        auto_scenario: autoScenario,
        context: {
          goal_type: "monthly",
          last_month_revenue: recapRev,
          last_month_name: `${recapMonthName} (bisher)`,
          last_worked_days: recapWorkedDays,
          days_in_last_month: daysInRecapSoFar,
          prior_goal: currentGoal,
          vs_prev_pct: vsPrior,
          prev_month_revenue: priorRev,
          prev_worked_days: priorWorkedDays,
          this_month_revenue: projectedRecap,
          this_month_name: goalMonthName,
          goal_month_name: goalMonthName,
          recap_month_name: recapMonthName,
          prior_month_name: priorMonthName,
          projected_recap: projectedRecap,
          scenario,
          week1_goal: week1,
          days_in_goal_month: daysInGoalMonth,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("generate-goal-message", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
