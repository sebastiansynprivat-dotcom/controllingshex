// Hot-Streak Detection: feuert Web Push wenn ein Chatter ≥150% über erwarteter Pace ist.
// Wird vom upsert-chatter-live nach jedem Live-Update aufgerufen.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-live-history-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PACE_THRESHOLD = 1.5; // 150%
const MIN_REVENUE = 30; // €
const DEDUPE_HOURS = 2;
const APP_TIMEZONE = "Europe/Berlin";
const SHIFT_CUTOFF_HOUR = 6;

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
webpush.setVapidDetails("mailto:noreply@controllingshex.app", VAPID_PUBLIC, VAPID_PRIVATE);

function berlinHourFraction(): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date()).reduce<Record<string, string>>((a, p) => {
    if (p.type !== "literal") a[p.type] = p.value;
    return a;
  }, {});
  const h = Number(parts.hour === "24" ? "00" : parts.hour);
  const m = Number(parts.minute);
  return h + m / 60;
}

function dayProgress(): number {
  const h = berlinHourFraction();
  const elapsed = (h - SHIFT_CUTOFF_HOUR + 24) % 24;
  return Math.max(0.05, Math.min(1, elapsed / 24));
}

interface Row {
  platform: string;
  chatter_name: string;
  revenue: number;
  date: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let rows: Row[] = [];
  try {
    const body = await req.json();
    rows = Array.isArray(body?.rows) ? body.rows : [];
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const progress = dayProgress();
  const today = new Date().toISOString().slice(0, 10);
  const dedupeSince = new Date(Date.now() - DEDUPE_HOURS * 3600 * 1000).toISOString();

  let firedCount = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const revenue = Number(row.revenue) || 0;
    if (revenue < MIN_REVENUE) continue;

    // Find all users that own this chatter (have history rows)
    const { data: ownerRows } = await admin
      .from("chatter_history")
      .select("user_id")
      .eq("platform", row.platform)
      .eq("chatter_name", row.chatter_name)
      .not("user_id", "is", null)
      .gte("analysis_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
      .limit(500);

    const userIds = Array.from(new Set((ownerRows ?? []).map((r) => r.user_id as string)));
    if (userIds.length === 0) continue;

    for (const userId of userIds) {
      // Personal baseline: avg revenue/day last 14 days
      const { data: hist } = await admin
        .from("chatter_history")
        .select("revenue_today, analysis_date")
        .eq("user_id", userId)
        .eq("platform", row.platform)
        .eq("chatter_name", row.chatter_name)
        .gte("analysis_date", new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10))
        .order("analysis_date", { ascending: false });

      const valid = (hist ?? []).filter((h) => h.analysis_date !== today);
      if (valid.length < 3) continue;
      const baseline = valid.reduce((s, h) => s + (Number(h.revenue_today) || 0), 0) / valid.length;
      if (baseline < 10) continue; // unter 10€ Schnitt → kein "starker Account"

      const expected = baseline * progress;
      if (expected <= 0) continue;
      const pacePct = revenue / expected;
      if (pacePct < PACE_THRESHOLD) continue;

      // Dedupe: gleicher chatter heute schon in den letzten 2h alarmiert?
      const { data: recent } = await admin
        .from("hot_streak_alerts")
        .select("id")
        .eq("user_id", userId)
        .eq("platform", row.platform)
        .eq("chatter_name", row.chatter_name)
        .eq("alert_date", today)
        .gte("sent_at", dedupeSince)
        .limit(1);
      if (recent && recent.length > 0) continue;

      // Insert alert (triggert Realtime → In-App Toast)
      await admin.from("hot_streak_alerts").insert({
        user_id: userId,
        platform: row.platform,
        chatter_name: row.chatter_name,
        alert_date: today,
        revenue_at_alert: revenue,
        expected_pace: expected,
        pace_pct: pacePct,
        baseline_avg: baseline,
      });

      // Push an alle Subscriptions des Users
      const { data: subs } = await admin
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("user_id", userId);

      const pacePctInt = Math.round(pacePct * 100);
      const payload = JSON.stringify({
        title: `🔥 ${row.chatter_name} läuft heiß`,
        body: `${pacePctInt}% vs. Pace · ${Math.round(revenue)} € (Ø ${Math.round(baseline)} €)`,
        url: "/live",
        tag: `streak-${row.chatter_name}-${today}`,
      });

      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification(
            {
              endpoint: s.endpoint,
              keys: { p256dh: s.p256dh, auth: s.auth },
            },
            payload,
          );
          firedCount++;
        } catch (e: any) {
          const status = e?.statusCode;
          if (status === 404 || status === 410) {
            // Subscription dead → cleanup
            await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          } else {
            errors.push(`${s.endpoint.slice(-12)}: ${e?.message ?? e}`);
          }
        }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, fired: firedCount, errors }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
