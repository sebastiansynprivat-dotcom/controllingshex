/**
 * Talent-Scout v3 — Workhorses ↔ Verwaiste Accounts (live-basiert).
 *
 * Änderungen ggü. v2:
 *   • Verwaiste Accounts werden NUR noch über Echtzeit-KPIs des heutigen Tages
 *     bewertet: `oldest_chat` (Tage seit ältestem offenem Chat) + `unread_chats`
 *     aus `chatter_history_live`. Online-Zeit/Aktivität spielt hier keine Rolle.
 *   • Workhorses bleiben historisch: Anwesenheit + Streak der letzten 7 Tage
 *     (ohne den heutigen Tag, der ist noch nicht abgeschlossen).
 *   • Es werden ausschließlich Chatter berücksichtigt, die im NEUESTEN Report
 *     der Plattform noch enthalten sind (raus = raus).
 */
import { supabase } from "@/integrations/supabase/client";
import { tierForFollowers, type AccountTier } from "@/lib/account-tiers";
import { loadActiveChatterNames, normalizeChatterName } from "@/lib/active-chatters";

const HISTORY_DAYS = 7;
const MAX_MATCHES = 8;
const MAX_WORKHORSES = 12;
const ONBOARDING_BONUS_MIN = 5;
const ONBOARDING_BONUS_MAX = 45;
const ONBOARDING_BONUS_FACTOR = 1.15;

// Schmerz-Schwellen für „verwaister Account":
// es muss mindestens ein klares Live-Signal heute geben.
const MIN_OLDEST_CHAT_DAYS = 2;   // älterer offener Chat ≥ 2 Tage
const MIN_UNREAD_CHATS = 25;      // ODER ≥ 25 unread heute
const MIN_PAIR_SCORE = 25;

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
  riserStreak: number;
  riserActiveDays: number;
  riserDmDays: number;
  riserChatWorkDays: number;
  riserRevenueDays: number;
  riserHasRevenueBoost: boolean;
  riserAvgRevenue: number;
  underuser: string;
  underuserTier: AccountTier;
  underuserAccount: string;
  underuserFollowers: number;
  underuserAvgRevenue6d: number;
  underuserRecentAvgRevenue2d: number;
  underuserActiveDays: number;
  underuserOpenChats: number;
  underuserOldestChatDays: number;
  underuserDelayDays: number;
  matchScore: number;
  isCritical: boolean;          // visuell markiert — dringend on Track bringen
}

export interface OrphanWarning {
  chatter: string;
  account: string;
  tier: AccountTier;
  followers: number;
  avgRevenue6d: number;
  recentAvgRevenue2d: number;
  activeDays: number;
  delayDays: number;
  openChats: number;
  oldestChatDays: number;
  painScore: number;
  isCritical: boolean;          // visuell markiert — Top/Growth stark im Rückgang
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
interface LiveRow {
  chatter_name: string;
  date: string;
  unread_chats: number | null;
  oldest_chat: number | null;
  updated_at: string;
}

const norm = (s: string) => s.trim().toLowerCase();
const fuzzyKey = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/\d+$/, "");

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86400000);
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
  // 7T-Werte (ohne heute) — für Workhorse-Score
  activeDays: number;
  streak: number;
  avgDelay: number;
  dmDays: number;              // Tage mit Mass-DMs
  chatWorkDays: number;        // Tage mit Bewegung in open_chats (Arbeit am Inbox)
  revenueDays: number;         // Tage mit Umsatz > 0
  avgRevenue: number;          // Ø € pro aktivem Tag
  recentAvgRevenue2d: number;  // Ø € der letzten 2 Tage (mit Umsatz)
  // Live-Werte heute — für Underuser-Score
  liveOpenChats: number;
  liveOldestChatDays: number;
}

