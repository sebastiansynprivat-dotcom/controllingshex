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
import type { LiveEfficiencyRow } from "@/lib/live-efficiency";
import { hasUsableLiveData } from "@/lib/live-efficiency";
import type { AccountFitMatrix } from "@/lib/account-fit";
import type { SwapTrackingEntry, TierDirection } from "@/lib/swap-tracking";
import { normalizeChatterName } from "@/lib/active-chatters";

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
  open_chats?: number;
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
  /** Eindeutiger Key: "<chatter>::<account>" */
  key: string;
  /** Originaler Chatter-Name (Mensch) */
  name: string;
  /** Konkreter Account dieses Eintrags (1 Eintrag pro Chatter×Account) */
  account: string;
  followers: number;
  tier: Tier;
  /** Tagesumsatz heute (anteilig auf diesen Account) */
  currentRevenue: number;
  /** 7-Tage-Schnitt Umsatz (anteilig auf diesen Account) */
  avgRevenue: number;
  /** 7-Tage-Schnitt Mass-DMs (Chatter-weit, nicht anteilig — Disziplin) */
  avgMassDms: number;
  /** 7-Tage-Schnitt offene Chats (anteilig auf diesen Account) */
  avgOpenChats: number;
  /** 7-Tage-Schnitt Response-Delay (Chatter-weit, nicht anteilig) */
  avgResponseDelay: number;
  /** Skill-Score 0..1 — auf CHATTER-Ebene berechnet, auf alle Accounts gespiegelt */
  skillScore: number;
  /** Frühestes analysis_date aus History (ISO YYYY-MM-DD) — wann der Chatter zuerst erfasst wurde */
  firstSeen: string | null;
  /** Sub-Scores für UI/Debugging */
  scoreBreakdown: {
    massDms: number;
    response: number;
    throughput: number;
    revenue: number;
  };
  /** Quelle des Skill-Scores: "live" wenn aus chatter_activity_sessions, sonst "legacy". */
  skillSource: "live" | "legacy";
  /** Live-Effizienz-Rohdaten (falls vorhanden) — für UI-Anzeige (€/h, €/Msg, …) */
  live?: LiveEfficiencyRow;
}

