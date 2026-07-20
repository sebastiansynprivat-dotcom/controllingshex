import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = (Deno.env.get("CONTROLLING_CHAT_KEY") ?? "").trim();
    const incoming = (req.headers.get("x-api-key") ?? "").trim();
    if (!apiKey || incoming !== apiKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { request_id, success, done, chat, chats, error } = body ?? {};
    if (!request_id) {
      return new Response(JSON.stringify({ error: "request_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Normalise incremental chats and append them if present.
    const incrementalChats: unknown[] = [];
    if (chat) incrementalChats.push(chat);
    if (Array.isArray(chats)) incrementalChats.push(...chats);

    if (incrementalChats.length > 0) {
      const { error: appErr } = await admin.rpc("append_chats_to_request", {
        p_id: request_id,
        p_chats: incrementalChats as unknown as any,
      });
      if (appErr) {
        return new Response(JSON.stringify({ error: appErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 2) Terminal signals: explicit failure OR final "done"/"success" flag.
    const isFailure = error || success === false;
    const isFinal = isFailure || done === true || success === true;

    if (isFinal) {
      const update = isFailure
        ? { status: "failed", error_message: String(error ?? "unknown error") }
        : { status: "completed", error_message: null };

      const { error: updErr } = await admin
        .from("chats_fetch_requests")
        .update(update)
        .eq("id", request_id);

      if (updErr) {
        return new Response(JSON.stringify({ error: updErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
