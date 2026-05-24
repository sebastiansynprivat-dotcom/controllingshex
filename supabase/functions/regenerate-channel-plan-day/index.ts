// Regenerates a single day of an existing channel plan
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WEEKDAYS_DE = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
const MONTHS_DE = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

function seasonOf(month: number): string {
  if (month >= 3 && month <= 5) return "Frühling";
  if (month >= 6 && month <= 8) return "Sommer";
  if (month >= 9 && month <= 11) return "Herbst";
  return "Winter";
}
function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function germanHolidaysFor(year: number): Record<string, string> {
  const easter = easterSunday(year);
  const map: Record<string, string> = {
    [`${year}-01-01`]: "Neujahr",
    [`${year}-05-01`]: "Tag der Arbeit",
    [`${year}-10-03`]: "Tag der Deutschen Einheit",
    [`${year}-12-24`]: "Heiligabend",
    [`${year}-12-25`]: "1. Weihnachtstag",
    [`${year}-12-26`]: "2. Weihnachtstag",
    [`${year}-12-31`]: "Silvester",
    [`${year}-02-14`]: "Valentinstag",
    [`${year}-10-31`]: "Halloween",
  };
  map[ymd(addDays(easter, -2))] = "Karfreitag";
  map[ymd(addDays(easter, 1))] = "Ostermontag";
  map[ymd(addDays(easter, 39))] = "Christi Himmelfahrt";
  map[ymd(addDays(easter, 50))] = "Pfingstmontag";
  return map;
}

const SYSTEM_PROMPT = `Du schreibst kurze bis mittellange Broadcast-Nachrichten in einem internen WhatsApp-Channel an ein TEAM aus CHATTERN (Mitarbeiter), die für den Creator mit zahlenden Fans schreiben.

WICHTIG – EMPFÄNGER:
- Empfänger sind AUSSCHLIESSLICH die eigenen Chatter (Mitarbeiter im Team).
- FANS SEHEN DIESE POSTS NIE.
- KEIN Fan-Content. Keine sinnlichen Andeutungen, kein Flirten, kein Tease an die Community.

ROLLE (mehrere Modi – wechsle bewusst zwischen ihnen):
- Manchmal Boss/Teamleiter, der morgens pusht.
- Manchmal Founder, der einen Gedanken teilt, der ihn gerade beschäftigt.
- Manchmal einfach ein Mensch, der mit seinem inneren Kreis laut denkt – persönlich, ehrlich, auch mal mit Zweifel.

THEMEN-TAGS (Prefix im "theme"-Feld): PUSH | MINDSET-JOB | MINDSET-LIFE | DEEP | APPRECIATION | TACTICAL | VIBE | MONEY.
MONEY-WINDOW = Tag 1–5 des Monats (Fans haben Gehalt). An solchen Tagen wird PUSH zu MONEY (härterer Push).

LÄNGEN-MODI ("length"): short (1–2 Sätze), medium (3–4), long (5–8, ausgeführter Gedanke mit Bogen).

TONALITÄT: locker, direkt, persönlich. Kein HR-/Coaching-Sprech. Nie toxisch-positiv. Energie variieren. Fragmentarisch erlaubt.

WISSENSBASIS NUR als Stil-Referenz – NIEMALS Sätze 1:1 oder fast wörtlich übernehmen.

VARIATION (HARTE REGEL FÜR DIESE REGENERIERUNG):
- Der neue Post darf sich NICHT wie die anderen bereits geplanten Posts dieser Woche anhören.
- Kein wiederholter Opener, keine wiederholten Phrasen/Bilder/Metaphern aus den anderen Posts der Woche.
- Wenn ein konkreter Hinweis vom User mitgegeben wird, RICHTE den neuen Post explizit danach aus.
- Max 1 rhetorische Frage pro Post.

VERBOTEN: Listen, Bullets, Überschriften, Hashtags, Meta-Sätze. Floskeln wie "Bergfest", "Wochenstart", "let's go", "manifestiere", "best version", "Komfortzone verlassen", "Reicher Mindset", "Es liegt an dir", "Vertrau dem Prozess", "Mindset is everything", "Hey ihr Lieben", "Guten Morgen zusammen", "ich hoffe es geht euch gut".

EMOJI-REGELN (strikt):
- NIE Punkt direkt vor Emoji. Lass den Punkt weg oder nutze Komma/Gedankenstrich.
- Hautton-Emojis IMMER mit hellem Modifier 🏻: 👍🏻 ✌🏻 👋🏻 🙌🏻 💪🏻 🤝🏻 ☝🏻 👇🏻 👉🏻 👈🏻 🙏🏻 🤙🏻 🫶🏻 ✍🏻 👏🏻.
- Emoji-Dichte variieren, DEEP/MINDSET-LIFE dürfen ganz ohne Emoji bleiben.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const dayId: string = body.day_id;
    const hint: string = (body.hint || "").toString().slice(0, 1000);

    if (!dayId || typeof dayId !== "string") {
      return new Response(JSON.stringify({ error: "Missing day_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Load target day (must belong to user)
    const { data: targetDay, error: targetErr } = await admin
      .from("channel_plan_days")
      .select("id, plan_id, plan_date, weekday, theme, post_text, context_notes, user_id")
      .eq("id", dayId)
      .eq("user_id", userId)
      .maybeSingle();
    if (targetErr || !targetDay) {
      return new Response(JSON.stringify({ error: "Day not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load plan + siblings
    const [{ data: plan }, { data: siblings }, { data: knowledge }] = await Promise.all([
      admin.from("channel_plans").select("id, generation_context").eq("id", targetDay.plan_id).maybeSingle(),
      admin.from("channel_plan_days")
        .select("plan_date, theme, post_text")
        .eq("plan_id", targetDay.plan_id)
        .neq("id", dayId)
        .order("position", { ascending: true }),
      admin.from("channel_knowledge")
        .select("title, body")
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
    ]);

    // Build day context
    const d = new Date(targetDay.plan_date + "T00:00:00Z");
    const yr = d.getUTCFullYear();
    const holidays = germanHolidaysFor(yr);
    const dom = d.getUTCDate();
    const ctx = {
      date: targetDay.plan_date,
      weekday_de: WEEKDAYS_DE[d.getUTCDay()],
      weekday_num: d.getUTCDay() === 0 ? 7 : d.getUTCDay(),
      month_de: MONTHS_DE[d.getUTCMonth()],
      day_of_month: dom,
      season: seasonOf(d.getUTCMonth() + 1),
      holiday: holidays[targetDay.plan_date] ?? null,
      is_money_window: dom >= 1 && dom <= 5,
    };

    const knowledgeText = (knowledge || [])
      .map((k, i) => `[${i + 1}] ${k.title ? k.title + "\n" : ""}${k.body}`)
      .join("\n\n---\n\n") || "(noch keine Wissensbasis hinterlegt)";

    const siblingsText = (siblings || []).length
      ? (siblings || []).map(s => `- ${s.plan_date} | ${s.theme}\n${s.post_text}`).join("\n\n")
      : "(keine weiteren Tage in dieser Woche)";

    const dayLine = `${ctx.date} (${ctx.weekday_de}, ${ctx.day_of_month}. ${ctx.month_de}, ${ctx.season}${ctx.holiday ? `, FEIERTAG/ANLASS: ${ctx.holiday}` : ""}${ctx.is_money_window ? `, MONEY-WINDOW (Tag ${ctx.day_of_month} – Fans gerade liquide)` : ""})`;

    const userPrompt = `WISSENSBASIS (NUR STIL-REFERENZ – NICHT WÖRTLICH ÜBERNEHMEN):