export interface SwapPair {
  left: SwapChatter; // underplaced (verdient besseren Account)
  right: SwapChatter; // overplaced (sitzt auf zu starkem Account)
  /** Erwarteter Mehr-Umsatz pro Tag wenn left auf rights Account wechselt */
  expectedGain: number;
  /** Follower-Verhältnis right/left (kontinuierlich, z.B. 2.4 = 2.4× mehr Follower) */
  followerRatio: number;
  /** Tier-Sprung — nur noch fürs visuelle Label, nicht mehr als Filter */
  tierJump: number;
  leftAlternatives: SwapChatter[];
  rightAlternatives: SwapChatter[];
  /** 0..100 — wie verlässlich der Vorschlag ist (Account-Fit + Sample + Recency + Lern-Loop). */
  confidence?: number;
  /** Menschenlesbare Begründung mit Zahlen — wird auf der Card angezeigt. */
  evidence?: string;
  /** 1 = direkter historischer Beweis auf diesem Account, 2 = Nachbar-Account-Beweis, 3 = Skill-Fallback. */
  evidenceTier?: 1 | 2 | 3;
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

// (Effizienz-Score wird inline in buildEnriched berechnet — auf Chatter-Ebene)

/* ------------------------------------------------------------------ */
/*  HISTORY → 7-TAGE-SCHNITTE                                           */
/* ------------------------------------------------------------------ */

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Aggregiert History-Rows in ein Zeitfenster zu Tages-Durchschnitten.
 *
 * Wichtig: avg = Summe / Anzahl vorhandener Rows (nicht / windowDays).
 * Dadurch bleibt `avgRevenue` immer ein echter Tagesschnitt — kompatibel zu
 * Peer-Benchmarks (die ebenfalls auf Tages-Basis sind) und zu kurzen Fenstern
 * wie "Heute" (1 Tag), wo sonst alles künstlich hochgerechnet/runtergerechnet
 * würde und der computeSwapExpectedGain-Vergleich kollabiert.
 */
function aggregateWindow(
  history: HistoryRow[] | undefined,
  windowDays: number,
  from?: string,
  to?: string
): {
  avgRevenue: number;
  avgMassDms: number;
  avgOpenChats: number;
  avgResponseDelay: number;
} {
  let rows = [...(history || [])].sort((a, b) =>
    String(a.analysis_date).localeCompare(String(b.analysis_date))
  );
  if (from && to) {
    rows = rows.filter((r) => {
      const d = String(r.analysis_date);
      return d >= from && d <= to;
    });
  } else {
    rows = rows.slice(-Math.max(1, windowDays));
  }
  const denom = Math.max(1, rows.length);
  return {
    avgRevenue: rows.reduce((sum, r) => sum + (Number(r.revenue_today) || 0), 0) / denom,
    avgMassDms: rows.reduce((sum, r) => sum + (Number(r.mass_dms) || 0), 0) / denom,
    avgOpenChats: rows.reduce((sum, r) => sum + (Number(r.open_chats) || 0), 0) / denom,
    avgResponseDelay: avg(rows.map((r) => Number(r.response_delay_days) || 0)),
  };
}

/* ------------------------------------------------------------------ */
/*  HAUPT-FUNKTION                                                      */
/* ------------------------------------------------------------------ */

/** Account-String "a, b, c" → ["a","b","c"] (leere/nur-Komma rausfiltern) */
function splitAccounts(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

export interface WindowSpec {
  /** Anzahl Tage über die gemittelt werden soll (z.B. 1, 7, 14, 30) */
  windowDays: number;
  /** Optional: ISO-Datum YYYY-MM-DD (inkl.) — wenn gesetzt, wird History strikt auf [from..to] gefiltert */
  from?: string;
  /** Optional: ISO-Datum YYYY-MM-DD (inkl.) */
  to?: string;
}

const DEFAULT_WINDOW: WindowSpec = { windowDays: 7 };

function buildEnriched(
  chatters: SwapInput[],
  models: SwapModelInfo[],
  window: WindowSpec = DEFAULT_WINDOW,
  liveEfficiency?: Map<string, LiveEfficiencyRow>
): SwapChatter[] {
  // Fix 1: Models mit follower_count=0 kriegen Median-Fallback (sonst werden ganze
  // Account-Einträge unsichtbar weil der Brezzels-Pool e.followers > 0 verlangt)
  const nonZeroFollowers = models.map((m) => m.follower_count || 0).filter((f) => f > 0);
  let followerMedian = 0;
  if (nonZeroFollowers.length > 0) {
    const sorted = [...nonZeroFollowers].sort((a, b) => a - b);
    followerMedian = sorted[Math.floor(sorted.length / 2)] ?? 0;
  }
  const followerLookup = new Map<string, number>();
  for (const m of models) {
    const raw = m.follower_count || 0;
    followerLookup.set((m.model_name || "").toLowerCase().trim(), raw > 0 ? raw : followerMedian);
  }

  // Pass 1: Pro Chatter aggregierte Stats berechnen (Skill-Score = Disziplin = pro Mensch)
  type ChatterAgg = {
    name: string;
    accounts: string[];
    avgRevenue: number;
    avgMassDms: number;
    avgOpenChats: number;
    avgResponseDelay: number;
    currentRevenue: number;
    firstSeen: string | null;
  };
  const chatterAggs: ChatterAgg[] = [];
  for (const c of chatters) {
    const accounts = splitAccounts(c.account);
    if (accounts.length === 0) continue;
    const agg = aggregateWindow(c.history, window.windowDays, window.from, window.to);
    if (
      agg.avgRevenue === 0 &&
      c.currentRevenue === 0 &&
      agg.avgMassDms === 0 &&
      agg.avgOpenChats === 0 &&
      agg.avgResponseDelay === 0
    ) {
      continue;
    }
    // Frühestes analysis_date aus gesamter History (nicht nur 7 Tage)
    const dates = (c.history || [])
      .map((r) => r.analysis_date)
      .filter((d): d is string => typeof d === "string" && d.length > 0)
      .sort();
    const firstSeen = dates[0] ?? null;
    chatterAggs.push({
      name: c.name,
      accounts,
      avgRevenue: agg.avgRevenue,
      avgMassDms: agg.avgMassDms,
      avgOpenChats: agg.avgOpenChats,
      avgResponseDelay: agg.avgResponseDelay,
      currentRevenue: c.currentRevenue,
      firstSeen,
    });
  }
  if (chatterAggs.length === 0) return [];

  // Pool-weite Verteilungen (auf CHATTER-Ebene → Skill-Score pro Mensch)
  const allMassDms = chatterAggs.map((b) => b.avgMassDms);
  const allDelays = chatterAggs.map((b) => b.avgResponseDelay);
  const allOpenChats = chatterAggs.map((b) => b.avgOpenChats);

  // Effizienz pro Chatter: Gesamt-Revenue / Gesamt-Follower (über alle seine Accounts summiert)
  const chatterTotalFollowers = chatterAggs.map((b) =>
    b.accounts.reduce((sum, acc) => sum + (followerLookup.get(acc.toLowerCase()) || 0), 0)
  );
  const allEfficiencies = chatterAggs
    .map((b, i) => (chatterTotalFollowers[i] >= 100 ? b.avgRevenue / Math.max(chatterTotalFollowers[i], 1) : null))
    .filter((v): v is number => v !== null);

  // Pass 2a: Legacy-Skill-Score pro Chatter (Fallback wenn keine Live-Daten)
  const chatterSkill = new Map<
    string,
    { skill: number; breakdown: SwapChatter["scoreBreakdown"]; source: "live" | "legacy" }
  >();
  chatterAggs.forEach((b, i) => {
    const massScore = normalizeHigherBetter(b.avgMassDms, allMassDms);
    const respScore = normalizeLowerBetter(b.avgResponseDelay, allDelays);
    const throughScore = normalizeLowerBetter(b.avgOpenChats, allOpenChats);
    const totalFollowers = chatterTotalFollowers[i];
    let revScore: number;
    if (totalFollowers < 100) {
      revScore = 0.5;
    } else {
      const eff = b.avgRevenue / Math.max(totalFollowers, 1);
      revScore = normalizeHigherBetter(eff, allEfficiencies);
    }
    const skill =
      WEIGHTS.massDms * massScore +
      WEIGHTS.response * respScore +
      WEIGHTS.throughput * throughScore +
      WEIGHTS.revenue * revScore;
    chatterSkill.set(b.name, {
      skill: Math.max(0, Math.min(1, skill)),
      breakdown: { massDms: massScore, response: respScore, throughput: throughScore, revenue: revScore },
      source: "legacy",
    });
  });

  // Pass 2b: Live-Score überschreibt wo verlässlich vorhanden
  if (liveEfficiency && liveEfficiency.size > 0) {
    const usableNames = chatterAggs
      .map((b) => b.name)
      .filter((n) => hasUsableLiveData(liveEfficiency.get(n.trim().toLowerCase())));
    if (usableNames.length >= 2) {
      const liveRows = usableNames.map((n) => liveEfficiency.get(n.trim().toLowerCase())!);
      const allEurH = liveRows.map((r) => r.eur_per_active_hour);
      const allEurMsg = liveRows.map((r) => r.eur_per_incoming);
      const allFirstResp = liveRows
        .map((r) => r.first_response_min_p50)
        .filter((v): v is number => v !== null);
      const allConsistency = liveRows.map((r) => r.session_consistency);
      const allMassLive = liveRows.map((r) => r.total_mass_dms);

      const LW = { eurH: 0.40, eurMsg: 0.25, firstResp: 0.15, consistency: 0.10, mass: 0.10 };
      for (const name of usableNames) {
        const row = liveEfficiency.get(name.trim().toLowerCase())!;
        const eurH = normalizeHigherBetter(row.eur_per_active_hour, allEurH);
        const eurMsg = normalizeHigherBetter(row.eur_per_incoming, allEurMsg);
        const firstResp = row.first_response_min_p50 != null && allFirstResp.length > 0
          ? normalizeLowerBetter(row.first_response_min_p50, allFirstResp)
          : 0.5;
        const consistency = normalizeHigherBetter(row.session_consistency, allConsistency);
        const massLive = normalizeHigherBetter(row.total_mass_dms, allMassLive);
        const skill =
          LW.eurH * eurH +
          LW.eurMsg * eurMsg +
          LW.firstResp * firstResp +
          LW.consistency * consistency +
          LW.mass * massLive;
        chatterSkill.set(name, {
          skill: Math.max(0, Math.min(1, skill)),
          // Mapping auf bestehende Breakdown-Felder für UI-Kompatibilität:
          //   massDms → eurH, response → firstResp, throughput → eurMsg, revenue → consistency
          breakdown: {
            massDms: eurH,
            response: firstResp,
            throughput: eurMsg,
            revenue: consistency,
          },
          source: "live",
        });
      }
    }
  }

  // Pass 3: Pro (Chatter, Account) ein Eintrag erzeugen
  const enriched: SwapChatter[] = [];
  chatterAggs.forEach((b) => {
    const skillEntry = chatterSkill.get(b.name);
    if (!skillEntry) return;
    const liveRow = liveEfficiency?.get(b.name.trim().toLowerCase());
    const followerByAcc = b.accounts.map((acc) => followerLookup.get(acc.toLowerCase()) || 0);
    b.accounts.forEach((acc, idx) => {
      const followers = followerByAcc[idx];
      enriched.push({
        key: `${b.name}::${acc}`,
        name: b.name,
        account: acc,
        followers,
        tier: tierOf(followers),
        currentRevenue: b.currentRevenue,
        avgRevenue: b.avgRevenue,
        avgMassDms: b.avgMassDms,
        avgOpenChats: b.avgOpenChats,
        avgResponseDelay: b.avgResponseDelay,
        skillScore: skillEntry.skill,
        firstSeen: b.firstSeen,
        scoreBreakdown: skillEntry.breakdown,
        skillSource: skillEntry.source,
        live: liveRow,
      });
    });
  });

  return enriched;
}

/**
 * Erwarteter Gain für left-Chatter auf right-Account.
 * Nutzt Peer-Cluster-Median für das Ziel-Follower-Tier × Skill-Faktor.
 */
export function computeSwapExpectedGain(
  left: SwapChatter,
  right: SwapChatter,
  bundle: BenchmarkBundle | null
): number {
  // Skill-Faktor: 0.5 = Median-Skill → 1.0× Multiplikator. 1.0 Skill → 2.0×.
  const skillFactor = Math.max(0.5, left.skillScore / 0.5);

  let baseExpected: number;
  const cluster = bundle ? findCluster(bundle, right.followers) : null;
  if (cluster && cluster.median > 0 && cluster.confidence !== "low") {
    baseExpected = cluster.median * skillFactor;
  } else {
    // Fallback: lineare Hochrechnung gedeckelt durch right.followers / left.followers Verhältnis
    const ratio = Math.min(5, right.followers / Math.max(left.followers, 1));
    baseExpected = left.avgRevenue * Math.min(ratio, 3) * skillFactor;
  }
  // Erwarteter Netto-Gain des Tauschs: Verbesserung von links auf dem besseren Account
  // abzüglich Opportunitätsverlust rechts. Nicht nur right.avgRevenue abziehen, sonst
  // werden starke Links mit bereits gutem Umsatz fälschlich klein/negativ gerechnet.
  const leftCurrent = left.avgRevenue || left.currentRevenue;
  const rightCurrent = right.avgRevenue || right.currentRevenue;
  const opportunityLoss = Math.max(0, rightCurrent - leftCurrent);
  const current = leftCurrent + opportunityLoss;
  return baseExpected - current;
}

export interface ComputeOptions {
  /** Minimales Follower-Verhältnis right/left (default: 1.5 = Ziel hat mind. 50% mehr Follower) */
  minFollowerRatio?: number;
  /** Maximales Follower-Verhältnis (Sicherheits-Cap, default: 50 = niemand kriegt 50× größeren Account) */
  maxFollowerRatio?: number;
  /** Minimaler Skill-Differenz für Pairing (default: 0.13) */
  minSkillDiff?: number;
  /** Anteil Top/Bottom des Skill-Pools für Kandidaten-Auswahl (default: 0.4 = Top/Bottom 40%) */
  poolFraction?: number;
  /** Plattform-Name (z.B. "Brezzels") — aktiviert plattform-spezifische Filter */
  platform?: string;
  /** Zeitfenster über das gemittelt wird (default: letzte 7 Tage). */
  window?: WindowSpec;
  /** Optional: Live-Effizienz pro Chatter (key = chatter_name lowercase). Wenn gesetzt und ausreichend Daten, ersetzt sie den Legacy-Skill-Score. */
  liveEfficiency?: Map<string, LiveEfficiencyRow>;
  /** Optional: Account-Fit-Matrix (aus loadAccountFitMatrix). Aktiviert den account-spezifischen Smart-Branch. */
  fitMatrix?: AccountFitMatrix;
  /** Optional: Outcome-Daten vergangener Swaps (aus loadSwapTracking). Speist Confidence-Bonus pro Tier-Richtung. */
  swapTracking?: Map<string, SwapTrackingEntry>;
  /** Minimal-Confidence (0..100). Pairs darunter werden gefiltert. Default 50. -1 = alles zeigen. */
  minConfidence?: number;
  /** Wenn true UND zu wenig confident pairs (<5), wird der Legacy-Skill-Mismatch als Spekulations-Backfill aufgenommen. Default true. */
  allowSpeculativeBackfill?: boolean;
}

/**
 * Brezzels v4 — MISMATCH-RANG-Logik.
 *
 * Idee: Sortiere alle Chatter zweimal — einmal nach Skill, einmal nach Followern.
 *   Mismatch = Skill-Rang − Account-Rang   (1 = best in beiden Listen)
 *
 *   Stark negativ → Top-Skiller auf kleinem Account → UNDERPLACED
 *   Stark positiv → Schwacher Skiller auf großem Account → OVERPLACED
 *
 * Vorteil ggü. Effizienz-Filter: Skill und Effizienz korrelieren bei enger
 * Follower-Spanne stark — der alte Doppel-Filter (Eff Bottom-50% UND Skill Top-50%)
 * dünnt den Pool aus statt ihn zu schärfen. Mismatch nutzt beide Dimensionen
 * orthogonal und liefert robust Pairs auf jeder Skala.
 */
interface BrezzelsLevel {
  poolSize: number; // pro Seite (Underplaced/Overplaced)
}
const BREZZELS_LEVELS: BrezzelsLevel[] = [
  { poolSize: 12 },
  { poolSize: 16 },
  { poolSize: 20 },
];

function buildFallbackSkillPools(
  enriched: SwapChatter[],
  poolSize: number
): { underplaced: SwapChatter[]; overplaced: SwapChatter[] } {
  const valid = enriched.filter((e) => e.followers > 0);
  const underplaced = [...valid]
    .sort((a, b) => b.skillScore - a.skillScore || a.followers - b.followers)
    .slice(0, poolSize);
  const underKeys = new Set(underplaced.map((u) => u.key));
  const medianSkill = median(valid.map((e) => e.skillScore));
  const overplaced = [...valid]
    .filter((e) => !underKeys.has(e.key) && e.skillScore <= medianSkill)
    .sort((a, b) => b.followers - a.followers || a.skillScore - b.skillScore)
    .slice(0, poolSize);
  return { underplaced, overplaced };
}

function buildBrezzelsPools(
  enriched: SwapChatter[],
  level: BrezzelsLevel
): { underplaced: SwapChatter[]; overplaced: SwapChatter[] } {
  const valid = enriched.filter((e) => e.followers > 0);
  if (valid.length < 4) return { underplaced: [], overplaced: [] };

  // Skill-Rang: 1 = höchster Skill
  const bySkillDesc = [...valid].sort((a, b) => b.skillScore - a.skillScore);
  const skillRank = new Map<string, number>();
  bySkillDesc.forEach((e, i) => skillRank.set(e.key, i + 1));

  // Account-Rang: 1 = meiste Follower
  const byFollowersDesc = [...valid].sort((a, b) => b.followers - a.followers);
  const followerRank = new Map<string, number>();
  byFollowersDesc.forEach((e, i) => followerRank.set(e.key, i + 1));

  // Mismatch = Skill-Rang − Follower-Rang
  const withMismatch = valid.map((e) => ({
    entry: e,
    mismatch: (skillRank.get(e.key) ?? 0) - (followerRank.get(e.key) ?? 0),
  }));

  const ascByMismatch = [...withMismatch].sort((a, b) => a.mismatch - b.mismatch);
  const descByMismatch = [...withMismatch].sort((a, b) => b.mismatch - a.mismatch);

  const cap = Math.min(level.poolSize, valid.length);
  const underplaced = ascByMismatch.slice(0, cap).map((x) => x.entry);

  // Fix 2 (revidiert): De-Dup nur auf KEY-Ebene (Chatter+Account). Multi-Account-Chatter
  // dürfen weiterhin mit Account A underplaced UND mit Account B overplaced auftauchen —
  // genau das ist ja der interessante interne Tausch. Name-basierter Filter passiert in
  // pairUp via `o.name === u.name`-Check pro Pair, nicht im Pool-Aufbau.
  const underplacedKeys = new Set(underplaced.map((u) => u.key));
  const overplaced = descByMismatch
    .filter((x) => !underplacedKeys.has(x.entry.key))
    .slice(0, cap)
    .map((x) => x.entry);

  console.log(
    `[Brezzels swap] poolDedup: blocked ${underplaced.length} keys; overplaced kept ${overplaced.length}`
  );

  return { underplaced, overplaced };
}

export function computeSwapCandidates(
  chatters: SwapInput[],
  models: SwapModelInfo[],
  bundle: BenchmarkBundle | null = null,
  opts: ComputeOptions = {}
): SwapPair[] {
  const minFollowerRatio = opts.minFollowerRatio ?? 1.5;
  const maxFollowerRatio = opts.maxFollowerRatio ?? 50;
  const minSkillDiff = opts.minSkillDiff ?? 0.13;
  const poolFraction = opts.poolFraction ?? 0.4;
  const platform = opts.platform;

  const enriched = buildEnriched(chatters, models, opts.window ?? DEFAULT_WINDOW, opts.liveEfficiency);
  if (enriched.length < 2) return [];

  // ----- Brezzels: Mismatch-Pool + Fallback-Skill-Pool -----
  if (platform === "Brezzels") {
    for (const level of BREZZELS_LEVELS) {
      const mismatchPools = buildBrezzelsPools(enriched, level);
      const fallbackPools = buildFallbackSkillPools(enriched, level.poolSize);
      let underplaced = mismatchPools.underplaced;
      let overplaced = mismatchPools.overplaced;
      const totalEnriched = enriched.length;
      const validFollowers = enriched.filter((e) => e.followers > 0).length;
      const zeroFollowerEntries = totalEnriched - validFollowers;
      console.log(
        `[Brezzels swap] enrichedTotal=${totalEnriched}, validFollowers=${validFollowers}, zeroFollowerSkipped=${zeroFollowerEntries}`
      );
      console.log(
        `[Brezzels swap] poolSize=${level.poolSize} → underplaced=${underplaced.length}, overplaced=${overplaced.length}`
      );
      if (underplaced.length === 0 || overplaced.length === 0) {
        underplaced = fallbackPools.underplaced;
        overplaced = fallbackPools.overplaced;
        console.log(`[Brezzels swap] ⚠️ Mismatch-Pool leer — nutze Skill/Follower-Fallback`);
      }
      console.log(
        `[Brezzels swap] Underplaced:`,
        underplaced.map((u) => `${u.name} (skill=${u.skillScore.toFixed(2)}, F=${u.followers})`)
      );
      console.log(
        `[Brezzels swap] Overplaced:`,
        overplaced.map((o) => `${o.name} (skill=${o.skillScore.toFixed(2)}, F=${o.followers})`)
      );
      const result = pairUp(underplaced, overplaced, bundle, {
        minFollowerRatio: 1.0,
        maxFollowerRatio,
        minSkillDiff: 0.05,
        maxRightUses: 1,
        gainTolerance: -1,
        debugLabel: `Brezzels L=${level.poolSize}`,
      });
      result.sort((a, b) => b.expectedGain - a.expectedGain);
      console.log(`[Brezzels swap] → ${result.length} pairs at poolSize=${level.poolSize}`);
      // DOM-Marker für externe Inspektion (falls Console nicht erreichbar)
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute(
          "data-brezzels-swap-debug",
          JSON.stringify({
            level: level.poolSize,
            enriched: enriched.length,
            underplaced: underplaced.length,
            overplaced: overplaced.length,
            pairs: result.length,
          })
        );
      }
      if (result.length >= 3 || level === BREZZELS_LEVELS[BREZZELS_LEVELS.length - 1]) {
        return result;
      }
    }
    return [];
  }

  // ----- Default (Maloum, myLoop & Co.) -----
  // Wenn fitMatrix übergeben → Smart-Cascade (S1 → S2 → S3 Spec-Backfill).
  // Sonst → klassischer Skill-Mismatch (Legacy-Verhalten, Backwards-Compat).
  if (opts.fitMatrix) {
    return computeSmartDefault(enriched, chatters, bundle, opts);
  }

  const sortedBySkill = [...enriched].sort((a, b) => b.skillScore - a.skillScore);
  const n = sortedBySkill.length;
  const topCount = Math.max(1, Math.ceil(n * poolFraction));
  const bottomCount = Math.max(1, Math.ceil(n * poolFraction));
  const underplacedPool = sortedBySkill.slice(0, topCount);
  const overplacedPool = sortedBySkill.slice(-bottomCount).reverse();

  return pairUp(underplacedPool, overplacedPool, bundle, {
    minFollowerRatio,
    maxFollowerRatio,
    minSkillDiff,
  });
}

/* ------------------------------------------------------------------ */
/*  SMART-DEFAULT — Account-Fit-getriebene Cascade (S1 → S2 → S3)     */
/* ------------------------------------------------------------------ */

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysSinceIso(iso: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso + "T00:00:00Z");
  const now = Date.parse(isoToday() + "T00:00:00Z");
  if (isNaN(then) || isNaN(now)) return null;
  return Math.max(0, Math.round((now - then) / 86400000));
}