/**
 * Talent-Score (Stufen):
 *  1. Grundvoraussetzung: arbeitet aktiv Chats ab + schickt Mass-DMs.
 *     Ohne diese beiden Faktoren → 0, Chatter taucht nicht als Talent auf.
 *  2. Bonus-Stufe: zusätzlich Umsatz → Revenue-Boost (markiert visuell stärker).
 */
function workhorseScore(a: ChatterAgg): number {
  const denom = Math.max(1, HISTORY_DAYS - 1); // ohne heute
  const chatWork = Math.min(1, a.chatWorkDays / denom);
  const dmConst = Math.min(1, a.dmDays / denom);
  // Hartes Gate: beide Grundvoraussetzungen müssen ≥1 sein, sonst 0
  if (a.chatWorkDays < 2 || a.dmDays < 2) return 0;
  const presence = Math.min(1, a.activeDays / denom);
  const streakRatio = Math.min(1, a.streak / denom);
  // Basis-Score aus Aktivität + DMs + Streak
  let s = chatWork * 30 + dmConst * 30 + presence * 15 + streakRatio * 10;
  // Revenue-Boost (0..1.5×) — je mehr Umsatztage, desto stärker
  const revRatio = Math.min(1, a.revenueDays / denom);
  s *= 1 + revRatio * 0.5;
  if (
    a.daysOnboarded != null &&
    a.daysOnboarded >= ONBOARDING_BONUS_MIN &&
    a.daysOnboarded <= ONBOARDING_BONUS_MAX
  ) {
    s *= ONBOARDING_BONUS_FACTOR;
  }
  return s;
}

function hasRevenueBoost(a: ChatterAgg): boolean {
  return a.revenueDays >= 3 && a.dmDays >= 2 && a.chatWorkDays >= 2;
}

/** Live-Schmerz-Score: nur oldest_chat (Tage) und unread_chats (heute). */
function orphanPainScore(a: ChatterAgg): number {
  if (!a.tier) return 0;
  const hasSignal =
    a.liveOldestChatDays >= MIN_OLDEST_CHAT_DAYS ||
    a.liveOpenChats >= MIN_UNREAD_CHATS;
  if (!hasSignal) return 0;
  // oldest_chat (Tage) ist der Hauptschmerz, unread füllt auf.
  const oldestPart = a.liveOldestChatDays * 10;
  const unreadPart = Math.max(0, a.liveOpenChats - 10) * 0.4;
  const raw = oldestPart + unreadPart;
  return raw * (TIER_WEIGHT[a.tier.id] ?? 1.0);
}

