import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);

  // Auth: entweder API-Key ODER eingeloggter User (Bearer-Token aus der App)
  const secrets = [
    Deno.env.get("LIVE_STATUS_KEY"),
    Deno.env.get("LIVE_HISTORY_SECRET"),
  ].filter(Boolean) as string[];
  const provided =
    req.headers.get("x-api-key")?.trim() ||
    url.searchParams.get("key")?.trim() ||
    "";
  let authorized = provided !== "" && secrets.includes(provided);

  if (!authorized) {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const authClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { auth: { persistSession: false } },
      );
      const { data, error } = await authClient.auth.getUser(token);
      if (!error && data?.user?.id) authorized = true;
    }
  }

  if (!authorized) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));

  const pick = (k: string) =>
    (body[k] as string | number | undefined) ?? url.searchParams.get(k) ?? undefined;

  const platform = String(pick("platform") ?? "").trim();
  if (!platform) return json({ error: "platform required" }, 400);

  const chatterName = pick("chatter_name") ? String(pick("chatter_name")) : null;
  const minDelay = pick("min_delay_days") != null ? Number(pick("min_delay_days")) : null;
  const sort = String(pick("sort") ?? "delay");
  const limit = Math.min(Number(pick("limit") ?? 40) || 40, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let q = supabase
    .from("chatter_history_live")
    .select(
      "chatter_name,platform,unread_chats,oldest_chat,revenue,mass_dms,date,stats_details,revenue_details,updated_at",
    )
    .ilike("platform", platform);

  if (chatterName) q = q.ilike("chatter_name", `%${chatterName}%`);
  if (minDelay != null && Number.isFinite(minDelay)) q = q.gte("oldest_chat", minDelay);

  const col =
    sort === "unread" ? "unread_chats" : sort === "revenue" ? "revenue" : "oldest_chat";

  const { data, error } = await q
    .order(col, { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) return json({ error: error.message }, 500);

  return json({ platform, count: data?.length ?? 0, rows: data ?? [] });
});
