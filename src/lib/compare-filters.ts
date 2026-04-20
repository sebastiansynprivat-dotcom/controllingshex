/**
 * Compare-Mode: Filter zwei Chatter-Sets nebeneinander und vergleiche
 * aggregierte Kennzahlen (Ø, Σ, Null-Rate, Trend, Top).
 *
 * Greift auf die bereits geladenen Daten in `TinderMode` zu —
 * kein zusätzlicher DB-Roundtrip.
 */
import { z } from "zod";
import type { SwapInput } from "@/lib/swap-suggestions";
import type { HistoryRow as RangeHistoryRow, TimeRange } from "@/lib/timerange-categorize";
import type { ActionCategoryName } from "@/lib/action-categories";
import type { AccountTierId } from "@/lib/account-tiers";

/* ----------------------------- Types ----------------------------- */

export const compareFilterSchema = z.object({
  tiers: z.array(z.string()).default([]),                 // AccountTierId[]
  categories: z.array(z.string()).default([]),            // ActionCategoryName[]
  labelIds: z.array(z.string()).default([]),
  revToday: z.tuple([z.number(), z.number()]).nullable().default(null),
  revAvg: z.tuple([z.number(), z.number()]).nullable().default(null),
  delayMax: z.number().nullable().default(null),
  status: z.enum(["any", "active", "inactive", "onboarding"]).default("any"),
  alerts: z.enum(["any", "with", "without"]).default("any"),
});

export interface CompareFilter {
  tiers: string[];
  categories: string[];
  labelIds: string[];
  revToday: [number, number] | null;
  revAvg: [number, number] | null;
  delayMax: number | null;
  status: "any" | "active" | "inactive" | "onboarding";
  alerts: "any" | "with" | "without";
}

export const EMPTY_FILTER: CompareFilter = {
  tiers: [],
  categories: [],
  labelIds: [],
  revToday: null,
  revAvg: null,
  delayMax: null,
  status: "any",
  alerts: "any",
};

export interface CompareStats {
  count: number;
  avgRev: number;     // Ø €/Tag im Fenster
  sumRev: number;     // Σ € im Fenster (gesamtsumme)
  zeroRate: number;   // Anteil Null-Tage über alle History-Rows im Fenster
  trend: number;      // -1..+1 (relative Änderung Ø zweite Hälfte vs erste)
  topChatter: { name: string; avgRev: number } | null;
}

export const EMPTY_STATS: CompareStats = {
  count: 0, avgRev: 0, sumRev: 0, zeroRate: 0, trend: 0, topChatter: null,
};

/* --------------------------- Normalize --------------------------- */

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
}

/* --------------------------- Apply Filter ------------------------ */

export interface ApplyFilterContext {
  /** raw chatters as in TinderMode (with kpis, history, account, categoryName) */
  chatters: Array<{
    name: string;
    account?: string;
    kpis: Record<string, string>;
    categoryName?: string;
    categoryEmoji?: string;
  }>;
  /** History rows for the active TimeRange */
  rangeHistory: RangeHistoryRow[];
  /** active TimeRange (used for avg-calc + window length) */
  range: TimeRange;
  /** Re-categorized map: normalizedName → ActionCategoryName (Heute = leer = use original) */
  recategorizedMap: Map<string, ActionCategoryName>;
  /** Labels assigned: normalizedName → Set<labelId> */
  labelsByChatter: Map<string, Set<string>>;
  /** Tiers per chatter: normalizedName → AccountTierId[] */
  tierIdsByChatter: Map<string, AccountTierId[]>;
  /** chatters with active alerts (normalized names) */
  alertChatterNames: Set<string>;
  /** Onboarding start dates: normalizedName → ISO YYYY-MM-DD */
  onboardingStarts?: Map<string, string>;
}

interface AggregateRow {
  avgRev: number;
  sumRev: number;
  zeroDays: number;
  totalDays: number;
  maxDelay: number;
}

function aggregateChatter(rows: RangeHistoryRow[]): AggregateRow {
  if (rows.length === 0) return { avgRev: 0, sumRev: 0, zeroDays: 0, totalDays: 0, maxDelay: 0 };
  let sum = 0, zero = 0, maxD = 0;
  for (const r of rows) {
    sum += r.revenue_today || 0;
    if ((r.revenue_today || 0) === 0) zero++;
    maxD = Math.max(maxD, r.response_delay_days || 0);
  }
  return { avgRev: sum / rows.length, sumRev: sum, zeroDays: zero, totalDays: rows.length, maxDelay: maxD };
}