function fmtEurShort(n: number): string {
  return Math.round(n).toLocaleString("de-DE") + " €";
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return "?";
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
}

function detectDecliningChatters(chatters: SwapInput[]): Set<string> {
  const declining = new Set<string>();
  for (const c of chatters) {
    const hist = c.history || [];
    if (hist.length < 14) continue;
    const sorted = [...hist].sort((a, b) =>
      String(a.analysis_date).localeCompare(String(b.analysis_date))
    );
    const last7 = sorted.slice(-7);
    const prev = sorted.slice(-30, -7);
    if (prev.length < 7) continue;
    const avg7 = last7.reduce((s, r) => s + (Number(r.revenue_today) || 0), 0) / last7.length;
    const avgPrev = prev.reduce((s, r) => s + (Number(r.revenue_today) || 0), 0) / prev.length;
    if (avgPrev >= 20 && avg7 / avgPrev <= 0.75) {
      declining.add(normalizeChatterName(c.name));
    }
  }
  return declining;
}

type AccountSignal = "decline" | "underperform";

interface AccountSignals {
  flags: AccountSignal[];
  vsPeer?: number;
  peerGap?: number;
}

function detectAccountSignals(
  current: SwapChatter,
  declining: Set<string>,
  fitMatrix?: AccountFitMatrix
): AccountSignals {
  const flags: AccountSignal[] = [];
  let vsPeer: number | undefined;
  let peerGap: number | undefined;

  if (declining.has(normalizeChatterName(current.name))) flags.push("decline");

  if (fitMatrix) {
    const accKey = current.account.toLowerCase().trim();
    const peerMed = fitMatrix.peerMedianByAccount.get(accKey) ?? 0;
    const currentEntry = fitMatrix.byPair.get(`${normalizeChatterName(current.name)}|${accKey}`);
    if (currentEntry && peerMed > 0) {
      vsPeer = currentEntry.vsPeerOnAccount;
      peerGap = peerMed - currentEntry.avgPerDay;
      if (vsPeer < 0.85 && currentEntry.days >= 3 && peerGap > 30) {
        flags.push("underperform");
      }
    }
  }

  return { flags, vsPeer, peerGap };
}

