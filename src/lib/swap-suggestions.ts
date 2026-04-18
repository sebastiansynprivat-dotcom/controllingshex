/**
 * Swap Suggestions — v2 (Tier-System + Skill-Score + Peer-Benchmarks)
 *
 * Idee: Tausch-Vorschläge basieren nicht mehr auf nackter revenue/followers-Effizienz,
 * sondern auf einem Skill-Score (Disziplin, Zuverlässigkeit, Throughput, Skill-Beweis).
 * Aus 7 Tagen History gemittelt — Tagesausreißer verzerren nichts mehr.
 *
 * Tier-System:
 *   Micro    < 500 Follower
 *   Small    500 – 2.000
 *   Medium   2.000 – 10.000
 *   Large    10.000 – 50.000
 *   Huge     ≥ 50.000
 *
 * Tausch-Constraint: Max. 2 Tier-Sprünge nach oben.
 *   → Micro-Chatter kriegt nur Small/Medium-Vorschlag (kein Sprung auf Huge)
 *
 * Erwarteter Gain via Peer-Cluster-Median, skaliert mit Skill-Score:
 *   expected = peer_median(target_tier) * (skill_score / 0.5) - current_revenue
 */

import type { BenchmarkBundle } from "@/lib/peer-benchmarks";
import { findCluster } from "@/lib/peer-benchmarks";

export type Tier = "Micro" | "Small" | "Medium" | "Large" | "Huge";

const TIER_ORDER: Tier[] = ["Micro", "Small", "Medium", "Large", "Huge"];

export function tierOf(followers: number): Tier {
  if (followers < 500) return "Micro";
  if (followers < 2_000) return "Small";
  if (followers < 10_000) return "Medium";
  if (followers < 50_000) return "Large";
  return "Huge";
}

function tierIndex(t: Tier): number {
  return TIER_ORDER.indexOf(t);
}

export interface HistoryRow {
  analysis_date: string;
  revenue_today: number;
  mass_dms: number;
  open_chats: number;
  response_delay_days: number;
}

export interface SwapInput {
  name: string;
  account?: string;
  /** Heutiger Tagesumsatz (aus KPIs) */
  currentRevenue: number;
  /** Letzte ~7-30 Tage History (wird auf 7 Tage gefiltert) */
  history?: HistoryRow[];
}

export interface SwapModelInfo {
  model_name: string;
  follower_count: number;
}

export interface SwapChatter {
  name: string;
  account: string;
  followers: number;
  tier: Tier;
  /** Tagesumsatz heute */
  currentRevenue: number;
  /** 7-Tage-Schnitt Umsatz */
  avgRevenue: number;
  /** 7-Tage-Schnitt Mass-DMs */
  avgMassDms: number;
  /** 7-Tage-Schnitt offene Chats (niedriger = besser) */
  avgOpenChats: number;
  /** 7-Tage-Schnitt Response-Delay (niedriger = besser) */
  avgResponseDelay: number;
  /** Skill-Score 0..1 */
  skillScore: number;
  /** Sub-Scores für UI/Debugging */
  scoreBreakdown: {
    massDms: number;
    response: number;
    throughput: number;
    revenue: number;
  };
}

export interface SwapPair {
  left: SwapChatter; // underplaced (verdient besseren Account)
  right: SwapChatter; // overplaced (sitzt auf zu starkem Account)
  /** Erwarteter Mehr-Umsatz pro Tag wenn left auf rights Account wechselt */
  expectedGain: number;
  /** Tier-Sprung-Distanz (1 = nur 1 Tier rauf, 2 = 2 Tier rauf) */
  tierJump: number;
  leftAlternatives: SwapChatter[];
  rightAlternatives: SwapChatter[];
}

/* ------------------------------------------------------------------ */
/*  SKILL-SCORE BERECHNUNG                                              */
/* ------------------------------------------------------------------ */

const WEIGHTS = {
  massDms: 0.35,
  response: 0.25,
  throughput: 0.20,
  revenue: 0.20,
};

/**
 * Normalisiert einen Wert auf 0..1 mittels Min-Max gegenüber dem Pool.
 * Höher ist besser.
 */
