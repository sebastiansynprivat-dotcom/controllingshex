/**
 * Onboarding-Filter — Chatter Tag 6–20 nach Onboarding, ohne System-Label,
 * gruppiert nach Onboarding-Tag absteigend für sequenzielles Durcharbeiten.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizeChatterName, loadActiveChatterNames } from "@/lib/active-chatters";
import type { ChatterLabel, LabelAssignment } from "@/lib/chatter-labels";
import { isSystemLabel } from "@/lib/chatter-labels";

export interface OnboardingChatter {
  chatterName: string;
  chatterKey: string;
  daysOnboarded: number;
  account: string | null;
  assignedLabels: ChatterLabel[];
  // KPIs
  accountFollowers: number | null;
  accountTotalRevenue: number; // alle Chatter zusammen auf diesem Account
  chatterRevenueOnAccount: number; // dieser Chatter auf diesem Account
  chatterSinceOnAccount: string | null; // ISO date
  avgMassDms: number; // Ø Mass-DMs pro aktivem Tag dieses Chatters (aus chatter_history)
  liveOpenChats: number | null; // aktuelle unread_chats aus chatter_history_live
  liveOldestChatDays: number | null; // oldest_chat aus chatter_history_live (in Tagen)
}

export interface OnboardingGroup {
  day: number;
  items: OnboardingChatter[];
}

interface Options {
  minDays?: number; // default 6
  maxDays?: number; // default 20
}

export async function loadOnboardingChatters(
  platform: string,
  allLabels: ChatterLabel[],
  assignments: LabelAssignment[],
  opts: Options = {},
): Promise<OnboardingGroup[]> {
  const minDays = opts.minDays ?? 1;
  const maxDays = opts.maxDays ?? 20;

  const [onboardingRes, activeNames, accountsRes, latestReportRes] = await Promise.all([
    supabase.rpc("get_chatter_onboarding", { p_platform: platform }),
    loadActiveChatterNames(platform),
    supabase
      .from("chatter_history")
      .select("chatter_name, account, analysis_date")
      .ilike("platform", platform)
      .order("analysis_date", { ascending: false })
      .limit(2000),
    supabase
      .from("analysis_reports")
      .select("result_json, created_at")
      .ilike("platform", platform)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const onboarding = (onboardingRes.data ?? []) as { chatter_name: string; onboarded_on: string; report_day: number | null }[];

  // startDate aus dem aktuellsten Report (CSV-Spalte) → primäre Quelle für Onboarding-Tag.
  // Format aus CSV: "DD.MM.YYYY" (manchmal "DD.MM.YY" oder ISO).
  const startDateByChatter = new Map<string, string>();
  const displayNameByChatter = new Map<string, string>();
  const result = (latestReportRes.data?.result_json ?? null) as { categories?: { chatters?: { name?: string; startDate?: string }[] }[] } | null;
  if (result?.categories) {
    for (const cat of result.categories) {
      for (const ch of cat.chatters ?? []) {
        if (ch?.name) {
          const nk = normalizeChatterName(ch.name);
          if (!displayNameByChatter.has(nk)) displayNameByChatter.set(nk, ch.name);
          if (ch.startDate) startDateByChatter.set(nk, ch.startDate);
        }
      }
    }
  }

  const parseStartDays = (s: string | undefined, refToday: Date): number | null => {
    if (!s) return null;
    const trimmed = s.trim();
    let d: Date | null = null;
    const dm = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (dm) {
      const day = parseInt(dm[1], 10);
      const mon = parseInt(dm[2], 10) - 1;
      let yr = parseInt(dm[3], 10);
      if (yr < 100) yr += 2000;
      d = new Date(yr, mon, day);
    } else if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      d = new Date(trimmed);
    }
    if (!d || isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    const days = Math.floor((refToday.getTime() - d.getTime()) / 86400000);
    return days >= 0 ? days : null;
  };

  // Account je Chatter — neuester Eintrag
  const accountByChatter = new Map<string, string>();
  for (const r of (accountsRes.data ?? []) as { chatter_name: string; account: string | null }[]) {
    const k = normalizeChatterName(r.chatter_name);
    if (!accountByChatter.has(k) && r.account) {
      const first = r.account.split(",")[0]?.trim();
      if (first) accountByChatter.set(k, first);
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Index: Chatter-Key → System-Label-Zuweisungen
  const systemLabelIds = new Set(allLabels.filter(isSystemLabel).map((l) => l.id));
  const labelsByChatter = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = labelsByChatter.get(a.chatter_key) ?? new Set<string>();
    set.add(a.label_id);
    labelsByChatter.set(a.chatter_key, set);
  }
  const labelById = new Map(allLabels.map((l) => [l.id, l]));

  // Chatter aus dem letzten Report, die nicht im RPC-Output sind, ergänzen
  const seenInOnboarding = new Set(onboarding.map((r) => normalizeChatterName(r.chatter_name)));
  const onboardingFull = [...onboarding];
  for (const [k, sd] of startDateByChatter) {
    if (!seenInOnboarding.has(k)) {
      onboardingFull.push({ chatter_name: displayNameByChatter.get(k) ?? k, onboarded_on: "", report_day: null } as any);
    }
  }

  const items: OnboardingChatter[] = [];
  for (const row of onboardingFull) {
    const k = normalizeChatterName(row.chatter_name);
    if (activeNames !== null && !activeNames.has(k)) continue;

    // PRIMÄR: startDate aus Report. Fallback: report_day. Fallback: Kalendertage.
    const sdDays = parseStartDays(startDateByChatter.get(k), today);
    let days = sdDays ?? Number(row.report_day ?? 0);
    if (!days && row.onboarded_on) {
      const onboardedDate = new Date(row.onboarded_on);
      onboardedDate.setHours(0, 0, 0, 0);
      days = Math.floor((today.getTime() - onboardedDate.getTime()) / (1000 * 60 * 60 * 24));
    }
    if (days < minDays || days > maxDays) continue;

    // Chatter mit System-Label bereits eingestuft → raus aus Onboarding-Queue
    const ids = labelsByChatter.get(k);
    const hasSystemLabel = ids && [...ids].some((id) => systemLabelIds.has(id));
    if (hasSystemLabel) continue;

    const assignedLabels: ChatterLabel[] = [];
    if (ids) {
      for (const id of ids) {
        const l = labelById.get(id);
        if (l) assignedLabels.push(l);
      }
    }

    items.push({
      chatterName: row.chatter_name,
      chatterKey: k,
      daysOnboarded: days,
      account: accountByChatter.get(k) ?? null,
      assignedLabels,
      accountFollowers: null,
      accountTotalRevenue: 0,
      chatterRevenueOnAccount: 0,
      chatterSinceOnAccount: null,
      avgMassDms: 0,
      liveOpenChats: null,
      liveOldestChatDays: null,
    });
  }

  // ---- KPIs anreichern (Account-Follower, Revenue, Mass-DMs, Live-Tracking) ----
  const chatterNames = Array.from(new Set(items.map((i) => i.chatterName)));
  const accounts = Array.from(
    new Set(items.map((i) => i.account).filter((a): a is string => !!a)),
  );

  if (chatterNames.length) {
    // Account-Total: paginiert laden — PostgREST cappt sonst bei 1000 Zeilen
    const fetchAllAccountRevenue = async () => {
      if (!accounts.length) return [] as { account: string | null; revenue_today: number | null }[];
      const all: { account: string | null; revenue_today: number | null }[] = [];
      const pageSize = 1000;
      for (let from = 0; from < 200000; from += pageSize) {
        const { data, error } = await supabase
          .from("chatter_history")
          .select("account, revenue_today")
          .ilike("platform", platform)
          .not("account", "is", null)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = (data ?? []) as { account: string | null; revenue_today: number | null }[];
        all.push(...rows);
        if (rows.length < pageSize) break;
      }
      return all;
    };

    const [chHistRes, accHistData, modelsRes, liveRes] = await Promise.all([
      supabase
        .from("chatter_history")
        .select("chatter_name, account, revenue_today, mass_dms, analysis_date")
        .ilike("platform", platform)
        .in("chatter_name", chatterNames),
      fetchAllAccountRevenue(),
      accounts.length
        ? supabase
            .from("models")
            .select("model_name, follower_count")
            .ilike("platform", platform)
            .in("model_name", accounts)
        : Promise.resolve({ data: [] as { model_name: string; follower_count: number | null }[] }),
      supabase
        .from("chatter_history_live")
        .select("chatter_name, unread_chats, oldest_chat, date, updated_at")
        .ilike("platform", platform)
        .in("chatter_name", chatterNames)
        .order("date", { ascending: false })
        .order("updated_at", { ascending: false }),

    ]);
    const accHistRes = { data: accHistData };


    // Account → Follower
    const followersByAccount = new Map<string, number>();
    for (const m of (modelsRes.data ?? []) as { model_name: string; follower_count: number | null }[]) {
      followersByAccount.set(m.model_name, m.follower_count ?? 0);
    }

    // Account → Gesamtrevenue (alle Chatter) — account-Feld kann komma-separiert sein
    const totalRevByAccount = new Map<string, number>();
    for (const r of (accHistRes.data ?? []) as { account: string | null; revenue_today: number | null }[]) {
      const rev = Number(r.revenue_today ?? 0);
      if (!rev) continue;
      const accs = (r.account ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const a of accs) {
        totalRevByAccount.set(a, (totalRevByAccount.get(a) ?? 0) + rev);
      }
    }

    // (chatter, account) → { revenue, since }
    type Agg = { revenue: number; since: string | null };
    const pairAgg = new Map<string, Agg>();
    const pairKey = (c: string, a: string) => `${normalizeChatterName(c)}::${a}`;

    // Chatter-weite Mass-DM-Stats: Σ mass_dms ÷ Anzahl history-Rows (inkl. 0-Tage)
    // → matched exakt den Wert im Chatter-Profil (ChatterSlideOver: avgDMs)
    type DmAgg = { sum: number; count: number };
    const dmByChatter = new Map<string, DmAgg>();

    for (const r of (chHistRes.data ?? []) as {
      chatter_name: string;
      account: string;
      revenue_today: number | null;
      mass_dms: number | null;
      analysis_date: string;
    }[]) {
      const ck = normalizeChatterName(r.chatter_name);
      const dmAgg = dmByChatter.get(ck) ?? { sum: 0, count: 0 };
      dmAgg.sum += Number(r.mass_dms ?? 0);
      dmAgg.count += 1;
      dmByChatter.set(ck, dmAgg);

      const accs = (r.account ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const a of accs) {
        const k = pairKey(r.chatter_name, a);
        const agg = pairAgg.get(k) ?? { revenue: 0, since: null };
        agg.revenue += Number(r.revenue_today ?? 0);
        if (!agg.since || r.analysis_date < agg.since) agg.since = r.analysis_date;
        pairAgg.set(k, agg);
      }
    }

    // Live-Tracking: neuester Eintrag je Chatter (Query ist bereits desc sortiert)
    const liveByChatter = new Map<string, { unread: number | null; oldest: number | null }>();
    for (const r of (liveRes.data ?? []) as {
      chatter_name: string;
      unread_chats: number | null;
      oldest_chat: number | null;
    }[]) {
      const k = normalizeChatterName(r.chatter_name);
      if (liveByChatter.has(k)) continue;
      liveByChatter.set(k, {
        unread: r.unread_chats != null ? Number(r.unread_chats) : null,
        oldest: r.oldest_chat != null ? Number(r.oldest_chat) : null,
      });
    }

    for (const it of items) {
      if (it.account) {
        it.accountFollowers = followersByAccount.get(it.account) ?? null;
        it.accountTotalRevenue = totalRevByAccount.get(it.account) ?? 0;
        const agg = pairAgg.get(pairKey(it.chatterName, it.account));
        if (agg) {
          it.chatterRevenueOnAccount = agg.revenue;
          it.chatterSinceOnAccount = agg.since;
        }
      }
      const dmAgg = dmByChatter.get(it.chatterKey);
      if (dmAgg && dmAgg.count > 0) {
        it.avgMassDms = Math.round(dmAgg.sum / dmAgg.count);
      }
      const live = liveByChatter.get(it.chatterKey);
      if (live) {
        it.liveOpenChats = live.unread;
        it.liveOldestChatDays = live.oldest;
      }
    }
  }



  // Gruppieren nach Tag (absteigend → ältester zuerst)
  const byDay = new Map<number, OnboardingChatter[]>();
  for (const it of items) {
    const arr = byDay.get(it.daysOnboarded) ?? [];
    arr.push(it);
    byDay.set(it.daysOnboarded, arr);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([day, list]) => ({
      day,
      items: list.sort((a, b) => a.chatterName.localeCompare(b.chatterName, "de")),
    }));
}