function buildHistoryIndex(rangeHistory: RangeHistoryRow[]): Map<string, RangeHistoryRow[]> {
  const map = new Map<string, RangeHistoryRow[]>();
  for (const h of rangeHistory) {
    const key = normalizeName(h.chatter_name);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(h);
  }
  return map;
}

export interface FilteredChatter extends SwapInput {
  /** computed for sort/list display */
  avgRevWindow: number;
  zeroRateWindow: number;
  category: ActionCategoryName | string | undefined;
}

/**
 * Wendet den Filter auf den Daten-Pool an und liefert die gematchten Chatter
 * (mit window-aggregierten Kennzahlen) zurück.
 */
export function applyCompareFilter(
  filter: CompareFilter,
  ctx: ApplyFilterContext
): FilteredChatter[] {
  const histIndex = buildHistoryIndex(ctx.rangeHistory);
  const today = new Date();
  const out: FilteredChatter[] = [];

  for (const c of ctx.chatters) {
    const key = normalizeName(c.name);
    const tierIds = ctx.tierIdsByChatter.get(key) || [];

    // Tier filter
    if (filter.tiers.length > 0) {
      if (!tierIds.some((t) => filter.tiers.includes(t))) continue;
    }

    // Category filter (use recategorized when available, fallback to original)
    const cat = ctx.recategorizedMap.get(key) ?? c.categoryName;
    if (filter.categories.length > 0) {
      if (!cat || !filter.categories.includes(cat as string)) continue;
    }

    // Label filter
    if (filter.labelIds.length > 0) {
      const labels = ctx.labelsByChatter.get(key);
      if (!labels || !filter.labelIds.some((id) => labels.has(id))) continue;
    }

    // Alert filter
    if (filter.alerts === "with" && !ctx.alertChatterNames.has(key)) continue;
    if (filter.alerts === "without" && ctx.alertChatterNames.has(key)) continue;

    // Revenue today (from kpis)
    const revKey = Object.keys(c.kpis).find((k) => /umsatz|revenue/i.test(k));
    const revStr = revKey ? c.kpis[revKey] : "0";
    const revToday = parseFloat(String(revStr).replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
    if (filter.revToday) {
      const [lo, hi] = filter.revToday;
      if (revToday < lo || revToday > hi) continue;
    }

    // Window aggregates
    const rows = histIndex.get(key) || [];
    const agg = aggregateChatter(rows);

    // Max delay: bevorzuge History-Aggregat; falls leer (z.B. "Heute"-Preset), falle auf KPI zurück
    let maxDelay = agg.maxDelay;
    if (rows.length === 0) {
      const delayKey = Object.keys(c.kpis).find((k) => /delay|verzug|antwort/i.test(k));
      if (delayKey) {
        const m = String(c.kpis[delayKey]).match(/-?\d+(?:[.,]\d+)?/);
        if (m) maxDelay = parseFloat(m[0].replace(",", ".")) || 0;
      }
    }

    if (filter.revAvg) {
      const [lo, hi] = filter.revAvg;
      if (agg.avgRev < lo || agg.avgRev > hi) continue;
    }
    if (filter.delayMax != null && maxDelay > filter.delayMax) continue;

    // Status filter
    if (filter.status !== "any") {
      const isOnboarding = (() => {
        const startIso = ctx.onboardingStarts?.get(key);
        if (!startIso) return false;
        const start = new Date(startIso + "T00:00:00Z").getTime();
        const days = Math.floor((today.getTime() - start) / 86400000);
        return days >= 0 && days <= 13;
      })();
      const isActive = revToday > 0 || agg.avgRev > 0;
      if (filter.status === "onboarding" && !isOnboarding) continue;
      if (filter.status === "active" && !isActive) continue;
      if (filter.status === "inactive" && isActive) continue;
    }

    out.push({
      name: c.name,
      account: c.account,
      currentRevenue: revToday,
      history: undefined,
      avgRevWindow: agg.avgRev,
      zeroRateWindow: agg.totalDays > 0 ? agg.zeroDays / agg.totalDays : 0,
      category: cat,
    });
  }

  return out.sort((a, b) => b.avgRevWindow - a.avgRevWindow);
}

/* --------------------------- Stats ------------------------------- */

export function computeCompareStats(
  filtered: FilteredChatter[],
  ctx: Pick<ApplyFilterContext, "rangeHistory" | "range">
): CompareStats {
  if (filtered.length === 0) return EMPTY_STATS;

  const wantNames = new Set(filtered.map((f) => normalizeName(f.name)));
  let sumRev = 0, totalDays = 0, zeroDays = 0;
  // For trend: split window halves by date
  const fromTs = new Date(ctx.range.from + "T00:00:00Z").getTime();
  const toTs = new Date(ctx.range.to + "T00:00:00Z").getTime();
  const midTs = (fromTs + toTs) / 2;
  let firstHalfSum = 0, firstHalfRows = 0, secondHalfSum = 0, secondHalfRows = 0;

  for (const h of ctx.rangeHistory) {
    if (!wantNames.has(normalizeName(h.chatter_name))) continue;
    const rev = h.revenue_today || 0;
    sumRev += rev;
    totalDays++;
    if (rev === 0) zeroDays++;
    const ts = new Date(h.analysis_date + "T00:00:00Z").getTime();
    if (ts <= midTs) {
      firstHalfSum += rev; firstHalfRows++;
    } else {
      secondHalfSum += rev; secondHalfRows++;
    }
  }

  const avgRev = totalDays > 0 ? sumRev / totalDays : 0;
  const zeroRate = totalDays > 0 ? zeroDays / totalDays : 0;

  let trend = 0;
  if (firstHalfRows >= 2 && secondHalfRows >= 2) {
    const a = firstHalfSum / firstHalfRows;
    const b = secondHalfSum / secondHalfRows;
    if (a > 0) trend = (b - a) / a;
    else if (b > 0) trend = 1;
  }

  const top = filtered.reduce<{ name: string; avgRev: number } | null>((acc, c) => {
    if (!acc || c.avgRevWindow > acc.avgRev) return { name: c.name, avgRev: c.avgRevWindow };
    return acc;
  }, null);

  return { count: filtered.length, avgRev, sumRev, zeroRate, trend, topChatter: top };
}

/* --------------------------- Presets ----------------------------- */

export interface ComparePreset {
  id: string;
  label: string;
  setA: CompareFilter;
  setB: CompareFilter;
}

export const DEFAULT_PRESETS: ComparePreset[] = [
  {
    id: "top-vs-seed",
    label: "Top vs Seed",
    setA: { ...EMPTY_FILTER, tiers: ["top"] },
    setB: { ...EMPTY_FILTER, tiers: ["seed"] },
  },
  {
    id: "active-vs-inactive",
    label: "Aktiv vs Inaktiv",
    setA: { ...EMPTY_FILTER, status: "active" },
    setB: { ...EMPTY_FILTER, status: "inactive" },
  },
  {
    id: "alert-vs-noalert",
    label: "Mit Alert vs ohne",
    setA: { ...EMPTY_FILTER, alerts: "with" },
    setB: { ...EMPTY_FILTER, alerts: "without" },
  },
  {
    id: "eingreifen-vs-belohnen",
    label: "SOFORT EINGREIFEN vs BELOHNEN",
    setA: { ...EMPTY_FILTER, categories: ["SOFORT EINGREIFEN"] },
    setB: { ...EMPTY_FILTER, categories: ["BELOHNEN"] },
  },
];

const STORAGE_KEY = "tinder.compareFilters.v1";

export interface CompareStorageState {
  setA: CompareFilter;
  setB: CompareFilter;
  customPresets: ComparePreset[];
}

const storageSchema = z.object({
  setA: compareFilterSchema,
  setB: compareFilterSchema,
  customPresets: z.array(z.object({
    id: z.string(),
    label: z.string(),
    setA: compareFilterSchema,
    setB: compareFilterSchema,
  })).default([]),
});

export function loadCompareState(): CompareStorageState {
  if (typeof window === "undefined") {
    return { setA: EMPTY_FILTER, setB: EMPTY_FILTER, customPresets: [] };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { setA: EMPTY_FILTER, setB: EMPTY_FILTER, customPresets: [] };
    const parsed = storageSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { setA: EMPTY_FILTER, setB: EMPTY_FILTER, customPresets: [] };
    return parsed.data as CompareStorageState;
  } catch {
    return { setA: EMPTY_FILTER, setB: EMPTY_FILTER, customPresets: [] };
  }
}

export function saveCompareState(state: CompareStorageState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

/* --------------------------- Format Helpers ---------------------- */

export function formatEur(n: number): string {
  return `${Math.round(n).toLocaleString("de-DE")} €`;
}

export function formatPct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatTrendPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(0)}%`;
}
