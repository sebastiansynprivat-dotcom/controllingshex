/**
 * Timerange-basierte Re-Kategorisierung der Action-Buckets im Swipe-Mode.
 *
 * Aggregiert pro Chatter die `chatter_history` im gewählten Datumsfenster
 * (from..to inklusiv) und mapped auf eine Action-Category basierend auf
 * Performance-Indikatoren des Fensters statt auf den Snapshot von heute.
 */
import type { ActionCategoryName } from "@/lib/action-categories";
import { supabase } from "@/integrations/supabase/client";

export type TimeRangePreset = "today" | "yesterday" | "7d" | "14d" | "30d" | "custom";

export interface TimeRange {
  preset: TimeRangePreset;
  /** ISO date YYYY-MM-DD (inclusive) */
  from: string;
  /** ISO date YYYY-MM-DD (inclusive) */
  to: string;
}

export interface HistoryRow {
  chatter_name: string;
  analysis_date: string;
  revenue_today: number;
  response_delay_days?: number;
}

const HISTORY_PAGE_SIZE = 1000;

function toIso(d: Date): string {
  return d.toISOString().split("T")[0];
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
}

export function buildTimeRange(preset: TimeRangePreset, customFrom?: string, customTo?: string): TimeRange {
  const today = new Date();
  const todayIso = toIso(today);

  const subDays = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return toIso(d);
  };

  switch (preset) {
    case "today":
      return { preset, from: todayIso, to: todayIso };
    case "yesterday": {
      const y = subDays(1);
      return { preset, from: y, to: y };
    }
    case "7d":
      return { preset, from: subDays(6), to: todayIso };
    case "14d":
      return { preset, from: subDays(13), to: todayIso };
    case "30d":
      return { preset, from: subDays(29), to: todayIso };
    case "custom": {
      let from = customFrom || todayIso;
      let to = customTo || todayIso;
      if (from > to) [from, to] = [to, from];
      return { preset, from, to };
    }
  }
}

export function rangeDays(range: TimeRange): number {
  const a = new Date(range.from + "T00:00:00Z").getTime();
  const b = new Date(range.to + "T00:00:00Z").getTime();
  return Math.max(1, Math.floor((b - a) / 86400000) + 1);
}

export function rangeLabel(range: TimeRange): string {
  switch (range.preset) {
    case "today": return "Heute";
    case "yesterday": return "Gestern";
    case "7d": return "Letzte 7 Tage";
    case "14d": return "Letzte 14 Tage";
    case "30d": return "Letzte 30 Tage";
    case "custom": return `${range.from} → ${range.to}`;
  }
}

/**
 * Lädt History-Rows für einen Datumsbereich (paginiert).
 */
export async function loadHistoryForRange(
  platform: string,
  fromIso: string,
  toIso: string
): Promise<HistoryRow[]> {
  const all: HistoryRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("chatter_history")
      .select("chatter_name, analysis_date, revenue_today, response_delay_days")
      .eq("platform", platform)
      .gte("analysis_date", fromIso)
      .lte("analysis_date", toIso)
      .order("analysis_date", { ascending: true })
      .range(offset, offset + HISTORY_PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data || []) as any[];
    for (const r of rows) {
      all.push({
        chatter_name: r.chatter_name,
        analysis_date: r.analysis_date,
        revenue_today: Number(r.revenue_today) || 0,
        response_delay_days: Number(r.response_delay_days) || 0,
      });
    }
    if (rows.length < HISTORY_PAGE_SIZE) break;
    offset += HISTORY_PAGE_SIZE;
  }
  return all;
}

interface AggStat {
  avgRev: number;
  zeroRate: number;
  maxDelay: number;
  trend: number; // -1..+1 normalized slope vs avg
  count: number;
}