${knowledgeText}

WOCHEN-KONTEXT DES PLANS: ${plan?.generation_context || "(keiner)"}

BEREITS GEPLANTE POSTS DIESER WOCHE (NICHT WIEDERHOLEN, NICHT ÄHNLICH KLINGEN):
${siblingsText}

ZIELTAG: ${dayLine}

BISHERIGER POST FÜR DIESEN TAG (gefällt nicht, ersetze ihn):
THEME: ${targetDay.theme}
TEXT:
${targetDay.post_text}

HINWEIS VOM USER (wenn vorhanden, RICHTE DEN NEUEN POST EXPLIZIT DANACH AUS):
${hint || "(kein expliziter Hinweis – wähle bewusst ein anderes Theme / Längen-Modus / Tonalität als der alte Post, sodass es sich frisch anfühlt)"}

Liefere GENAU EINEN neuen Post für diesen Tag, der zum Wochen-Mix passt, sich klar vom alten Post UND von den anderen Wochen-Posts unterscheidet.
- Setze "theme" als "TAG: kurzer Titel" (TAG ∈ PUSH | MINDSET-JOB | MINDSET-LIFE | DEEP | APPRECIATION | TACTICAL | VIBE | MONEY).
- Setze "length" bewusst (short | medium | long).`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "regenerate_day",
            description: "Liefert genau einen neuen Channel-Post für den Zieltag.",
            parameters: {
              type: "object",
              properties: {
                theme: { type: "string", description: "Format: 'TAG: kurzer Titel'. Max 60 Zeichen." },
                length: { type: "string", enum: ["short", "medium", "long"] },
                post_text: { type: "string", description: "Fertiger Channel-Post-Text auf Deutsch" },
              },
              required: ["theme", "length", "post_text"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "regenerate_day" } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI error", aiResp.status, t);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit erreicht, bitte später erneut versuchen." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Lovable AI Credits aufgebraucht." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error("No tool call", JSON.stringify(aiJson));
      return new Response(JSON.stringify({ error: "AI lieferte kein strukturiertes Ergebnis" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: { theme: string; length: string; post_text: string };
    try { parsed = JSON.parse(toolCall.function.arguments); }
    catch {
      return new Response(JSON.stringify({ error: "AI Response parse error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newContextNotes = {
      ...(targetDay.context_notes || {}),
      season: ctx.season,
      holiday: ctx.holiday,
      day_of_month: ctx.day_of_month,
      month_de: ctx.month_de,
      weekday_de: ctx.weekday_de,
      length: parsed.length ?? null,
    };

    const { data: updated, error: updErr } = await admin
      .from("channel_plan_days")
      .update({
        theme: parsed.theme,
        post_text: parsed.post_text,
        context_notes: newContextNotes,
      })
      .eq("id", dayId)
      .select("id, plan_id, plan_date, weekday, theme, post_text, context_notes, position")
      .single();

    if (updErr || !updated) {
      console.error("update day", updErr);
      return new Response(JSON.stringify({ error: "DB update failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ day: updated }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("regenerate-channel-plan-day", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