function normalizeHigherBetter(value: number, allValues: number[]): number {
  if (allValues.length === 0) return 0;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

/**
 * Niedriger ist besser → invertierte Normalisierung.
 */
function normalizeLowerBetter(value: number, allValues: number[]): number {
  if (allValues.length === 0) return 0;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  if (max === min) return 0.5;
  return 1 - (value - min) / (max - min);
}

/**
 * Effizienz (rev/followers) auf 0..1 — als "Skill-Beweis" wenn der Account
 * groß genug ist um Geld zu verdienen.
 */
function revenueEfficiencyScore(c: SwapChatter, allEfficiencies: number[]): number {
  // Mini-Models (<100 Follower) bekommen neutrale 0.5 — kein Skill-Beweis möglich
  if (c.followers < 100) return 0.5;
  const eff = c.avgRevenue / Math.max(c.followers, 1);
  return normalizeHigherBetter(eff, allEfficiencies);
}

/* ------------------------------------------------------------------ */
/*  HISTORY → 7-TAGE-SCHNITTE                                           */
/* ------------------------------------------------------------------ */

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function aggregate7Day(history?: HistoryRow[]): {
  avgRevenue: number;
  avgMassDms: number;
  avgOpenChats: number;
  avgResponseDelay: number;
} {
  const rows = (history || []).slice(-7);
  return {
    avgRevenue: avg(rows.map((r) => Number(r.revenue_today) || 0)),
    avgMassDms: avg(rows.map((r) => Number(r.mass_dms) || 0)),
    avgOpenChats: avg(rows.map((r) => Number(r.open_chats) || 0)),
    avgResponseDelay: avg(rows.map((r) => Number(r.response_delay_days) || 0)),
  };
}

/* ------------------------------------------------------------------ */
/*  HAUPT-FUNKTION                                                      */
/* ------------------------------------------------------------------ */

function buildEnriched(
  chatters: SwapInput[],
  models: SwapModelInfo[]
): SwapChatter[] {
  const followerLookup = new Map<string, number>();
  for (const m of models) {
    followerLookup.set((m.model_name || "").toLowerCase().trim(), m.follower_count || 0);
  }

  // Erste Pass: Basisdaten sammeln
  const base: Omit<SwapChatter, "skillScore" | "scoreBreakdown">[] = [];
  for (const c of chatters) {
    const account = (c.account || "").trim();
    if (!account) continue;
    const followers = followerLookup.get(account.toLowerCase()) || 0;
    const agg = aggregate7Day(c.history);
    // Wenn keine History UND kein Heute-Umsatz, gar nichts zu bewerten → skip
    if (agg.avgRevenue === 0 && c.currentRevenue === 0 && agg.avgMassDms === 0) {
      // Bleibt aber drin wenn er Mass-DMs schickt — Disziplin ist auch ohne Umsatz wertvoll
      // Komplett-leere skippen
      if (agg.avgOpenChats === 0 && agg.avgResponseDelay === 0) continue;
    }
    base.push({
      name: c.name,
      account,
      followers,
      tier: tierOf(followers),
      currentRevenue: c.currentRevenue,
      avgRevenue: agg.avgRevenue,
      avgMassDms: agg.avgMassDms,
      avgOpenChats: agg.avgOpenChats,
      avgResponseDelay: agg.avgResponseDelay,
    });
  }

  if (base.length === 0) return [];

  // Pool-weite Verteilungen für Min-Max-Normalisierung
  const allMassDms = base.map((b) => b.avgMassDms);
  const allDelays = base.map((b) => b.avgResponseDelay);
  const allOpenChats = base.map((b) => b.avgOpenChats);
  const allEfficiencies = base
    .filter((b) => b.followers >= 100)
    .map((b) => b.avgRevenue / Math.max(b.followers, 1));

  // Zweite Pass: Skill-Score berechnen
  const enriched: SwapChatter[] = base.map((b) => {
    const massScore = normalizeHigherBetter(b.avgMassDms, allMassDms);
    const respScore = normalizeLowerBetter(b.avgResponseDelay, allDelays);
    const throughScore = normalizeLowerBetter(b.avgOpenChats, allOpenChats);
    const revScore = revenueEfficiencyScore(
      { ...b, skillScore: 0, scoreBreakdown: { massDms: 0, response: 0, throughput: 0, revenue: 0 } } as SwapChatter,
      allEfficiencies
    );
    const skill =
      WEIGHTS.massDms * massScore +
      WEIGHTS.response * respScore +
      WEIGHTS.throughput * throughScore +
      WEIGHTS.revenue * revScore;
    return {
      ...b,
      skillScore: Math.max(0, Math.min(1, skill)),
      scoreBreakdown: {
        massDms: massScore,
        response: respScore,
        throughput: throughScore,
        revenue: revScore,
      },
    };
  });

  return enriched;
}

/**
 * Erwarteter Gain für left-Chatter auf right-Account.
 * Nutzt Peer-Cluster-Median für das Ziel-Follower-Tier × Skill-Faktor.
 */
function computeExpectedGain(
  left: SwapChatter,
  right: SwapChatter,
  bundle: BenchmarkBundle | null
): number {
  // Skill-Faktor: 0.5 = Median-Skill → 1.0× Multiplikator. 1.0 Skill → 2.0×.
  const skillFactor = Math.max(0.3, left.skillScore / 0.5);

  let baseExpected: number;
  const cluster = bundle ? findCluster(bundle, right.followers) : null;
  if (cluster && cluster.median > 0 && cluster.confidence !== "low") {
    baseExpected = cluster.median * skillFactor;
  } else {
    // Fallback: lineare Hochrechnung gedeckelt durch right.followers / left.followers Verhältnis
    const ratio = Math.min(5, right.followers / Math.max(left.followers, 1));
    baseExpected = left.avgRevenue * Math.min(ratio, 3) * skillFactor;
  }
  // Aktueller Umsatz auf Right-Account = was wir gewinnen abzüglich was schon da ist
  const current = right.avgRevenue || right.currentRevenue;
  return baseExpected - current;
}

export interface ComputeOptions {
  /** Maximaler Tier-Sprung nach oben (default: 2) */
  maxTierJump?: number;
  /** Minimaler Skill-Differenz für Pairing (default: 0.20) */
  minSkillDiff?: number;
}

export function computeSwapCandidates(
  chatters: SwapInput[],
  models: SwapModelInfo[],
  bundle: BenchmarkBundle | null = null,
  opts: ComputeOptions = {}
): SwapPair[] {
  const maxTierJump = opts.maxTierJump ?? 2;
  const minSkillDiff = opts.minSkillDiff ?? 0.20;

  const enriched = buildEnriched(chatters, models);
  if (enriched.length < 2) return [];

  const sortedBySkill = [...enriched].sort((a, b) => b.skillScore - a.skillScore);
  const n = sortedBySkill.length;

  // Top-30% Skill = Underplaced-Kandidaten
  // Bottom-30% Skill = Overplaced-Kandidaten
  const topCount = Math.max(1, Math.ceil(n * 0.3));
  const bottomCount = Math.max(1, Math.ceil(n * 0.3));
  const underplacedPool = sortedBySkill.slice(0, topCount);
  const overplacedPool = sortedBySkill.slice(-bottomCount).reverse(); // niedrigster Skill zuerst

  const pairs: SwapPair[] = [];
  const usedRight = new Set<string>();

  for (const u of underplacedPool) {
    const uTierIdx = tierIndex(u.tier);

    let best: { right: SwapChatter; gain: number; jump: number } | null = null;
    for (const o of overplacedPool) {
      if (usedRight.has(o.name)) continue;
      if (o.name === u.name) continue;
      const oTierIdx = tierIndex(o.tier);
      const jump = oTierIdx - uTierIdx;
      if (jump < 1) continue; // Ziel muss höheres Tier sein
      if (jump > maxTierJump) continue; // kein Mega-Sprung
      if (u.skillScore - o.skillScore < minSkillDiff) continue; // Skill-Differenz zu klein

      const gain = computeExpectedGain(u, o, bundle);
      if (gain <= 0) continue;
      if (!best || gain > best.gain) best = { right: o, gain, jump };
    }
    if (!best) continue;
    usedRight.add(best.right.name);

    // Alternativen für rechte Karte: andere Overplaced, die mit u funktionieren
    const rightAlts = overplacedPool.filter((o) => {
      if (o.name === best!.right.name || o.name === u.name) return false;
      const j = tierIndex(o.tier) - uTierIdx;
      if (j < 1 || j > maxTierJump) return false;
      if (u.skillScore - o.skillScore < minSkillDiff) return false;
      return computeExpectedGain(u, o, bundle) > 0;
    });

    // Alternativen für linke Karte: andere Underplaced, die mit best.right funktionieren
    const rightTierIdx = tierIndex(best.right.tier);
    const leftAlts = underplacedPool.filter((alt) => {
      if (alt.name === u.name || alt.name === best!.right.name) return false;
      const j = rightTierIdx - tierIndex(alt.tier);
      if (j < 1 || j > maxTierJump) return false;
      if (alt.skillScore - best!.right.skillScore < minSkillDiff) return false;
      return computeExpectedGain(alt, best!.right, bundle) > 0;
    });

    pairs.push({
      left: u,
      right: best.right,
      expectedGain: best.gain,
      tierJump: best.jump,
      leftAlternatives: leftAlts,
      rightAlternatives: rightAlts,
    });
  }

  pairs.sort((a, b) => b.expectedGain - a.expectedGain);
  return pairs;
}

/* ------------------------------------------------------------------ */
/*  FORMAT HELFER                                                       */
/* ------------------------------------------------------------------ */

export function formatEur(n: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Math.round(n)) + "€";
}

export function formatSkill(skill: number): string {
  return Math.round(skill * 100) + "/100";
}

export function tierColor(t: Tier): string {
  // HSL hue values for tier visualization
  switch (t) {
    case "Micro": return "240 8% 55%";
    case "Small": return "200 70% 55%";
    case "Medium": return "152 65% 50%";
    case "Large": return "40 90% 55%";
    case "Huge": return "320 75% 60%";
  }
}
