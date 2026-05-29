// Generate a personal Boss→Chatter message recapping last month + proposing new monthly goal.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Du schreibst kurze, persönliche Direktnachrichten an EINEN Chatter (Mitarbeiter) – Boss/Founder an Team-Mitglied. Geschrieben so, wie der User es in WhatsApp/Telegram in einem Rutsch verschickt.

EMPFÄNGER: EIN konkreter Chatter (Mitarbeiter im eigenen Team). NIE Fans.

ZWECK:
- Kurzer Recap des letzten Monats (Zahlen ehrlich nennen).
- Wenn letzter Monat schwach war: NICHT abwerten. Tonalität: "halb so wild, drehen wir den nächsten Monat einfach wieder, ich glaub an dich". Motivierend, ohne kitschig zu sein.
- Wenn letzter Monat gut war: echtes Lob, persönlich. Dann klarer Push: jetzt noch einen drauflegen.
- Neues Monatsziel EXPLIZIT nennen (genauer EUR-Wert) + 1 kurzer Satz warum genau diese Zahl realistisch/ambitioniert ist.
- Ende mit kurzem Push, kein Fragezeichen-Loop.

FORMAT:
- 3–6 Sätze. WhatsApp-Stil, Du-Form. Keine Anrede mit "Hey ihr Lieben" etc. Direkt: "Hey [Name]," oder "Moin [Name]," oder ohne Anrede starten.
- Keine Bullets, keine Überschriften, keine Hashtags, keine Meta-Sätze.
- Keine Floskeln wie "Mindset", "best version", "Komfortzone", "let's go", "vertrau dem Prozess", "manifestiere", "Reicher Mindset".
- Max 1 rhetorische Frage.

