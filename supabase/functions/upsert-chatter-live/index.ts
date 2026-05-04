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
      date: r.date ?? today,
      updated_at: new Date().toISOString(),
    };
  });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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

  return new Response(JSON.stringify({ success: true, count: data?.length ?? 0, rows: data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