interface ReplacementCandidate {
  replacement: SwapChatter;
  gain: number;
  evidenceTier: 1 | 2 | 3;
  evidence: string;
  sampleDays: number;
  recencyDays: number | null;
}

function findReplacements(
  current: SwapChatter,
  enriched: SwapChatter[],
  fitMatrix: AccountFitMatrix
): ReplacementCandidate[] {
  const accKey = current.account.toLowerCase().trim();
  const currentChatterKey = normalizeChatterName(current.name);
  const currentAvg = current.avgRevenue || current.currentRevenue || 0;

  const enrichedByChatter = new Map<string, SwapChatter[]>();
  for (const e of enriched) {
    const k = normalizeChatterName(e.name);
    if (!enrichedByChatter.has(k)) enrichedByChatter.set(k, []);
    enrichedByChatter.get(k)!.push(e);
  }

  const out: ReplacementCandidate[] = [];

  /* S1 — DIREKTER BEWEIS auf genau diesem Account */
  const accountFits = fitMatrix.byAccount.get(accKey) ?? [];
  for (const fit of accountFits) {
    if (fit.chatterKey === currentChatterKey) continue;
    if (fit.days < 3) continue;
    if (fit.confidence === "low") continue;
    if (fit.fitScore < 60) continue;
    if (fit.avgPerDay < currentAvg * 1.1 && fit.avgPerDay - currentAvg < 40) continue;
    const replList = enrichedByChatter.get(fit.chatterKey) ?? [];
    const repl = [...replList].sort((a, b) => a.followers - b.followers)[0];
    if (!repl) continue;
    if (repl.account.toLowerCase().trim() === accKey) continue;

    out.push({
      replacement: repl,
      gain: fit.avgPerDay - currentAvg,
      evidenceTier: 1,
      evidence:
        `${repl.name} hatte @${current.account} schon (${fmtDateShort(fit.lastPhaseFrom)}–${fmtDateShort(fit.lastPhaseTo)}, ${fit.days} Tage) und brachte Ø ${fmtEurShort(fit.avgPerDay)}/Tag. ` +
        `${current.name} liegt aktuell bei Ø ${fmtEurShort(currentAvg)}/Tag.`,
      sampleDays: fit.days,
      recencyDays: daysSinceIso(fit.lastPhaseTo),
    });
  }

  /* S2 — NACHBAR-BEWEIS auf ähnlich großem Account */
  if (out.length < 3) {
    const fLow = current.followers * 0.5;
    const fHigh = current.followers * 1.5;
    const followersByAccount = new Map<string, number>();
    for (const e of enriched) followersByAccount.set(e.account.toLowerCase().trim(), e.followers);
    const seenChatters = new Set(out.map((o) => normalizeChatterName(o.replacement.name)));
    seenChatters.add(currentChatterKey);

    for (const [otherAccKey, fits] of fitMatrix.byAccount) {
      if (otherAccKey === accKey) continue;
      const f = followersByAccount.get(otherAccKey) ?? 0;
      if (f <= 0 || f < fLow || f > fHigh) continue;
      for (const fit of fits) {
        if (seenChatters.has(fit.chatterKey)) continue;
        if (fit.days < 5) continue;
        if (fit.confidence === "low") continue;
        if (fit.fitScore < 70) continue;
        if (fit.avgPerDay < currentAvg * 1.15) continue;
        const replList = enrichedByChatter.get(fit.chatterKey) ?? [];
        const repl = [...replList].sort((a, b) => a.followers - b.followers)[0];
        if (!repl) continue;
        if (repl.account.toLowerCase().trim() === accKey) continue;
        seenChatters.add(fit.chatterKey);
        const ratio = f >= current.followers ? current.followers / f : f / current.followers;
        const gain = fit.avgPerDay * ratio - currentAvg;
        if (gain <= 0) continue;
        out.push({
          replacement: repl,
          gain,
          evidenceTier: 2,
          evidence:
            `${repl.name} performt stark auf @${fit.accountName} (ähnliche Größe, Ø ${fmtEurShort(fit.avgPerDay)}/Tag, ${fit.days} Tage). ` +
            `${current.name} liegt @${current.account} bei Ø ${fmtEurShort(currentAvg)}/Tag.`,
          sampleDays: fit.days,
          recencyDays: daysSinceIso(fit.lastPhaseTo),
        });
        if (out.length >= 5) break;
      }
      if (out.length >= 5) break;
    }
  }

  out.sort((a, b) =>
    a.evidenceTier === b.evidenceTier ? b.gain - a.gain : a.evidenceTier - b.evidenceTier
  );
  return out;
}

