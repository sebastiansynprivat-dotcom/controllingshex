// Generate a personal Boss→Chatter message recapping last month + proposing new monthly goal.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Du schreibst SEHR KURZE persönliche Direktnachrichten an EINEN Chatter (Mitarbeiter) – Boss/Founder an Team-Mitglied. WhatsApp/Telegram-Stil, in einem Rutsch verschickt.

EMPFÄNGER: EIN konkreter Chatter (Mitarbeiter im eigenen Team). NIE Fans.

LÄNGE (hart): MAX 60 Wörter gesamt. 3 kurze Absätze. Jeder Satz scharf, keine Füllwörter. Wenn's länger wird → kürzen.

INHALT (alles muss rein, aber knapp):
1) 1 Satz: Recap laufender Monat + Info, dass Fans/Kunden jetzt frisches Gehalt auf dem Konto haben → leicht zu verkaufen.
2) 1–2 Sätze: Woche 1 Vollgas (Money-Window), danach wird's entspannter. Konkrete VORGABE (kein Tipp, keine Alternative): Mass-DMs stündlich, solange du online bist.
3) 1 Satz: Neues Monatsziel für Folgemonat in EUR + Woche-1-Zwischenziel in EUR. Ziele FETT in WhatsApp-Syntax: *2.500 €*.

VERBOTENE TIPPS (diese NIEMALS erwähnen oder als Alternative anbieten):
- Keine Tageszeit-Tipps (z. B. "morgens", "abends", "nachts").
- Keine persönliche Sprachnotiz.
- Kein exklusiver Teaser zum Antriggern.
- Keine anderen verkaufspsychologischen "Kniffe" oder "Tricks".

WHATSAPP-FETT:
- Wichtige Zahlen/Begriffe mit *EINEM* Sternchen umschließen (WhatsApp-Bold): *2.500 €*, *Woche 1*, *Vollgas*. NICHT ** verwenden.
- Max 3–4 Fett-Stellen pro Nachricht – nur das Wichtigste (Zahlen, Money-Window, Woche 1).

FORMAT:
- Du-Form. Anrede locker: "Hey [Name]," oder "Moin [Name]," – kurz halten.
- Keine Bullets, keine Überschriften, keine Listen, keine Hashtags, keine Meta-Sätze.
- Keine Floskeln: "Mindset", "best version", "Komfortzone", "let's go", "vertrau dem Prozess", "manifestiere", "go go go".
- 0 rhetorische Fragen.