EMOJI-REGELN (strikt):
- NIE Punkt direkt vor Emoji. Lass den Punkt weg oder nutze Komma/Gedankenstrich.
- Hautton-Emojis IMMER mit hellem Modifier 🏻: 👍🏻 💪🏻 🙌🏻 🤝🏻 🙏🏻 👊🏻 ✌🏻.
- 1–3 Emojis insgesamt, nicht spammen. Bei ernster/ruhiger Tonalität auch 0 Emojis okay.`;

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
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const chatterName: string = (body.chatter_name || "").toString().trim();
    const platform: string = (body.platform || "").toString().trim();
    const proposedGoal = Number(body.proposed_goal);
    const currentGoal = body.current_goal != null ? Number(body.current_goal) : null;

    if (!chatterName || !platform || !Number.isFinite(proposedGoal) || proposedGoal <= 0) {
      return new Response(JSON.stringify({ error: "Missing or invalid input" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Date ranges
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth(); // 0-11
    const firstOfThisMonth = new Date(Date.UTC(y, m, 1));
    const firstOfLastMonth = new Date(Date.UTC(y, m - 1, 1));
    const lastOfLastMonth = new Date(Date.UTC(y, m, 0));
    const firstOfPrevPrevMonth = new Date(Date.UTC(y, m - 2, 1));
    const lastOfPrevPrevMonth = new Date(Date.UTC(y, m - 1, 0));

    const iso = (d: Date) => d.toISOString().slice(0, 10);

    // Roster: Models des Chatters aus den letzten 14 Tagen
    const fourteenAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);

    const [histRes, notesRes, rosterRes] = await Promise.all([
      admin
        .from("chatter_history")
        .select("revenue_today, analysis_date")
        .eq("user_id", userId)
        .eq("platform", platform)
        .eq("chatter_name", chatterName)
        .gte("analysis_date", iso(firstOfPrevPrevMonth))
        .lte("analysis_date", iso(today)),
      admin
        .from("coaching_notes")
        .select("note_text, created_at")
        .eq("user_id", userId)
        .eq("platform", platform)
        .eq("chatter_name", chatterName)
        .order("created_at", { ascending: false })
        .limit(5),
      admin
        .from("chatter_history")
        .select("account")
        .eq("user_id", userId)
        .eq("platform", platform)
        .eq("chatter_name", chatterName)
        .gte("analysis_date", iso(fourteenAgo))
        .lte("analysis_date", iso(today)),
    ]);

    if (histRes.error) throw histRes.error;

    // Roster aufbauen
    const splitAccounts = (s: string | null | undefined): string[] =>
      !s ? [] : s.split(/[,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const rosterSet = new Set<string>();
    for (const r of (rosterRes.data ?? []) as Array<{ account: string | null }>) {
      for (const m of splitAccounts(r.account)) rosterSet.add(m);
    }
    const roster = Array.from(rosterSet);

    // Model-Baselines: alle Rows der letzten 60 Tage (egal welcher Chatter) für die Models im Roster
    let modelBaselineEurPerDay = 0;
    if (roster.length > 0) {
      const sixtyAgo = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);
      const { data: baseRows } = await admin
        .from("chatter_history")
        .select("account, revenue_today, analysis_date")
        .eq("user_id", userId)
        .eq("platform", platform)
        .gte("analysis_date", iso(sixtyAgo))
        .lte("analysis_date", iso(today));

      const sumByModel = new Map<string, number>();
      const daysByModel = new Map<string, Set<string>>();
      for (const r of (baseRows ?? []) as Array<{ account: string | null; revenue_today: number | null; analysis_date: string }>) {
        const models = splitAccounts(r.account);
        if (models.length === 0) continue;
        const share = Number(r.revenue_today ?? 0) / models.length;
        for (const m of models) {
          if (!rosterSet.has(m)) continue; // nur Models im Roster zählen
          sumByModel.set(m, (sumByModel.get(m) ?? 0) + share);
          if (!daysByModel.has(m)) daysByModel.set(m, new Set());
          daysByModel.get(m)!.add(r.analysis_date);
        }
      }
      for (const m of roster) {
        const days = daysByModel.get(m)?.size ?? 0;
        if (days > 0) modelBaselineEurPerDay += (sumByModel.get(m) ?? 0) / days;
      }
    }



    // Aggregate per DISTINCT day (chatter_history hat oft mehrere Rows/Tag pro Account)
    const lastFrom = iso(firstOfLastMonth);
    const lastTo = iso(lastOfLastMonth);
    const prevFrom = iso(firstOfPrevPrevMonth);
    const prevTo = iso(lastOfPrevPrevMonth);
    const thisFrom = iso(firstOfThisMonth);

    const dayMap = new Map<string, { rev: number; bucket: "last" | "prev" | "this" }>();
    for (const h of histRes.data ?? []) {
      const d = h.analysis_date as string;
      const rev = Number(h.revenue_today ?? 0);
      let bucket: "last" | "prev" | "this" | null = null;
      if (d >= lastFrom && d <= lastTo) bucket = "last";
      else if (d >= prevFrom && d <= prevTo) bucket = "prev";
      else if (d >= thisFrom) bucket = "this";
      if (!bucket) continue;
      const key = `${bucket}|${d}`;
      const cur = dayMap.get(key) ?? { rev: 0, bucket };
      cur.rev += rev;
      dayMap.set(key, cur);
    }

    let lastMonthRev = 0, lastWorkedDays = 0, lastEarningDays = 0;
    let prevMonthRev = 0, prevWorkedDays = 0, prevEarningDays = 0;
    let thisMonthRev = 0;
    for (const v of dayMap.values()) {
      if (v.bucket === "last") {
        lastMonthRev += v.rev;
        lastWorkedDays += 1;
        if (v.rev > 0) lastEarningDays += 1;
      } else if (v.bucket === "prev") {
        prevMonthRev += v.rev;
        prevWorkedDays += 1;
        if (v.rev > 0) prevEarningDays += 1;
      } else if (v.bucket === "this") {
        thisMonthRev += v.rev;
      }
    }
    const daysInLastMonth = lastOfLastMonth.getUTCDate();
    const daysInPrevPrevMonth = lastOfPrevPrevMonth.getUTCDate();
    const lastAvgPerWorkedDay = lastWorkedDays > 0 ? lastMonthRev / lastWorkedDays : 0;
    const prevAvgPerWorkedDay = prevWorkedDays > 0 ? prevMonthRev / prevWorkedDays : 0;
    const lastEarningRatio = lastWorkedDays > 0 ? lastEarningDays / lastWorkedDays : 0;
    const lastAttendanceRatio = daysInLastMonth > 0 ? lastWorkedDays / daysInLastMonth : 0;

    // Try to extract previous goal from notes if not provided
    let priorGoal: number | null = currentGoal;
    if (priorGoal == null) {
      for (const n of notesRes.data ?? []) {
        const txt = (n.note_text || "") as string;
        const match = txt.match(/-?\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/);
        if (match) {
          let raw = match[0];
          if (raw.includes(",")) raw = raw.replace(/[.\s]/g, "").replace(",", ".");
          else {
            const parts = raw.split(".");
            if (parts.length > 1 && parts.slice(1).every((p) => /^\d{3}$/.test(p))) raw = parts.join("");
          }
          const n2 = parseFloat(raw);
          if (Number.isFinite(n2) && n2 > 0) { priorGoal = n2; break; }
        }
      }
    }

    const fmtEUR = (n: number) =>
      new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

    const MONTHS_DE = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
    const lastMonthName = MONTHS_DE[firstOfLastMonth.getUTCMonth()];
    const thisMonthName = MONTHS_DE[firstOfThisMonth.getUTCMonth()];

    const goalHit = priorGoal != null && priorGoal > 0 ? (lastMonthRev / priorGoal) * 100 : null;
    const vsPrev = prevMonthRev > 0 ? ((lastMonthRev - prevMonthRev) / prevMonthRev) * 100 : null;

    let tone: "strong" | "ok" | "weak";
    if (goalHit != null) {
      tone = goalHit >= 95 ? "strong" : goalHit >= 75 ? "ok" : "weak";
    } else if (vsPrev != null) {
      tone = vsPrev >= 5 ? "strong" : vsPrev >= -10 ? "ok" : "weak";
    } else {
      tone = "ok";
    }

    const manyZeroDays = lastWorkedDays >= 5 && lastEarningRatio < 0.5;
    const lowAttendance = lastAttendanceRatio < 0.4 && lastWorkedDays > 0;

    const toneLine = tone === "strong"
      ? "Letzter Monat war stark. Echtes Lob, dann klarer Push noch einen draufzulegen."
      : tone === "ok"
      ? "Solide, nicht spektakulär. Anerkennen, dann auf nächstes Level pushen."
      : "Letzter Monat war unter Ziel/schwach. NICHT abwerten – locker einordnen, klar machen dass das nicht schlimm ist, Vertrauen geben, motivieren den nächsten Monat zu drehen.";

    const contextHints: string[] = [];
    if (manyZeroDays) {
      contextHints.push(`WICHTIG: Viele Nullrunden – nur ${lastEarningDays} von ${lastWorkedDays} Arbeitstagen brachten Umsatz. Sprich das diplomatisch an: die Schichten wurden nicht ausgenutzt. Fokus: mehr aus den vorhandenen Schichten holen, nicht "mehr arbeiten".`);
    }
    if (lowAttendance) {
      contextHints.push(`WICHTIG: Nur ${lastWorkedDays} von ${daysInLastMonth} Kalendertagen aktiv. Bewerte die TAGES-Leistung (Ø ${fmtEUR(lastAvgPerWorkedDay)}/Tag), NICHT die Monatssumme. Kein Bashing wegen niedriger Gesamt-EUR.`);
    }

    const modelLine = roster.length > 0 && modelBaselineEurPerDay > 0
      ? `- Models im aktuellen Roster: ${roster.length} (${roster.slice(0, 5).join(", ")}${roster.length > 5 ? ", …" : ""}) – kombiniertes Tages-Potenzial Ø ${fmtEUR(modelBaselineEurPerDay)}/Tag (Basis letzte 60 Tage, alle Chatter).`
      : "- Models im Roster: keine erkannt (Account-Feld leer).";

    const userPrompt = `Schreib genau eine Direktnachricht an den Chatter "${chatterName}".

