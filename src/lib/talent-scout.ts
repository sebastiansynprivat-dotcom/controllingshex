/**
 * Talent-Scout — adaptive Paarung von Aufsteigern (junges Onboarding) mit
 * etablierten Underusern auf besseren Accounts.
 *
 * Schwellen passen sich dem Pool an: gibt es viele etablierte Chatter mit
 * großen Lecks (lange Verzüge, viele offene Chats, kaum Aktivität, niedriger
 * €/Tag im Vergleich zum Tier-Median), werden die Anforderungen an die
 * Aufsteiger automatisch lockerer — wir wollen das beste verfügbare
 * Tausch-Paar finden, nicht starre Cutoffs durchsetzen.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchLiveEfficiency, hasUsableLiveData, type LiveEfficiencyRow } from "@/lib/live-efficiency";
import { tierForFollowers, type AccountTier } from "@/lib/account-tiers";

// --- Semantische Konstanten (kein Schwellwert) ---
const ONBOARDING_MIN_DAYS = 5;
const ONBOARDING_MAX_DAYS = 21;
const ESTABLISHED_MIN_DAYS = 14;
const HISTORY_DAYS = 7;
const MAX_MATCHES = 8;
const MIN_EXPECTED_GAIN = 25;

export interface TalentMatch {
  riser: string;
  riserDaysOnboarded: number;
  riserTier: AccountTier;
  riserAvgMassDms: number;
  riserResponseP50: number | null;
  underuser: string;
  underuserTier: AccountTier;
  underuserOpenChats: number;
  underuserDelayDays: number;
  underuserAccount: string;
  matchScore: number;
}

export interface AdaptiveThresholds {
  minMass: number;
  minSessions: number;
  minConsistency: number;
}

export type ThresholdSource = "auto-low" | "auto-medium" | "auto-high" | "manual";

export interface TalentDiagnostics {
  thresholds: AdaptiveThresholds;
  source: ThresholdSource;
  pressure: "low" | "medium" | "high";
  underuserCount: number;
  strongLeakCount: number;        // Lecks ≥ 40
  topLeakScore: number;
  riserCandidateCount: number;    // wie viele Riser nach Filter übrig blieben
  totalMatches: number;
}

const OVERRIDE_STORAGE_KEY = "talent-scout:thresholds-override";

export function loadThresholdOverride(): AdaptiveThresholds | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(OVERRIDE_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (
      typeof v?.minMass === "number" &&
      typeof v?.minSessions === "number" &&
      typeof v?.minConsistency === "number"
    ) {
      return { minMass: v.minMass, minSessions: v.minSessions, minConsistency: v.minConsistency };
    }
  } catch {/* ignore */}
  return null;
}

export function saveThresholdOverride(t: AdaptiveThresholds | null): void {
  if (typeof window === "undefined") return;
  if (t == null) window.localStorage.removeItem(OVERRIDE_STORAGE_KEY);
  else window.localStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(t));
}

interface OnboardingRow { chatter_name: string; onboarded_on: string }
interface HistoryRow {
  chatter_name: string;
  account: string | null;
  analysis_date: string;
  open_chats: number | null;
  response_delay_days: number | null;
  revenue_today: number | null;
  mass_dms: number | null;
}
interface ModelRow { model_name: string; follower_count: number }

function norm(s: string): string { return s.trim().toLowerCase(); }
function fuzzyKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/\d+$/, "");
}
function lookupFollowers(account: string, exact: Map<string, number>, fuzzy: Map<string, number[]>): number {
  const key = norm(account);
  const direct = exact.get(key);
  if (direct != null) return direct;
  const fk = fuzzyKey(account);
  if (!fk) return 0;
  const cands = fuzzy.get(fk);
  if (!cands || cands.length === 0) return 0;
  return Math.max(...cands);
}
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86400000);
}
function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// --- Score-Funktionen ---
interface UnderuserAgg {
  name: string;
  account: string;
  tier: AccountTier;
  avgOpenChats: number;
  avgDelay: number;
  avgRev: number;
  activityRatio: number; // 0..1 — Anteil Tage mit Aktivität in den 7T
}

