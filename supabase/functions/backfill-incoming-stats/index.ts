import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface HourlyRow {
  user_id: string;
  platform: string;
  chatter_name: string;
  date: string;
  hour: number;
  revenue: number;
  unread_delta: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Auth: require caller to be an authenticated user (any signed-in user of the app)
  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const requesterId = userData.user.id;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const scopeAll = url.searchParams.get("scope") === "all";

  let query = supabase
    .from("chatter_hourly_stats")
    .select("user_id, platform, chatter_name, date, hour, revenue, unread_delta")
    .order("date", { ascending: true })
    .order("hour", { ascending: true });

  if (!scopeAll) query = query.eq("user_id", requesterId);
  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);

  // Page through
  const pageSize = 1000;
  let offset = 0;
  const rows: HourlyRow[] = [];
  while (true) {
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as HourlyRow[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  // Group by (user_id, platform, chatter_name, date)
  type Agg = {
    user_id: string;
    platform: string;
    chatter_name: string;
    date: string;
    reads: number;         // Sum of unread drops per hour (messages the chatter cleared)
    unreadCumulative: number; // Sum of unread_delta across the day → proxy for EOD unread
    lastRevenue: number;
  };
  const aggMap = new Map<string, Agg>();
  for (const r of rows) {
    const key = `${r.user_id}|${r.platform}|${r.chatter_name}|${r.date}`;
    let a = aggMap.get(key);
    if (!a) {
      a = {
        user_id: r.user_id,
        platform: r.platform,
        chatter_name: r.chatter_name,
        date: r.date,
        reads: 0,
        unreadCumulative: 0,
        lastRevenue: 0,
      };
      aggMap.set(key, a);
    }
    const delta = Number(r.unread_delta ?? 0);
    // Reads (messages the chatter processed) contribute to arrivals — they had to arrive first
    a.reads += Math.max(0, -delta);
    // Net movement of unread queue across the day
    a.unreadCumulative += delta;
    a.lastRevenue += Number(r.revenue ?? 0);
  }

  const upserts = Array.from(aggMap.values()).map((a) => ({
    user_id: a.user_id,
    platform: a.platform,
    chatter_name: a.chatter_name,
    date: a.date,
    // reads_count only; UI adds last_unread on top to get total arrivals
    incoming_count: a.reads,
    last_unread: Math.max(0, a.unreadCumulative),
    last_revenue: a.lastRevenue,
    updated_at: new Date().toISOString(),
  }));

  let written = 0;
  const batchSize = 500;
  for (let i = 0; i < upserts.length; i += batchSize) {
    const batch = upserts.slice(i, i + batchSize);
    const { error } = await supabase
      .from("chatter_incoming_stats")
      .upsert(batch, { onConflict: "user_id,platform,chatter_name,date" });
    if (error) {
      return new Response(
        JSON.stringify({ error: error.message, written }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    written += batch.length;
  }

  return new Response(
    JSON.stringify({ success: true, written, hourlyRows: rows.length }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