EMOJI-REGELN (strikt):
- Max 2 Emojis gesamt.
- NIE Punkt direkt vor Emoji.
- Hautton-Emojis IMMER mit hellem Modifier 🏻: 👍🏻 💪🏻 🙌🏻 🤝🏻 🙏🏻 👊🏻 ✌🏻.`;


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

    // Date ranges — Recap = LAUFENDER Monat (so weit), Ziel = FOLGEMONAT
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth(); // 0-11
    const firstOfNextMonth = new Date(Date.UTC(y, m + 1, 1));
    const lastOfNextMonth = new Date(Date.UTC(y, m + 2, 0));
    const firstOfThisMonth = new Date(Date.UTC(y, m, 1));
    const lastOfThisMonth = new Date(Date.UTC(y, m + 1, 0));
    const firstOfLastMonth = new Date(Date.UTC(y, m - 1, 1));
    const lastOfLastMonth = new Date(Date.UTC(y, m, 0));

    const iso = (d: Date) => d.toISOString().slice(0, 10);

    // Roster: Models des Chatters aus den letzten 14 Tagen
    const fourteenAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);

    const [histRes, notesRes, rosterRes, tenureRes] = await Promise.all([
      admin
        .from("chatter_history")
        .select("revenue_today, analysis_date")
        .eq("user_id", userId)
        .eq("platform", platform)
        .eq("chatter_name", chatterName)
        .gte("analysis_date", iso(firstOfLastMonth))
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
      admin
        .from("chatter_history")
        .select("analysis_date")
        .eq("user_id", userId)
        .eq("platform", platform)
        .eq("chatter_name", chatterName)
        .order("analysis_date", { ascending: true })
        .limit(1),
    ]);

    if (histRes.error) throw histRes.error;

    // Onboarding-Datum (erstes Auftauchen in chatter_history)
    const onboardedOnIso: string | null =
      (tenureRes.data?.[0]?.analysis_date as string | undefined) ?? null;
    const onboardedOn = onboardedOnIso ? new Date(onboardedOnIso + "T00:00:00Z") : null;
    const tenureDays = onboardedOn
      ? Math.max(0, Math.floor((today.getTime() - onboardedOn.getTime()) / 86_400_000))
      : null;
    const startedAfterPriorMonth = onboardedOn ? onboardedOn > lastOfLastMonth : false;
    const startedDuringPriorMonth = onboardedOn
      ? onboardedOn >= firstOfLastMonth && onboardedOn <= lastOfLastMonth
      : false;
    const startedThisMonth = onboardedOn ? onboardedOn >= firstOfThisMonth : false;
    const isNewbie = tenureDays != null && tenureDays < 30;


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
          if (!rosterSet.has(m)) continue;
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

    // Aggregate per DISTINCT day
    // recap = laufender Monat (bisher), prior = letzter Monat (komplett) für Trend
    const recapFrom = iso(firstOfThisMonth);
    const recapTo = iso(today);
    const priorFrom = iso(firstOfLastMonth);
    const priorTo = iso(lastOfLastMonth);

    const dayMap = new Map<string, { rev: number; bucket: "recap" | "prior" }>();
    for (const h of histRes.data ?? []) {
      const d = h.analysis_date as string;
      const rev = Number(h.revenue_today ?? 0);
      let bucket: "recap" | "prior" | null = null;
      if (d >= recapFrom && d <= recapTo) bucket = "recap";
      else if (d >= priorFrom && d <= priorTo) bucket = "prior";
      if (!bucket) continue;
      const key = `${bucket}|${d}`;
      const cur = dayMap.get(key) ?? { rev: 0, bucket };
      cur.rev += rev;
      dayMap.set(key, cur);
    }

    let recapRev = 0, recapWorkedDays = 0, recapEarningDays = 0;
    let priorRev = 0, priorWorkedDays = 0, priorEarningDays = 0;
    for (const v of dayMap.values()) {
      if (v.bucket === "recap") {
        recapRev += v.rev;
        recapWorkedDays += 1;
        if (v.rev > 0) recapEarningDays += 1;
      } else {
        priorRev += v.rev;
        priorWorkedDays += 1;
        if (v.rev > 0) priorEarningDays += 1;
      }
    }
    const daysInRecapSoFar = today.getUTCDate(); // Tage des laufenden Monats bisher
    const daysInRecapMonth = lastOfThisMonth.getUTCDate();
    const daysInPriorMonth = lastOfLastMonth.getUTCDate();
    const daysInGoalMonth = lastOfNextMonth.getUTCDate();
    const recapAvgPerWorkedDay = recapWorkedDays > 0 ? recapRev / recapWorkedDays : 0;
    const priorAvgPerWorkedDay = priorWorkedDays > 0 ? priorRev / priorWorkedDays : 0;
    const recapEarningRatio = recapWorkedDays > 0 ? recapEarningDays / recapWorkedDays : 0;
    const recapAttendanceRatio = daysInRecapSoFar > 0 ? recapWorkedDays / daysInRecapSoFar : 0;

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
    const recapMonthName = MONTHS_DE[firstOfThisMonth.getUTCMonth()];
    const priorMonthName = MONTHS_DE[firstOfLastMonth.getUTCMonth()];
    const goalMonthName = MONTHS_DE[firstOfNextMonth.getUTCMonth()];

    // Hochrechnung des laufenden Monats: pace = bisher pro Tag * Tage gesamt
    const projectedRecap = daysInRecapSoFar > 0
      ? (recapRev / daysInRecapSoFar) * daysInRecapMonth
      : 0;
    const goalHit = priorGoal != null && priorGoal > 0 ? (projectedRecap / priorGoal) * 100 : null;
    const vsPrior = priorRev > 0 ? ((projectedRecap - priorRev) / priorRev) * 100 : null;

    let tone: "strong" | "ok" | "weak";
    if (goalHit != null) {
      tone = goalHit >= 95 ? "strong" : goalHit >= 75 ? "ok" : "weak";
    } else if (vsPrior != null) {
      tone = vsPrior >= 5 ? "strong" : vsPrior >= -10 ? "ok" : "weak";
    } else {
      tone = "ok";
    }

    const manyZeroDays = recapWorkedDays >= 5 && recapEarningRatio < 0.5;
    const lowAttendance = recapAttendanceRatio < 0.4 && recapWorkedDays > 0;

    const toneLine = tone === "strong"
      ? `Laufender Monat (${recapMonthName}) sieht stark aus. Kurz anerkennen, dann klar machen: ${goalMonthName} legen wir nochmal eine Schippe drauf.`
      : tone === "ok"
      ? `Laufender Monat (${recapMonthName}) ist solide. Kurz einordnen, dann auf ${goalMonthName} pushen.`
      : `Laufender Monat (${recapMonthName}) bleibt hinter Erwartung. NICHT abwerten – locker einordnen, Vertrauen geben, klar machen dass wir ${goalMonthName} sauber drehen.`;

    const contextHints: string[] = [];
    if (manyZeroDays) {
      contextHints.push(`Viele Nullrunden im laufenden Monat – nur ${recapEarningDays} von ${recapWorkedDays} Arbeitstagen brachten Umsatz. Diplomatisch ansprechen: Schichten besser nutzen, nicht "mehr arbeiten".`);
    }
    if (lowAttendance) {
      contextHints.push(`Geringe Präsenz im laufenden Monat (${recapWorkedDays} von ${daysInRecapSoFar} Tagen bisher). Bewerte die TAGES-Leistung (Ø ${fmtEUR(recapAvgPerWorkedDay)}/Tag), NICHT die Monatssumme.`);
    }

    const modelLine = roster.length > 0 && modelBaselineEurPerDay > 0
      ? `- Models im aktuellen Roster: ${roster.length} (${roster.slice(0, 5).join(", ")}${roster.length > 5 ? ", …" : ""}) – kombiniertes Tages-Potenzial Ø ${fmtEUR(modelBaselineEurPerDay)}/Tag (Basis letzte 60 Tage, alle Chatter).`
      : "- Models im Roster: keine erkannt (Account-Feld leer).";

    // Vormonats-Vergleich nur, wenn Chatter schon im Vormonat dabei war
    const showPrior = !startedAfterPriorMonth;
    const priorLine = showPrior
      ? `- Vormonat ${priorMonthName} (komplett): ${priorRev > 0 ? `${fmtEUR(priorRev)} an ${priorWorkedDays}/${daysInPriorMonth} Tagen (Ø ${fmtEUR(priorAvgPerWorkedDay)}/Tag)` : "—"}${vsPrior != null ? ` (Trend Hochrechnung vs. Vormonat ${vsPrior >= 0 ? "+" : ""}${Math.round(vsPrior)}%)` : ""}.`
      : `- Vormonat ${priorMonthName}: NICHT relevant – Chatter war damals noch nicht dabei. KEINE Vergleiche mit ${priorMonthName} ziehen.`;

    const tenureLine = onboardedOn
      ? startedThisMonth
        ? `- Onboarding: Chatter ist erst seit ${tenureDays} Tagen dabei (Start im ${recapMonthName}). Recap mit Augenmaß – ist quasi Einstieg. KEIN Vormonats-Vergleich.`
        : startedDuringPriorMonth
        ? `- Onboarding: Chatter startete im ${priorMonthName} (seit ${tenureDays} Tagen dabei). Daten aus ${priorMonthName} sind nur Teilmonat – nicht als voller Vormonat behandeln, kein "letzter Monat lief schlecht".`
        : isNewbie
        ? `- Onboarding: Chatter ist seit ${tenureDays} Tagen dabei (relativ neu). Tonalität entsprechend: Aufbau-Phase, nicht abrechnen.`
        : `- Onboarding: Chatter ist seit ${tenureDays} Tagen dabei (etabliert).`
      : "";

    const userPrompt = `Schreib genau eine Direktnachricht an den Chatter "${chatterName}".

