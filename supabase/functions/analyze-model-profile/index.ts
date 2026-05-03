// Analyze a model's profile photo via Lovable AI Vision and store archetype attributes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TOOL = {
  type: "function",
  function: {
    name: "classify_model",
    description:
      "Classify the visual archetype of a content creator based on their profile photo.",
    parameters: {
      type: "object",
      properties: {
        age_group: { type: "string", enum: ["young", "mature", "milf"] },
        body_type: {
          type: "string",
          enum: ["slim", "curvy", "bbw", "athletic", "average"],
        },
        hair_color: {
          type: "string",
          enum: ["blonde", "brunette", "red", "black", "other"],
        },
        style: {
          type: "string",
          enum: [
            "girl-next-door",
            "dominant",
            "alternative",
            "glamour",
            "sporty",
          ],
        },
        specials: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "tattoos",
              "piercings",
              "big-boobs",
              "small-boobs",
              "glasses",
              "lingerie",
              "fitness",
              "natural",
            ],
          },
        },
        summary: {
          type: "string",
          description: "One short German sentence describing the look.",
        },
      },
      required: [
        "age_group",
        "body_type",
        "hair_color",
        "style",
        "specials",
        "summary",
      ],
      additionalProperties: false,
    },
  },
};

async function fetchProfileImageFromMaloum(profileUrl: string): Promise<string | null> {
  try {
    const res = await fetch(profileUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Look for thumbnails or banner image URLs
    const m = html.match(
      /https:\/\/storage\.googleapis\.com\/maloum-prod-images\/thumbnails\/[^"\s]+/,
    );
    return m ? m[0] : null;
  } catch (e) {
    console.error("scrape error", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not set");

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userRes.user;

    const { model_id, image_url, profile_url } = await req.json();
    if (!model_id) throw new Error("model_id required");

    // Decide image source
    let sourceImageUrl: string | null = image_url ?? null;
    if (!sourceImageUrl && profile_url) {
      sourceImageUrl = await fetchProfileImageFromMaloum(profile_url);
    }
    if (!sourceImageUrl) {
      return new Response(
        JSON.stringify({
          error:
            "Kein Bild gefunden. Lade ein Foto hoch oder prüfe die Profil-URL.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Call Lovable AI with vision + tool calling
    const aiRes = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                "Du bist ein neutraler Bildanalyst. Klassifiziere das Foto sachlich nach den vorgegebenen Kategorien. Keine Wertung.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Klassifiziere diese Person nach Archetyp.",
                },
                { type: "image_url", image_url: { url: sourceImageUrl } },
              ],
            },
          ],
          tools: [TOOL],
          tool_choice: { type: "function", function: { name: "classify_model" } },
        }),
      },
    );

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("AI error", aiRes.status, t);
      if (aiRes.status === 429)
        return new Response(JSON.stringify({ error: "Rate limit" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      if (aiRes.status === 402)
        return new Response(
          JSON.stringify({ error: "AI-Credits aufgebraucht" }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      throw new Error(`AI gateway ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const call = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("Keine Klassifikation erhalten");
    const args = JSON.parse(call.function.arguments);

    // Upsert
    const { error: upErr } = await supabase
      .from("model_attributes")
      .upsert(
        {
          user_id: user.id,
          model_id,
          age_group: args.age_group,
          body_type: args.body_type,
          hair_color: args.hair_color,
          style: args.style,
          specials: args.specials ?? [],
          ai_summary: args.summary,
          source_image_url: sourceImageUrl,
          analyzed_at: new Date().toISOString(),
        },
        { onConflict: "model_id" },
      );
    if (upErr) throw upErr;

    return new Response(JSON.stringify({ success: true, attributes: args }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-model-profile error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
