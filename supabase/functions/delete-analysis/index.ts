import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { analysis_date, platform } = await req.json();

    // Extract user_id from JWT
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        userId = payload.sub || null;
      } catch { /* ignore */ }
    }

    if (!analysis_date || !platform) {
      return new Response(
        JSON.stringify({ error: "analysis_date und platform sind erforderlich." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(analysis_date)) {
      return new Response(
        JSON.stringify({ error: "analysis_date muss im Format YYYY-MM-DD sein." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Delete chatter_history for this date + platform + user
    let historyQuery = supabase
      .from("chatter_history")
      .delete()
      .eq("analysis_date", analysis_date)
      .eq("platform", platform);
    if (userId) historyQuery = historyQuery.eq("user_id", userId);
    const { data: historyData, error: historyError } = await historyQuery.select();

    if (historyError) {
      console.error("chatter_history delete error:", historyError);
    }

    // 2. Delete daily_chatter_checks for this date + platform + user
    let checksQuery = supabase
      .from("daily_chatter_checks")
      .delete()
      .eq("check_date", analysis_date)
      .eq("platform", platform);
    if (userId) checksQuery = checksQuery.eq("user_id", userId);
    const { data: checksData, error: checksError } = await checksQuery.select();

    if (checksError) {
      console.error("daily_chatter_checks delete error:", checksError);
    }

    const historyDeleted = historyData?.length ?? 0;
    const checksDeleted = checksData?.length ?? 0;
    console.log(`Deleted ${historyDeleted} history + ${checksDeleted} checks for ${platform} on ${analysis_date}`);

    // Return error only if both failed
    if (historyError && checksError) {
      return new Response(
        JSON.stringify({ error: historyError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, deletedHistory: historyDeleted, deletedChecks: checksDeleted }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
