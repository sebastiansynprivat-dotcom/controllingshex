/**
 * Model Tracking Overview
 *
 * Lädt für eine Plattform alle Models, die jemals in chatter_history aufgetaucht sind,
 * + täglichen Umsatz im gewählten Zeitraum + Trend (lineare Regression).
 */

import { supabase } from "@/integrations/supabase/client";
import type { TimeRange } from "@/lib/timerange-categorize";

const PAGE_SIZE = 1000;

export interface DailyPoint {
  date: string;
  revenue: number;
  chatter: string | null;
}

export type TrendDirection = "up" | "flat" | "down" | "none";

export interface ModelOverviewRow {
  modelName: string;
  daily: DailyPoint[];
  totalRevenue: number;
  avgPerDay: number;
  pointCount: number;
  currentChatter: string | null;
  trend: TrendDirection;
  /** Prozentuale Veränderung Ende vs. Anfang laut Regression (gerundet). */
  trendPct: number | null;
  /** Slope in €/Tag — für Sortierung intern. */
  slope: number;
  /** Tage, die der aktuelle Chatter ununterbrochen auf dem Model ist (lookback bis 365T). */
  currentPhaseDays: number | null;
  /** Gab es vor der aktuellen Chatter-Phase eine andere? */
  previousPhaseExisted: boolean;
  /** War der Trend der vorherigen Phase bereits negativ (slope < 0)? */
  previousPhaseTrendDown: boolean;
}


/** Linear regression — returns slope (€/day) and intercept. */
function linearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export function computeTrend(daily: DailyPoint[], rangeDays: number): { direction: TrendDirection; pct: number | null; slope: number } {
  if (daily.length < 3) return { direction: "none", pct: null, slope: 0 };
  const points = daily.map((p, i) => ({ x: i, y: p.revenue }));
  const { slope, intercept } = linearRegression(points);
  const n = daily.length;
  const startVal = intercept;
  const endVal = intercept + slope * (n - 1);
  const avg = (startVal + endVal) / 2;
  if (avg <= 0) return { direction: "none", pct: null, slope };
  const pct = Math.round(((endVal - startVal) / Math.max(1, avg)) * 100);
  let direction: TrendDirection;
  if (pct > 5) direction = "up";
  else if (pct < -5) direction = "down";
  else direction = "flat";
  return { direction, pct, slope };
}

interface RawRow {
  account: string;
  chatter_name: string | null;
  revenue_today: number | null;
  analysis_date: string;
}

