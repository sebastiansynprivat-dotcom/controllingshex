/**
 * Risk-Forecast Engine
 *
 * Berechnet pro Chatter einen Risk-Score 0–100 für die nächsten 1–3 Tage,
 * basierend auf 7 Tagen History + Peer-Benchmarks. Pure Funktion, kein I/O.
 *
 * Signale (gewichtet):
 *  - Revenue-Slope        (30) — lineare Regression letzte 7 Tage
 *  - Verzug-Drift         (25) — response_delay_days steigend
 *  - Mass-DM-Verfall      (15) — Disziplin-Frühindikator
 *  - Chat-Stau-Wachstum   (10) — open_chats Slope
 *  - Peer-Gap-Trend       (10) — Skill vs. Cluster-P25
 *  - Onboarding-Phase     ( 5) — daysSinceStart < 14
 *  - Tier-Mismatch        ( 5) — niedrige Performance auf High-Tier-Account
 *  - Abwesenheits-Muster  (15) — unzuverlässige Anwesenheit (opt-in)
 */

export interface HistoryPoint {
  date: string;          // YYYY-MM-DD
  revenue: number;
  responseDelay: number;
  massDms: number;
  openChats: number;
}

export interface ForecastInput {
  chatter: string;
  account: string | null;
  followers: number;
  /** sortiert ASC nach Datum (üblicherweise letzte 7 Tage) */
  history: HistoryPoint[];
  /** Volle History (30d), für Absence-Pattern-Erkennung. Optional. */
  fullHistory?: HistoryPoint[];
  /** Tage seit Onboarding (null wenn unbekannt) */
  daysSinceStart: number | null;
  /** Peer-Cluster-Median (€/Tag) — null wenn keine Benchmark-Daten */
  peerMedian: number | null;
  peerP25: number | null;
  /** Wenn true → Absence-Signal wird eingerechnet */
  includeAbsence?: boolean;
}

export interface SignalContribution {
  key: "revenue" | "delay" | "massdm" | "openchats" | "peer" | "onboarding" | "tier" | "absence";
  label: string;
  /** Punkte 0..maxWeight */
  points: number;
  /** menschenlesbarer Detail-String */
  detail: string;
}

export interface RiskScore {
  chatter: string;
  account: string | null;
  /** 0..100 */
  score: number;
  band: "low" | "medium" | "high" | "critical";
  /** signal mit der höchsten Punktzahl */
  mainReason: string;
  /** geschätzter Tagesumsatz, der bei Crash gefährdet wäre (€) */
  euroAtRisk: number;
  signals: SignalContribution[];
  /** Sparkline-Daten für UI */
  revenueTrend: number[];
}

const W = {
  revenue: 30,
  delay: 25,
  massdm: 15,
  openchats: 10,
  peer: 10,
  onboarding: 5,
  tier: 5,
  absence: 15,
} as const;

/* ------------------------------------------------------------------ */
/*  STATISTIK                                                          */
/* ------------------------------------------------------------------ */

/** Lineare Regression. Returns slope (units per day). */
function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/* ------------------------------------------------------------------ */
/*  SIGNAL-BERECHNUNG                                                  */
/* ------------------------------------------------------------------ */

function revenueSignal(history: HistoryPoint[]): SignalContribution {
  const revs = history.map(h => h.revenue);
  const avg = average(revs);
  const slope = linearSlope(revs);

  if (avg === 0 || revs.length < 3) {
    return { key: "revenue", label: "Revenue-Trend", points: 0, detail: "zu wenig Daten" };
  }
  // slope-pro-Tag in % vom Schnitt
  const slopePct = (slope / avg) * 100;
  let pts = 0;
  if (slopePct < -25) pts = W.revenue;
  else if (slopePct < -15) pts = W.revenue * 0.75;
  else if (slopePct < -8) pts = W.revenue * 0.5;
  else if (slopePct < -3) pts = W.revenue * 0.25;

  const sign = slopePct >= 0 ? "+" : "";
  return {
    key: "revenue",
    label: "Revenue-Slope",
    points: Math.round(pts),
    detail: `${sign}${slopePct.toFixed(0)}%/Tag`,
  };
}

