/**
 * Talent-Scout v2 — Workhorses ↔ Verwaiste Accounts.
 *
 * Idee: Wir filtern niemanden mit harten Schwellen weg. Stattdessen
 *   1. ranken wir alle Chatter nach **Verlässlichkeit** (Anwesenheit + Streak,
 *      kleiner Onboarding-Bonus) — die "Workhorses".
 *   2. ranken wir alle Chatter-Account-Paare nach **Vernachlässigung**
 *      (stille Tage, Verzug, Stau, Umsatz unter Tier-Median, gewichtet mit
 *      Tier-Größe) — die "verwaisten Accounts".
 *   3. paaren wir greedy: Top-Workhorse → Top-verwaister-Account, sofern
 *      es nicht derselbe Chatter ist und der Account-Tier mindestens dem
 *      eigenen entspricht (ein Workhorse soll *aufsteigen*).
 *
 * Keine Slider, kein Override, keine festen Mindestwerte.
 */
import { supabase } from "@/integrations/supabase/client";
import { tierForFollowers, type AccountTier } from "@/lib/account-tiers";

const HISTORY_DAYS = 7;
const MAX_MATCHES = 8;
const MAX_WORKHORSES = 12;
const ONBOARDING_BONUS_MIN = 5;
const ONBOARDING_BONUS_MAX = 45;
const ONBOARDING_BONUS_FACTOR = 1.15;

// Mindestpaarung-Schwellen — ganz weich, nur damit komplett gesunde Accounts
// nicht als "verwaist" gemeldet werden.
const MIN_PAIR_SCORE = 25;
const MIN_ORPHAN_PAIN = 20;

const TIER_WEIGHT: Record<string, number> = {
  seed: 0.7,
  starter: 1.0,
  growth: 1.2,
  top: 1.4,
};
const TIER_RANK: Record<string, number> = { seed: 0, starter: 1, growth: 2, top: 3 };

export interface TalentMatch {
  riser: string;
  riserDaysOnboarded: number | null;
  riserTier: AccountTier | null;
  riserStreak: number;          // längste aktive Strecke in 7T
  riserActiveDays: number;      // aktive Tage in 7T (0–7)
  underuser: string;
  underuserTier: AccountTier;
  underuserAccount: string;
  underuserActiveDays: number;
  underuserOpenChats: number;
  underuserDelayDays: number;
  matchScore: number;           // 0–100, höher = größerer Hebel
}

export interface OrphanWarning {
  chatter: string;
  account: string;
  tier: AccountTier;
  activeDays: number;
  delayDays: number;
  openChats: number;
  painScore: number;
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

const norm = (s: string) => s.trim().toLowerCase();
const fuzzyKey = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/\d+$/, "");

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
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function lookupFollowers(
  account: string,
  exact: Map<string, number>,
  fuzzy: Map<string, number[]>,
): number {
  const direct = exact.get(norm(account));
  if (direct != null) return direct;
  const fk = fuzzyKey(account);
  if (!fk) return 0;
  const cands = fuzzy.get(fk);
  return cands && cands.length ? Math.max(...cands) : 0;
}

interface ChatterAgg {
  name: string;
  account: string;
  followers: number;
  tier: AccountTier | null;
  daysOnboarded: number | null;
  // 7T-Werte
  activeDays: number;          // Tage mit irgendeiner Aktivität
  streak: number;              // längste zusammenhängende aktive Strecke
  avgOpenChats: number;
  avgDelay: number;
  avgRev: number;
}

function workhorseScore(a: ChatterAgg): number {
  const presence = a.activeDays / HISTORY_DAYS;          // 0..1
  const streakRatio = a.streak / HISTORY_DAYS;           // 0..1
  let s = presence * 50 + streakRatio * 35;
  if (
    a.daysOnboarded != null &&
    a.daysOnboarded >= ONBOARDING_BONUS_MIN &&
    a.daysOnboarded <= ONBOARDING_BONUS_MAX
  ) {
    s *= ONBOARDING_BONUS_FACTOR;
  }
  return s;
}

