/**
 * Effort × Potential Mismatch
 *
 * Reine Zeit-Logik: vergleicht Ø aktive Stunden/Tag (aus chatter_hourly_stats)
 * mit dem Tier des aktuell zugewiesenen Accounts (aus models.follower_count).
 *
 * Mismatch-Regeln:
 *   - "pull_up":   Ø ≥ 5h/Tag UND Tier ∈ {seed, starter}
 *                  → viel Zeit auf zu kleinem Account.
 *   - "underused": Ø ≤ 2h/Tag UND Tier ∈ {growth, top}
 *                  → großer Account, zu wenig Zeit.
 *
 * Umsatz fließt bewusst NICHT ein — der verzerrt das Bild.
 */
import { supabase } from "@/integrations/supabase/client";
import { tierForFollowers, type AccountTier } from "@/lib/account-tiers";

export type MismatchKind = "pull_up" | "underused";

export interface MismatchEntry {
  chatterName: string;
  /** lowercased + trim, matches LiveTracking.normName */
  key: string;
  account: string;
  tier: AccountTier;
  avgHoursPerDay: number;
  daysObserved: number;
  kind: MismatchKind;
}

export interface MismatchResult {
  byKey: Map<string, MismatchEntry>;
  pullUp: MismatchEntry[];
  underused: MismatchEntry[];
}

const HIGH_EFFORT_HOURS = 5;
const LOW_EFFORT_HOURS = 2;
const MIN_DAYS_OBSERVED = 3;
const ONBOARDING_MIN_DAYS = 14;
const LOOKBACK_DAYS = 14;

function norm(s: string): string {
  return s.trim().toLowerCase();
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

export async function loadMismatchMap(platform: string): Promise<MismatchResult> {
  const empty: MismatchResult = { byKey: new Map(), pullUp: [], underused: [] };

  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return empty;

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
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

  const followerByAcc = new Map<string, number>();
  for (const m of models) {
    followerByAcc.set(norm(m.model_name), Number(m.follower_count) || 0);
  }

  // Aktuelles Account-Mapping + ältester History-Eintrag pro Chatter.
  // history ist DESC sortiert → erster Treffer = neuester.
  const accountByChatter = new Map<string, string>();
  const oldestSeen = new Map<string, string>();
  const displayName = new Map<string, string>();
  for (const h of history) {
    const name = (h.chatter_name ?? "").trim();
    if (!name) continue;
    const key = norm(name);
    displayName.set(key, name);
    if (!accountByChatter.has(key) && h.account?.trim()) {
      accountByChatter.set(key, h.account.trim());
    }
    oldestSeen.set(key, h.analysis_date); // wird bei jedem (älteren) Treffer überschrieben
  }

  // Aktive Stunden pro Chatter aggregieren.
  const dayHours = new Map<string, Map<string, Set<number>>>();
  for (const r of hourly) {
    const isActive =
      (Number(r.revenue) || 0) > 0 ||
      (Number(r.mass_dms) || 0) > 0 ||
      (Number(r.unread_delta) || 0) < 0;
    if (!isActive) continue;
    const name = (r.chatter_name ?? "").trim();
    if (!name) continue;
    const key = norm(name);
    if (!displayName.has(key)) displayName.set(key, name);
    if (!dayHours.has(key)) dayHours.set(key, new Map());
    const days = dayHours.get(key)!;
    if (!days.has(r.date)) days.set(r.date, new Set());
    days.get(r.date)!.add(Number(r.hour));
  }

  const todayMs = Date.now();
  const byKey = new Map<string, MismatchEntry>();

  for (const [key, days] of dayHours) {
    const account = accountByChatter.get(key);
    if (!account) continue; // ohne Account-Zuweisung kein Tier-Vergleich

    const followers = followerByAcc.get(norm(account)) ?? 0;
    const tier = tierForFollowers(followers);
    if (!tier) continue;

    const dayCount = days.size;
    if (dayCount < MIN_DAYS_OBSERVED) continue;

    const fs = oldestSeen.get(key);
    if (fs) {
      const ageDays = (todayMs - new Date(fs).getTime()) / 86400000;
      if (ageDays < ONBOARDING_MIN_DAYS) continue;
    }

    const totalHours = Array.from(days.values()).reduce((s, set) => s + set.size, 0);
    const avgHoursPerDay = totalHours / dayCount;

    let kind: MismatchKind | null = null;
    if (avgHoursPerDay >= HIGH_EFFORT_HOURS && (tier.id === "seed" || tier.id === "starter")) {
      kind = "pull_up";
    } else if (avgHoursPerDay <= LOW_EFFORT_HOURS && (tier.id === "growth" || tier.id === "top")) {
      kind = "underused";
    }
    if (!kind) continue;

    byKey.set(key, {
      chatterName: displayName.get(key) ?? key,
      key,
      account,
      tier,
      avgHoursPerDay,
      daysObserved: dayCount,
      kind,
    });
  }

  const all = Array.from(byKey.values());
  const pullUp = all
    .filter((e) => e.kind === "pull_up")
    .sort((a, b) => b.avgHoursPerDay - a.avgHoursPerDay);
  const underused = all
    .filter((e) => e.kind === "underused")
    .sort((a, b) => a.avgHoursPerDay - b.avgHoursPerDay);

  return { byKey, pullUp, underused };
}