function delaySignal(history: HistoryPoint[]): SignalContribution {
  const delays = history.map(h => h.responseDelay);
  if (delays.length < 3) {
    return { key: "delay", label: "Antwortverzug", points: 0, detail: "—" };
  }
  const first = average(delays.slice(0, Math.ceil(delays.length / 2)));
  const last = average(delays.slice(Math.floor(delays.length / 2)));
  const drift = last - first;
  const peak = Math.max(...delays);

  let pts = 0;
  if (peak >= 3) pts = W.delay;
  else if (drift >= 1.5) pts = W.delay * 0.8;
  else if (drift >= 0.7) pts = W.delay * 0.5;
  else if (drift >= 0.3) pts = W.delay * 0.25;

  const detail = drift >= 0.3
    ? `Drift ${first.toFixed(1)} → ${last.toFixed(1)} Tage`
    : peak >= 2
      ? `Spitze bei ${peak} Tagen`
      : "stabil";

  return { key: "delay", label: "Verzug-Drift", points: Math.round(pts), detail };
}

function massDmSignal(history: HistoryPoint[]): SignalContribution {
  const dms = history.map(h => h.massDms);
  if (dms.length < 4) {
    return { key: "massdm", label: "Mass-DMs", points: 0, detail: "—" };
  }
  const half = Math.floor(dms.length / 2);
  const early = average(dms.slice(0, half));
  const late = average(dms.slice(half));
  if (early <= 0) {
    return { key: "massdm", label: "Mass-DMs", points: 0, detail: "kein Baseline" };
  }
  const dropPct = ((early - late) / early) * 100;
  let pts = 0;
  if (dropPct >= 50) pts = W.massdm;
  else if (dropPct >= 30) pts = W.massdm * 0.7;
  else if (dropPct >= 15) pts = W.massdm * 0.4;

  const detail = dropPct >= 15
    ? `−${dropPct.toFixed(0)}% Disziplin`
    : "stabil";
  return { key: "massdm", label: "Mass-DM-Verfall", points: Math.round(pts), detail };
}

function openChatsSignal(history: HistoryPoint[]): SignalContribution {
  const chats = history.map(h => h.openChats);
  if (chats.length < 3) {
    return { key: "openchats", label: "Chat-Stau", points: 0, detail: "—" };
  }
  const avg = average(chats);
  if (avg === 0) {
    return { key: "openchats", label: "Chat-Stau", points: 0, detail: "leer" };
  }
  const slope = linearSlope(chats);
  const slopePct = (slope / avg) * 100;
  let pts = 0;
  if (slopePct > 25) pts = W.openchats;
  else if (slopePct > 12) pts = W.openchats * 0.6;
  else if (slopePct > 5) pts = W.openchats * 0.3;
  return {
    key: "openchats",
    label: "Chat-Stau-Wachstum",
    points: Math.round(pts),
    detail: slopePct > 5 ? `Backlog +${slopePct.toFixed(0)}%/Tag` : "stabil",
  };
}

function peerGapSignal(history: HistoryPoint[], peerP25: number | null): SignalContribution {
  if (peerP25 === null || peerP25 <= 0 || history.length < 3) {
    return { key: "peer", label: "Peer-Gap", points: 0, detail: "—" };
  }
  const recent = average(history.slice(-3).map(h => h.revenue));
  const ratio = recent / peerP25;
  let pts = 0;
  if (ratio < 0.4) pts = W.peer;
  else if (ratio < 0.6) pts = W.peer * 0.7;
  else if (ratio < 0.85) pts = W.peer * 0.4;
  return {
    key: "peer",
    label: "Peer-Gap",
    points: Math.round(pts),
    detail: ratio < 0.85
      ? `${(ratio * 100).toFixed(0)}% vom Cluster-P25`
      : "über P25",
  };
}

function onboardingSignal(daysSinceStart: number | null): SignalContribution {
  if (daysSinceStart === null) {
    return { key: "onboarding", label: "Onboarding", points: 0, detail: "—" };
  }
  if (daysSinceStart < 7) {
    return { key: "onboarding", label: "Onboarding", points: W.onboarding, detail: `Tag ${daysSinceStart + 1}` };
  }
  if (daysSinceStart < 14) {
    return { key: "onboarding", label: "Onboarding", points: W.onboarding * 0.6, detail: `Tag ${daysSinceStart + 1}` };
  }
  return { key: "onboarding", label: "Onboarding", points: 0, detail: "etabliert" };
}

function tierMismatchSignal(history: HistoryPoint[], followers: number, peerMedian: number | null): SignalContribution {
  if (peerMedian === null || peerMedian <= 0 || history.length < 3 || followers < 1000) {
    return { key: "tier", label: "Tier-Mismatch", points: 0, detail: "—" };
  }
  const recent = average(history.slice(-3).map(h => h.revenue));
  const ratio = recent / peerMedian;
  // High-Tier (≥1000 Follower) und liefert <60% vom Median
  if (ratio < 0.5) return { key: "tier", label: "Tier-Mismatch", points: W.tier, detail: `Top-Account, ${(ratio * 100).toFixed(0)}% vom Median` };
  if (ratio < 0.7) return { key: "tier", label: "Tier-Mismatch", points: W.tier * 0.5, detail: `${(ratio * 100).toFixed(0)}% vom Median` };
  return { key: "tier", label: "Tier-Mismatch", points: 0, detail: "passt" };
}

