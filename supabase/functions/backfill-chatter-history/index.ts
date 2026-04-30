// Auto-Backfill: Füllt fehlende chatter_history-Zeilen aus analysis_reports.result_json nach.
// - Läuft als Cron täglich (siehe pg_cron) UND kann manuell aufgerufen werden.
// - Iteriert über alle Reports der letzten N Tage und upsertet je Chatter eine Tageszeile.
// - Idempotent dank UNIQUE (chatter_name, account, platform, analysis_date).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function num(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[^0-9.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

function int(v: any): number {
  return Math.round(num(v));
}

function pickName(c: any): string | null {
  return c?.chatter_name ?? c?.name ?? c?.chatter ?? null;
}

function pickAccount(c: any): string {
  return c?.account ?? c?.model ?? c?.model_name ?? "";
}

function extractChatters(result: any): any[] {
  if (!result) return [];
  if (Array.isArray(result?.chatters)) return result.chatters;
  if (Array.isArray(result?.results)) return result.results;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result)) return result;
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const body = await req.json().catch(() => ({}));
  const days = Math.max(1, Math.min(90, Number(body.days ?? 14)));
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);
  const sinceIso = sinceDate.toISOString().split("T")[0];

  try {
    const { data: reports, error: repErr } = await admin
      .from("analysis_reports")
      .select("id, user_id, platform, analysis_date, result_json")
      .gte("analysis_date", sinceIso);

    if (repErr) throw repErr;

    let inserted = 0;
    let skipped = 0;
    const perReport: any[] = [];

    for (const r of reports ?? []) {
      if (!r.user_id || !r.result_json) { skipped++; continue; }
      const chatters = extractChatters(r.result_json);
      if (chatters.length === 0) { skipped++; continue; }

      const rows = chatters
        .map((c: any) => {
          const name = pickName(c);
          if (!name) return null;
          return {
            user_id: r.user_id,
            platform: r.platform,
            analysis_date: r.analysis_date,
            chatter_name: String(name),
            account: String(pickAccount(c) ?? ""),
            revenue_today: num(c.revenue_today ?? c.revenue ?? c.umsatz ?? 0),
            mass_dms: int(c.mass_dms ?? c.massdms ?? c.mass_dm ?? 0),
            open_chats: int(c.open_chats ?? c.offene_chats ?? c.openchats ?? 0),
            response_delay_days: int(c.response_delay_days ?? c.verzug ?? c.delay_days ?? 0),
            category: c.category ?? null,
            recommendation: c.recommendation ?? null,
          };
        })
        .filter(Boolean);

      if (rows.length === 0) { skipped++; continue; }

      const { error: upErr, count } = await admin
        .from("chatter_history")
        .upsert(rows as any, {
          onConflict: "chatter_name,account,platform,analysis_date",
          ignoreDuplicates: false,
          count: "exact",
        });

      if (upErr) {
        perReport.push({ report_id: r.id, error: upErr.message });
      } else {
        inserted += rows.length;
        perReport.push({ report_id: r.id, date: r.analysis_date, rows: rows.length, count });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, reports: reports?.length ?? 0, upserted_rows: inserted, skipped, since: sinceIso, perReport }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[backfill-chatter-history] error:", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
