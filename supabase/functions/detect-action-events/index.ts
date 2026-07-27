// Erkennt Handlungen (Account weggenommen / neu vergeben / Chatter rein oder raus)
// durch Vergleich der beiden letzten Report-Tage und legt sie als action_events an.
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

interface HistRow {
  chatter_name: string | null;
  account: string | null;
  analysis_date: string;
  revenue_today: number | null;
  mass_dms: number | null;
  open_chats: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const platform: string = (body.platform || "").toString();
    if (!platform) return json({ error: "Missing platform" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Letzte 40 Tage History → daraus die beiden letzten Report-Tage + Baselines
    const from40 = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
    const history = await fetchAll<HistRow>((f, t) =>
      admin.from("chatter_history")
        .select("chatter_name, account, analysis_date, revenue_today, mass_dms, open_chats")
        .eq("user_id", userId)
        .eq("platform", platform)
        .gte("analysis_date", from40)
        .order("analysis_date", { ascending: false })
        .range(f, t));

    const dates = Array.from(new Set(history.map((h) => h.analysis_date))).sort().reverse();
    if (dates.length < 2) return json({ ok: true, created: 0, reason: "not enough reports" });
    const curDate = dates[0];
    const prevDate = dates[1];

    const buildMap = (d: string) => {
      const byChatter = new Map<string, { display: string; accounts: Map<string, string> }>();
      const byAccount = new Map<string, { display: string; chatters: Set<string> }>();
      for (const h of history) {
        if (h.analysis_date !== d) continue;
        const ck = norm(h.chatter_name ?? "");
        if (!ck) continue;
        let c = byChatter.get(ck);
        if (!c) { c = { display: h.chatter_name!, accounts: new Map() }; byChatter.set(ck, c); }
        const ak = norm(h.account ?? "");
        if (ak) {
          c.accounts.set(ak, h.account!);
          let a = byAccount.get(ak);
          if (!a) { a = { display: h.account!, chatters: new Set() }; byAccount.set(ak, a); }
          a.chatters.add(ck);
        }
      }
      return { byChatter, byAccount };
    };

    const cur = buildMap(curDate);
    const prev = buildMap(prevDate);

    // --- Baselines: Ø Umsatz/Tag der 7 Tage VOR dem aktuellen Report ---
    const baseFrom = new Date(new Date(curDate).getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const chatterBase = new Map<string, { sum: number; days: Set<string> }>();
    const accountBase = new Map<string, { sum: number; days: Set<string> }>();
    for (const h of history) {
      if (h.analysis_date >= curDate || h.analysis_date < baseFrom) continue;
      const rev = Number(h.revenue_today) || 0;
      const ck = norm(h.chatter_name ?? "");
      if (ck) {
        const e = chatterBase.get(ck) ?? { sum: 0, days: new Set<string>() };
        e.sum += rev; e.days.add(h.analysis_date); chatterBase.set(ck, e);
      }
      const ak = norm(h.account ?? "");
      if (ak) {
        const e = accountBase.get(ak) ?? { sum: 0, days: new Set<string>() };
        e.sum += rev; e.days.add(h.analysis_date); accountBase.set(ak, e);
      }
    }
    const avgOf = (m: Map<string, { sum: number; days: Set<string> }>, k: string) => {
      const e = m.get(k);
      if (!e || e.days.size === 0) return 0;
      return Math.round(e.sum / e.days.size);
    };

    // --- Live-Kontext (Verzug / offene Chats) ---
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

    const { data: reportRow } = await admin
      .from("analysis_reports")
      .select("id")
      .eq("user_id", userId)
      .eq("platform", platform)
      .eq("analysis_date", curDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    type EventRow = {
      user_id: string; platform: string; event_type: string; event_key: string;
      chatter_name: string | null; counterpart_chatter: string | null;
      account: string | null; prev_account: string | null;
      report_id: string | null; detected_on: string; baseline_json: Record<string, unknown>;
    };
    const events: EventRow[] = [];
    const push = (
      event_type: string,
      chatterKey: string | null,
      chatterDisplay: string | null,
      accountKey: string | null,
      accountDisplay: string | null,
      extra: Partial<EventRow> & { counterpartKey?: string } = {},
    ) => {
      const live = chatterKey ? liveByChatter.get(chatterKey) : null;
      events.push({
        user_id: userId,
        platform,
        event_type,
        event_key: `${curDate}|${event_type}|${chatterKey ?? "-"}|${accountKey ?? "-"}`,
        chatter_name: chatterDisplay,
        counterpart_chatter: extra.counterpart_chatter ?? null,
        account: accountDisplay,
        prev_account: extra.prev_account ?? null,
        report_id: reportRow?.id ?? null,
        detected_on: curDate,
        baseline_json: {
          report_date: curDate,
          prev_report_date: prevDate,
          chatter_avg_day_7d: chatterKey ? avgOf(chatterBase, chatterKey) : 0,
          account_avg_day_7d: accountKey ? avgOf(accountBase, accountKey) : 0,
          counterpart_avg_day_7d: extra.counterpartKey ? avgOf(chatterBase, extra.counterpartKey) : null,
          live_unread: live ? Number(live.unread_chats) || 0 : null,
          live_oldest_chat_days: live ? Number(live.oldest_chat) || 0 : null,
        },
      });
    };

    const handledAccounts = new Set<string>();

    // 1) Account hat den Besitzer gewechselt → Tausch / Neuvergabe
    for (const [ak, curA] of cur.byAccount) {
      const prevA = prev.byAccount.get(ak);
      if (!prevA) continue;
      const newHolders = [...curA.chatters].filter((c) => !prevA.chatters.has(c));
      const lostHolders = [...prevA.chatters].filter((c) => !curA.chatters.has(c));
      if (newHolders.length === 0 || lostHolders.length === 0) continue;
      handledAccounts.add(ak);
      const nk = newHolders[0];
      const lk = lostHolders[0];
      push(
        "account_reassigned",
        nk,
        cur.byChatter.get(nk)?.display ?? nk,
        ak,
        curA.display,
        {
          counterpart_chatter: prev.byChatter.get(lk)?.display ?? lk,
          counterpartKey: lk,
        },
      );
    }

    // 2) Chatter komplett neu / komplett raus
    for (const [ck, c] of cur.byChatter) {
      if (prev.byChatter.has(ck)) continue;
      push("chatter_onboarded", ck, c.display, null, [...c.accounts.values()].join(", ") || null);
    }
    for (const [ck, c] of prev.byChatter) {
      if (cur.byChatter.has(ck)) continue;
      push("chatter_offboarded", ck, c.display, null, [...c.accounts.values()].join(", ") || null);
    }

    // 3) Einzelne Account-Zuordnungen weggenommen / dazugekommen
    for (const [ck, c] of prev.byChatter) {
      const curC = cur.byChatter.get(ck);
      if (!curC) continue; // schon als offboarded erfasst
      for (const [ak, display] of c.accounts) {
        if (curC.accounts.has(ak) || handledAccounts.has(ak)) continue;
        push("account_removed", ck, c.display, ak, display);
      }
    }
    for (const [ck, c] of cur.byChatter) {
      const prevC = prev.byChatter.get(ck);
      if (!prevC) continue; // schon als onboarded erfasst
      for (const [ak, display] of c.accounts) {
        if (prevC.accounts.has(ak) || handledAccounts.has(ak)) continue;
        push("account_added", ck, c.display, ak, display);
      }
    }

    if (events.length === 0) return json({ ok: true, created: 0, report_date: curDate });

    const { error: insErr, data: inserted } = await admin
      .from("action_events")
      .upsert(events, { onConflict: "user_id,platform,event_key", ignoreDuplicates: true })
      .select("id");
    if (insErr) {
      console.error("action_events insert failed:", insErr.message);
      return json({ error: insErr.message }, 500);
    }

    return json({ ok: true, created: inserted?.length ?? 0, detected: events.length, report_date: curDate });
  } catch (e) {
    console.error("detect-action-events error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
