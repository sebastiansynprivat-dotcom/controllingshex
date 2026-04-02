const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { csvData } = await req.json();
    if (!csvData || typeof csvData !== "string") {
      return new Response(JSON.stringify({ error: "csvData is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch models
    const { data: models } = await supabase.from("models").select("model_name, follower_count");
    const modelsText = models && models.length > 0
      ? models.map((m: any) => `${m.model_name}: ${m.follower_count} Follower`).join("\n")
      : "Keine Models vorhanden.";

    // Fetch system prompt
    const { data: promptData } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "system_prompt")
      .single();
    const systemPrompt = promptData?.value || "Du bist ein hilfreicher Assistent für Datenanalyse.";

    // Build message
    const userMessage = `Hier sind die CSV-Daten der heutigen Analyse:\n\n${csvData}\n\nHier ist die Liste der Models und ihrer Followerzahlen:\n${modelsText}`;

    // Call Anthropic API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ error: `Anthropic API error: ${response.status}`, details: errText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();
    const resultText = aiResult.content?.[0]?.text || "Keine Antwort erhalten.";

    return new Response(JSON.stringify({ result: resultText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