function computeTrackingBonuses(
  tracking?: Map<string, SwapTrackingEntry>
): Record<TierDirection, number> {
  const buckets: Record<TierDirection, number[]> = {
    upgrade: [], lateral: [], downgrade: [], unknown: [],
  };
  if (tracking) {
    for (const e of tracking.values()) {
      if (e.deltaPct === null) continue;
      buckets[e.tierDirection].push(e.deltaPct);
    }
  }
  const bonuses: Record<TierDirection, number> = { upgrade: 0, lateral: 0, downgrade: 0, unknown: 0 };
  for (const dir of ["upgrade", "lateral", "downgrade"] as TierDirection[]) {
    const vals = buckets[dir];
    if (vals.length < 5) continue;
    const a = vals.reduce((s, v) => s + v, 0) / vals.length;
    bonuses[dir] = Math.max(-10, Math.min(10, Math.round(a / 2)));
  }
  return bonuses;
}

function computeConfidence(
  candidate: ReplacementCandidate,
  signals: AccountSignals,
  trackingBonuses: Record<TierDirection, number>,
  tierDirection: TierDirection
): { score: number; note: string } {
  const base = candidate.evidenceTier === 1 ? 70 : candidate.evidenceTier === 2 ? 50 : 25;
  const sampleBonus = Math.min(15, Math.round(candidate.sampleDays * 1.5));
  const recencyBonus =
    candidate.recencyDays === null
      ? 0
      : candidate.recencyDays <= 14
      ? 10
      : candidate.recencyDays <= 45
      ? 6
      : candidate.recencyDays <= 90
      ? 2
      : 0;
  const trackingBonus = trackingBonuses[tierDirection] ?? 0;
  const signalBonus = Math.min(8, signals.flags.length * 4);
  const score = Math.max(0, Math.min(100, base + sampleBonus + recencyBonus + trackingBonus + signalBonus));

  const noteParts: string[] = [];
  if (trackingBonus > 2) noteParts.push(`ähnliche Tausche bisher: Ø +${trackingBonus * 2}%`);
  if (signals.flags.includes("decline")) noteParts.push("Account im Rückgang");
  if (signals.flags.includes("underperform") && signals.peerGap)
    noteParts.push(`unter Peer-Median (-${fmtEurShort(signals.peerGap)}/Tag)`);

  return { score, note: noteParts.length ? `(${noteParts.join(", ")})` : "" };
}

