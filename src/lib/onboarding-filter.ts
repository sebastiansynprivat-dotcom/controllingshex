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
  liveOldestChatHours: number | null; // oldest_chat aus chatter_history_live (in Stunden)
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

  const [onboardingRes, activeNames, accountsRes] = await Promise.all([
    supabase.rpc("get_chatter_onboarding", { p_platform: platform }),
    loadActiveChatterNames(platform),
    supabase
      .from("chatter_history")
      .select("chatter_name, account, analysis_date")
      .ilike("platform", platform)
      .order("analysis_date", { ascending: false })
      .limit(2000),
  ]);

  const onboarding = (onboardingRes.data ?? []) as { chatter_name: string; onboarded_on: string }[];

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

  const items: OnboardingChatter[] = [];
  for (const row of onboarding) {
    const k = normalizeChatterName(row.chatter_name);
    if (activeNames !== null && !activeNames.has(k)) continue;
    const onboardedDate = new Date(row.onboarded_on);
    onboardedDate.setHours(0, 0, 0, 0);
    const days = Math.floor((today.getTime() - onboardedDate.getTime()) / (1000 * 60 * 60 * 24));
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
      liveOldestChatHours: null,
    });
  }

  // ---- KPIs anreichern (Account-Follower, Revenue, Response-Time, Mass-DMs) ----
  const chatterNames = Array.from(new Set(items.map((i) => i.chatterName)));
  const accounts = Array.from(
    new Set(items.map((i) => i.account).filter((a): a is string => !!a)),
  );

  if (chatterNames.length) {
    const [chHistRes, accHistRes, modelsRes, sessionsRes] = await Promise.all([
      supabase
        .from("chatter_history")
        .select("chatter_name, account, revenue_today, mass_dms, analysis_date")
        .ilike("platform", platform)
        .in("chatter_name", chatterNames),
      accounts.length
        ? supabase
            .from("chatter_history")
            .select("account, revenue_today")
            .ilike("platform", platform)
            .in("account", accounts)
        : Promise.resolve({ data: [] as { account: string; revenue_today: number | null }[] }),
      accounts.length
        ? supabase
            .from("models")
            .select("model_name, follower_count")
            .ilike("platform", platform)
            .in("model_name", accounts)
        : Promise.resolve({ data: [] as { model_name: string; follower_count: number | null }[] }),
      supabase
        .from("chatter_activity_sessions")
        .select("chatter_name, first_response_min, mass_dms_in_session, date")
        .ilike("platform", platform)
        .in("chatter_name", chatterNames),
    ]);

    // Account → Follower
    const followersByAccount = new Map<string, number>();
    for (const m of (modelsRes.data ?? []) as { model_name: string; follower_count: number | null }[]) {
      followersByAccount.set(m.model_name, m.follower_count ?? 0);
    }

    // Account → Gesamtrevenue (alle Chatter)
    const totalRevByAccount = new Map<string, number>();
    for (const r of (accHistRes.data ?? []) as { account: string; revenue_today: number | null }[]) {
      totalRevByAccount.set(r.account, (totalRevByAccount.get(r.account) ?? 0) + Number(r.revenue_today ?? 0));
    }

    // (chatter, account) → { revenue, since, massDmsDays }
    type Agg = { revenue: number; since: string | null; massDmsByDay: Map<string, number> };
    const pairAgg = new Map<string, Agg>();
    const pairKey = (c: string, a: string) => `${normalizeChatterName(c)}::${a}`;
    for (const r of (chHistRes.data ?? []) as {
      chatter_name: string;
      account: string;
      revenue_today: number | null;
      mass_dms: number | null;
      analysis_date: string;
    }[]) {
      // account-Feld kann komma-separiert sein → splitten
      const accs = (r.account ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const a of accs) {
        const k = pairKey(r.chatter_name, a);
        const agg = pairAgg.get(k) ?? { revenue: 0, since: null, massDmsByDay: new Map() };
        agg.revenue += Number(r.revenue_today ?? 0);
        if (!agg.since || r.analysis_date < agg.since) agg.since = r.analysis_date;
        const dms = Number(r.mass_dms ?? 0);
        if (dms > 0) {
          agg.massDmsByDay.set(r.analysis_date, (agg.massDmsByDay.get(r.analysis_date) ?? 0) + dms);
        }
        pairAgg.set(k, agg);
      }
    }

    // Chatter → Response p50 + Avg Mass-DMs aus Sessions
    const respByChatter = new Map<string, number[]>();
    const dmsSessByChatter = new Map<string, { byDay: Map<string, number> }>();
    for (const s of (sessionsRes.data ?? []) as {
      chatter_name: string;
      first_response_min: number | null;
      mass_dms_in_session: number | null;
      date: string;
    }[]) {
      const k = normalizeChatterName(s.chatter_name);
      if (s.first_response_min != null) {
        const arr = respByChatter.get(k) ?? [];
        arr.push(s.first_response_min);
        respByChatter.set(k, arr);
      }
      const dms = Number(s.mass_dms_in_session ?? 0);
      if (dms > 0) {
        const entry = dmsSessByChatter.get(k) ?? { byDay: new Map() };
        entry.byDay.set(s.date, (entry.byDay.get(s.date) ?? 0) + dms);
        dmsSessByChatter.set(k, entry);
      }
    }

    const median = (arr: number[]): number | null => {
      if (!arr.length) return null;
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };

    for (const it of items) {
      if (it.account) {
        it.accountFollowers = followersByAccount.get(it.account) ?? null;
        it.accountTotalRevenue = totalRevByAccount.get(it.account) ?? 0;
        const agg = pairAgg.get(pairKey(it.chatterName, it.account));
        if (agg) {
          it.chatterRevenueOnAccount = agg.revenue;
          it.chatterSinceOnAccount = agg.since;
          // Fallback Ø Mass-DMs aus Reports
          if (agg.massDmsByDay.size > 0) {
            const total = [...agg.massDmsByDay.values()].reduce((a, b) => a + b, 0);
            it.avgMassDms = total / agg.massDmsByDay.size;
          }
        }
      }
      // Sessions bevorzugen, falls vorhanden
      const dmsSess = dmsSessByChatter.get(it.chatterKey);
      if (dmsSess && dmsSess.byDay.size > 0) {
        const total = [...dmsSess.byDay.values()].reduce((a, b) => a + b, 0);
        it.avgMassDms = total / dmsSess.byDay.size;
      }
      it.responseMedianMin = median(respByChatter.get(it.chatterKey) ?? []);
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
