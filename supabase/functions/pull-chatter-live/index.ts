import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SOURCE_URL =
  "https://acznyhzgbkdcmnbqvptt.supabase.co/functions/v1/update-controlling";

interface AmountEntry {
  purchase_id?: string;
  amount?: number;
  time?: string;
  type?: string;
  customer?: string;
  [k: string]: unknown;
}

interface ModelStats {
  amounts?: AmountEntry[];
  total?: number;
  mass_dms?: number;
  unread_chats?: number;
  oldest_chat?: number;
}

interface ChatterPayload {
  chatter_name: string;
  telegram_id?: string | null;
  date?: string;
  platforms?: Record<string, Record<string, ModelStats>>;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("CONTROLLING_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "CONTROLLING_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(SOURCE_URL, {
      method: "GET",
      headers: { "x-api-key": apiKey, Accept: "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Upstream fetch failed", details: String(e) }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!upstream.ok) {
    const body = await upstream.text();
    console.error(`Upstream [${upstream.status}]: ${body}`);
    return new Response(
      JSON.stringify({ error: "Upstream error", status: upstream.status, details: body }),
      { status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Invalid upstream JSON", details: String(e) }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const chatters: ChatterPayload[] = Array.isArray(payload)
    ? (payload as ChatterPayload[])
    : [];

  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const rows: Array<Record<string, unknown>> = [];

  for (const c of chatters) {
    if (!c || typeof c.chatter_name !== "string" || !c.chatter_name.trim()) continue;
    const platforms = c.platforms ?? {};
    const platformKeys = Object.keys(platforms);
    if (platformKeys.length === 0) continue;

    for (const pKey of platformKeys) {
      const models = platforms[pKey] ?? {};
      const modelEntries = Object.entries(models);
      if (modelEntries.length === 0) continue;

      let revenue = 0;
      let mass_dms = 0;
      let unread_chats = 0;
      let oldest_chat = 0;
      const revenue_details: Record<string, AmountEntry[]> = {};
      const stats_details: Record<
        string,
        { mass_dms: number; unread_chats: number; oldest_chat: number }
      > = {};

      for (const [modelName, s] of modelEntries) {
        revenue += num(s?.total);
        mass_dms += num(s?.mass_dms);
        unread_chats += num(s?.unread_chats);
        const oc = num(s?.oldest_chat);
        if (oc > oldest_chat) oldest_chat = oc;
        revenue_details[modelName] = Array.isArray(s?.amounts) ? s!.amounts! : [];
        stats_details[modelName] = {
          mass_dms: num(s?.mass_dms),
          unread_chats: num(s?.unread_chats),
          oldest_chat: num(s?.oldest_chat),
        };
      }

      rows.push({
        platform: capitalize(pKey),
        chatter_name: c.chatter_name.trim(),
        telegram_id: c.telegram_id ?? null,
        date: c.date ?? today,
        revenue,
        mass_dms,
        unread_chats,
        oldest_chat,
        revenue_details,
        stats_details,
        updated_at: nowIso,
      });
    }
  }

  if (rows.length === 0) {
    return new Response(
      JSON.stringify({ success: true, count: 0, message: "No rows to upsert" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase
    .from("chatter_history_live")
    .upsert(rows, { onConflict: "platform,telegram_id,date" })
    .select();

  if (error) {
    console.error("Upsert failed:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { error: rpcErr } = await supabase.rpc("recompute_live_now");
  if (rpcErr) console.error("recompute_live_now failed:", rpcErr.message);

  return new Response(
    JSON.stringify({ success: true, count: data?.length ?? rows.length }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
