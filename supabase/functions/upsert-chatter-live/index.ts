import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-live-history-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LiveRow {
  platform?: string;
  chatter_name: string;
  telegram_id?: string | null;
  revenue?: number;
  mass_dms?: number;
  unread_chats?: number;
  oldest_chat?: number | null;
  date?: string; // YYYY-MM-DD
}

function badRequest(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return badRequest("Method not allowed", 405);
  }

  const expected = Deno.env.get("LIVE_HISTORY_SECRET");
  if (!expected) {
    return badRequest("Server misconfigured: missing LIVE_HISTORY_SECRET", 500);
  }

  const provided =
    req.headers.get("x-live-history-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!provided || provided !== expected) {
    return badRequest("Unauthorized", 401);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const rowsInput: LiveRow[] = Array.isArray(payload)
    ? (payload as LiveRow[])
    : Array.isArray((payload as { rows?: LiveRow[] })?.rows)
    ? (payload as { rows: LiveRow[] }).rows
    : [payload as LiveRow];

  if (rowsInput.length === 0) {
    return badRequest("No rows provided");
  }

  const today = new Date().toISOString().slice(0, 10);

  function cleanWs(s: string): string {
    return s
      .normalize("NFKC")
      .replace(/[\uFE00-\uFE0F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, "")
      .replace(/[\u00A0\u2007\u202F]/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }
  function rosterKey(s: string): string {
    return cleanWs(s).toLowerCase().replace(/[_\s]+/g, " ").trim();
  }
  function titleCase(s: string): string {
    return cleanWs(s)
      .toLowerCase()
      .split(" ")
      .map((part) =>
        part
          .split("-")
          .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
          .join("-"),
      )
      .join(" ");
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Build canonical-name lookup from chatter_history per platform.
  const platforms = Array.from(
    new Set(rowsInput.map((r) => (r?.platform ?? "Maloum"))),
  );
  const canonical = new Map<string, string>(); // key: `${platformLower}|${nameLower}` → canonical name
  const ownerUsers = new Map<string, Set<string>>(); // key: `${platformLower}|${canonicalLower}` → Set<user_id>
  const activeRoster = new Map<string, Set<string>>(); // platformLower → current report roster keys
  for (const p of platforms) {
    const [{ data: hist }, { data: reports }] = await Promise.all([
      supabase
        .from("chatter_history")
        .select("chatter_name, analysis_date, user_id")
        .eq("platform", p)
        .order("analysis_date", { ascending: false })
        .limit(5000),
      supabase
        .from("analysis_reports")
        .select("result_json")
        .eq("platform", p)
        .not("result_json", "is", null)
        .order("analysis_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    const platformKey = p.toLowerCase();
    const roster = new Set<string>();
    const latestResult = (reports?.[0] as any)?.result_json;
    for (const cat of latestResult?.categories ?? []) {
      for (const ch of cat?.chatters ?? []) {
        const name = typeof ch?.name === "string" ? ch.name : "";
        const key = rosterKey(name);
        if (key) roster.add(key);
      }
    }
    if (roster.size > 0) activeRoster.set(platformKey, roster);

    for (const h of hist ?? []) {
      const name = (h as any).chatter_name as string | null;
      const uid = (h as any).user_id as string | null;
      if (!name) continue;
      const cleaned = cleanWs(name);
      const nameKey = rosterKey(cleaned);
      if (roster.size > 0 && !roster.has(nameKey)) continue;
      const key = `${platformKey}|${nameKey}`;
      if (!canonical.has(key)) canonical.set(key, cleaned);
      if (uid) {
        if (!ownerUsers.has(key)) ownerUsers.set(key, new Set());
        ownerUsers.get(key)!.add(uid);
      }
    }
  }

  const rows = rowsInput.flatMap((r) => {
    if (!r || typeof r.chatter_name !== "string" || r.chatter_name.trim() === "") {
      throw new Error("chatter_name is required for each row");
    }
    const platform = r.platform ?? "Maloum";
    const cleaned = cleanWs(r.chatter_name);
    const platformKey = platform.toLowerCase();
    const inputKey = rosterKey(cleaned);
    const roster = activeRoster.get(platformKey);
    if (roster && !roster.has(inputKey)) return [];
    const lookupKey = `${platformKey}|${inputKey}`;
    const canonicalName = canonical.get(lookupKey) ?? titleCase(cleaned);
    if (roster && !roster.has(rosterKey(canonicalName))) return [];
    return [{
      platform,
      chatter_name: canonicalName,
      telegram_id: r.telegram_id ?? null,
      revenue: Number(r.revenue ?? 0),
      mass_dms: Number(r.mass_dms ?? 0),
      unread_chats: Number(r.unread_chats ?? 0),
      oldest_chat: r.oldest_chat ?? null,
      date: r.date ?? today,
      updated_at: new Date().toISOString(),
    }];
  });

  if (rows.length === 0) {
    return new Response(JSON.stringify({ success: true, count: 0, rows: [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Read prior live snapshots for delta computation (before upsert overwrites them)
  const priorKeyOf = (r: { platform: string; telegram_id: string | null; date: string }) =>
    `${r.platform}|${r.telegram_id ?? ""}|${r.date}`;
  const priorMap = new Map<string, { unread: number; revenue: number }>();
  const priorFilters = rows.filter((r) => r.telegram_id);
  if (priorFilters.length > 0) {
    const orExpr = priorFilters
      .map(
        (r) =>
          `and(platform.eq.${r.platform},telegram_id.eq.${r.telegram_id},date.eq.${r.date})`,
      )
      .join(",");
    const { data: priors } = await supabase
      .from("chatter_history_live")
      .select("platform,telegram_id,date,unread_chats,revenue")
      .or(orExpr);
    for (const p of priors ?? []) {
      priorMap.set(priorKeyOf(p as any), {
        unread: Number((p as any).unread_chats ?? 0),
        revenue: Number((p as any).revenue ?? 0),
      });
    }
  }

  const { data, error } = await supabase
    .from("chatter_history_live")
    .upsert(rows, { onConflict: "platform,telegram_id,date" })
    .select();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Increment incoming_stats per row/user (fire-and-collect)
  for (const r of rows) {
    const prior = priorMap.get(priorKeyOf(r as any));
    const priorUnread = prior?.unread ?? Number(r.unread_chats ?? 0);
    const priorRevenue = prior?.revenue ?? Number(r.revenue ?? 0);
    const unreadDrop = Math.max(0, priorUnread - Number(r.unread_chats ?? 0));
    const revenueEvent = Number(r.revenue ?? 0) > priorRevenue ? 1 : 0;
    const delta = unreadDrop + revenueEvent;
    if (delta <= 0) continue;
    const key = `${r.platform.toLowerCase()}|${r.chatter_name.toLowerCase()}`;
    const uids = ownerUsers.get(key);
    if (!uids || uids.size === 0) continue;
    for (const uid of uids) {
      const { error: rpcErr } = await supabase.rpc("increment_incoming_stats", {
        p_user_id: uid,
        p_platform: r.platform,
        p_chatter_name: r.chatter_name,
        p_date: r.date,
        p_delta: delta,
        p_last_unread: Number(r.unread_chats ?? 0),
        p_last_revenue: Number(r.revenue ?? 0),
      });
      if (rpcErr) console.error("increment_incoming_stats failed:", rpcErr.message);
    }
  }

  await supabase.rpc("recompute_live_now");

  // Fire-and-forget hot-streak check (don't block response)
  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/hot-streak-check`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ rows }),
    }).catch((e) => console.error("hot-streak-check call failed:", e));
  } catch (e) {
    console.error("hot-streak-check dispatch error:", e);
  }

  return new Response(JSON.stringify({ success: true, count: data?.length ?? 0, rows: data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
