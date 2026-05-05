// Snapshot stündliche Stats aus chatter_history_live → chatter_hourly_stats
// Wird per pg_cron stündlich aufgerufen. Berechnet Delta zur letzten Stunde pro Chatter.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const hour = now.getHours();
    const prevHour = hour === 0 ? 23 : hour - 1;
    const prevDate = hour === 0
      ? new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10)
      : today;

    // alle live rows von heute
    const { data: live, error: liveErr } = await supabase
      .from("chatter_history_live")
      .select("*")
      .eq("date", today);
    if (liveErr) throw liveErr;

    // wir kennen user_id nicht direkt im live-record (Tabelle hat kein user_id).
    // → wir mappen via chatter_history der letzten 14 Tage
    const since = new Date(now.getTime() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const { data: hist, error: histErr } = await supabase
      .from("chatter_history")
      .select("user_id, platform, chatter_name")
      .gte("analysis_date", since);
    if (histErr) throw histErr;

    const ownerOf = new Map<string, string>(); // platform|name → user_id
    (hist ?? []).forEach((h: any) => {
      const key = `${(h.platform ?? "").toLowerCase()}|${(h.chatter_name ?? "").trim().toLowerCase()}`;
      if (!ownerOf.has(key) && h.user_id) ownerOf.set(key, h.user_id);
    });

    // letzte hourly-stats (kumulativer Stand bis Ende vorherige Stunde)
    const { data: prevStats, error: prevErr } = await supabase
      .from("chatter_hourly_stats")
      .select("user_id, platform, chatter_name, date, hour, revenue, mass_dms, unread_delta")
      .gte("date", since);
    if (prevErr) throw prevErr;

    // baue Lookup: kumulierter revenue/dms je chatter bis Ende prevHour
    type Cum = { revenue: number; mass_dms: number };
    const cumulativeBefore = new Map<string, Cum>();
    (prevStats ?? []).forEach((s: any) => {
      // nur heutige Stunden bis prevHour zählen für "kumulativ heute"
      if (s.date !== today) return;
      if (s.hour > prevHour && hour !== 0) return;
      const k = `${s.platform.toLowerCase()}|${s.chatter_name.trim().toLowerCase()}`;
      const c = cumulativeBefore.get(k) ?? { revenue: 0, mass_dms: 0 };
      c.revenue += Number(s.revenue) || 0;
      c.mass_dms += Number(s.mass_dms) || 0;
      cumulativeBefore.set(k, c);
    });

    let written = 0;
    for (const row of live ?? []) {
      const k = `${(row.platform ?? "").toLowerCase()}|${(row.chatter_name ?? "").trim().toLowerCase()}`;
      const userId = ownerOf.get(k);
      if (!userId) continue;
      const cum = cumulativeBefore.get(k) ?? { revenue: 0, mass_dms: 0 };
      const totalRev = Number(row.revenue) || 0;
      const totalDms = Number(row.mass_dms) || 0;
      const deltaRev = Math.max(0, totalRev - cum.revenue);
      const deltaDms = Math.max(0, totalDms - cum.mass_dms);

      // unread_delta als Snapshot des aktuellen Standes (kein echter Delta ohne Vorwert pro Stunde)
      const unreadNow = Number(row.unread_chats) || 0;

      const { error: upErr } = await supabase
        .from("chatter_hourly_stats")
        .upsert(
          {
            user_id: userId,
            platform: row.platform,
            chatter_name: row.chatter_name,
            date: today,
            hour: prevHour,
            revenue: deltaRev,
            mass_dms: deltaDms,
            unread_delta: unreadNow,
            updates_seen: 1,
          },
          { onConflict: "user_id,platform,chatter_name,date,hour" },
        );
      if (!upErr) written++;
    }

    return new Response(
      JSON.stringify({ ok: true, written, recordedHour: prevHour, date: prevDate }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("snapshot-hourly-stats error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