WICHTIG ZUM TIMING:
- Das NEUE Monatsziel zählt für ${goalMonthName} (Folgemonat, hat noch nicht begonnen).
- Der laufende Monat ist ${recapMonthName} – davon gibt's einen KURZEN Recap (1 Satz), das ist NICHT das Hauptthema.
- Nachricht muss klar vermitteln: "Für ${goalMonthName} ist dein Ziel X €" – nicht für den aktuellen Monat.
${startedAfterPriorMonth ? `- ACHTUNG: Chatter war im ${priorMonthName} noch nicht im Team. Erwähne NICHTS über ${priorMonthName} – weder Zahlen noch Performance.` : ""}
${startedThisMonth ? `- ACHTUNG: Chatter ist erst diesen Monat (${recapMonthName}) gestartet. Recap sehr wohlwollend formulieren – das sind Einstiegs-Tage, keine volle Bewertungsbasis.` : ""}

ZAHLEN (verwende sie ehrlich, runde EUR auf volle Hundert wenn sinnvoll):
- Laufender Monat (${recapMonthName}) bisher: ${fmtEUR(recapRev)} an ${recapWorkedDays} von ${daysInRecapSoFar} Tagen aktiv${recapWorkedDays > 0 ? ` (Ø ${fmtEUR(recapAvgPerWorkedDay)}/Arbeitstag)` : ""}. Hochrechnung Monatsende: ~${fmtEUR(projectedRecap)}.
- Earning-Tage (>0 €) im ${recapMonthName}: ${recapEarningDays}${recapWorkedDays > 0 ? ` von ${recapWorkedDays} (${Math.round(recapEarningRatio * 100)}%)` : ""}.
${priorLine}
${tenureLine}
- Altes/aktuelles Monatsziel: ${priorGoal != null ? fmtEUR(priorGoal) : "keins hinterlegt"}${goalHit != null ? ` – Hochrechnung trifft das zu ${Math.round(goalHit)}%` : ""}.
${modelLine}
- NEUES Monatsziel für ${goalMonthName}: ${fmtEUR(proposedGoal)} (${daysInGoalMonth} Tage) — MUSS in der Nachricht genannt werden, klar als Ziel für ${goalMonthName}. ${roster.length > 0 && modelBaselineEurPerDay > 0 ? "Das Ziel basiert auf dem normalen Performance-Niveau seiner Models – erwähne KURZ dass das Ziel realistisch ist weil die Models das Potenzial haben." : ""}
- WOCHE-1-ZIEL (Tag 1–7): mind. ${fmtEUR(Math.round((proposedGoal * 0.30) / 50) * 50)} = ca. 30 % des Monatsziels. Begründung im Text: Money-Window am Monatsanfang (Fans haben frisches Geld), wenn man die erste Woche pusht wird's nach hinten raus entspannter.

