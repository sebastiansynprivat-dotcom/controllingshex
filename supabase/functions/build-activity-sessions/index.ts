// Baut chatter_activity_sessions aus chatter_hourly_stats + chatter_history_live.
// Logik: Aufeinanderfolgende Stunden mit Aktivität (revenue>0 ∨ mass_dms>0 ∨ unread_delta≠0)
// werden zu einer Session zusammengefasst, sofern die Lücke ≤ SESSION_GAP_MIN beträgt.
// Idempotent über UNIQUE(user_id, platform, chatter_name, started_at).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SESSION_GAP_MIN_DEFAULT = 25;

interface HourlyRow {
  user_id: string;
  platform: string;
  chatter_name: string;
  date: string; // YYYY-MM-DD
  hour: number;
  revenue: number;
  mass_dms: number;
  unread_delta: number;
  updates_seen: number;
}

interface LiveRow {
  platform: string;
  chatter_name: string;
  date: string;
  updated_at: string;
}

function hourBucketStart(date: string, hour: number): Date {
  // hour bezeichnet UTC-Stunde (snapshot-hourly-stats nutzt UTC)
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let backfillDays = 1;
    try {
      const body = await req.json();
      if (body && typeof body.backfillDays === "number") {
        backfillDays = Math.max(1, Math.min(60, Math.floor(body.backfillDays)));
      }
    } catch { /* default */ }

    const now = new Date();
    const fromDate = new Date(now.getTime() - backfillDays * 24 * 3600 * 1000)
      .toISOString().slice(0, 10);

    const { data: hourly, error: hourlyErr } = await supabase
      .from("chatter_hourly_stats")
      .select("user_id, platform, chatter_name, date, hour, revenue, mass_dms, unread_delta, updates_seen")
      .gte("date", fromDate);
    if (hourlyErr) throw hourlyErr;

    const { data: live, error: liveErr } = await supabase
      .from("chatter_history_live")
      .select("platform, chatter_name, date, updated_at")
      .gte("date", fromDate);
    if (liveErr) throw liveErr;

    // Lookup: erster bekannter updated_at je (platform|name|date) für genauere Session-Starts
    const liveStartMap = new Map<string, string>();
    for (const l of (live ?? []) as LiveRow[]) {
      const key = `${l.platform.toLowerCase()}|${l.chatter_name.trim().toLowerCase()}|${l.date}`;
      const existing = liveStartMap.get(key);
      if (!existing || new Date(l.updated_at) < new Date(existing)) {
        liveStartMap.set(key, l.updated_at);
      }
    }

    // Gruppieren pro (user_id, platform, chatter_name)
    const groups = new Map<string, HourlyRow[]>();
    for (const r of (hourly ?? []) as HourlyRow[]) {
      const active = (Number(r.revenue) || 0) > 0
        || (Number(r.mass_dms) || 0) > 0
        || (Number(r.unread_delta) || 0) !== 0;
      if (!active) continue;
      const k = `${r.user_id}|${r.platform.toLowerCase()}|${r.chatter_name.trim().toLowerCase()}`;
      const arr = groups.get(k) ?? [];
      arr.push(r);
      groups.set(k, arr);
    }

    interface Session {
      user_id: string;
      platform: string;
      chatter_name: string;
      date: string;
      started_at: string;
      ended_at: string;
      duration_min: number;
      revenue_in_session: number;
      mass_dms_in_session: number;
      incoming_proxy: number;
      first_response_min: number | null;
    }
    const sessions: Session[] = [];
    const gapMs = SESSION_GAP_MIN_DEFAULT * 60 * 1000;

    for (const [, rows] of groups) {
      rows.sort((a, b) => {
        const da = hourBucketStart(a.date, a.hour).getTime();
        const db = hourBucketStart(b.date, b.hour).getTime();
        return da - db;
      });

      let cur: Session | null = null;
      let curLastBucketEnd = 0;

      const flush = () => {
        if (!cur) return;
        cur.duration_min = Math.max(
          0,
          Math.round((new Date(cur.ended_at).getTime() - new Date(cur.started_at).getTime()) / 60000),
        );
        sessions.push(cur);
        cur = null;
      };

      for (const r of rows) {
        const bucketStart = hourBucketStart(r.date, r.hour);
        const bucketEnd = new Date(bucketStart.getTime() + 60 * 60 * 1000);
        const incoming =
          Math.max(0, Number(r.unread_delta) || 0) +
          Math.max(0, -(Number(r.unread_delta) || 0)) +
          (Number(r.mass_dms) || 0);

        if (cur && bucketStart.getTime() - curLastBucketEnd <= gapMs) {
          // gleiche Session
          cur.ended_at = bucketEnd.toISOString();
          cur.revenue_in_session += Number(r.revenue) || 0;
          cur.mass_dms_in_session += Number(r.mass_dms) || 0;
          cur.incoming_proxy += incoming;
        } else {
          flush();
          // genauerer Session-Start aus chatter_history_live, falls vorhanden und in der Stunde
          const liveKey = `${r.platform.toLowerCase()}|${r.chatter_name.trim().toLowerCase()}|${r.date}`;
          const liveTs = liveStartMap.get(liveKey);
          let started = bucketStart.toISOString();
          if (liveTs) {
            const t = new Date(liveTs);
            if (t >= bucketStart && t < bucketEnd) started = t.toISOString();
          }
          cur = {
            user_id: r.user_id,
            platform: r.platform,
            chatter_name: r.chatter_name,
            date: r.date,
            started_at: started,
            ended_at: bucketEnd.toISOString(),
            duration_min: 0,
            revenue_in_session: Number(r.revenue) || 0,
            mass_dms_in_session: Number(r.mass_dms) || 0,
            incoming_proxy: incoming,
            first_response_min: (Number(r.revenue) || 0) > 0 || (Number(r.mass_dms) || 0) > 0 ? 30 : null,
          };
        }
        curLastBucketEnd = bucketEnd.getTime();
      }
      flush();
    }

    // Upsert in Chunks
    let written = 0;
    const chunkSize = 500;
    for (let i = 0; i < sessions.length; i += chunkSize) {
      const chunk = sessions.slice(i, i + chunkSize);
      const { error } = await supabase
        .from("chatter_activity_sessions")
        .upsert(chunk, { onConflict: "user_id,platform,chatter_name,started_at" });
      if (error) throw error;
      written += chunk.length;
    }

    return new Response(
      JSON.stringify({ ok: true, sessions: written, fromDate, backfillDays }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("build-activity-sessions error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