function computeLeakScore(
  a: UnderuserAgg,
  poolOpenChatsMedian: number,
  tierRevMedian: number,
): number {
  const delayPart = a.avgDelay * 25;
  const jamPart = a.avgOpenChats > poolOpenChatsMedian
    ? (a.avgOpenChats - poolOpenChatsMedian) * 0.6
    : 0;
  const idlePart = (1 - a.activityRatio) * 40;
  const revPart = a.avgRev < tierRevMedian
    ? Math.min(40, (tierRevMedian - a.avgRev) * 0.3)
    : 0;
  return delayPart + jamPart + idlePart + revPart;
}

interface RiserAgg {
  name: string;
  daysOnboarded: number;
  tier: AccountTier;
  live: LiveEfficiencyRow;
  avgMassPerDay: number;
}

function computeRiserScore(r: RiserAgg): number {
  const massPart = r.avgMassPerDay * 6;
  const sessPart = r.live.session_count * 2;
  const respPart = r.live.first_response_min_p50 != null
    ? Math.max(0, 45 - r.live.first_response_min_p50)
    : 5;
  const consPart = (r.live.session_consistency ?? 0) * 30;
  return massPart + sessPart + respPart + consPart;
}

interface AdaptiveThresholds {
  minMass: number;
  minSessions: number;
  minConsistency: number;
}

function deriveAdaptiveThresholds(leakScores: number[]): AdaptiveThresholds {
  const strongLeaks = leakScores.filter((s) => s >= 40).length;
  if (strongLeaks >= 3) {
    return { minMass: 2, minSessions: 3, minConsistency: 0.35 };
  }
  if (strongLeaks >= 1) {
    return { minMass: 3, minSessions: 4, minConsistency: 0.5 };
  }
  return { minMass: 4, minSessions: 5, minConsistency: 0.7 };
}