PFLICHT-INHALTE (alles muss rein, aber MAX 60 Wörter gesamt, 3 kurze Absätze):
A) 1 Satz: Recap + Fans/Kunden haben frisches Gehalt → leicht zu verkaufen.
B) 1–2 Sätze: *Woche 1* Vollgas (Money-Window), danach entspannter + EIN konkreter Hebel.
C) 1 Satz: Neues Ziel *${fmtEUR(proposedGoal)}* für ${goalMonthName}, davon *${fmtEUR(Math.round((proposedGoal * 0.30) / 50) * 50)}* in Woche 1.

FETT-REGEL: WhatsApp nutzt EIN Sternchen (*text*), NICHT zwei. Nur Zahlen + 2–3 Schlüsselbegriffe fett.

TONE: ${toneLine}${contextHints.length ? "\n\n" + contextHints.join("\n") : ""}

Schreib JETZT die fertige Nachricht. MAX 60 Wörter. 3 kurze Absätze (Leerzeile zwischen). Ziel klar für ${goalMonthName}. Keine Floskeln, keine Listen, max 2 Emojis.`;



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
                message: { type: "string", description: "Fertiger Nachrichtentext auf Deutsch, MAX 60 Wörter, 3 kurze Absätze, WhatsApp-Bold mit *einem* Sternchen." },
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
          // Recap (laufender Monat) – wird im Dialog unter "last_month_*" Keys angezeigt
          last_month_revenue: recapRev,
          last_month_name: `${recapMonthName} (bisher)`,
          last_worked_days: recapWorkedDays,
          last_earning_days: recapEarningDays,
          last_zero_days: recapWorkedDays - recapEarningDays,
          days_in_last_month: daysInRecapSoFar,
          last_avg_per_worked_day: recapAvgPerWorkedDay,
          prior_goal: priorGoal,
          goal_hit_pct: goalHit,
          vs_prev_pct: vsPrior,
          prev_month_revenue: priorRev,
          prev_worked_days: priorWorkedDays,
          this_month_revenue: projectedRecap,
          this_month_name: goalMonthName,
          goal_month_name: goalMonthName,
          recap_month_name: recapMonthName,
          projected_recap: projectedRecap,
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
