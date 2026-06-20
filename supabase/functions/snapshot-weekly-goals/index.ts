// snapshot-weekly-goals
// Läuft jeden Montag (per pg_cron) und schreibt für JEDE Plattform/User/Chatter,
// die ein Wochenziel für die abgelaufene Woche hatten, einen Eintrag in
// weekly_goal_results (Ziel, Ist-Umsatz, erreicht ja/nein, Datum).
//
// Idempotent: UNIQUE (user_id, platform, chatter_name, week_key) + UPSERT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// --- ISO Wochen-Helfer ---
function isoWeekday(d: Date): number {
  const x = d.getUTCDay();
  return x === 0 ? 7 : x;
}
function weekStartUtc(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - (isoWeekday(x) - 1));
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function isoWeekNumber(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function parseTargetWeek(text: string | null): { week: number; year: number } | null {
  if (!text) return null;
  const m = text.match(/Wochenziel\s+KW\s+(\d{1,2})\s+(\d{4})/i);
  if (!m) return null;
  return { week: parseInt(m[1], 10), year: parseInt(m[2], 10) };
}
function parseGoalFromNote(text: string | null): number | null {
  if (!text) return null;
  const colon = text.lastIndexOf(":");
  const hay = colon >= 0 ? text.slice(colon + 1) : text;
  const m = hay.match(/-?\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  let raw = m[0];
  if (raw.includes(",")) raw = raw.replace(/[.\s]/g, "").replace(",", ".");
  else {
    const parts = raw.split(".");
    if (parts.length > 1 && parts.slice(1).every((p) => /^\d{3}$/.test(p))) raw = parts.join("");
    raw = raw.replace(/\s/g, "");
  }
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // Vorwoche bestimmen (Mo-So)
    const now = new Date();
    const thisWeekStart = weekStartUtc(now);
    const prevWeekStart = addDays(thisWeekStart, -7);
    const prevWeekEnd = addDays(prevWeekStart, 6);
    const prevWeek = isoWeekNumber(prevWeekStart);
    const weekKey = `${prevWeek.year}-W${String(prevWeek.week).padStart(2, "0")}`;

    // Alle Wochenziel-Notes laden (inkl. user_id)
    const { data: notes, error: nErr } = await supabase
      .from("coaching_notes")
      .select("user_id, platform, chatter_name, note_text, created_at")
      .ilike("note_text", "Wochenziel%")
      .order("created_at", { ascending: false });
    if (nErr) throw nErr;

    // Pro (user, platform, chatter) nimm die jüngste Note, die exakt auf prevWeek zeigt
    type Key = string;
    const goals = new Map<Key, { user_id: string; platform: string; chatter: string; goal: number }>();
    for (const n of notes ?? []) {
      const target = parseTargetWeek(n.note_text);
      if (!target || target.week !== prevWeek.week || target.year !== prevWeek.year) continue;
      const k = `${n.user_id}|${n.platform}|${n.chatter_name}`;
      if (goals.has(k)) continue;
      const g = parseGoalFromNote(n.note_text);
      if (g == null) continue;
      goals.set(k, { user_id: n.user_id, platform: n.platform, chatter: n.chatter_name, goal: g });
    }

    if (goals.size === 0) {
      return new Response(
        JSON.stringify({ ok: true, weekKey, processed: 0, message: "Keine passenden Wochenziele für die Vorwoche." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // History für genau diese Woche holen, gruppiert nach (user, platform, chatter)
    const fromIso = isoDate(prevWeekStart);
    const toIso = isoDate(prevWeekEnd);

    // Eindeutige Chatter-Liste pro user+platform, damit wir gezielt abfragen
    const byUserPlatform = new Map<string, { user_id: string; platform: string; chatters: Set<string> }>();
    for (const v of goals.values()) {
      const k = `${v.user_id}|${v.platform}`;
      if (!byUserPlatform.has(k)) {
        byUserPlatform.set(k, { user_id: v.user_id, platform: v.platform, chatters: new Set() });
      }
      byUserPlatform.get(k)!.chatters.add(v.chatter);
    }

    const revenueByKey = new Map<string, number>(); // user|platform|chatter -> sum
    const seenRow = new Set<string>(); // dedup: user|platform|chatter|date|account → MAX

    for (const grp of byUserPlatform.values()) {
      const chatters = Array.from(grp.chatters);
      // Pagination
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data: rows, error } = await supabase
          .from("chatter_history")
          .select("chatter_name, revenue_today, analysis_date, account")
          .eq("user_id", grp.user_id)
          .eq("platform", grp.platform)
          .in("chatter_name", chatters)
          .gte("analysis_date", fromIso)
          .lte("analysis_date", toIso)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const chunk = rows ?? [];
        // Dedup pro (chatter,date,account) auf MAX revenue_today
        const maxByRow = new Map<string, number>();
        for (const r of chunk) {
          const rk = `${grp.user_id}|${grp.platform}|${r.chatter_name}|${r.analysis_date}|${(r.account ?? "").trim()}`;
          const v = Number(r.revenue_today ?? 0);
          const prev = maxByRow.get(rk) ?? 0;
          if (v > prev) maxByRow.set(rk, v);
        }
        for (const [rk, v] of maxByRow) {
          if (seenRow.has(rk)) continue;
          seenRow.add(rk);
          const parts = rk.split("|");
          const ck = `${parts[0]}|${parts[1]}|${parts[2]}`;
          revenueByKey.set(ck, (revenueByKey.get(ck) ?? 0) + v);
        }
        if (chunk.length < pageSize) break;
        from += pageSize;
      }
    }

    // Upsert Ergebnisse
    const records = Array.from(goals.values()).map((v) => {
      const ck = `${v.user_id}|${v.platform}|${v.chatter}`;
      const actual = Math.round((revenueByKey.get(ck) ?? 0) * 100) / 100;
      return {
        user_id: v.user_id,
        platform: v.platform,
        chatter_name: v.chatter,
        week_key: weekKey,
        week_start: fromIso,
        week_end: toIso,
        goal_eur: v.goal,
        actual_eur: actual,
        achieved: actual >= v.goal,
        source: "auto",
      };
    });

    const { error: upErr } = await supabase
      .from("weekly_goal_results")
      .upsert(records, { onConflict: "user_id,platform,chatter_name,week_key" });
    if (upErr) throw upErr;

    return new Response(
      JSON.stringify({ ok: true, weekKey, processed: records.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[snapshot-weekly-goals]", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