async function loadAggs(platform: string): Promise<ChatterAgg[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const fromHist = isoDaysAgo(HISTORY_DAYS);
  const today = todayISO();
  const yesterday = isoDaysAgo(1);

  const [onboardingRes, historyRes, modelsRes, liveRes, activeNames] = await Promise.all([
    supabase.rpc("get_chatter_onboarding", { p_platform: platform }),
    supabase
      .from("chatter_history")
      .select("chatter_name, account, analysis_date, open_chats, response_delay_days, revenue_today, mass_dms")
      .eq("user_id", user.id)
      .ilike("platform", platform)
      .gte("analysis_date", fromHist),
    supabase
      .from("models")
      .select("model_name, follower_count")
      .eq("user_id", user.id)
      .ilike("platform", platform),
    supabase
      .from("chatter_history_live")
      .select("chatter_name, date, unread_chats, oldest_chat, updated_at")
      .ilike("platform", platform)
      .gte("date", yesterday),
    loadActiveChatterNames(platform),
  ]);

  const onboarding = (onboardingRes.data ?? []) as OnboardingRow[];
  const history = (historyRes.data ?? []) as HistoryRow[];
  const models = (modelsRes.data ?? []) as ModelRow[];
  const live = (liveRes.data ?? []) as LiveRow[];

  if (history.length === 0) return [];

  // Active-Filter: nur Chatter, die im neuesten Report noch existieren.
  const isActive = (name: string) =>
    activeNames === null ? true : activeNames.has(normalizeChatterName(name));

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

  // Live-Daten: jeweils neuester Eintrag (heute bevorzugt) pro Chatter.
  const liveByChatter = new Map<string, LiveRow>();
  const liveSorted = [...live].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
  });
  for (const r of liveSorted) {
    if (!r.chatter_name) continue;
    const k = norm(r.chatter_name);
    if (!liveByChatter.has(k)) liveByChatter.set(k, r);
  }

  // Historie ohne heute (heute ist noch unvollständig).
  const histPast = history.filter((r) => r.analysis_date !== today);

  const sorted = [...histPast].sort((a, b) => b.analysis_date.localeCompare(a.analysis_date));
  const byChatter = new Map<string, HistoryRow[]>();
  const accountByChatter = new Map<string, string>();
  for (const r of sorted) {
    if (!r.chatter_name) continue;
    if (!isActive(r.chatter_name)) continue;
    const k = norm(r.chatter_name);
    const arr = byChatter.get(k) ?? [];
    arr.push(r);
    byChatter.set(k, arr);
    if (!accountByChatter.has(k)) {
      const acc = (r.account ?? "").split(",")[0]?.trim() ?? "";
      if (acc) accountByChatter.set(k, acc);
    }
  }

  function computeStreak(daySet: Set<string>): number {
    if (daySet.size === 0) return 0;
    let best = 0, cur = 0;
    // letzte 6 Tage (ohne heute)
    for (let i = HISTORY_DAYS - 1; i >= 1; i--) {
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
    const dmSet = new Set<string>();
    const chatWorkSet = new Set<string>();
    const revSet = new Set<string>();
    const revVals: number[] = [];
    for (const r of rows) {
      const rev = Number(r.revenue_today ?? 0);
      const dm = Number(r.mass_dms ?? 0);
      const chats = Number(r.open_chats ?? 0);
      const isAct = rev > 0 || dm > 0 || chats > 0;
      if (isAct) activeSet.add(r.analysis_date);
      if (dm > 0) dmSet.add(r.analysis_date);
      // "Chats abgearbeitet" — Annäherung: an dem Tag waren offene Chats sichtbar
      // (Person hat den Inbox-Stack bearbeitet) ODER es kam Umsatz / DM dazu.
      if (chats > 0 || dm > 0 || rev > 0) chatWorkSet.add(r.analysis_date);
      if (rev > 0) { revSet.add(r.analysis_date); revVals.push(rev); }
    }
    const avgRevenue = revVals.length === 0
      ? 0
      : revVals.reduce((s, v) => s + v, 0) / revVals.length;

    // Letzte 2 abgeschlossene Tage: Ø Umsatz über Tage mit Umsatz > 0
    const recentDays = [isoDaysAgo(1), isoDaysAgo(2)];
    const recentRevVals = rows
      .filter((r) => recentDays.includes(r.analysis_date))
      .map((r) => Number(r.revenue_today ?? 0))
      .filter((v) => v > 0);
    const recentAvgRevenue2d = recentRevVals.length === 0
      ? 0
      : recentRevVals.reduce((s, v) => s + v, 0) / recentRevVals.length;

    const liveRow = liveByChatter.get(k);
    aggs.push({
      name,
      account,
      followers,
      tier,
      daysOnboarded: onboardedDays.get(k) ?? null,
      activeDays: activeSet.size,
      streak: computeStreak(activeSet),
      avgDelay: rows.reduce((s, r) => s + (r.response_delay_days ?? 0), 0) / Math.max(1, denom),
      dmDays: dmSet.size,
      chatWorkDays: chatWorkSet.size,
      revenueDays: revSet.size,
      avgRevenue,
      recentAvgRevenue2d,
      liveOpenChats: Math.max(0, Number(liveRow?.unread_chats ?? 0)),
      liveOldestChatDays: Math.max(0, Number(liveRow?.oldest_chat ?? 0)),
    });
  }

  return aggs;
}