function orphanPainScore(
  a: ChatterAgg,
  poolOpenChatsMedian: number,
  tierRevMedian: number,
): number {
  if (!a.tier) return 0;
  const idleDays = HISTORY_DAYS - a.activeDays;
  const idlePart = idleDays * 12;
  const stauPart = a.avgOpenChats > poolOpenChatsMedian
    ? (a.avgOpenChats - poolOpenChatsMedian) * 0.5
    : 0;
  const delayPart = a.avgDelay * 20;
  const revGap = tierRevMedian > 0
    ? Math.max(0, (tierRevMedian - a.avgRev) / tierRevMedian)
    : 0;
  const revPart = revGap * 30;
  const raw = idlePart + stauPart + delayPart + revPart;
  return raw * (TIER_WEIGHT[a.tier.id] ?? 1.0);
}

async function loadAggs(platform: string): Promise<{
  aggs: ChatterAgg[];
  poolOpenChatsMedian: number;
  tierRevMedian: Map<string, number>;
}> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { aggs: [], poolOpenChatsMedian: 0, tierRevMedian: new Map() };

  const from = isoDaysAgo(HISTORY_DAYS);

  const [onboardingRes, historyRes, modelsRes] = await Promise.all([
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
  ]);

  const onboarding = (onboardingRes.data ?? []) as OnboardingRow[];
  const history = (historyRes.data ?? []) as HistoryRow[];
  const models = (modelsRes.data ?? []) as ModelRow[];
  if (history.length === 0) return { aggs: [], poolOpenChatsMedian: 0, tierRevMedian: new Map() };

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

  // Pro Chatter: jüngsten Account + aggregierte 7T-Werte + Streak
  const sorted = [...history].sort((a, b) => b.analysis_date.localeCompare(a.analysis_date));
  const byChatter = new Map<string, HistoryRow[]>();
  const accountByChatter = new Map<string, string>();
  for (const r of sorted) {
    if (!r.chatter_name) continue;
    const k = norm(r.chatter_name);
    const arr = byChatter.get(k) ?? [];
    arr.push(r);
    byChatter.set(k, arr);
    if (!accountByChatter.has(k)) {
      const acc = (r.account ?? "").split(",")[0]?.trim() ?? "";
      if (acc) accountByChatter.set(k, acc);
    }
  }

  // Aktive-Tag-Map pro Chatter (Set von ISO-Tagen mit Aktivität)
  function computeStreak(daySet: Set<string>): number {
    if (daySet.size === 0) return 0;
    let best = 0, cur = 0;
    for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
      const day = isoDaysAgo(i);
      if (daySet.has(day)) {
        cur += 1;
        if (cur > best) best = cur;
      } else {
        cur = 0;
      }
    }
    return best;
  }

  const aggs: ChatterAgg[] = [];
  for (const [k, rows] of byChatter) {
    const account = accountByChatter.get(k) ?? "";
    const name = rows[0].chatter_name;
    const followers = account ? lookupFollowers(account, followersByModel, followersFuzzy) : 0;
    const tier = account ? tierForFollowers(followers) : null;

    const denom = rows.length;
    const activeSet = new Set<string>();
    for (const r of rows) {
      const isActive =
        Number(r.revenue_today ?? 0) > 0 ||
        Number(r.mass_dms ?? 0) > 0 ||
        Number(r.open_chats ?? 0) > 0;
      if (isActive) activeSet.add(r.analysis_date);
    }

    aggs.push({
      name,
      account,
      followers,
      tier,
      daysOnboarded: onboardedDays.get(k) ?? null,
      activeDays: activeSet.size,
      streak: computeStreak(activeSet),
      avgOpenChats: rows.reduce((s, r) => s + (r.open_chats ?? 0), 0) / denom,
      avgDelay: rows.reduce((s, r) => s + (r.response_delay_days ?? 0), 0) / denom,
      avgRev: rows.reduce((s, r) => s + Number(r.revenue_today ?? 0), 0) / denom,
    });
  }

  const openVals = aggs.map((a) => a.avgOpenChats).filter((v) => v > 0);
  const poolOpenChatsMedian = median(openVals);
  const tierRevMedian = new Map<string, number>();
  for (const tierId of ["seed", "starter", "growth", "top"]) {
    const vals = aggs.filter((a) => a.tier?.id === tierId).map((a) => a.avgRev);
    tierRevMedian.set(tierId, median(vals));
  }

  return { aggs, poolOpenChatsMedian, tierRevMedian };
}

