/**
 * Talent-Scout — findet Aufsteiger im Onboarding (ab Tag 5) die stark performen,
 * aber auf zu kleinem Account sitzen — und paart sie mit "Underuser"-Kollegen,
 * die einen besseren Account haben, ihn aber nicht ausschöpfen.
 *
 * Datenquellen (alle vorhanden — keine Migration):
 *   • get_live_efficiency RPC (chatter_activity_sessions) — MassDMs, Reaktionszeit, Konsistenz
 *   • get_chatter_onboarding RPC — onboarded_on
 *   • chatter_history (7T) — Verzug, offene Chats für Underuser
 *   • models.follower_count + tierForFollowers — Tier-Einordnung
 *
 * Output: max. 5 Match-Vorschläge pro Tag.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchLiveEfficiency, hasUsableLiveData, type LiveEfficiencyRow } from "@/lib/live-efficiency";
import { tierForFollowers, type AccountTier } from "@/lib/account-tiers";

// --- Schwellen (zentral, einfach anpassbar) ---
const ONBOARDING_MIN_DAYS = 5;
const ONBOARDING_MAX_DAYS = 21;
const MIN_LIVE_SESSIONS = 5;
const MIN_AVG_MASSDMS = 4;
const MAX_RESPONSE_P50_MIN = 30;
const MIN_CONSISTENCY = 0.7;
const UNDERUSER_MIN_DELAY_DAYS = 2;
const UNDERUSER_MIN_OPEN_CHATS = 30;
const ESTABLISHED_MIN_DAYS = 14;
const MAX_MATCHES = 5;

export interface TalentMatch {
  /** Aufsteiger (junges Onboarding, stark performend) */
  riser: string;
  riserDaysOnboarded: number;
  riserTier: AccountTier;
  riserAvgMassDms: number;          // pro Tag im 7T-Fenster
  riserResponseP50: number | null;  // Minuten
  /** Underuser (etablierter Chatter mit besserem Account, aber Lecks) */
  underuser: string;
  underuserTier: AccountTier;
  underuserOpenChats: number;
  underuserDelayDays: number;
  underuserAccount: string;
  /** Score 0..100 — primär für Sortierung */
  matchScore: number;
}

interface OnboardingRow { chatter_name: string; onboarded_on: string }
interface HistoryRow {
  chatter_name: string;
  account: string | null;
  analysis_date: string;
  open_chats: number | null;
  response_delay_days: number | null;
  revenue_today: number | null;
}
interface ModelRow { model_name: string; follower_count: number }

function norm(s: string): string { return s.trim().toLowerCase(); }

/** Strip non-alphanum and trailing digits/underscores for tolerant matching */
function fuzzyKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/\d+$/, "");
}

