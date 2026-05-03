/**
 * Revenue Recovery Queue
 *
 * Identifiziert Chatter, die aktuell deutlich unter ihrem eigenen 30-Tage-Median
 * laufen, und berechnet pro Chatter, wie viel Umsatz in einer Woche zurückgeholt
 * werden könnte, wenn sie auf Baseline gebracht werden.
 *
 * Datenquelle: chatter_history (revenue_today, analysis_date).
 * Keine Vorhersage, keine ML — nur sauberer Vergleich Baseline vs. aktuell.
 */
import { supabase } from "@/integrations/supabase/client";
import { loadActiveChatterNames, normalizeChatterName } from "@/lib/active-chatters";

export interface RecoveryEntry {
  chatterName: string;
  baseline: number;       // 30d-Median (ohne 0€-Tage)
  currentAvg: number;     // Schnitt der letzten 3 Tage mit Daten
  gap: number;            // baseline - currentAvg
  gapPct: number;         // gap / baseline
  recoveryEur: number;    // gap * 7 * confidence (1-Wochen-Hochrechnung)
  confidence: number;     // 0..1
  dataPoints: number;     // Anzahl Tage im Fenster
  lastDate: string;       // ISO
  spark: number[];        // letzte 14 Tage revenue (oldest → newest)
  leaderboardRank?: number;   // Platz im 30T-Leaderboard (1 = top)
  isTopPerformer?: boolean;   // rank <= 10
}

/**
 * Berechnet den Leaderboard-Rang (1 = höchster 30T-Umsatz) pro Chatter
 * basierend auf der bereits geladenen History.
 */
export function computeLeaderboardRanks(history: HistoryRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of history) {
    totals.set(r.chatter_name, (totals.get(r.chatter_name) || 0) + (Number(r.revenue_today) || 0));
  }
  const sorted = [...totals.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const ranks = new Map<string, number>();
  sorted.forEach(([name], i) => ranks.set(name, i + 1));
  return ranks;
}

interface HistoryRow {
  chatter_name: string;
  analysis_date: string;
  revenue_today: number;
}

const PAGE = 1000;
const WINDOW_DAYS = 30;
const RECENT_DAYS = 3;
const MIN_GAP_PCT = 0.15;
const MIN_RECOVERY_EUR = 50;
const MAX_STALENESS_DAYS = 2;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0];
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + "T00:00:00Z").getTime();
  const b = new Date(bIso + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

export async function loadRecoveryHistory(platform: string): Promise<HistoryRow[]> {
  const fromIso = isoDaysAgo(WINDOW_DAYS - 1);
  const toIso = isoDaysAgo(0);
  const all: HistoryRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("chatter_history")
      .select("chatter_name, analysis_date, revenue_today")
      .eq("platform", platform)
      .gte("analysis_date", fromIso)
      .lte("analysis_date", toIso)
      .order("analysis_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as HistoryRow[];
    for (const r of rows) {
      all.push({
        chatter_name: r.chatter_name,
        analysis_date: r.analysis_date,
        revenue_today: Number(r.revenue_today) || 0,
      });
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export function computeRecoveryQueue(
  history: HistoryRow[],
  ranks?: Map<string, number>,
): RecoveryEntry[] {
  const today = isoDaysAgo(0);
  const rankMap = ranks ?? computeLeaderboardRanks(history);

  const byChatter = new Map<string, HistoryRow[]>();
  for (const r of history) {
    if (!byChatter.has(r.chatter_name)) byChatter.set(r.chatter_name, []);
    byChatter.get(r.chatter_name)!.push(r);
  }

  const results: RecoveryEntry[] = [];

  for (const [name, rows] of byChatter) {
    rows.sort((a, b) => a.analysis_date.localeCompare(b.analysis_date));
    const lastDate = rows[rows.length - 1].analysis_date;
    const staleness = daysBetween(lastDate, today);
    if (staleness > MAX_STALENESS_DAYS) continue;

    const nonZero = rows.map((r) => r.revenue_today).filter((v) => v > 0);
    if (nonZero.length < 5) continue;
    const baseline = median(nonZero);
    if (baseline < 30) continue;

    const recent = rows.slice(-RECENT_DAYS).map((r) => r.revenue_today);
    const currentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;

    const gap = baseline - currentAvg;
    if (gap <= 0) continue;
    const gapPct = gap / baseline;
    if (gapPct < MIN_GAP_PCT) continue;

    const confidence = Math.min(1, rows.length / WINDOW_DAYS);
    const recoveryEur = gap * 7 * confidence;
    if (recoveryEur < MIN_RECOVERY_EUR) continue;

    const spark: number[] = [];
    const map = new Map(rows.map((r) => [r.analysis_date, r.revenue_today]));
    for (let i = 13; i >= 0; i--) {
      const iso = isoDaysAgo(i);
      spark.push(map.get(iso) ?? 0);
    }

    const leaderboardRank = rankMap.get(name);
    const isTopPerformer = leaderboardRank !== undefined && leaderboardRank <= 10;

    results.push({
      chatterName: name,
      baseline,
      currentAvg,
      gap,
      gapPct,
      recoveryEur,
      confidence,
      dataPoints: rows.length,
      lastDate,
      spark,
      leaderboardRank,
      isTopPerformer,
    });
  }

  results.sort((a, b) => b.recoveryEur - a.recoveryEur);
  return results;
}

export function totalRecoveryEur(entries: RecoveryEntry[]): number {
  return entries.reduce((s, e) => s + e.recoveryEur, 0);
}
