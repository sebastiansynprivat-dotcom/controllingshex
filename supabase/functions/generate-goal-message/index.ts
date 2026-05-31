// Generate Boss→Chatter goal message from a user-defined TEMPLATE (no AI).
// Placeholders: {name}, {ziel}, {woche1}, {monat}
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Scenario = "growth" | "flat" | "decline";

const DEFAULT_TEMPLATES: Record<Scenario, string> = {
  growth:
    "Hey {name}, starker Monat 💪🏻 Läuft richtig gut – nächsten Monat legen wir nochmal eine Schippe drauf. Fans haben jetzt frisches Gehalt, leicht zu verkaufen.\n\n*Woche 1* Vollgas: Mass-DMs raus, solange du online bist. Danach wird's entspannter.\n\nNeues Ziel für {monat}: *{ziel}*, davon *{woche1}* in *Woche 1*.",
  flat:
    "Hey {name}, Monat war okay – kein Riesensprung, halb so wild. Nächsten Monat holen wir die Steigerung locker rein. Fans haben jetzt frisches Gehalt, leicht zu verkaufen.\n\n*Woche 1* Vollgas: Mass-DMs raus, solange du online bist. Danach wird's entspannter.\n\nNeues Ziel für {monat}: *{ziel}*, davon *{woche1}* in *Woche 1*.",
  decline:
    "Hey {name}, war nicht unser Monat – halb so wild. Nächsten Monat drehen wir das sauber. Fans haben jetzt frisches Gehalt, leicht zu verkaufen.\n\n*Woche 1* Vollgas: Mass-DMs raus, solange du online bist. Danach wird's entspannter.\n\nNeues Ziel für {monat}: *{ziel}*, davon *{woche1}* in *Woche 1*.",
};

const MONTHS_DE = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

const fmtEUR = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

function substitute(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
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
    const scenarioOverride: Scenario | null =
      body.scenario_override === "growth" || body.scenario_override === "flat" || body.scenario_override === "decline"
        ? body.scenario_override
        : null;

    if (!chatterName || !platform || !Number.isFinite(proposedGoal) || proposedGoal <= 0) {
      return new Response(JSON.stringify({ error: "Missing or invalid input" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const today = new Date();
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    const firstOfNextMonth = new Date(Date.UTC(y, m + 1, 1));
    const lastOfNextMonth = new Date(Date.UTC(y, m + 2, 0));
    const firstOfThisMonth = new Date(Date.UTC(y, m, 1));
    const lastOfThisMonth = new Date(Date.UTC(y, m + 1, 0));
    const firstOfLastMonth = new Date(Date.UTC(y, m - 1, 1));
    const lastOfLastMonth = new Date(Date.UTC(y, m, 0));

    const iso = (d: Date) => d.toISOString().slice(0, 10);

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
        .eq("user_id", userId),
    ]);

    if (histRes.error) throw histRes.error;

    // Aggregate revenue per distinct day
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

    // Scenario detection (auto), optionally overridden by client
    let autoScenario: Scenario;
    if (vsPrior == null) autoScenario = "flat";
    else if (vsPrior >= 5) autoScenario = "growth";
    else if (vsPrior <= -5) autoScenario = "decline";
    else autoScenario = "flat";
    const scenario: Scenario = scenarioOverride ?? autoScenario;


    // Pick template (user-defined or fallback)
    const userTemplates = new Map<Scenario, string>();
    for (const t of (tplRes.data ?? []) as Array<{ scenario: Scenario; template: string }>) {
      if (t.template && t.template.trim()) userTemplates.set(t.scenario, t.template);
    }
    const template = userTemplates.get(scenario) ?? DEFAULT_TEMPLATES[scenario];

    const goalMonthName = MONTHS_DE[firstOfNextMonth.getUTCMonth()];
    const recapMonthName = MONTHS_DE[firstOfThisMonth.getUTCMonth()];
    const priorMonthName = MONTHS_DE[firstOfLastMonth.getUTCMonth()];
    const week1 = Math.round((proposedGoal * 0.30) / 50) * 50;

    const firstName = chatterName.split(/\s+/)[0] || chatterName;
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
