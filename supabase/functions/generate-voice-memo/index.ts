import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { chatterName, platform, customText } = await req.json();
    if (!chatterName || !platform) {
      return new Response(JSON.stringify({ error: "chatterName & platform required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const elevenKey = Deno.env.get("ELEVENLABS_API_KEY");
    const voiceId = Deno.env.get("ELEVENLABS_VOICE_ID");
    if (!elevenKey || !voiceId) {
      return new Response(JSON.stringify({ error: "ElevenLabs nicht konfiguriert" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let memoText = (customText || "").toString().trim();

    if (!memoText) {
      // Daten ziehen
      const from = new Date();
      from.setDate(from.getDate() - 14);
      const fromDate = from.toISOString().split("T")[0];

      const [histRes, notesRes] = await Promise.all([
        supabase.from("chatter_history")
          .select("analysis_date,revenue_today,mass_dms,open_chats,response_delay_days,category")
          .eq("platform", platform).eq("chatter_name", chatterName)
          .gte("analysis_date", fromDate)
          .order("analysis_date", { ascending: false }),
        supabase.from("coaching_notes")
          .select("note_text,created_at")
          .eq("platform", platform).eq("chatter_name", chatterName)
          .order("created_at", { ascending: false }).limit(5),
      ]);

      const hist = histRes.data ?? [];
      const notes = notesRes.data ?? [];
      const revs = hist.map((r: any) => Number(r.revenue_today) || 0);
      const total = revs.reduce((s, v) => s + v, 0);
      const avg = revs.length ? total / revs.length : 0;
      const today = hist[0];
      const last3 = revs.slice(0, 3).reduce((s, v) => s + v, 0) / Math.max(1, Math.min(3, revs.length));
      const prev3 = revs.slice(3, 6).reduce((s, v) => s + v, 0) / Math.max(1, revs.slice(3, 6).length || 1);
      const trend = prev3 > 0 ? Math.round(((last3 - prev3) / prev3) * 100) : 0;

      const ctx = `Chatter: ${chatterName.replace(/_/g, " ")}
Heute: ${today?.revenue_today ?? 0}€ Umsatz, ${today?.response_delay_days ?? 0} Tage Verzug, ${today?.open_chats ?? 0} offene Chats, ${today?.mass_dms ?? 0} Mass-DMs (Ziel: bis zu 6/Tag)
14-Tage-Schnitt: ${Math.round(avg)}€
Trend (letzte 3d vs vorherige 3d): ${trend > 0 ? "+" : ""}${trend}%
Kategorie: ${today?.category ?? "-"}
Letzte Notizen: ${notes.map((n: any) => n.note_text).join(" | ") || "keine"}`;

      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Du bist der Agency-Owner (Chef) und schickst deinem Chatter eine kurze persönliche WhatsApp-Sprachnachricht. So wie du wirklich sprichst — nicht wie eine KI.

Stil:
- Max 40 Wörter. Locker, direkt, echt. Wie unter Kumpels.
- Füllwörter erlaubt: "ey", "yo", "krass", "läuft", "easy", "passt", "joa". Auch mal ein "ähm" oder unvollständige Sätze.
- KEIN Coaching-Sprech, keine Aufzählungen, kein "ich wollte dir nur sagen", kein "denk dran". Nicht belehrend.
- Wenn was gut läuft: kurz feiern ("krass diggi", "läuft bei dir"). Wenn nicht: ehrlich aber kumpelhaft ansprechen, nicht maßregeln.

Was zählt für mich (wichtig — daran orientieren):
- Umsatz gemessen am Potenzial des Modells, nicht absolute Zahl
- Mass-DMs: Ziel sind bis zu 6/Tag — wenn deutlich drunter, kurz erwähnen
- Verzug: kritisch wenn >1 Tag
- Rote Lampe: Umsatz bricht stark ein vs. eigener Schnitt, oder mehrere Tage unter Ziel

Fokussiere dich auf das eine Thema das heute am meisten zählt. Steig direkt mit Vornamen ein (keine Begrüßung). Kein Markdown.`,
            },
            { role: "user", content: ctx },
          ],
        }),
      });

      if (!aiRes.ok) {
        const t = await aiRes.text();
        return new Response(JSON.stringify({ error: `AI Fehler: ${aiRes.status} ${t}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const aiJson = await aiRes.json();
      memoText = aiJson.choices?.[0]?.message?.content?.trim() || "";
      if (!memoText) {
        return new Response(JSON.stringify({ error: "Leerer Text von AI" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ElevenLabs TTS
    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": elevenKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: memoText,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.35, similarity_boost: 0.85, style: 0.55, use_speaker_boost: true },
        }),
      }
    );

    if (!ttsRes.ok) {
      const t = await ttsRes.text();
      return new Response(JSON.stringify({ error: `ElevenLabs Fehler: ${ttsRes.status} ${t}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const audioBuffer = await ttsRes.arrayBuffer();
    const bytes = new Uint8Array(audioBuffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
    }
    const audioB64 = btoa(binary);

    return new Response(JSON.stringify({ audio: audioB64, text: memoText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[generate-voice-memo]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
