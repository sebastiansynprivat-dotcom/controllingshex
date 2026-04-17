import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// SENSIBLE Schwellen — der User möchte alles sehen was auffällt
const THRESHOLDS = {
  verzug_spike: { absoluteMin: 2, deltaDays: 1 },           // heute >= Ø + 1 Tag UND mind. 2 Tage Verzug
  mass_dm_drop: { dropPct: 30, minBaseline: 3 },            // Mass-DMs -30% UND Baseline >= 3
  chat_jam: { multiplier: 1.25, minAbsolute: 30 },          // open_chats > 1.25× Ø UND >= 30 absolut
  revenue_drop: { dropPct: 30, minBaseline: 50 },           // Revenue -30% UND Baseline >= 50€
  inactivity: { daysGap: 2 },                               // 2+ Tage nicht in Reports
  positive_outlier: { multiplier: 1.8, minBaseline: 50 },   // Revenue 1.8× Ø UND Baseline >= 50€
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface ChatterRow {
  chatter_name: string;
  analysis_date: string;
  revenue_today: number | null;
  mass_dms: number | null;
  open_chats: number | null;
  response_delay_days: number | null;
}

interface Alert {
  chatter_name: string;
  alert_type: string;
  severity: string;
  metric_value: number;
  baseline_value: number;
  delta_pct: number;
  message: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const platform = body.platform || "Maloum";

    const admin = createClient(supabaseUrl, serviceKey);

    // letzte 14 Tage History holen
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: history } = await admin
      .from("chatter_history")
      .select("chatter_name, analysis_date, revenue_today, mass_dms, open_chats, response_delay_days")
      .eq("user_id", userId)
      .eq("platform", platform)
      .gte("analysis_date", fourteenDaysAgo.toISOString().split("T")[0])
      .order("analysis_date", { ascending: false });

    if (!history || history.length === 0) {
      return new Response(JSON.stringify({ alerts: [], message: "Keine Daten der letzten 14 Tage." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = history as ChatterRow[];

    // Latest analysis date
    const latestDate = rows[0].analysis_date;

    // Group by chatter_name
    const byChatter = new Map<string, ChatterRow[]>();
    for (const r of rows) {
      const list = byChatter.get(r.chatter_name) || [];
      list.push(r);
      byChatter.set(r.chatter_name, list);
    }

    const alerts: Alert[] = [];
    const today = new Date(latestDate);

    for (const [name, entries] of byChatter) {
      const todayEntry = entries.find((e) => e.analysis_date === latestDate);
      const historical = entries.filter((e) => e.analysis_date !== latestDate);

      // INACTIVITY — chatter not in latest report
      if (!todayEntry && historical.length > 0) {
        const lastSeen = historical[0].analysis_date;
        const daysAgo = Math.floor((today.getTime() - new Date(lastSeen).getTime()) / 86400000);
        if (daysAgo >= THRESHOLDS.inactivity.daysGap) {
          alerts.push({
            chatter_name: name,
            alert_type: "inactivity",
            severity: "medium",
            metric_value: daysAgo,
            baseline_value: 0,
            delta_pct: 0,
            message: `${name} taucht seit ${daysAgo} Tagen nicht mehr in Reports auf.`,
          });
        }
        continue;
      }

      if (!todayEntry || historical.length < 2) continue;

      // VERZUG SPIKE
      const todayDelay = todayEntry.response_delay_days ?? 0;
      const baseDelays = historical.map((e) => e.response_delay_days ?? 0);
      const baseDelay = median(baseDelays);
      if (todayDelay >= THRESHOLDS.verzug_spike.absoluteMin && todayDelay >= baseDelay + THRESHOLDS.verzug_spike.deltaDays) {
        const delta = baseDelay > 0 ? ((todayDelay - baseDelay) / baseDelay) * 100 : 100;
        alerts.push({
          chatter_name: name,
          alert_type: "verzug_spike",
          severity: todayDelay >= 4 ? "critical" : "high",
          metric_value: todayDelay,
          baseline_value: baseDelay,
          delta_pct: Math.round(delta),
          message: `Verzug heute ${todayDelay} Tage (Ø ${baseDelay.toFixed(1)})`,
        });
      }

      // MASS DM DROP
      const todayDM = todayEntry.mass_dms ?? 0;
      const baseDMs = historical.map((e) => e.mass_dms ?? 0);
      const baseDM = median(baseDMs);
      if (baseDM >= THRESHOLDS.mass_dm_drop.minBaseline) {
        const dropPct = ((baseDM - todayDM) / baseDM) * 100;
        if (dropPct >= THRESHOLDS.mass_dm_drop.dropPct) {
          alerts.push({
            chatter_name: name,
            alert_type: "mass_dm_drop",
            severity: dropPct >= 60 ? "high" : "medium",
            metric_value: todayDM,
            baseline_value: baseDM,
            delta_pct: -Math.round(dropPct),
            message: `Mass-DMs heute ${todayDM} (Ø ${baseDM.toFixed(0)}, -${Math.round(dropPct)}%)`,
          });
        }
      }

      // CHAT JAM
      const todayChats = todayEntry.open_chats ?? 0;
      const baseChats = historical.map((e) => e.open_chats ?? 0);
      const baseChat = median(baseChats);
      if (todayChats >= THRESHOLDS.chat_jam.minAbsolute && baseChat > 0 && todayChats > baseChat * THRESHOLDS.chat_jam.multiplier) {
        const delta = ((todayChats - baseChat) / baseChat) * 100;
        alerts.push({
          chatter_name: name,
          alert_type: "chat_jam",
          severity: delta >= 50 ? "high" : "medium",
          metric_value: todayChats,
          baseline_value: baseChat,
          delta_pct: Math.round(delta),
          message: `Offene Chats: ${todayChats} (Ø ${baseChat.toFixed(0)}, +${Math.round(delta)}%)`,
        });
      }

      // REVENUE
      const todayRev = Number(todayEntry.revenue_today ?? 0);
      const baseRevs = historical.map((e) => Number(e.revenue_today ?? 0));
      const baseRev = median(baseRevs);

      // REVENUE DROP
      if (baseRev >= THRESHOLDS.revenue_drop.minBaseline) {
        const dropPct = ((baseRev - todayRev) / baseRev) * 100;
        if (dropPct >= THRESHOLDS.revenue_drop.dropPct) {
          alerts.push({
            chatter_name: name,
            alert_type: "revenue_drop",
            severity: dropPct >= 60 ? "high" : "medium",
            metric_value: todayRev,
            baseline_value: baseRev,
            delta_pct: -Math.round(dropPct),
            message: `Umsatz ${todayRev.toFixed(0)}€ (Ø ${baseRev.toFixed(0)}€, -${Math.round(dropPct)}%)`,
          });
        }
      }

      // POSITIVE OUTLIER
      if (baseRev >= THRESHOLDS.positive_outlier.minBaseline && todayRev >= baseRev * THRESHOLDS.positive_outlier.multiplier) {
        const delta = ((todayRev - baseRev) / baseRev) * 100;
        alerts.push({
          chatter_name: name,
          alert_type: "positive_outlier",
          severity: "info",
          metric_value: todayRev,
          baseline_value: baseRev,
          delta_pct: Math.round(delta),
          message: `Umsatz ${todayRev.toFixed(0)}€ (Ø ${baseRev.toFixed(0)}€, +${Math.round(delta)}%) — was läuft hier richtig?`,
        });
      }
    }

    // Auto-resolve: bestehende NEW/SEEN-Alerts älter als heute, deren Chatter heute keinen entsprechenden Alert hat
    const todayAlertKeys = new Set(alerts.map((a) => `${a.chatter_name}|${a.alert_type}`));
    const { data: openAlerts } = await admin
      .from("anomaly_alerts")
      .select("id, chatter_name, alert_type, detection_date")
      .eq("user_id", userId)
      .eq("platform", platform)
      .in("status", ["new", "seen"])
      .lt("detection_date", latestDate);

    const toResolve = (openAlerts || []).filter(
      (a: any) => !todayAlertKeys.has(`${a.chatter_name}|${a.alert_type}`)
    );
    if (toResolve.length > 0) {
      await admin
        .from("anomaly_alerts")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .in("id", toResolve.map((a: any) => a.id));
    }

    // Upsert today's alerts
    if (alerts.length > 0) {
      const records = alerts.map((a) => ({
        user_id: userId,
        platform,
        chatter_name: a.chatter_name,
        alert_type: a.alert_type,
        severity: a.severity,
        metric_value: a.metric_value,
        baseline_value: a.baseline_value,
        delta_pct: a.delta_pct,
        message: a.message,
        detection_date: latestDate,
      }));

      await admin
        .from("anomaly_alerts")
        .upsert(records, { onConflict: "user_id,platform,chatter_name,alert_type,detection_date", ignoreDuplicates: true });
    }

    return new Response(
      JSON.stringify({
        alerts_detected: alerts.length,
        auto_resolved: toResolve.length,
        latest_date: latestDate,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[detect-anomalies] error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