export async function findTalentMatches(
  platform: string,
  rejectedPairs?: Set<string>,
): Promise<TalentMatch[]> {
  const aggs = await loadAggs(platform);
  if (aggs.length === 0) return [];
  const rejected = rejectedPairs ?? new Set<string>();

  // Workhorses — Gate: ≥3 aktive Tage, ≥2 Chat-Work-Tage, ≥2 DM-Tage (in workhorseScore enthalten).
  const workhorses = aggs
    .map((a) => ({ a, score: workhorseScore(a) }))
    .filter((w) => w.score > 0 && w.a.activeDays >= 3)
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_WORKHORSES);

  // Verwaiste Accounts — nach Live-Schmerz (oldest_chat + unread heute).
  const orphans = aggs
    .filter((a) => a.tier && a.account)
    .map((a) => ({ a, pain: orphanPainScore(a) }))
    .filter((o) => o.pain > 0)
    .sort((x, y) => y.pain - x.pain);

  if (orphans.length === 0 || workhorses.length === 0) return [];

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
      if (TIER_RANK[o.a.tier!.id] < ownTierRank) return false;
      // Abgelehnte Riser↔Account-Kombi überspringen
      if (rejected.has(`${wKey}|${norm(o.a.account)}`)) return false;
      return true;
    });
    if (!candidate) continue;

    // Pair-Score: Pain + Workhorse-Score + Revenue-Bonus
    const revBoost = hasRevenueBoost(w.a) ? 15 : 0;
    const pairScore = candidate.pain * 0.55 + w.score * 0.4 + revBoost;
    if (pairScore < MIN_PAIR_SCORE) continue;

    usedOrphans.add(norm(candidate.a.name));
    usedWorkhorses.add(wKey);

    matches.push({
      riser: w.a.name,
      riserDaysOnboarded: w.a.daysOnboarded,
      riserTier: w.a.tier,
      riserStreak: w.a.streak,
      riserActiveDays: w.a.activeDays,
      riserDmDays: w.a.dmDays,
      riserChatWorkDays: w.a.chatWorkDays,
      riserRevenueDays: w.a.revenueDays,
      riserHasRevenueBoost: hasRevenueBoost(w.a),
      riserAvgRevenue: Math.round(w.a.avgRevenue),
      underuser: candidate.a.name,
      underuserTier: candidate.a.tier!,
      underuserAccount: candidate.a.account,
      underuserFollowers: candidate.a.followers,
      underuserAvgRevenue6d: candidate.a.avgRevenue,
      underuserRecentAvgRevenue2d: candidate.a.recentAvgRevenue2d,
      underuserActiveDays: candidate.a.activeDays,
      underuserOpenChats: candidate.a.liveOpenChats,
      underuserOldestChatDays: candidate.a.liveOldestChatDays,
      underuserDelayDays: Math.round(candidate.a.avgDelay * 10) / 10,
      matchScore: Math.min(100, Math.round(pairScore)),
    });
  }

  return matches;
}

/** Verwaiste Accounts ohne passenden Workhorse — als Solo-Warnungen. */
export async function findOrphanedAccounts(platform: string): Promise<OrphanWarning[]> {
  const aggs = await loadAggs(platform);
  if (aggs.length === 0) return [];
  return aggs
    .filter((a) => a.tier && a.account)
    .map((a) => ({
      chatter: a.name,
      account: a.account,
      tier: a.tier!,
      followers: a.followers,
      avgRevenue6d: a.avgRevenue,
      recentAvgRevenue2d: a.recentAvgRevenue2d,
      activeDays: a.activeDays,
      delayDays: Math.round(a.avgDelay * 10) / 10,
      openChats: a.liveOpenChats,
      oldestChatDays: a.liveOldestChatDays,
      painScore: Math.round(orphanPainScore(a)),
    }))
    .filter((o) => o.painScore > 0)
    .sort((x, y) => y.painScore - x.painScore);
}
