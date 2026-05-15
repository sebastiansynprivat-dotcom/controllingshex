// Stündlicher Snapshot: schreibt für die *vergangene* Stunde pro Chatter
// genau einen Datensatz mit dem Stunden-Delta (Zuwachs gegenüber dem
// Tagesstand am Anfang dieser Stunde).
//
// Quelle: chatter_history_live (kumulatives Tagestotal pro Chatter)
// Ziel:   chatter_hourly_stats (Stunden-Delta pro Chatter)
//
// Wichtig:
// - Es gibt keinen DB-Trigger mehr; diese Function ist die einzige Quelle.
// - prevStats wird paginiert geladen (kein 1000er-Limit).
// - Beim 00-Uhr-Lauf wird Stunde 23 dem Vortag zugeordnet.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PAGE = 1000;

async function fetchAll<T>(
  qb: () => any, // eslint-disable-line
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await qb().range(from, from + PAGE - 1);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const hour = now.getUTCHours();
    const isMidnight = hour === 0;
    // Wir buchen die *vorherige* Stunde
    const recordedHour = isMidnight ? 23 : hour - 1;
    const recordedDate = isMidnight
      ? new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10)
      : todayIso;

    // 1) Live-Stand der laufenden Datums-Periode laden
    //    Bei 00-Uhr-Lauf brauchen wir den Tagesabschluss von gestern.
    const liveDate = recordedDate;
    const live = await fetchAll<any>(() =>
      supabase
        .from("chatter_history_live")
        .select("platform, chatter_name, revenue, mass_dms, unread_chats, date")
        .eq("date", liveDate),
    );

    // 2) user_id-Mapping aus chatter_history (letzte 30 Tage reichen)
    const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const hist = await fetchAll<any>(() =>
      supabase
        .from("chatter_history")
        .select("user_id, platform, chatter_name")
        .gte("analysis_date", since)
        .not("user_id", "is", null),
    );
    const ownerOf = new Map<string, string>();
    for (const h of hist) {
      const key = `${(h.platform ?? "").toLowerCase()}|${(h.chatter_name ?? "").trim().toLowerCase()}`;
      if (!ownerOf.has(key) && h.user_id) ownerOf.set(key, h.user_id);
    }

    // 3) Bisherige Stunden-Deltas DIESES Tages bis (recordedHour - 1) laden
    //    → daraus bauen wir das, was bis Stundenanfang schon erfasst ist.
    type Cum = { revenue: number; mass_dms: number };
    const cumulativeBefore = new Map<string, Cum>();
    if (recordedHour > 0) {
      const prevStats = await fetchAll<any>(() =>
        supabase
          .from("chatter_hourly_stats")
          .select("platform, chatter_name, revenue, mass_dms, hour")
          .eq("date", recordedDate)
          .lt("hour", recordedHour),
      );
      for (const s of prevStats) {
        const k = `${(s.platform ?? "").toLowerCase()}|${(s.chatter_name ?? "").trim().toLowerCase()}`;
        const c = cumulativeBefore.get(k) ?? { revenue: 0, mass_dms: 0 };
        c.revenue += Number(s.revenue) || 0;
        c.mass_dms += Number(s.mass_dms) || 0;
        cumulativeBefore.set(k, c);
      }
    }

    // 4) Pro Chatter Delta berechnen und schreiben (Batch-Upsert)
    const upserts: any[] = [];
    let skipped = 0;
    for (const row of live) {
      const k = `${(row.platform ?? "").toLowerCase()}|${(row.chatter_name ?? "").trim().toLowerCase()}`;
      const userId = ownerOf.get(k);
      if (!userId) { skipped++; continue; }

      const cum = cumulativeBefore.get(k) ?? { revenue: 0, mass_dms: 0 };
      const totalRev = Number(row.revenue) || 0;
      const totalDms = Number(row.mass_dms) || 0;
      const deltaRev = Math.max(0, totalRev - cum.revenue);
      const deltaDms = Math.max(0, totalDms - cum.mass_dms);
      const unreadNow = Number(row.unread_chats) || 0;

      // Nur schreiben wenn etwas Sinnvolles passiert ist — sonst keinen Eintrag,
      // damit "0-Stunden" nicht als Aktivität gelten.
      if (deltaRev <= 0 && deltaDms <= 0) continue;

      upserts.push({
        user_id: userId,
        platform: row.platform,
        chatter_name: row.chatter_name,
        date: recordedDate,
        hour: recordedHour,
        revenue: deltaRev,
        mass_dms: deltaDms,
        unread_delta: unreadNow,
        updates_seen: 1,
      });
    }

    let written = 0;
    // In Chunks upserten
    for (let i = 0; i < upserts.length; i += 500) {
      const chunk = upserts.slice(i, i + 500);
      const { error } = await supabase
        .from("chatter_hourly_stats")
        .upsert(chunk, { onConflict: "user_id,platform,chatter_name,date,hour" });
      if (error) throw error;
      written += chunk.length;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        recordedDate,
        recordedHour,
        live_rows: live.length,
        skipped_no_user: skipped,
        written,
      }),
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