/** Look up follower count with tolerant name matching (handles "bondgirl" vs "bondgirl4") */
function lookupFollowers(
  account: string,
  exact: Map<string, number>,
  fuzzy: Map<string, number[]>,
): number {
  const key = norm(account);
  const direct = exact.get(key);
  if (direct != null) return direct;
  const fk = fuzzyKey(account);
  if (!fk) return 0;
  const cands = fuzzy.get(fk);
  if (!cands || cands.length === 0) return 0;
  // Prefer the largest matching follower count (mostly we want any tier signal)
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

export async function findTalentMatches(platform: string): Promise<TalentMatch[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const from = isoDaysAgo(7);
  const to = isoDaysAgo(0);

  const [onboardingRes, historyRes, modelsRes, liveMap] = await Promise.all([
    supabase.rpc("get_chatter_onboarding", { p_platform: platform }),
    supabase
      .from("chatter_history")
      .select("chatter_name, account, analysis_date, open_chats, response_delay_days, revenue_today")
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
  for (const m of models) followersByModel.set(norm(m.model_name), Number(m.follower_count) || 0);

  const onboardedDays = new Map<string, number>();
  for (const o of onboarding) onboardedDays.set(norm(o.chatter_name), daysSince(o.onboarded_on));

  // History pro Chatter aggregieren — aktueller Account (jüngster Eintrag), 7T-Mittelwerte
  type Agg = {
    name: string;
    account: string;
    followers: number;
    tier: AccountTier;
    avgOpenChats: number;
    avgDelay: number;
    avgRev: number;
    days: number;
  };
  const sortedHist = [...history].sort((a, b) => b.analysis_date.localeCompare(a.analysis_date));
  const aggMap = new Map<string, { rows: HistoryRow[]; latestAccount: string }>();
  for (const r of sortedHist) {
    if (!r.chatter_name) continue;
    const k = norm(r.chatter_name);
    let entry = aggMap.get(k);
    if (!entry) {
      const acc = (r.account ?? "").split(",")[0]?.trim() ?? "";
      entry = { rows: [], latestAccount: acc };
      aggMap.set(k, entry);
    }
    entry.rows.push(r);
  }

  const aggs: Agg[] = [];
  for (const [, entry] of aggMap) {
    if (entry.rows.length === 0 || !entry.latestAccount) continue;
    const name = entry.rows[0].chatter_name;
    const followers = followersByModel.get(norm(entry.latestAccount)) ?? 0;
    const tier = tierForFollowers(followers);
    if (!tier) continue;
    const denom = entry.rows.length;
    aggs.push({
      name,
      account: entry.latestAccount,
      followers,
      tier,
      avgOpenChats: entry.rows.reduce((s, r) => s + (r.open_chats ?? 0), 0) / denom,
      avgDelay: entry.rows.reduce((s, r) => s + (r.response_delay_days ?? 0), 0) / denom,
      avgRev: entry.rows.reduce((s, r) => s + Number(r.revenue_today ?? 0), 0) / denom,
      days: denom,
    });
  }
  if (aggs.length === 0) return [];

  // Pool-Median für offene Chats (für Underuser-Erkennung)
  const openChatsArr = aggs.map((a) => a.avgOpenChats).filter((v) => v > 0).sort((a, b) => a - b);
  const openChatsMedian = openChatsArr.length > 0
    ? openChatsArr[Math.floor(openChatsArr.length / 2)]
    : 0;

  // ---- Aufsteiger filtern ----
  type Riser = {
    name: string;
    daysOnboarded: number;
    tier: AccountTier;
    live: LiveEfficiencyRow;
    avgMassPerDay: number;
  };
  const risers: Riser[] = [];
  for (const a of aggs) {
    const days = onboardedDays.get(norm(a.name));
    if (days == null) continue;
    if (days < ONBOARDING_MIN_DAYS || days > ONBOARDING_MAX_DAYS) continue;
    if (a.tier.id !== "seed" && a.tier.id !== "starter") continue;

    const live = liveMap.get(norm(a.name));
    if (!live || !hasUsableLiveData(live)) continue;
    if (live.session_count < MIN_LIVE_SESSIONS) continue;

    const avgMassPerDay = live.total_mass_dms / Math.max(1, live.active_days);
    if (avgMassPerDay < MIN_AVG_MASSDMS) continue;

    const fastResp = live.first_response_min_p50 != null && live.first_response_min_p50 <= MAX_RESPONSE_P50_MIN;
    const consistent = live.session_consistency >= MIN_CONSISTENCY;
    if (!fastResp && !consistent) continue;

    risers.push({ name: a.name, daysOnboarded: days, tier: a.tier, live, avgMassPerDay });
  }
  if (risers.length === 0) return [];

  // ---- Underuser filtern ----
  type Underuser = {
    name: string;
    account: string;
    tier: AccountTier;
    avgOpenChats: number;
    avgDelay: number;
    /** Quantifiziert wie groß die Lecks sind (höher = schlechter ausgeschöpft) */
    leakScore: number;
  };
  const underusers: Underuser[] = [];
  for (const a of aggs) {
    if (a.tier.id !== "growth" && a.tier.id !== "top") continue;
    const days = onboardedDays.get(norm(a.name));
    if (days == null || days < ESTABLISHED_MIN_DAYS) continue;

    const slowResp = a.avgDelay >= UNDERUSER_MIN_DELAY_DAYS;
    const jammed = a.avgOpenChats >= UNDERUSER_MIN_OPEN_CHATS && a.avgOpenChats > openChatsMedian * 1.5;
    if (!slowResp && !jammed) continue;

    const leakScore =
      a.avgDelay * 20 +
      (a.avgOpenChats > openChatsMedian ? (a.avgOpenChats - openChatsMedian) * 0.5 : 0);
    underusers.push({
      name: a.name,
      account: a.account,
      tier: a.tier,
      avgOpenChats: a.avgOpenChats,
      avgDelay: a.avgDelay,
      leakScore,
    });
  }
  if (underusers.length === 0) return [];

  // ---- Pairing: jeder Riser kriegt seinen besten Underuser ----
  const used = new Set<string>();
  const matches: TalentMatch[] = [];
  // Riser nach Stärke sortieren — beste zuerst (mehr Sessions × MassDMs)
  const sortedRisers = [...risers].sort((a, b) => (b.avgMassPerDay * b.live.session_count) - (a.avgMassPerDay * a.live.session_count));

  for (const r of sortedRisers) {
    if (matches.length >= MAX_MATCHES) break;
    const candidates = underusers
      .filter((u) => !used.has(norm(u.name)))
      .sort((a, b) => b.leakScore - a.leakScore);
    const best = candidates[0];
    if (!best) continue;
    used.add(norm(best.name));

    const matchScore = Math.min(100, Math.round(
      r.avgMassPerDay * 5 +
      (r.live.first_response_min_p50 != null ? Math.max(0, 30 - r.live.first_response_min_p50) : 10) +
      best.leakScore * 0.5,
    ));

    matches.push({
      riser: r.name,
      riserDaysOnboarded: r.daysOnboarded,
      riserTier: r.tier,
      riserAvgMassDms: r.avgMassPerDay,
      riserResponseP50: r.live.first_response_min_p50,
      underuser: best.name,
      underuserTier: best.tier,
      underuserOpenChats: Math.round(best.avgOpenChats),
      underuserDelayDays: Math.round(best.avgDelay * 10) / 10,
      underuserAccount: best.account,
      matchScore,
    });
  }

  return matches;
}
