/**
 * Effort × Potential Matrix
 *
 * Vergleicht für jeden Chatter den Aufwand (aktive Stunden/Tag aus
 * `chatter_hourly_stats`) mit dem Potenzial des aktuell zugewiesenen
 * Accounts (Tier nach Follower-Größe).
 *
 * Ziel: Mismatches finden →
 *  - "pull_up": viel Aktivität, kleiner Account → Kandidat für Top-Account
 *  - "underused": wenig Aktivität, großer Account → Account verschwendet
 */
import { supabase } from "@/integrations/supabase/client";
import { tierForFollowers, type AccountTier } from "@/lib/account-tiers";

export type Verdict = "pull_up" | "underused" | "match" | "unknown";

export interface EffortPotentialRow {
  chatterName: string;
  account: string | null;
  followers: number;
  tier: AccountTier | null;
  avgHoursPerDay: number;
  daysObserved: number;
  effortScore: number; // 0..100
  potentialScore: number; // 0..100
  delta: number; // effort - potential
  verdict: Verdict;
}

export interface EffortPotentialResult {
  rows: EffortPotentialRow[];
  pullUp: EffortPotentialRow[]; // viel Effort, kleines Potenzial
  underused: EffortPotentialRow[]; // wenig Effort, hohes Potenzial
  unassigned: EffortPotentialRow[];
  teamMedianHours: number;
}

const TIER_POTENTIAL: Record<string, number> = {
  seed: 20,
  starter: 45,
  growth: 70,
  top: 95,
};

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

interface HourlyRow {
  chatter_name: string;
  date: string;
  hour: number;
  revenue: number;
  mass_dms: number;
  unread_delta: number;
}

interface HistoryRow {
  chatter_name: string;
  account: string | null;
  analysis_date: string;
}

export async function loadEffortPotentialMatrix(
  platform: string,
  lookbackDays = 14,
): Promise<EffortPotentialResult> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) {
    return { rows: [], pullUp: [], underused: [], unassigned: [], teamMedianHours: 0 };
  }

  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  const sinceIso = since.toISOString().slice(0, 10);

  const [hourlyRes, historyRes, modelsRes] = await Promise.all([
    supabase
      .from("chatter_hourly_stats")
      .select("chatter_name, date, hour, revenue, mass_dms, unread_delta")
      .eq("user_id", uid)
      .ilike("platform", platform)
      .gte("date", sinceIso),
    supabase
      .from("chatter_history")
      .select("chatter_name, account, analysis_date")
      .eq("user_id", uid)
      .ilike("platform", platform)
      .gte("analysis_date", sinceIso)
      .order("analysis_date", { ascending: false }),
    supabase
      .from("models")
      .select("model_name, follower_count")
      .eq("user_id", uid)
      .ilike("platform", platform),
  ]);

  const hourly = (hourlyRes.data ?? []) as HourlyRow[];
  const history = (historyRes.data ?? []) as HistoryRow[];
  const models = (modelsRes.data ?? []) as { model_name: string; follower_count: number }[];

  // Follower-Lookup
  const followerByAcc = new Map<string, number>();
  for (const m of models) {
    followerByAcc.set(m.model_name.toLowerCase().trim(), Number(m.follower_count) || 0);
  }

  // Aktuelles Account-Mapping pro Chatter (jüngster History-Eintrag)
  const accountByChatter = new Map<string, string | null>();
  const firstSeen = new Map<string, string>();
  for (const h of history) {
    const key = h.chatter_name?.trim();
    if (!key) continue;
    if (!accountByChatter.has(key)) {
      accountByChatter.set(key, h.account?.trim() || null);
    }
    firstSeen.set(key, h.analysis_date); // weil DESC sortiert → letzter Wert = ältester
  }

  // Aktive Stunden pro Chatter aggregieren
  const dayHoursPerChatter = new Map<string, Map<string, Set<number>>>();
  for (const r of hourly) {
    const active =
      (Number(r.revenue) || 0) > 0 ||
      (Number(r.mass_dms) || 0) > 0 ||
      (Number(r.unread_delta) || 0) < 0;
    if (!active) continue;
    const key = r.chatter_name?.trim();
    if (!key) continue;
    if (!dayHoursPerChatter.has(key)) dayHoursPerChatter.set(key, new Map());
    const days = dayHoursPerChatter.get(key)!;
    if (!days.has(r.date)) days.set(r.date, new Set());
    days.get(r.date)!.add(Number(r.hour));
  }

  // Vereinheitlichte Chatter-Liste (alle die in History oder Hourly sind)
  const allChatters = new Set<string>([
    ...accountByChatter.keys(),
    ...dayHoursPerChatter.keys(),
  ]);

  const rawRows: Array<EffortPotentialRow & { _onboarding: boolean }> = [];
  const todayMs = Date.now();

  for (const chatter of allChatters) {
    const days = dayHoursPerChatter.get(chatter);
    const dayCount = days?.size ?? 0;
    const totalHours = days
      ? Array.from(days.values()).reduce((s, set) => s + set.size, 0)
      : 0;
    const avgHoursPerDay = dayCount > 0 ? totalHours / dayCount : 0;

    const account = accountByChatter.get(chatter) ?? null;
    const followers = account ? followerByAcc.get(account.toLowerCase()) ?? 0 : 0;
    const tier = account ? tierForFollowers(followers) : null;

    // Onboarding-Filter: <14 Tage seit erstem History-Eintrag
    let onboarding = false;
    const fs = firstSeen.get(chatter);
    if (fs) {
      const ageDays = (todayMs - new Date(fs).getTime()) / 86400000;
      if (ageDays < 14) onboarding = true;
    }

    rawRows.push({
      chatterName: chatter,
      account,
      followers,
      tier,
      avgHoursPerDay,
      daysObserved: dayCount,
      effortScore: 0,
      potentialScore: tier ? TIER_POTENTIAL[tier.id] ?? 0 : 0,
      delta: 0,
      verdict: "unknown",
      _onboarding: onboarding,
    });
  }

  // Effort-Score: relativ zum Team-Median (Median = 50)
  const allHours = rawRows
    .filter((r) => r.daysObserved >= 3)
    .map((r) => r.avgHoursPerDay);
  const teamMedianHours = median(allHours) || 1;

  for (const r of rawRows) {
    // 0–100 Skala: Median=50, doppelter Median=100, Null=0.
    const score = Math.min(100, Math.round((r.avgHoursPerDay / (teamMedianHours * 2)) * 100));
    r.effortScore = score;
    r.delta = r.effortScore - r.potentialScore;
    if (!r.account || !r.tier) {
      r.verdict = "unknown";
    } else if (r.daysObserved < 3 || r._onboarding) {
      r.verdict = "match"; // zu wenig Daten → nicht in Mismatch-Listen
    } else if (r.delta <= -30) {
      r.verdict = "pull_up";
    } else if (r.delta >= 30) {
      r.verdict = "underused";
    } else {
      r.verdict = "match";
    }
  }

  const rows: EffortPotentialRow[] = rawRows.map(({ _onboarding, ...rest }) => rest);

  const pullUp = rows
    .filter((r) => r.verdict === "pull_up")
    .sort((a, b) => a.delta - b.delta) // negativste zuerst
    .slice(0, 5);
  const underused = rows
    .filter((r) => r.verdict === "underused")
    .sort((a, b) => b.delta - a.delta) // positivste zuerst
    .slice(0, 5);
  const unassigned = rows.filter((r) => !r.account && r.daysObserved >= 3);

  return { rows, pullUp, underused, unassigned, teamMedianHours };
}
