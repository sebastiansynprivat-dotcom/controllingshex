// Generates a weekly channel plan via Lovable AI
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const WEEKDAYS_DE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS_DE = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

function seasonOf(month: number): string {
  if (month >= 3 && month <= 5) return "Frühling";
  if (month >= 6 && month <= 8) return "Sommer";
  if (month >= 9 && month <= 11) return "Herbst";
  return "Winter";
}

// Gauss algorithm for Easter Sunday
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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

interface DayContext {
  date: string;
  weekday_de: string;
  weekday_num: number;
  month_de: string;
  day_of_month: number;
  season: string;
  holiday: string | null;
  is_money_window: boolean;
}

function buildDayContexts(weekStart: string, selectedWeekdays: number[]): DayContext[] {
  const start = new Date(weekStart + "T00:00:00Z");
  const result: DayContext[] = [];
  const yearsSeen = new Set<number>();
  const holidayCache: Record<number, Record<string, string>> = {};

  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const isoDay = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // 1=Mon, 7=Sun
    if (!selectedWeekdays.includes(isoDay)) continue;
    const yr = d.getUTCFullYear();
    if (!yearsSeen.has(yr)) {
      holidayCache[yr] = germanHolidaysFor(yr);
      yearsSeen.add(yr);
    }
    const dateStr = ymd(d);
    const dom = d.getUTCDate();
    result.push({
      date: dateStr,
      weekday_de: WEEKDAYS_DE[d.getUTCDay()],
      weekday_num: isoDay,
      month_de: MONTHS_DE[d.getUTCMonth()],
      day_of_month: dom,
      season: seasonOf(d.getUTCMonth() + 1),
      holiday: holidayCache[yr][dateStr] ?? null,
      is_money_window: dom >= 1 && dom <= 5,
    });
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const platform: string = body.platform || "Maloum";
    const weekStart: string = body.week_start;
    const selectedWeekdays: number[] = Array.isArray(body.selected_weekdays) ? body.selected_weekdays : [1,2,3,4,5,6,7];
    const extraContext: string = (body.extra_context || "").toString().slice(0, 2000);

    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return new Response(JSON.stringify({ error: "Invalid week_start" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (selectedWeekdays.length === 0) {
      return new Response(JSON.stringify({ error: "Select at least one weekday" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Load knowledge (shared across all workspaces for this user)
    const { data: knowledge } = await admin
      .from("channel_knowledge")
      .select("title, body")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    const dayContexts = buildDayContexts(weekStart, selectedWeekdays);

    const knowledgeText = (knowledge || [])
      .map((k, i) => `[${i + 1}] ${k.title ? k.title + "\n" : ""}${k.body}`)
      .join("\n\n---\n\n") || "(noch keine Wissensbasis hinterlegt)";

    const dayList = dayContexts.map(d =>
      `- ${d.date} (${d.weekday_de}, ${d.day_of_month}. ${d.month_de}, ${d.season}${d.holiday ? `, FEIERTAG/ANLASS: ${d.holiday}` : ""}${d.is_money_window ? `, MONEY-WINDOW (Tag ${d.day_of_month} – Fans gerade liquide)` : ""})`
    ).join("\n");

    const systemPrompt = `Du schreibst kurze Broadcast-Nachrichten in einem internen WhatsApp-Channel an ein TEAM aus CHATTERN (Mitarbeiter), die für den Creator mit zahlenden Fans schreiben.

WICHTIG – EMPFÄNGER:
- Empfänger sind AUSSCHLIESSLICH die eigenen Chatter (Mitarbeiter im Team).
- FANS SEHEN DIESE POSTS NIE.
- Ton: locker, direkt, Du-Form, auf Augenhöhe – wie ein Founder/Teamleiter, der morgens im Team-Chat schreibt. Klare Energie, motivierend, persönlich.
- KEIN Fan-Content. Keine sinnlichen Andeutungen, kein Flirten, kein Tease an die Community. Wir reden mit dem TEAM.

JOB JEDES POSTS (eins davon pro Post, klar erkennbar):
- Chatter pushen, online zu kommen / aktiv ihre Schicht zu nutzen
- Mindset & Motivation für den Tag setzen
- Anerkennung / Dank fürs Team
- Taktischer Reminder (Workflow, Fokus heute)
- Reine Vibe-/Team-Bonding-Message

MONEY-WINDOW (Tag 1–5 des Monats):
In Deutschland bekommen Fans Anfang des Monats Gehalt – das ist DAS Verkaufsfenster.
An MONEY-WINDOW-Tagen pushst du das Team explizit: jetzt rangehen, Custom-Pitches raushauen, Mass-DMs sauber raus, jeder offene Chat ist Cash. Nicht plump ("Fans haben Geld, melkt sie"), sondern als Boss-Push: "heute ist der Tag, lasst nichts liegen".

THEMEN-MIX ÜBER DIE WOCHE (Pflicht-Verteilung, der Tag-Prefix muss in "theme" stehen):
- PUSH (~40 %): "kommt online, gebt Gas, Fokus auf X"
- MINDSET (~25 %): ein Boss-Gedanke, der hängenbleibt – aus dem Bauch, nie Kalenderspruch
- APPRECIATION (~15 %): Team feiern, Dank, "ihr habt gestern gerockt"
- TACTICAL (~10 %): kleiner Workflow-Reminder (z.B. "auf Wiederkäufer fokussieren", "Mass-DMs nicht schleifen lassen")
- VIBE (~10 %): kurze gute-Laune-Message ohne CTA, Team-Bonding
- An MONEY-WINDOW-Tagen wird PUSH zu MONEY (härterer Push mit Money-Window-Bezug).

TONALITÄT:
- Locker, direkt, persönlich. Boss-Stimme, kein HR-Sprech, kein Coaching-Sprech.
- Positiv und motivierend, aber NIE toxisch-positiv ("alles wird gut!!", "you got this queen!!").
- Mal kurz und knapp ("kommt klar heute, ich zähl auf euch"), mal länger mit echtem Gedanken.
- Fragmentarisch, unperfekt, mit Gedankenstrich erlaubt.

WISSENSBASIS-NUTZUNG:
Die Wissensbasis ist NUR Stil-/Kontext-Referenz – sie zeigt, WIE der Creator schreibt.
NIEMALS Sätze oder Passagen 1:1 oder fast wörtlich übernehmen. Keine Paraphrasen nahe am Original.
Jeder Post komplett eigenständig formuliert, nur der Schreibstil fühlt sich an wie in der Wissensbasis.

VARIATIONS-REGELN (die Woche darf sich NICHT gleich anhören):
- Keine zwei Posts starten mit demselben Wort/Satzbau. Variiere Opener stark.
- Variiere Länge: kurze Hammer-Posts (1–2 Sätze) mit längeren (4–6 Sätze) mischen.
- Variiere Tonalität: mal frech, mal ernst, mal warm, mal direkt.
- Wiederhole keine Phrasen, Bilder oder Metaphern aus anderen Posts derselben Woche.
- Maximal 1 rhetorische Frage pro Post.

VERBOTENE FLOSKELN/KLISCHEES (niemals nutzen):
"Bergfest", "Wochenstart", "Halbzeit der Woche", "endlich Freitag", "TGIF", "T-G-I-F", "neuer Tag neues Glück", "Spendierhosen", "Prime Time" als feststehender Begriff, "let's go", "lasst uns gemeinsam", "gemeinsam schaffen wir", "manifestiere", "best version of yourself", "you got this", "Hey ihr Lieben", "Guten Morgen zusammen", "Wer kennt's", "Mal Hand hoch wer", "ich hoffe es geht euch gut".

VERBOTENE FORMATE:
- Keine Listen, keine Bullet-Points, keine Überschriften, keine Hashtags.
- Keine Meta-Sätze ("In diesem Post möchte ich…").

EMOJI- & ZEICHENSETZUNGS-REGELN (strikt):
- NIEMALS einen Punkt direkt vor einem Emoji ("Gas geben heute. 💪" ist verboten). Lass den Punkt weg ("Gas geben heute 💪🏻") oder nutze Komma/Gedankenstrich.
- Alle Emojis mit Hautton MÜSSEN im hellen Hautton (Modifier 🏻) gesetzt werden: 👍🏻 ✌🏻 👋🏻 🙌🏻 💪🏻 🤝🏻 ☝🏻 👇🏻 👉🏻 👈🏻 🙏🏻 🤙🏻 🫶🏻 ✍🏻 👏🏻.
- Variiere Emoji-Einsatz: nicht jeder Post braucht gleich viele, manche dürfen ganz ohne Emoji bleiben.`;

    const userPrompt = `WISSENSBASIS (NUR STIL-/KONTEXT-REFERENZ – NICHT WÖRTLICH ÜBERNEHMEN):
${knowledgeText}

ZUSÄTZLICHER KONTEXT FÜR DIESE WOCHE:
${extraContext || "(keiner)"}

ZU PLANENDE TAGE (${dayContexts.length} Posts):
${dayList}

Erstelle für JEDEN dieser Tage genau einen internen Team-Channel-Post an die Chatter. Schreibe eigenständig im Stil der Wissensbasis – ohne Formulierungen daraus zu kopieren. Setze in "theme" den Tag-Prefix (PUSH | MINDSET | APPRECIATION | TACTICAL | VIBE | MONEY) gefolgt von einem kurzen Titel, z.B. "MONEY: Tag 1 – Gas geben".`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "create_week_plan",
            description: "Liefert für jeden geplanten Tag ein Thema und einen fertigen Channel-Post.",
            parameters: {
              type: "object",
              properties: {
                days: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      date: { type: "string", description: "YYYY-MM-DD" },
                      theme: { type: "string", description: "Format: 'TAG: kurzer Titel' wobei TAG ∈ {PUSH, MINDSET, APPRECIATION, TACTICAL, VIBE, MONEY}. Max 60 Zeichen." },
                      post_text: { type: "string", description: "Fertiger Channel-Post-Text auf Deutsch" },
                    },
                    required: ["date", "theme", "post_text"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["days"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "create_week_plan" } },
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
        return new Response(JSON.stringify({ error: "Lovable AI Credits aufgebraucht. Bitte aufladen." }), {
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
    let parsed: { days: { date: string; theme: string; post_text: string }[] };
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      return new Response(JSON.stringify({ error: "AI Response parse error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert plan
    const { data: planRow, error: planErr } = await admin
      .from("channel_plans")
      .insert({
        user_id: userId,
        platform,
        week_start: weekStart,
        generation_context: extraContext || null,
      })
      .select("id")
      .single();
    if (planErr || !planRow) {
      console.error("plan insert", planErr);
      return new Response(JSON.stringify({ error: "DB insert failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ctxByDate = new Map(dayContexts.map(d => [d.date, d]));
    const rows = parsed.days
      .filter(d => ctxByDate.has(d.date))
      .map((d, i) => {
        const ctx = ctxByDate.get(d.date)!;
        return {
          plan_id: planRow.id,
          user_id: userId,
          plan_date: d.date,
          weekday: ctx.weekday_num,
          theme: d.theme,
          post_text: d.post_text,
          context_notes: {
            season: ctx.season,
            holiday: ctx.holiday,
            day_of_month: ctx.day_of_month,
            month_de: ctx.month_de,
            weekday_de: ctx.weekday_de,
          },
          position: i,
        };
      });

    if (rows.length === 0) {
      await admin.from("channel_plans").delete().eq("id", planRow.id);
      return new Response(JSON.stringify({ error: "AI lieferte keine passenden Tage" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: daysErr } = await admin.from("channel_plan_days").insert(rows);
    if (daysErr) {
      console.error("days insert", daysErr);
      return new Response(JSON.stringify({ error: "DB insert (days) failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ plan_id: planRow.id, days: rows.length }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-channel-plan", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