function tierDirectionBetween(left: SwapChatter, right: SwapChatter): TierDirection {
  const a = tierIndex(left.tier);
  const b = tierIndex(right.tier);
  if (b > a) return "upgrade";
  if (b < a) return "downgrade";
  return "lateral";
}

function computeSmartDefault(
  enriched: SwapChatter[],
  chatters: SwapInput[],
  bundle: BenchmarkBundle | null,
  opts: ComputeOptions
): SwapPair[] {
  const fitMatrix = opts.fitMatrix!;
  const minConfidence = opts.minConfidence ?? 50;
  const allowBackfill = opts.allowSpeculativeBackfill ?? true;

  const declining = detectDecliningChatters(chatters);
  const trackingBonuses = computeTrackingBonuses(opts.swapTracking);

  const smart: SwapPair[] = [];
  const usedRight = new Map<string, number>();
  const usedLeft = new Map<string, number>();

  for (const current of enriched) {
    if (current.followers <= 0) continue;
    const signals = detectAccountSignals(current, declining, fitMatrix);
    const candidates = findReplacements(current, enriched, fitMatrix);
    for (const cand of candidates) {
      if (cand.gain <= 0) continue;
      if ((usedLeft.get(cand.replacement.key) ?? 0) >= 2) continue;
      if ((usedRight.get(current.key) ?? 0) >= 1) continue;
      const dir = tierDirectionBetween(cand.replacement, current);
      const conf = computeConfidence(cand, signals, trackingBonuses, dir);
      if (conf.score < minConfidence) continue;

      usedLeft.set(cand.replacement.key, (usedLeft.get(cand.replacement.key) ?? 0) + 1);
      usedRight.set(current.key, (usedRight.get(current.key) ?? 0) + 1);

      smart.push({
        left: cand.replacement,
        right: current,
        expectedGain: cand.gain,
        followerRatio: current.followers / Math.max(cand.replacement.followers, 1),
        tierJump: Math.max(0, tierIndex(current.tier) - tierIndex(cand.replacement.tier)),
        leftAlternatives: candidates
          .filter((c) => c.replacement.key !== cand.replacement.key)
          .slice(0, 3)
          .map((c) => c.replacement),
        rightAlternatives: [],
        confidence: conf.score,
        evidence: `${cand.evidence}${conf.note ? " " + conf.note : ""}`.trim(),
        evidenceTier: cand.evidenceTier,
      });
      break;
    }
  }

  smart.sort((a, b) => (b.confidence! - a.confidence!) || (b.expectedGain - a.expectedGain));

  console.log(
    `[Smart swap] platform=${opts.platform ?? "?"} enriched=${enriched.length} declining=${declining.size} smartPairs=${smart.length} (minConf=${minConfidence})`
  );

  if (allowBackfill && smart.length < 5) {
    const sortedBySkill = [...enriched].sort((a, b) => b.skillScore - a.skillScore);
    const n = sortedBySkill.length;
    const poolFraction = opts.poolFraction ?? 0.5;
    const topCount = Math.max(1, Math.ceil(n * poolFraction));
    const bottomCount = Math.max(1, Math.ceil(n * poolFraction));
    const underplacedPool = sortedBySkill.slice(0, topCount);
    const overplacedPool = sortedBySkill.slice(-bottomCount).reverse();
    const legacy = pairUp(underplacedPool, overplacedPool, bundle, {
      minFollowerRatio: opts.minFollowerRatio ?? 1.5,
      maxFollowerRatio: opts.maxFollowerRatio ?? 50,
      minSkillDiff: opts.minSkillDiff ?? 0.08,
      maxRightUses: 2,
    });
    const usedLeftKeys = new Set(smart.map((p) => p.left.key));
    const usedRightKeys = new Set(smart.map((p) => p.right.key));
    let added = 0;
    for (const p of legacy) {
      if (usedLeftKeys.has(p.left.key) || usedRightKeys.has(p.right.key)) continue;
      smart.push({
        ...p,
        confidence: 30,
        evidenceTier: 3,
        evidence: `Spekulativ: ${p.left.name} hat höheren Skill-Score (${Math.round(p.left.skillScore * 100)}) als ${p.right.name} (${Math.round(p.right.skillScore * 100)}) bei ${p.followerRatio.toFixed(1)}× mehr Followern. Kein direkter Account-Beweis.`,
      });
      added++;
      if (smart.length >= 12) break;
    }
    console.log(`[Smart swap] +${added} speculative backfill pairs (total=${smart.length})`);
  }

  return smart;
}

