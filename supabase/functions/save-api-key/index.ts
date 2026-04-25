const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { apiKey } = await req.json();
    if (!apiKey || typeof apiKey !== "string" || !apiKey.startsWith("sk-")) {
      return new Response(JSON.stringify({ error: "Invalid API key format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Note: In production, we'd store this in Vault. For now we validate format.
    // The actual key is managed via Lovable Cloud secrets.
    return new Response(JSON.stringify({ success: true, message: "API key validated. Please set it via Lovable Cloud secrets." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