export async function findTalentMatches(platform: string): Promise<TalentMatch[]> {
  const { aggs, poolOpenChatsMedian, tierRevMedian } = await loadAggs(platform);
  if (aggs.length === 0) return [];

  // Workhorses — nach Verlässlichkeit
  const workhorses = aggs
    .map((a) => ({ a, score: workhorseScore(a) }))
    .filter((w) => w.a.activeDays >= 2) // mindestens 2 von 7 Tagen aktiv
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_WORKHORSES);

  // Verwaiste Accounts — nach Schmerz
  const orphans = aggs
    .filter((a) => a.tier && a.account)
    .map((a) => ({
      a,
      pain: orphanPainScore(a, poolOpenChatsMedian, tierRevMedian.get(a.tier!.id) ?? 0),
    }))
    .filter((o) => o.pain >= MIN_ORPHAN_PAIN)
    .sort((x, y) => y.pain - x.pain);

  if (orphans.length === 0 || workhorses.length === 0) return [];

  // Greedy-Pairing
  const usedOrphans = new Set<string>();
  const usedWorkhorses = new Set<string>();
  const matches: TalentMatch[] = [];

  for (const w of workhorses) {
    if (matches.length >= MAX_MATCHES) break;
    const wKey = norm(w.a.name);
    if (usedWorkhorses.has(wKey)) continue;

    const ownTierRank = w.a.tier ? TIER_RANK[w.a.tier.id] : -1;

    const candidate = orphans.find((o) => {
      const oKey = norm(o.a.name);
      if (usedOrphans.has(oKey)) return false;
      if (oKey === wKey) return false;
      // Workhorse darf nur auf gleichen oder größeren Account wechseln
      if (TIER_RANK[o.a.tier!.id] < ownTierRank) return false;
      return true;
    });
    if (!candidate) continue;

    const pairScore = candidate.pain * 0.6 + w.score * 0.4;
    if (pairScore < MIN_PAIR_SCORE) continue;

    usedOrphans.add(norm(candidate.a.name));
    usedWorkhorses.add(wKey);

    matches.push({
      riser: w.a.name,
      riserDaysOnboarded: w.a.daysOnboarded,
      riserTier: w.a.tier,
      riserStreak: w.a.streak,
      riserActiveDays: w.a.activeDays,
      underuser: candidate.a.name,
      underuserTier: candidate.a.tier!,
      underuserAccount: candidate.a.account,
      underuserActiveDays: candidate.a.activeDays,
      underuserOpenChats: Math.round(candidate.a.avgOpenChats),
      underuserDelayDays: Math.round(candidate.a.avgDelay * 10) / 10,
      matchScore: Math.min(100, Math.round(pairScore)),
    });
  }

  return matches;
}

/** Verwaiste Accounts ohne passenden Workhorse — als Solo-Warnungen. */
export async function findOrphanedAccounts(platform: string): Promise<OrphanWarning[]> {
  const { aggs, poolOpenChatsMedian, tierRevMedian } = await loadAggs(platform);
  if (aggs.length === 0) return [];
  return aggs
    .filter((a) => a.tier && a.account)
    .map((a) => ({
      chatter: a.name,
      account: a.account,
      tier: a.tier!,
      activeDays: a.activeDays,
      delayDays: Math.round(a.avgDelay * 10) / 10,
      openChats: Math.round(a.avgOpenChats),
      painScore: Math.round(
        orphanPainScore(a, poolOpenChatsMedian, tierRevMedian.get(a.tier!.id) ?? 0),
      ),
    }))
    .filter((o) => o.painScore >= MIN_ORPHAN_PAIN)
    .sort((x, y) => y.painScore - x.painScore);
}