/* ------------------------------------------------------------------ */
/*  HAUPT-FUNKTION                                                     */
/* ------------------------------------------------------------------ */

function bandFor(score: number): RiskScore["band"] {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export function computeRiskScore(input: ForecastInput): RiskScore {
  const { history } = input;
  const signals: SignalContribution[] = [
    revenueSignal(history),
    delaySignal(history),
    massDmSignal(history),
    openChatsSignal(history),
    peerGapSignal(history, input.peerP25),
    onboardingSignal(input.daysSinceStart),
    tierMismatchSignal(history, input.followers, input.peerMedian),
  ];

  const score = Math.min(100, Math.round(signals.reduce((s, sig) => s + sig.points, 0)));

  // Hauptursache = stärkstes Signal
  const sorted = [...signals].sort((a, b) => b.points - a.points);
  const top = sorted[0];
  const mainReason = top.points > 0
    ? `${top.label}: ${top.detail}`
    : "Keine kritischen Signale";

  // Geld-Risiko: avg Revenue × 3 Tage × erwartete Drop-Rate (40% bei high)
  const avgRev = average(history.slice(-7).map(h => h.revenue));
  const dropRate = score >= 80 ? 0.6 : score >= 60 ? 0.4 : score >= 35 ? 0.2 : 0;
  const euroAtRisk = Math.round(avgRev * 3 * dropRate);

  return {
    chatter: input.chatter,
    account: input.account,
    score,
    band: bandFor(score),
    mainReason,
    euroAtRisk,
    signals,
    revenueTrend: history.map(h => h.revenue),
  };
}

export function computeRiskScores(inputs: ForecastInput[]): RiskScore[] {
  return inputs.map(computeRiskScore).sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/*  BACKTESTING                                                        */
/* ------------------------------------------------------------------ */

export interface BacktestResult {
  totalPredictions: number;
  hits: number;
  hitRate: number;
  /** alle einzelnen Treffer/Misses für Detail-Anzeige */
  details: { chatter: string; date: string; predictedScore: number; actualDropPct: number; hit: boolean }[];
}

/**
 * Backtest: für jeden möglichen Pivot-Tag T in der History
 * - berechne Risk mit Daten bis T-1
 * - vergleiche mit was an T..T+2 wirklich passierte
 * - Hit, wenn Risk≥60 UND Revenue ist ≥30% gegenüber Baseline gefallen
 */
export function backtest(
  fullHistoryByChatter: Map<string, HistoryPoint[]>,
  meta: Map<string, { account: string | null; followers: number; daysSinceStart: number | null; peerMedian: number | null; peerP25: number | null }>,
  threshold: number = 60,
  dropThresholdPct: number = 30,
): BacktestResult {
  const details: BacktestResult["details"] = [];
  let hits = 0;
  let total = 0;

  for (const [chatter, full] of fullHistoryByChatter) {
    if (full.length < 10) continue; // brauchen ≥7 Train + 3 Test
    const m = meta.get(chatter);
    if (!m) continue;

    // Sliding window: pivot = letzte 3 Tage Test-Window
    for (let pivot = 7; pivot <= full.length - 3; pivot++) {
      const train = full.slice(Math.max(0, pivot - 7), pivot);
      const test = full.slice(pivot, pivot + 3);
      if (train.length < 5 || test.length < 2) continue;

      const baseline = average(train.slice(-3).map(h => h.revenue));
      if (baseline <= 0) continue;

      const score = computeRiskScore({
        chatter,
        account: m.account,
        followers: m.followers,
        history: train,
        daysSinceStart: m.daysSinceStart,
        peerMedian: m.peerMedian,
        peerP25: m.peerP25,
      }).score;

      if (score < threshold) continue;

      const actualAvg = average(test.map(h => h.revenue));
      const dropPct = ((baseline - actualAvg) / baseline) * 100;
      const hit = dropPct >= dropThresholdPct;

      total++;
      if (hit) hits++;
      details.push({
        chatter,
        date: full[pivot].date,
        predictedScore: score,
        actualDropPct: Math.round(dropPct),
        hit,
      });
    }
  }

  return {
    totalPredictions: total,
    hits,
    hitRate: total > 0 ? hits / total : 0,
    details: details.sort((a, b) => b.predictedScore - a.predictedScore),
  };
}