ZAHLEN (verwende sie ehrlich, runde EUR auf volle Hundert wenn sinnvoll):
- Letzter Monat (${lastMonthName}): Umsatz ${fmtEUR(lastMonthRev)} an ${lastWorkedDays} von ${daysInLastMonth} Kalendertagen aktiv${lastWorkedDays > 0 ? ` (Ø ${fmtEUR(lastAvgPerWorkedDay)}/Arbeitstag)` : ""}.
- Davon Earning-Tage (>0 €): ${lastEarningDays}${lastWorkedDays > 0 ? ` von ${lastWorkedDays} (${Math.round(lastEarningRatio * 100)}%) – also ${lastWorkedDays - lastEarningDays} Nullrunden` : ""}.
- Altes Monatsziel: ${priorGoal != null ? fmtEUR(priorGoal) : "keins hinterlegt"}.
- Zielerreichung letzter Monat: ${goalHit != null ? Math.round(goalHit) + "%" : "—"}.
- Vormonat davor: ${prevMonthRev > 0 ? `${fmtEUR(prevMonthRev)} an ${prevWorkedDays}/${daysInPrevPrevMonth} Tagen (Ø ${fmtEUR(prevAvgPerWorkedDay)}/Tag)` : "—"}${vsPrev != null ? ` (Trend Gesamtumsatz ${vsPrev >= 0 ? "+" : ""}${Math.round(vsPrev)}% vs. davor)` : ""}.
- Aktueller Monat bisher (${thisMonthName}): ${fmtEUR(thisMonthRev)}.
${modelLine}
- NEUES Monatsziel für ${thisMonthName}: ${fmtEUR(proposedGoal)} — MUSS in der Nachricht genannt werden. ${roster.length > 0 && modelBaselineEurPerDay > 0 ? "Das Ziel basiert auf dem normalen Performance-Niveau seiner Models – erwähne KURZ dass das Ziel realistisch ist weil die Models das Potenzial haben." : ""}