function aggregate(rows: HistoryRow[]): AggStat {
  if (rows.length === 0) return { avgRev: 0, zeroRate: 1, maxDelay: 0, trend: 0, count: 0 };
  const revs = rows.map((r) => r.revenue_today);
  const sum = revs.reduce((a, b) => a + b, 0);
  const avgRev = sum / rows.length;
  const zeroDays = rows.filter((r) => r.revenue_today === 0).length;
  const zeroRate = zeroDays / rows.length;
  const maxDelay = rows.reduce((m, r) => Math.max(m, r.response_delay_days || 0), 0);

  // Linear regression slope on revenue vs day index
  let trend = 0;
  if (rows.length >= 3 && avgRev > 0) {
    const n = rows.length;
    const xs = rows.map((_, i) => i);
    const meanX = (n - 1) / 2;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - meanX) * (revs[i] - avgRev);
      den += (xs[i] - meanX) ** 2;
    }
    const slope = den > 0 ? num / den : 0;
    // Normalize: total change over window relative to avg
    const totalChange = slope * (n - 1);
    trend = totalChange / avgRev;
  }
  return { avgRev, zeroRate, maxDelay, trend, count: rows.length };
}

export interface RecategorizeOptions {
  /** Optional onboarding start dates per chatter (normalized name → ISO date) */
  onboardingStarts?: Map<string, string>;
}

/**
 * Berechnet pro Chatter eine neue ActionCategory basierend auf der Performance
 * im Fenster [from..to].
 *
 * - Chatter ohne History im Fenster → BEOBACHTEN
 * - Bei `today`-Preset: gar nicht aufrufen, stattdessen Original-Kategorie nutzen.
 */
export function recategorizeByWindow(
  chatterNames: string[],
  history: HistoryRow[],
  range: TimeRange,
  options: RecategorizeOptions = {}
): Map<string, ActionCategoryName> {
  const result = new Map<string, ActionCategoryName>();

  const byChatter = new Map<string, HistoryRow[]>();
  for (const h of history) {
    const key = normalizeName(h.chatter_name);
    if (!byChatter.has(key)) byChatter.set(key, []);
    byChatter.get(key)!.push(h);
  }

  // Compute aggregates for all chatters first (for top-20% revenue cutoff)
  const stats = new Map<string, AggStat>();
  for (const name of chatterNames) {
    const key = normalizeName(name);
    const rows = byChatter.get(key) || [];
    stats.set(key, aggregate(rows));
  }

  // Top-20% revenue threshold (only over chatters with any data)
  const revsActive = Array.from(stats.values())
    .filter((s) => s.count > 0 && s.avgRev > 0)
    .map((s) => s.avgRev)
    .sort((a, b) => b - a);
  const top20Cutoff = revsActive.length >= 5
    ? revsActive[Math.floor(revsActive.length * 0.2) - 1] ?? revsActive[0]
    : Infinity;

  const today = new Date();
  for (const name of chatterNames) {
    const key = normalizeName(name);
    const stat = stats.get(key)!;

    // No data in window → BEOBACHTEN
    if (stat.count === 0) {
      result.set(key, "BEOBACHTEN");
      continue;
    }

    // Onboarding-Phase im Fenster (wenn Start innerhalb der letzten 14 Tage liegt)
    const startIso = options.onboardingStarts?.get(key);
    let onboardingDay: number | null = null;
    if (startIso) {
      const start = new Date(startIso + "T00:00:00Z").getTime();
      const days = Math.floor((today.getTime() - start) / 86400000);
      if (days >= 0 && days <= 5) onboardingDay = days + 1;
    }

    // 1. SOFORT EINGREIFEN
    if (stat.zeroRate >= 0.8 || stat.maxDelay > 3) {
      result.set(key, "SOFORT EINGREIFEN");
      continue;
    }
    // 2. COACHING NÖTIG
    if (stat.zeroRate >= 0.5 || stat.trend <= -0.3) {
      result.set(key, "COACHING NÖTIG");
      continue;
    }
    // 3. PUSHEN (Onboarding oder starker positiver Trend)
    if (onboardingDay !== null) {
      result.set(key, `ONBOARDING TAG ${onboardingDay}` as ActionCategoryName);
      continue;
    }
    if (stat.trend >= 0.3) {
      result.set(key, "PUSHEN");
      continue;
    }
    // 4. BELOHNEN (Top-20% Umsatz im Fenster)
    if (stat.avgRev >= top20Cutoff && stat.avgRev > 0) {
      result.set(key, "BELOHNEN");
      continue;
    }
    // 5. BEOBACHTEN (Default)
    result.set(key, "BEOBACHTEN");
  }

  return result;
}