async function fetchRangeRows(platform: string, from: string, to: string): Promise<RawRow[]> {
  const all: RawRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("chatter_history")
      .select("account, chatter_name, revenue_today, analysis_date")
      .eq("platform", platform)
      .gte("analysis_date", from)
      .lte("analysis_date", to)
      .order("analysis_date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as RawRow[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

/**
 * Lädt Overview für gewählten Zeitraum.
 * Modell-Pool = alle distinct accounts, die im 365T-Fenster JEMALS Umsatz oder Aktivität hatten.
 * Pro Modell die Tagespunkte des gewählten Zeitraums (kann leer sein).
 */
export async function loadModelOverview(platform: string, range: TimeRange): Promise<ModelOverviewRow[]> {
  // Vergleichbares: lifetime model pool aus ~365 Tagen
  const today = new Date();
  const yearAgo = new Date(today);
  yearAgo.setDate(yearAgo.getDate() - 365);
  const yearAgoIso = yearAgo.toISOString().split("T")[0];
  const todayIso = today.toISOString().split("T")[0];

  // 1) Pool: alle distinct accounts in last 365d
  const poolRows = await fetchRangeRows(platform, yearAgoIso, todayIso);
  const modelSet = new Set<string>();
  for (const r of poolRows) {
    if (r.account && r.account.trim()) modelSet.add(r.account.trim());
  }

  // 2) Range-Daten: pro (model, date) summieren
  const rangeRows = range.from === yearAgoIso && range.to === todayIso
    ? poolRows
    : await fetchRangeRows(platform, range.from, range.to);

  const byModel = new Map<string, Map<string, { revenue: number; chatters: Map<string, number> }>>();
  for (const r of rangeRows) {
    const acc = r.account?.trim();
    if (!acc) continue;
    const dateMap = byModel.get(acc) ?? new Map();
    const day = dateMap.get(r.analysis_date) ?? { revenue: 0, chatters: new Map<string, number>() };
    const rev = Number(r.revenue_today) || 0;
    day.revenue += rev;
    const cName = r.chatter_name?.trim() || "—";
    day.chatters.set(cName, (day.chatters.get(cName) ?? 0) + rev);
    dateMap.set(r.analysis_date, day);
    byModel.set(acc, dateMap);
  }

  // 3) Last chatter (most recent analysis_date overall, take top revenue chatter that day)
  const latestChatter = new Map<string, string>();
  for (const r of [...poolRows].sort((a, b) => a.analysis_date.localeCompare(b.analysis_date))) {
    const acc = r.account?.trim();
    if (!acc || !r.chatter_name?.trim()) continue;
    latestChatter.set(acc, r.chatter_name.trim());
  }

  const rangeDaysCount = (() => {
    const a = new Date(range.from + "T00:00:00Z").getTime();
    const b = new Date(range.to + "T00:00:00Z").getTime();
    return Math.max(1, Math.floor((b - a) / 86400000) + 1);
  })();

  // Per-model phases aus 365T-Pool ableiten (für currentPhaseDays etc.)
  const poolByModel = new Map<string, Map<string, { revenue: number; chatters: Map<string, number> }>>();
  for (const r of poolRows) {
    const acc = r.account?.trim();
    if (!acc) continue;
    const dateMap = poolByModel.get(acc) ?? new Map();
    const day = dateMap.get(r.analysis_date) ?? { revenue: 0, chatters: new Map<string, number>() };
    const rev = Number(r.revenue_today) || 0;
    day.revenue += rev;
    const cName = r.chatter_name?.trim() || "—";
    day.chatters.set(cName, (day.chatters.get(cName) ?? 0) + rev);
    dateMap.set(r.analysis_date, day);
    poolByModel.set(acc, dateMap);
  }

  const out: ModelOverviewRow[] = [];
  for (const modelName of modelSet) {
    const dateMap = byModel.get(modelName);
    const daily: DailyPoint[] = [];
    if (dateMap) {
      const sortedDates = Array.from(dateMap.keys()).sort();
      for (const d of sortedDates) {
        const entry = dateMap.get(d)!;
        let topChatter: string | null = null;
        let topRev = -1;
        for (const [name, rev] of entry.chatters) {
          if (rev > topRev) { topRev = rev; topChatter = name; }
        }
        daily.push({ date: d, revenue: entry.revenue, chatter: topChatter });
      }
    }
    const totalRevenue = daily.reduce((s, p) => s + p.revenue, 0);
    const avgPerDay = totalRevenue / rangeDaysCount;
    const trendResult = computeTrend(daily, rangeDaysCount);

    // Phasen aus 365T-Pool
    const poolDateMap = poolByModel.get(modelName);
    let currentPhaseDays: number | null = null;
    let previousPhaseExisted = false;
    let previousPhaseTrendDown = false;
    if (poolDateMap) {
      const poolDates = Array.from(poolDateMap.keys()).sort();
      const poolDaily: DailyPoint[] = poolDates.map((d) => {
        const entry = poolDateMap.get(d)!;
        let topChatter: string | null = null;
        let topRev = -1;
        for (const [name, rev] of entry.chatters) {
          if (rev > topRev) { topRev = rev; topChatter = name; }
        }
        return { date: d, revenue: entry.revenue, chatter: topChatter };
      });
      const phases = derivePhases(poolDaily);
      const currentPhase = phases[phases.length - 1] ?? null;
      const previousPhase = phases.length >= 2 ? phases[phases.length - 2] : null;
      if (currentPhase) {
        // Days seit fromDate des current phase bis heute (Kalendertage, nicht nur Daten-Tage)
        const from = new Date(currentPhase.fromDate + "T00:00:00Z").getTime();
        const now = new Date(todayIso + "T00:00:00Z").getTime();
        currentPhaseDays = Math.max(1, Math.floor((now - from) / 86400000) + 1);
      }
      if (previousPhase) {
        previousPhaseExisted = true;
        // Slope der vorherigen Phase
        const prevPoints = poolDaily
          .filter((p) => p.date >= previousPhase.fromDate && p.date <= previousPhase.toDate)
          .map((p, i) => ({ x: i, y: p.revenue }));
        if (prevPoints.length >= 3) {
          const { slope } = linearRegression(prevPoints);
          previousPhaseTrendDown = slope < 0;
        }
      }
    }

    out.push({
      modelName,
      daily,
      totalRevenue,
      avgPerDay,
      pointCount: daily.length,
      currentChatter: latestChatter.get(modelName) ?? null,
      trend: trendResult.direction,
      trendPct: trendResult.pct,
      slope: trendResult.slope,
      currentPhaseDays,
      previousPhaseExisted,
      previousPhaseTrendDown,
    });
  }

  out.sort((a, b) => b.totalRevenue - a.totalRevenue);
  return out;
}


// ─────────────────────────── ALERTS ───────────────────────────

export type ModelAlertKind = "decline" | "new_chatter_underperform";

export interface ModelAlert {
  modelName: string;
  kind: ModelAlertKind;
  reason: string;
  currentChatter: string | null;
  deltaPct: number | null;
  severity: "high" | "medium";
  totalRevenue30d: number;
}

interface ChatterPhase {
  chatterName: string;
  fromDate: string;
  toDate: string;
  days: number;
  totalRevenue: number;
  avgPerDay: number;
}

function derivePhases(daily: DailyPoint[]): ChatterPhase[] {
  const phases: ChatterPhase[] = [];
  for (const p of daily) {
    if (!p.chatter) continue;
    const last = phases[phases.length - 1];
    if (last && last.chatterName === p.chatter) {
      last.toDate = p.date;
      last.days += 1;
      last.totalRevenue += p.revenue;
      last.avgPerDay = last.totalRevenue / last.days;
    } else {
      phases.push({
        chatterName: p.chatter,
        fromDate: p.date,
        toDate: p.date,
        days: 1,
        totalRevenue: p.revenue,
        avgPerDay: p.revenue,
      });
    }
  }
  return phases;
}

/**
 * Detect alerts für Models. Lädt 60T Historie, filtert auf relevante Models
 * (Mindestumsatz letzte 30T + Mindest-Datenpunkte).
 */
export async function detectRelevantModelAlerts(
  platform: string,
  relevanceMinEur30d = 100
): Promise<ModelAlert[]> {
  const today = new Date();
  const since = new Date(today);
  since.setDate(since.getDate() - 60);
  const fromIso = since.toISOString().split("T")[0];
  const toIso = today.toISOString().split("T")[0];

  const rows = await fetchRangeRows(platform, fromIso, toIso);

  // Group per model -> per day
  const byModel = new Map<string, Map<string, { revenue: number; chatters: Map<string, number> }>>();
  for (const r of rows) {
    const acc = r.account?.trim();
    if (!acc) continue;
    const dateMap = byModel.get(acc) ?? new Map();
    const day = dateMap.get(r.analysis_date) ?? { revenue: 0, chatters: new Map<string, number>() };
    const rev = Number(r.revenue_today) || 0;
    day.revenue += rev;
    const cName = r.chatter_name?.trim() || "—";
    day.chatters.set(cName, (day.chatters.get(cName) ?? 0) + rev);
    dateMap.set(r.analysis_date, day);
    byModel.set(acc, dateMap);
  }

  const thirtyAgo = new Date(today);
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const thirtyAgoIso = thirtyAgo.toISOString().split("T")[0];

  const alerts: ModelAlert[] = [];

  for (const [modelName, dateMap] of byModel) {
    const dates = Array.from(dateMap.keys()).sort();
    const daily: DailyPoint[] = dates.map((d) => {
      const entry = dateMap.get(d)!;
      let topChatter: string | null = null;
      let topRev = -1;
      for (const [name, rev] of entry.chatters) {
        if (rev > topRev) { topRev = rev; topChatter = name; }
      }
      return { date: d, revenue: entry.revenue, chatter: topChatter };
    });

    // Relevance gate
    const last30 = daily.filter((p) => p.date >= thirtyAgoIso);
    const totalRevenue30d = last30.reduce((s, p) => s + p.revenue, 0);
    if (totalRevenue30d < relevanceMinEur30d) continue;
    if (last30.length < 5) continue;

    const phases = derivePhases(daily);
    const currentPhase = phases[phases.length - 1] ?? null;
    const previousPhase = phases.length >= 2 ? phases[phases.length - 2] : null;

    // Alert 1: Decline since chatter switch
    if (currentPhase && previousPhase && previousPhase.avgPerDay > 0 && currentPhase.days >= 3) {
      const deltaPct = Math.round(
        ((currentPhase.avgPerDay - previousPhase.avgPerDay) / previousPhase.avgPerDay) * 100
      );
      if (deltaPct <= -20) {
        alerts.push({
          modelName,
          kind: "decline",
          reason: `Seit Wechsel zu ${currentPhase.chatterName} im Rückgang vs. ${previousPhase.chatterName}`,
          currentChatter: currentPhase.chatterName,
          deltaPct,
          severity: deltaPct <= -40 ? "high" : "medium",
          totalRevenue30d,
        });
        continue;
      }
    }

    // Alert 2: Last 7d < 60% of 30d avg
    const last7 = daily.slice(-7);
    if (last30.length >= 14 && last7.length >= 5) {
      const avg30 = last30.reduce((s, p) => s + p.revenue, 0) / last30.length;
      const avg7 = last7.reduce((s, p) => s + p.revenue, 0) / last7.length;
      if (avg30 >= 30 && avg7 < avg30 * 0.6) {
        const dropPct = Math.round(((avg7 - avg30) / avg30) * 100);
        alerts.push({
          modelName,
          kind: "decline",
          reason: `Letzte 7T deutlich unter eigenem 30T-Schnitt`,
          currentChatter: currentPhase?.chatterName ?? null,
          deltaPct: dropPct,
          severity: dropPct <= -50 ? "high" : "medium",
          totalRevenue30d,
        });
        continue;
      }
    }

    // Alert 3: New chatter ≤7d & <70% of previous phase
    if (
      currentPhase &&
      previousPhase &&
      currentPhase.days <= 7 &&
      currentPhase.days >= 2 &&
      previousPhase.avgPerDay > 0 &&
      currentPhase.avgPerDay < previousPhase.avgPerDay * 0.7
    ) {
      const deltaPct = Math.round(
        ((currentPhase.avgPerDay - previousPhase.avgPerDay) / previousPhase.avgPerDay) * 100
      );
      alerts.push({
        modelName,
        kind: "new_chatter_underperform",
        reason: `Neuer Chatter ${currentPhase.chatterName} (Tag ${currentPhase.days}) unter Vorgänger-Schnitt`,
        currentChatter: currentPhase.chatterName,
        deltaPct,
        severity: deltaPct <= -50 ? "high" : "medium",
        totalRevenue30d,
      });
    }
  }

  alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
    return b.totalRevenue30d - a.totalRevenue30d;
  });

  return alerts;
}

export function fmtEur(v: number): string {
  return Math.round(v).toLocaleString("de-DE") + " €";
}
