// Bewertet erkannte Handlungen (action_events) 3 bzw. 7 Tage nach Erkennung:
// Wie hat sich Chatter- und Account-Performance seither entwickelt?
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function norm(n: string) {
  return (n || "").trim().toLowerCase().replace(/[_\s]+/g, " ");
}

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(String((error as any)?.message ?? error));
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

const SYSTEM_PROMPT = `Du bist der Head of Revenue einer Chatting-/Creator-Agency und machst den RÜCKBLICK auf Entscheidungen des Users (Account-Tausch, Account weggenommen, Chatter neu besetzt oder rausgenommen).

Du bekommst pro Entscheidung: was passiert ist, die Ø-Tagesumsätze VOR der Entscheidung und SEITHER (Chatter und Account getrennt), sowie Verzug/offene Chats danach.

REGELN:
- Antworte ausschließlich auf Deutsch, direkt, ohne Coaching-Sprech.
- Bewerte AUS DEN ZAHLEN, nie aus dem Bauch. Nenne in der Begründung konkrete €-Werte und die Veränderung.
- verdict: "good" (klar besser), "neutral" (kein relevanter Unterschied), "bad" (klar schlechter / Account liegt brach), "watch" (Datenlage noch zu dünn, weiter beobachten).
- "bad" auch dann, wenn der Account nach der Entscheidung viel Verzug oder viele offene Chats hat, obwohl er vorher lief.
- recommendation: EINE konkrete nächste Handlung ("Account zurück auf X geben", "Y noch 3 Tage geben, Mass-DMs auf 6 hochziehen", "passt so, nichts tun").
- impact_eur: geschätzte tägliche €-Wirkung der Entscheidung (positiv wenn sie geholfen hat, negativ wenn sie geschadet hat).
- Wording: nie "absäuft" — stattdessen "im Rückgang". Kein Punkt vor Emojis, Hautton-Emojis immer mit hellem Modifier 🏻.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const platform: string = (body.platform || "").toString();
    if (!platform) return json({ error: "Missing platform" }, 400);
    const force: boolean = !!body.force;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const today = new Date().toISOString().slice(0, 10);
    const dayDiff = (a: string, b: string) =>
      Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

    const { data: allEvents, error: evErr } = await admin
      .from("action_events")
      .select("*")
      .eq("user_id", userId)
      .eq("platform", platform)
      .neq("status", "archived")
      .order("detected_on", { ascending: false });
    if (evErr) return json({ error: evErr.message }, 500);

    const due = (allEvents ?? []).filter((e: any) => {
      const age = dayDiff(e.detected_on, today);
      if (age < (force ? 1 : 3)) return false;
      const stage = (e.outcome_json ?? {}).stage;
      if (!e.evaluated_at) return true;
      if (force) return true;
      return age >= 7 && stage !== "d7";
    });

    if (due.length === 0) {
      return json({ ok: true, evaluated: 0, pending: (allEvents ?? []).length });
    }

    // History für Vorher/Nachher
    const oldest = due.reduce((m: string, e: any) => (e.detected_on < m ? e.detected_on : m), today);
    const from = new Date(new Date(oldest).getTime() - 10 * 86400000).toISOString().slice(0, 10);
    const history = await fetchAll<any>((f, t) =>
      admin.from("chatter_history")
        .select("chatter_name, account, analysis_date, revenue_today, mass_dms, open_chats")
        .eq("user_id", userId)
        .eq("platform", platform)
        .gte("analysis_date", from)
        .range(f, t));

    const liveRows = await fetchAll<any>((f, t) =>
      admin.from("chatter_history_live")
        .select("chatter_name, unread_chats, oldest_chat, revenue, stats_details, updated_at")
        .ilike("platform", platform)
        .order("updated_at", { ascending: false })
        .range(f, t));
    const liveByChatter = new Map<string, any>();
    for (const l of liveRows) {
      const k = norm(l.chatter_name ?? "");
      if (k && !liveByChatter.has(k)) liveByChatter.set(k, l);
    }

    const avgRevenue = (
      match: (r: any) => boolean,
      fromISO: string,
      toISO: string,
    ) => {
      const days = new Map<string, number>();
      for (const r of history) {
        if (r.analysis_date < fromISO || r.analysis_date > toISO) continue;
        if (!match(r)) continue;
        days.set(r.analysis_date, (days.get(r.analysis_date) ?? 0) + (Number(r.revenue_today) || 0));
      }
      if (days.size === 0) return { avg: 0, days: 0 };
      const sum = Array.from(days.values()).reduce((s, v) => s + v, 0);
      return { avg: Math.round(sum / days.size), days: days.size };
    };

    const enriched = due.map((e: any) => {
      const ck = norm(e.chatter_name ?? "");
      const ak = norm(e.account ?? "");
      const pk = norm(e.counterpart_chatter ?? "");
      const beforeFrom = new Date(new Date(e.detected_on).getTime() - 7 * 86400000).toISOString().slice(0, 10);
      const beforeTo = new Date(new Date(e.detected_on).getTime() - 86400000).toISOString().slice(0, 10);

      const chatterBefore = ck ? avgRevenue((r) => norm(r.chatter_name ?? "") === ck, beforeFrom, beforeTo) : { avg: 0, days: 0 };
      const chatterAfter = ck ? avgRevenue((r) => norm(r.chatter_name ?? "") === ck, e.detected_on, today) : { avg: 0, days: 0 };
      const accountBefore = ak ? avgRevenue((r) => norm(r.account ?? "") === ak, beforeFrom, beforeTo) : { avg: 0, days: 0 };
      const accountAfter = ak ? avgRevenue((r) => norm(r.account ?? "") === ak, e.detected_on, today) : { avg: 0, days: 0 };
      const partnerBefore = pk ? avgRevenue((r) => norm(r.chatter_name ?? "") === pk, beforeFrom, beforeTo) : { avg: 0, days: 0 };
      const partnerAfter = pk ? avgRevenue((r) => norm(r.chatter_name ?? "") === pk, e.detected_on, today) : { avg: 0, days: 0 };

      const live = ck ? liveByChatter.get(ck) : null;
      const age = dayDiff(e.detected_on, today);

      return {
        id: e.id,
        event_type: e.event_type,
        chatter: e.chatter_name,
        counterpart: e.counterpart_chatter,
        account: e.account,
        detected_on: e.detected_on,
        days_since: age,
        chatter_avg_before: chatterBefore.avg,
        chatter_avg_after: chatterAfter.avg,
        account_avg_before: accountBefore.avg,
        account_avg_after: accountAfter.avg,
        counterpart_avg_before: partnerBefore.avg,
        counterpart_avg_after: partnerAfter.avg,
        data_days_after: Math.max(chatterAfter.days, accountAfter.days),
        live_unread: live ? Number(live.unread_chats) || 0 : null,
        live_oldest_chat_days: live ? Number(live.oldest_chat) || 0 : null,
        baseline: e.baseline_json ?? {},
      };
    });

    async function callAI(items: any[]): Promise<any[]> {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3.6-flash",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Workspace ${platform}, heute ${today}.

ENTSCHEIDUNGEN ZUM BEWERTEN (JSON):
${JSON.stringify(items)}

Event-Typen: account_reassigned = Account ging von "counterpart" auf "chatter"; account_removed = Chatter hat diesen Account verloren; account_added = Chatter hat diesen Account dazubekommen; chatter_offboarded = Chatter ist raus; chatter_onboarded = Chatter ist neu dazu.

AUFGABE: Bewerte JEDE Entscheidung einzeln. Gib für jede die "id" unverändert zurück, dazu verdict, reason (2–3 Sätze mit Zahlen), recommendation und impact_eur.`,
            },
          ],
          tools: [{
            type: "function",
            function: {
              name: "deliver_verdicts",
              description: "Bewertungen der Entscheidungen",
              parameters: {
                type: "object",
                properties: {
                  verdicts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        verdict: { type: "string", enum: ["good", "neutral", "bad", "watch"] },
                        reason: { type: "string" },
                        recommendation: { type: "string" },
                        impact_eur: { type: "number" },
                      },
                      required: ["id", "verdict", "reason", "recommendation", "impact_eur"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["verdicts"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "deliver_verdicts" } },
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        console.error("AI error", resp.status, t.slice(0, 400));
        if (resp.status === 429) throw new Error("Rate limit erreicht, bitte später erneut versuchen.");
        if (resp.status === 402) throw new Error("AI-Credits aufgebraucht.");
        throw new Error(`AI Fehler (${resp.status})`);
      }
      const j = await resp.json();
      const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!args) return [];
      try { return JSON.parse(args)?.verdicts ?? []; } catch { return []; }
    }

    const CHUNK = 6;
    const chunks: any[][] = [];
    for (let i = 0; i < enriched.length; i += CHUNK) chunks.push(enriched.slice(i, i + CHUNK));

    const verdicts: any[] = [];
    const CONCURRENCY = 3;
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const res = await Promise.all(chunks.slice(i, i + CONCURRENCY).map(async (c) => {
        try { return await callAI(c); } catch (e) { console.error("verdict chunk failed", e); return []; }
      }));
      for (const r of res) verdicts.push(...r);
    }

    const byId = new Map(enriched.map((e) => [e.id, e]));
    let updated = 0;
    for (const v of verdicts) {
      const src = byId.get(v.id);
      if (!src) continue;
      const stage = src.days_since >= 7 ? "d7" : "d3";
      const { error } = await admin.from("action_events").update({
        verdict: v.verdict,
        verdict_reason: v.reason,
        recommendation: v.recommendation,
        impact_eur: Number(v.impact_eur) || 0,
        evaluated_at: new Date().toISOString(),
        outcome_json: { ...src, stage },
      }).eq("id", v.id).eq("user_id", userId);
      if (error) console.error("verdict update failed", error.message);
      else updated++;
    }

    return json({ ok: true, evaluated: updated, due: due.length });
  } catch (e) {
    console.error("evaluate-action-events error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