export async function findTalentMatches(platform: string): Promise<TalentMatch[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const from = isoDaysAgo(HISTORY_DAYS);
  const to = isoDaysAgo(0);

  const [onboardingRes, historyRes, modelsRes, liveMap] = await Promise.all([
    supabase.rpc("get_chatter_onboarding", { p_platform: platform }),
    supabase
      .from("chatter_history")
      .select("chatter_name, account, analysis_date, open_chats, response_delay_days, revenue_today, mass_dms")
      .eq("user_id", user.id)
      .ilike("platform", platform)
      .gte("analysis_date", from),
    supabase
      .from("models")
      .select("model_name, follower_count")
      .eq("user_id", user.id)
      .ilike("platform", platform),
    fetchLiveEfficiency(platform, from, to),
  ]);

  const onboarding = (onboardingRes.data ?? []) as OnboardingRow[];
  const history = (historyRes.data ?? []) as HistoryRow[];
  const models = (modelsRes.data ?? []) as ModelRow[];

  if (onboarding.length === 0 || history.length === 0) return [];

  const followersByModel = new Map<string, number>();
  const followersFuzzy = new Map<string, number[]>();
  for (const m of models) {
    const f = Number(m.follower_count) || 0;
    followersByModel.set(norm(m.model_name), f);
    const fk = fuzzyKey(m.model_name);
    if (fk) {
      const arr = followersFuzzy.get(fk) ?? [];
      arr.push(f);
      followersFuzzy.set(fk, arr);
    }
  }

  const onboardedDays = new Map<string, number>();
  for (const o of onboarding) onboardedDays.set(norm(o.chatter_name), daysSince(o.onboarded_on));

  // Aggregation pro Chatter (jüngster Account, 7T-Mittelwerte + Aktivitätsquote)
  type Agg = UnderuserAgg & { followers: number; days: number };
  const sortedHist = [...history].sort((a, b) => b.analysis_date.localeCompare(a.analysis_date));
  const histByChatter = new Map<string, HistoryRow[]>();
  const accountByChatter = new Map<string, string>();
  for (const r of sortedHist) {
    if (!r.chatter_name) continue;
    const k = norm(r.chatter_name);
    const arr = histByChatter.get(k) ?? [];
    arr.push(r);
    histByChatter.set(k, arr);
    if (!accountByChatter.has(k)) {
      const acc = (r.account ?? "").split(",")[0]?.trim() ?? "";
      if (acc) accountByChatter.set(k, acc);
    }
  }

  const aggs: Agg[] = [];
  for (const [k, rows] of histByChatter) {
    const account = accountByChatter.get(k);
    if (!account) continue;
    const name = rows[0].chatter_name;
    const followers = lookupFollowers(account, followersByModel, followersFuzzy);
    const tier = tierForFollowers(followers);
    if (!tier) continue;
    const denom = rows.length;
    const activeDays = rows.filter((r) =>
      Number(r.revenue_today ?? 0) > 0 || Number(r.mass_dms ?? 0) > 0
    ).length;
    aggs.push({
      name,
      account,
      followers,
      tier,
      avgOpenChats: rows.reduce((s, r) => s + (r.open_chats ?? 0), 0) / denom,
      avgDelay: rows.reduce((s, r) => s + (r.response_delay_days ?? 0), 0) / denom,
      avgRev: rows.reduce((s, r) => s + Number(r.revenue_today ?? 0), 0) / denom,
      activityRatio: activeDays / HISTORY_DAYS,
      days: denom,
    });
  }
  if (aggs.length === 0) return [];

  // Pool-Statistiken
  const openChatsArr = aggs.map((a) => a.avgOpenChats).filter((v) => v > 0);
  const openChatsMedian = median(openChatsArr);
  const tierRevMedians = new Map<string, number>();
  for (const tierId of ["seed", "starter", "growth", "top"]) {
    const vals = aggs.filter((a) => a.tier.id === tierId).map((a) => a.avgRev);
    tierRevMedians.set(tierId, median(vals));
  }

  // ---- Underuser-Pool (etabliert auf growth/top) ----
  type Underuser = UnderuserAgg & { leakScore: number };
  const underusers: Underuser[] = [];
  for (const a of aggs) {
    if (a.tier.id !== "growth" && a.tier.id !== "top") continue;
    const days = onboardedDays.get(norm(a.name));
    if (days == null || days < ESTABLISHED_MIN_DAYS) continue;
    const tierMed = tierRevMedians.get(a.tier.id) ?? 0;
    const leakScore = computeLeakScore(a, openChatsMedian, tierMed);
    if (leakScore <= 0) continue;
    underusers.push({ ...a, leakScore });
  }
  underusers.sort((a, b) => b.leakScore - a.leakScore);
  if (underusers.length === 0) return [];

  // Adaptive Schwellen je nach Druck im Underuser-Pool
  const thresholds = deriveAdaptiveThresholds(underusers.map((u) => u.leakScore));

  // ---- Riser-Pool (Onboarding Tag 5–21, seed/starter, weiche Schwellen) ----
  type RiserScored = RiserAgg & { riserScore: number };
  const risers: RiserScored[] = [];
  for (const a of aggs) {
    const days = onboardedDays.get(norm(a.name));
    if (days == null) continue;
    if (days < ONBOARDING_MIN_DAYS || days > ONBOARDING_MAX_DAYS) continue;
    if (a.tier.id !== "seed" && a.tier.id !== "starter") continue;

    const live = liveMap.get(norm(a.name));
    if (!live || !hasUsableLiveData(live)) continue;
    if (live.session_count < thresholds.minSessions) continue;

    const avgMassPerDay = live.total_mass_dms / Math.max(1, live.active_days);
    if (avgMassPerDay < thresholds.minMass) continue;
    if ((live.session_consistency ?? 0) < thresholds.minConsistency) continue;

    const r: RiserAgg = { name: a.name, daysOnboarded: days, tier: a.tier, live, avgMassPerDay };
    risers.push({ ...r, riserScore: computeRiserScore(r) });
  }
  if (risers.length === 0) return [];

  risers.sort((a, b) => b.riserScore - a.riserScore);

  // ---- Greedy-Pairing nach expectedGain ----
  const usedUnderusers = new Set<string>();
  const matches: TalentMatch[] = [];

  for (const r of risers) {
    if (matches.length >= MAX_MATCHES) break;
    const candidate = underusers.find((u) => !usedUnderusers.has(norm(u.name)));
    if (!candidate) break;

    const expectedGain = candidate.leakScore * 0.6 + r.riserScore * 0.4;
    if (expectedGain < MIN_EXPECTED_GAIN) continue;

    usedUnderusers.add(norm(candidate.name));
    matches.push({
      riser: r.name,
      riserDaysOnboarded: r.daysOnboarded,
      riserTier: r.tier,
      riserAvgMassDms: r.avgMassPerDay,
      riserResponseP50: r.live.first_response_min_p50,
      underuser: candidate.name,
      underuserTier: candidate.tier,
      underuserOpenChats: Math.round(candidate.avgOpenChats),
      underuserDelayDays: Math.round(candidate.avgDelay * 10) / 10,
      underuserAccount: candidate.account,
      matchScore: Math.min(100, Math.round(expectedGain)),
    });
  }

  return matches;
}