/**
 * Greedy-Pairing: pro Underplaced den besten verfügbaren Overplaced suchen,
 * je Pair Alternativen-Pools für Karten-Wechsel mitliefern.
 */
function pairUp(
  underplacedPool: SwapChatter[],
  overplacedPool: SwapChatter[],
  bundle: BenchmarkBundle | null,
  cfg: {
    minFollowerRatio: number;
    maxFollowerRatio: number;
    minSkillDiff: number;
    /** Wie oft darf ein Overplaced-Account in Pairs auftauchen? Default 1. */
    maxRightUses?: number;
    /** Erlaubte Untergrenze für expectedGain (default 0 → strikt positiv). Brezzels: -2 € */
    gainTolerance?: number;
    /** Wenn true: pro Underplaced-Iteration loggen wieviele an welcher Constraint scheitern */
    debugLabel?: string;
  }
): SwapPair[] {
  const { minFollowerRatio, maxFollowerRatio, minSkillDiff } = cfg;
  const maxRightUses = cfg.maxRightUses ?? 1;
  const gainThreshold = cfg.gainTolerance ?? 0;
  const pairs: SwapPair[] = [];
  const rightUses = new Map<string, number>();
  const usedLeft = new Set<string>();

  for (const u of underplacedPool) {
    if (usedLeft.has(u.key)) continue;

    let best: { right: SwapChatter; gain: number; ratio: number } | null = null;
    let cAlreadyUsed = 0, cSameName = 0, cRatioLow = 0, cRatioHigh = 0, cSkillDiff = 0, cGain = 0, cPassed = 0;

    for (const o of overplacedPool) {
      if ((rightUses.get(o.key) ?? 0) >= maxRightUses) { cAlreadyUsed++; continue; }
      if (o.name === u.name) { cSameName++; continue; }
      const uFollowers = Math.max(u.followers, 1);
      const ratio = o.followers / uFollowers;
      if (ratio < minFollowerRatio) { cRatioLow++; continue; }
      if (ratio > maxFollowerRatio) { cRatioHigh++; continue; }
      if (u.skillScore - o.skillScore < minSkillDiff) { cSkillDiff++; continue; }

      const gain = computeSwapExpectedGain(u, o, bundle);
      if (gain <= gainThreshold) { cGain++; continue; }
      cPassed++;
      if (!best || gain > best.gain) best = { right: o, gain, ratio };
    }

    if (cfg.debugLabel) {
      console.log(
        `[${cfg.debugLabel}] U=${u.name} (skill=${u.skillScore.toFixed(2)}, F=${u.followers}) → ` +
          `passed=${cPassed} | rejected: alreadyUsed=${cAlreadyUsed}, sameName=${cSameName}, ` +
          `ratio<${minFollowerRatio}=${cRatioLow}, ratio>${maxFollowerRatio}=${cRatioHigh}, ` +
          `skillDiff<${minSkillDiff}=${cSkillDiff}, gain<=${gainThreshold}=${cGain}`
      );
    }

    if (!best) continue;
    rightUses.set(best.right.key, (rightUses.get(best.right.key) ?? 0) + 1);
    usedLeft.add(u.key);

    const uFollowers = Math.max(u.followers, 1);
    const rightAlts = overplacedPool.filter((o) => {
      if (o.key === best!.right.key) return false;
      if (o.name === u.name) return false;
      const r = o.followers / uFollowers;
      if (r < minFollowerRatio || r > maxFollowerRatio) return false;
      if (u.skillScore - o.skillScore < minSkillDiff) return false;
      return computeSwapExpectedGain(u, o, bundle) > gainThreshold;
    });

    const rightFollowers = Math.max(best.right.followers, 1);
    const leftAlts = underplacedPool.filter((alt) => {
      if (alt.key === u.key) return false;
      if (alt.name === best!.right.name) return false;
      const r = rightFollowers / Math.max(alt.followers, 1);
      if (r < minFollowerRatio || r > maxFollowerRatio) return false;
      if (alt.skillScore - best!.right.skillScore < minSkillDiff) return false;
      return computeSwapExpectedGain(alt, best!.right, bundle) > gainThreshold;
    });

    const tierJump = Math.max(0, tierIndex(best.right.tier) - tierIndex(u.tier));

    pairs.push({
      left: u,
      right: best.right,
      expectedGain: best.gain,
      followerRatio: best.ratio,
      tierJump,
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

/* ------------------------------------------------------------------ */
/*  MANUELLER MODUS — Vorschläge für einen einzelnen Chatter            */
/* ------------------------------------------------------------------ */

/**
 * Liste aller verfügbaren Chatter (für Auswahl-UI).
 * Liefert deduplizierte Chatter-Namen mit ihren aggregierten Daten.
 */
export function listAllSwapChatters(
  chatters: SwapInput[],
  models: SwapModelInfo[],
  window: WindowSpec = DEFAULT_WINDOW,
  liveEfficiency?: Map<string, LiveEfficiencyRow>
): SwapChatter[] {
  return buildEnriched(chatters, models, window, liveEfficiency);
}

/**
 * Generiert Tausch-Vorschläge für EINEN ausgewählten Chatter (manueller Modus).
 * Filter sind gelockert: zeigt immer was, auch wenn Skill-Diff/Ratio klein sind.
 * Liefert Pairs in beide Richtungen:
 *   - Wenn der gewählte Chatter underplaced ist → bessere Accounts
 *   - Wenn er overplaced ist → schwächere Chatter die seinen Account übernehmen könnten
 * Sortiert nach erwartetem Gain absteigend.
 */
export function computeManualSwapCandidates(
  chatters: SwapInput[],
  models: SwapModelInfo[],
  selectedChatterName: string,
  bundle: BenchmarkBundle | null = null,
  limit = 8,
  window: WindowSpec = DEFAULT_WINDOW,
  liveEfficiency?: Map<string, LiveEfficiencyRow>
): SwapPair[] {
  const enriched = buildEnriched(chatters, models, window, liveEfficiency);
  if (enriched.length < 2) return [];

  // Alle Account-Einträge des gewählten Chatters
  const selectedEntries = enriched.filter(
    (e) => e.name.toLowerCase() === selectedChatterName.toLowerCase()
  );
  if (selectedEntries.length === 0) return [];

  // Skill-Median des Pools für underplaced/overplaced-Bestimmung
  const sortedSkills = [...enriched].map((e) => e.skillScore).sort((a, b) => a - b);
  const median = sortedSkills[Math.floor(sortedSkills.length / 2)] ?? 0.5;

  const pairs: SwapPair[] = [];
  const seenKeys = new Set<string>();

  for (const sel of selectedEntries) {
    const isUnderplaced = sel.skillScore >= median;

    for (const other of enriched) {
      if (other.name === sel.name) continue;

      // Pair-Variante deduplizieren (left::right vs right::left)
      const k1 = `${sel.key}::${other.key}`;
      const k2 = `${other.key}::${sel.key}`;
      if (seenKeys.has(k1) || seenKeys.has(k2)) continue;

      let left: SwapChatter;
      let right: SwapChatter;
      if (isUnderplaced) {
        // Sel ist gut → soll besseren Account (mehr Follower) bekommen
        if (other.followers <= sel.followers) continue;
        left = sel;
        right = other;
      } else {
        // Sel ist schwach → andere (bessere Skiller) sollten seinen Account übernehmen
        if (other.followers >= sel.followers) continue;
        if (other.skillScore <= sel.skillScore) continue;
        left = other;
        right = sel;
      }

      const gain = computeSwapExpectedGain(left, right, bundle);
      // Lockerer Modus: auch negative/kleine Gains zulassen, aber sortieren
      seenKeys.add(k1);
      const followerRatio = right.followers / Math.max(left.followers, 1);
      const tierJump = Math.max(0, tierIndex(right.tier) - tierIndex(left.tier));
      pairs.push({
        left,
        right,
        expectedGain: gain,
        followerRatio,
        tierJump,
        leftAlternatives: [],
        rightAlternatives: [],
      });
    }
  }

  pairs.sort((a, b) => b.expectedGain - a.expectedGain);
  return pairs.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/*  CHALLENGER-PICKER — Alternativen für einen Slot in einem Pair      */
/* ------------------------------------------------------------------ */

/**
 * Liefert die besten Alternativen für eine Pair-Slot.
 *
 * @param fixed   Der NICHT zu ersetzende Chatter (Counterpart)
 * @param side    Welche Seite ersetzt werden soll
 *                  "left"  → ersetze Underplaced; fixed = right
 *                  "right" → ersetze Overplaced;  fixed = left
 * @param current Der aktuell auf der Slot sitzende Chatter (wird ausgeblendet)
 * @param all     Alle verfügbaren Chatter (aus listAllSwapChatters)
 */
export function computeChallengersForSlot(
  fixed: SwapChatter,
  side: "left" | "right",
  current: SwapChatter,
  all: SwapChatter[],
  bundle: BenchmarkBundle | null = null,
  limit = 8
): Array<{ chatter: SwapChatter; expectedGain: number }> {
  const out: Array<{ chatter: SwapChatter; expectedGain: number }> = [];
  for (const c of all) {
    if (c.key === current.key) continue;
    if (c.name === fixed.name) continue;
    if (c.followers <= 0) continue;
    let left: SwapChatter, right: SwapChatter;
    if (side === "left") {
      // c soll Underplaced sein → muss kleineren Account haben als fixed (right)
      if (c.followers >= fixed.followers) continue;
      left = c;
      right = fixed;
    } else {
      // c soll Overplaced sein → muss größeren Account haben als fixed (left)
      if (c.followers <= fixed.followers) continue;
      left = fixed;
      right = c;
    }
    const gain = computeSwapExpectedGain(left, right, bundle);
    out.push({ chatter: c, expectedGain: gain });
  }
  out.sort((a, b) => b.expectedGain - a.expectedGain);
  return out.slice(0, limit);
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
