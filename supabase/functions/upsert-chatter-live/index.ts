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

type StoredLiveRow = Required<Pick<LiveRow, "platform" | "chatter_name" | "date">> & {
  revenue: number;
  mass_dms: number;
  unread_chats: number;
};

function rowKey(row: Pick<LiveRow, "platform" | "chatter_name" | "date">) {
  return `${row.date}|${(row.platform ?? "Maloum").toLowerCase()}|${row.chatter_name.trim().toLowerCase()}`;
}

function ownerKey(platform: string, chatterName: string) {
  return `${platform.toLowerCase()}|${chatterName.trim().toLowerCase()}`;
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
  const rows = rowsInput.map((r) => {
    if (!r || typeof r.chatter_name !== "string" || r.chatter_name.trim() === "") {
      throw new Error("chatter_name is required for each row");
    }
    return {
      platform: r.platform ?? "Maloum",
      chatter_name: r.chatter_name,
      telegram_id: r.telegram_id ?? null,
      revenue: Number(r.revenue ?? 0),
      mass_dms: Number(r.mass_dms ?? 0),
      unread_chats: Number(r.unread_chats ?? 0),
      oldest_chat: r.oldest_chat ?? null,
      date: r.date ?? today,
      updated_at: new Date().toISOString(),
    };
  });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const dates = [...new Set(rows.map((r) => r.date))];
  const platforms = [...new Set(rows.map((r) => r.platform))];
  const { data: previousRows, error: previousErr } = await supabase
    .from("chatter_history_live")
    .select("platform,chatter_name,date,revenue,mass_dms,unread_chats")
    .in("date", dates)
    .in("platform", platforms);

  if (previousErr) {
    return new Response(JSON.stringify({ error: previousErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const previousByKey = new Map<string, StoredLiveRow>();
  (previousRows ?? []).forEach((r: any) => {
    previousByKey.set(rowKey(r), {
      platform: r.platform,
      chatter_name: r.chatter_name,
      date: r.date,
      revenue: Number(r.revenue) || 0,
      mass_dms: Number(r.mass_dms) || 0,
      unread_chats: Number(r.unread_chats) || 0,
    });
  });

  const { data, error } = await supabase
    .from("chatter_history_live")
    .upsert(rows, { onConflict: "platform,chatter_name,date" })
    .select();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const activeRows = rows
    .map((row) => {
      const prev = previousByKey.get(rowKey(row));
      if (!prev) return null;
      const revenueDelta = Math.max(0, (Number(row.revenue) || 0) - prev.revenue);
      const massDmsDelta = Math.max(0, (Number(row.mass_dms) || 0) - prev.mass_dms);
      const unreadDelta = (Number(row.unread_chats) || 0) - prev.unread_chats;
      if (revenueDelta <= 0 && massDmsDelta <= 0 && unreadDelta >= 0) return null;
      return { row, revenueDelta, massDmsDelta, unreadDelta };
    })
    .filter(Boolean) as Array<{
      row: typeof rows[number];
      revenueDelta: number;
      massDmsDelta: number;
      unreadDelta: number;
    }>;

  let activityWritten = 0;
  if (activeRows.length > 0) {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const chatterNames = [...new Set(activeRows.map(({ row }) => row.chatter_name))];
    const { data: owners } = await supabase
      .from("chatter_history")
      .select("user_id, platform, chatter_name, analysis_date")
      .gte("analysis_date", since)
      .in("chatter_name", chatterNames)
      .order("analysis_date", { ascending: false });

    const ownerOf = new Map<string, string>();
    (owners ?? []).forEach((h: any) => {
      const key = ownerKey(h.platform ?? "Maloum", h.chatter_name ?? "");
      if (!ownerOf.has(key) && h.user_id) ownerOf.set(key, h.user_id);
    });

    const now = new Date();
    const statDate = now.toISOString().slice(0, 10);
    const statHour = now.getUTCHours();

    for (const activity of activeRows) {
      const userId = ownerOf.get(ownerKey(activity.row.platform, activity.row.chatter_name));
      if (!userId) continue;

      const { data: existingStat } = await supabase
        .from("chatter_hourly_stats")
        .select("id,revenue,mass_dms,unread_delta,updates_seen")
        .eq("user_id", userId)
        .eq("platform", activity.row.platform)
        .eq("chatter_name", activity.row.chatter_name)
        .eq("date", statDate)
        .eq("hour", statHour)
        .maybeSingle();

      const nextStat = {
        user_id: userId,
        platform: activity.row.platform,
        chatter_name: activity.row.chatter_name,
        date: statDate,
        hour: statHour,
        revenue: (Number((existingStat as any)?.revenue) || 0) + activity.revenueDelta,
        mass_dms: (Number((existingStat as any)?.mass_dms) || 0) + activity.massDmsDelta,
        unread_delta: (Number((existingStat as any)?.unread_delta) || 0) + activity.unreadDelta,
        updates_seen: (Number((existingStat as any)?.updates_seen) || 0) + 1,
        updated_at: now.toISOString(),
      };

      const write = existingStat
        ? supabase.from("chatter_hourly_stats").update(nextStat).eq("id", (existingStat as any).id)
        : supabase.from("chatter_hourly_stats").insert(nextStat);
      const { error: statErr } = await write;
      if (!statErr) activityWritten++;
    }

    if (activityWritten > 0) {
      await supabase.rpc("recompute_live_now");
    }
  }

  return new Response(JSON.stringify({ success: true, count: data?.length ?? 0, activityWritten, rows: data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