TONE: ${toneLine}${contextHints.length ? "\n\n" + contextHints.join("\n") : ""}

Schreib JETZT die fertige Nachricht (3–6 Sätze, WhatsApp-Stil, Du-Form, Emoji-Regeln beachten).`;

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
            name: "send_message",
            description: "Liefert die fertige Direktnachricht an den Chatter.",
            parameters: {
              type: "object",
              properties: {
                message: { type: "string", description: "Fertiger Nachrichtentext auf Deutsch, 3-6 Sätze." },
              },
              required: ["message"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "send_message" } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI error", aiResp.status, t);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate-Limit erreicht, gleich nochmal versuchen." }), {
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
    let parsed: { message: string };
    try { parsed = JSON.parse(toolCall.function.arguments); }
    catch {
      return new Response(JSON.stringify({ error: "AI Response parse error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        message: parsed.message,
        context: {
          last_month_revenue: lastMonthRev,
          last_month_name: lastMonthName,
          last_worked_days: lastWorkedDays,
          last_earning_days: lastEarningDays,
          last_zero_days: lastWorkedDays - lastEarningDays,
          days_in_last_month: daysInLastMonth,
          last_avg_per_worked_day: lastAvgPerWorkedDay,
          prior_goal: priorGoal,
          goal_hit_pct: goalHit,
          vs_prev_pct: vsPrev,
          prev_month_revenue: prevMonthRev,
          prev_worked_days: prevWorkedDays,
          this_month_revenue: thisMonthRev,
          this_month_name: thisMonthName,
          roster,
          model_baseline_eur_per_day: modelBaselineEurPerDay,
          tone,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("generate-goal-message", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
