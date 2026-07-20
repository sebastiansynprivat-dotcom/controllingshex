import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXTERNAL_ENDPOINT = "https://api.controlling.shexadmin.ngrok.pro/fetch-chats";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimErr } = await supabase.auth.getClaims(token);
    if (claimErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;

    const body = await req.json();
    const {
      telegram_id,
      platform,
      token: chatToken,
      model_username,
      date_range,
      user,
    } = body ?? {};

    if (!telegram_id || !platform || !chatToken || !date_range?.start || !date_range?.end) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: inserted, error: insertErr } = await admin
      .from("chats_fetch_requests")
      .insert({
        user_id: userId,
        telegram_id,
        platform,
        token: chatToken,
        model_username: model_username ?? null,
        recipient_username: user?.username ?? null,
        recipient_chat_id: user?.chat_id ?? null,
        date_range_start: date_range.start,
        date_range_end: date_range.end,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return new Response(JSON.stringify({ error: insertErr?.message ?? "Insert failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requestId = inserted.id as string;
    const apiKey = (Deno.env.get("CONTROLLING_CHAT_KEY") ?? "").trim();

    // Fire-and-forget the external request; the service will POST back to chats-webhook.
    const externalBody = {
      request_id: requestId,
      telegram_id,
      platform,
      token: chatToken,
      date_range,
      ...(user ? { user } : {}),
    };

    // We deliberately do NOT await the full response — respond to the client immediately.
    fetch(EXTERNAL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(externalBody),
    }).catch(async (err) => {
      console.error("external fetch-chats failed", err);
      await admin
        .from("chats_fetch_requests")
        .update({ status: "failed", error_message: String(err?.message ?? err) })
        .eq("id", requestId);
    });

    return new Response(JSON.stringify({ request_id: requestId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
