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
    return s.trim().replace(/\s+/g, " ");
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
  for (const p of platforms) {
    const { data: hist } = await supabase
      .from("chatter_history")
      .select("chatter_name, analysis_date, user_id")
      .eq("platform", p)
      .order("analysis_date", { ascending: false })
      .limit(5000);
    for (const h of hist ?? []) {
      const name = (h as any).chatter_name as string | null;
      const uid = (h as any).user_id as string | null;
      if (!name) continue;
      const cleaned = cleanWs(name);
      const key = `${p.toLowerCase()}|${cleaned.toLowerCase()}`;
      if (!canonical.has(key)) canonical.set(key, cleaned);
      if (uid) {
        if (!ownerUsers.has(key)) ownerUsers.set(key, new Set());
        ownerUsers.get(key)!.add(uid);
      }
    }
  }

  const rows = rowsInput.map((r) => {
    if (!r || typeof r.chatter_name !== "string" || r.chatter_name.trim() === "") {
      throw new Error("chatter_name is required for each row");
    }
    const platform = r.platform ?? "Maloum";
    const cleaned = cleanWs(r.chatter_name);
    const lookupKey = `${platform.toLowerCase()}|${cleaned.toLowerCase()}`;
    const canonicalName = canonical.get(lookupKey) ?? titleCase(cleaned);
    return {
      platform,
      chatter_name: canonicalName,
      telegram_id: r.telegram_id ?? null,
      revenue: Number(r.revenue ?? 0),
      mass_dms: Number(r.mass_dms ?? 0),
      unread_chats: Number(r.unread_chats ?? 0),
      oldest_chat: r.oldest_chat ?? null,
      date: r.date ?? today,
      updated_at: new Date().toISOString(),
    };
  });

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
