/**
 * Model Performance Tracking
 *
 * Lädt pro Model:
 *  - Tägliche Umsatz-Timeline (für den aktiven Account-Chatter pro Tag).
 *  - Chatter-Phasen (kontinuierliche Zeiträume, in denen ein Chatter dieses Model hatte).
 *  - Trouble-Detection (wer absäuft seit Wechsel / unter eigenem Schnitt).
 *
 * Wir gehen davon aus: pro (account, analysis_date) gibt es i.d.R. einen primären Chatter.
 * Falls mehrere Chatter am gleichen Tag denselben Account bedient haben, summieren wir
 * den Umsatz und nehmen den Chatter mit dem höchsten Anteil als "Phasen-Chatter".
 */

import { supabase } from "@/integrations/supabase/client";
import { normalizeAccountName, normalizeChatterName } from "@/lib/active-chatters";

const PAGE_SIZE = 1000;

interface RawHistoryRow {
  account: string | null;
  chatter_name: string | null;
  revenue_today: number | string | null;
  analysis_date: string | null;
}

export interface ModelHistoryPoint {
  date: string;
  chatterName: string;
  chatterKey: string;
  revenue: number;
}

function cleanDisplayName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/[\uFE00-\uFE0F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, "")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitAccounts(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => cleanDisplayName(s))
    .filter(Boolean);
}

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function accountSearchPatterns(modelName: string): string[] {
  const clean = cleanDisplayName(modelName);
  const variants = new Set<string>([clean]);
  variants.add(clean.replace(/\s+/g, "_"));
  variants.add(clean.replace(/[_\s]+/g, ""));
  return Array.from(variants).filter(Boolean);
}

async function fetchModelCandidateRows(
  platform: string,
  modelName: string,
  fromDate?: string,
  toDate?: string,
): Promise<RawHistoryRow[]> {
  const out: RawHistoryRow[] = [];
  let offset = 0;
  const patterns = accountSearchPatterns(modelName);

  while (true) {
    let query = supabase
      .from("chatter_history")
      .select("account, chatter_name, revenue_today, analysis_date")
      .eq("platform", platform)
      .or(patterns.map((term) => `account.ilike.%${escapeIlike(term)}%`).join(","))
      .order("analysis_date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (fromDate) query = query.gte("analysis_date", fromDate);
    if (toDate) query = query.lte("analysis_date", toDate);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as RawHistoryRow[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return out;
}

async function loadFollowerMap(platform: string): Promise<Map<string, number>> {
  const { data } = await supabase
    .from("models")
    .select("model_name, follower_count")
    .eq("platform", platform);

  const map = new Map<string, number>();
  for (const row of data || []) {
    const key = normalizeAccountName(String(row.model_name ?? ""));
    if (key) map.set(key, Number(row.follower_count) || 0);
  }
  return map;
}

/**
 * Lädt die Historie für ein Model robust über Case-/Schreibweisen hinweg.
 * Wichtig: `account` kann mehrere Models enthalten ("A, B") – dann wird der
 * Umsatz wie in der Model-Übersicht auf das passende Model aufgeteilt.
 */
export async function loadModelHistoryForModel(
  platform: string,
  modelName: string,
  fromDate?: string,
  toDate?: string,
): Promise<ModelHistoryPoint[]> {
  const targetKey = normalizeAccountName(modelName);
  if (!targetKey) return [];

  const [rows, followerMap] = await Promise.all([
    fetchModelCandidateRows(platform, modelName, fromDate, toDate),
    loadFollowerMap(platform),
  ]);

  const points: ModelHistoryPoint[] = [];
  for (const row of rows) {
    const date = row.analysis_date;
    if (!date) continue;

    const accounts = splitAccounts(row.account);
    const accountKeys = accounts.map((a) => normalizeAccountName(a));
    const targetIndex = accountKeys.findIndex((key) => key === targetKey);
    if (targetIndex === -1) continue;

    const totalRevenue = Number(row.revenue_today) || 0;
    let revenue = totalRevenue;
    if (accounts.length > 1) {
      const weights = accountKeys.map((key) => Math.max(0, followerMap.get(key) ?? 0));
      const weightSum = weights.reduce((sum, w) => sum + w, 0);
      revenue = weightSum > 0
        ? totalRevenue * (weights[targetIndex] / weightSum)
        : totalRevenue / accounts.length;
    }

    const chatterName = cleanDisplayName(row.chatter_name) || "—";
    const chatterKey = normalizeChatterName(chatterName) || chatterName.toLowerCase();
    points.push({ date, chatterName, chatterKey, revenue });
  }

  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

export interface DailyPoint {
  date: string;          // YYYY-MM-DD
  revenue: number;
  chatter: string | null;
  chatterKey?: string | null;
}

export interface ChatterPhase {
  chatterName: string;
  fromDate: string;      // YYYY-MM-DD
  toDate: string;        // YYYY-MM-DD inclusive
  days: number;          // Tage mit Daten
  totalRevenue: number;
  avgPerDay: number;
}

export interface ModelTimeline {
  modelName: string;
  daily: DailyPoint[];
  phases: ChatterPhase[];
  /** % Differenz aktuelle Phase Ø/Tag vs. vorherige Phase Ø/Tag */
  vsPreviousPct: number | null;
  currentPhase: ChatterPhase | null;
  previousPhase: ChatterPhase | null;
}

export interface ModelTrouble {
  modelName: string;
  reason: string;
  severity: "high" | "medium";
  currentChatter: string | null;
  deltaPct: number | null;
  /** Aktueller €/Tag-Schnitt (current phase oder last7) — Basis für Hebel-Schätzung. */
  currentAvgPerDay: number | null;
  /** Vergleichs €/Tag-Schnitt (previous phase oder 30T-Schnitt). */
  baselineAvgPerDay: number | null;
}

/**
 * Lädt tägliche Datenpunkte + Phasen für ein einzelnes Model.
 */
export async function loadModelTimeline(
  platform: string,
  modelName: string,
  fromDate: string,
  toDate: string
): Promise<ModelTimeline> {
  const data = await loadModelHistoryForModel(platform, modelName, fromDate, toDate);

  // Gruppieren pro Tag
  const byDay = new Map<string, Map<string, { name: string; revenue: number }>>(); // date -> chatterKey -> sum
  for (const row of data) {
    if (!byDay.has(row.date)) byDay.set(row.date, new Map());
    const m = byDay.get(row.date)!;
    const cur = m.get(row.chatterKey) ?? { name: row.chatterName, revenue: 0 };
    cur.revenue += row.revenue;
    m.set(row.chatterKey, cur);
  }

  const daily: DailyPoint[] = [];
  const sortedDates = Array.from(byDay.keys()).sort();
  for (const date of sortedDates) {
    const m = byDay.get(date)!;
    let topChatter: string | null = null;
    let topChatterKey: string | null = null;
    let topRev = -1;
    let total = 0;
    for (const [key, item] of m) {
      total += item.revenue;
      if (item.revenue > topRev) {
        topRev = item.revenue;
        topChatter = item.name;
        topChatterKey = key;
      }
    }
    daily.push({ date, revenue: total, chatter: topChatter, chatterKey: topChatterKey });
  }

  // Phasen ableiten: aufeinanderfolgende Tage mit gleichem Chatter
  const phases: ChatterPhase[] = [];
  for (const point of daily) {
    if (!point.chatter) continue;
    const last = phases[phases.length - 1];
    if (last && normalizeChatterName(last.chatterName) === (point.chatterKey ?? normalizeChatterName(point.chatter))) {
      last.toDate = point.date;
      last.days += 1;
      last.totalRevenue += point.revenue;
      last.avgPerDay = last.totalRevenue / last.days;
    } else {
      phases.push({
        chatterName: point.chatter,
        fromDate: point.date,
        toDate: point.date,
        days: 1,
        totalRevenue: point.revenue,
        avgPerDay: point.revenue,
      });
    }
  }

  const currentPhase = phases[phases.length - 1] || null;
  const previousPhase = phases.length >= 2 ? phases[phases.length - 2] : null;
  let vsPreviousPct: number | null = null;
  if (currentPhase && previousPhase && previousPhase.avgPerDay > 0) {
    vsPreviousPct = Math.round(
      ((currentPhase.avgPerDay - previousPhase.avgPerDay) / previousPhase.avgPerDay) * 100
    );
  }

  return { modelName, daily, phases, vsPreviousPct, currentPhase, previousPhase };
}

/**
 * Detect Models in trouble — über alle Models einer Plattform, basierend auf 60T History.
 */
export async function detectModelTroubles(
  platform: string,
  modelNames: string[]
): Promise<ModelTrouble[]> {
  if (modelNames.length === 0) return [];
  const since = new Date();
  since.setDate(since.getDate() - 60);
  const sinceStr = since.toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];

  const troubles: ModelTrouble[] = [];

  // Sequentiell, aber preisgünstig — pro Model ein Query.
  // Bei vielen Models könnte man einen Sammel-Query bauen; reicht erstmal.
  const results = await Promise.all(
    modelNames.map((name) => loadModelTimeline(platform, name, sinceStr, today))
  );

  for (const tl of results) {
    if (tl.daily.length < 5) continue;

    // Trigger 1: aktuelle Phase deutlich schlechter als vorherige
    if (
      tl.currentPhase &&
      tl.previousPhase &&
      tl.vsPreviousPct !== null &&
      tl.vsPreviousPct <= -20 &&
      tl.currentPhase.days >= 3
    ) {
      troubles.push({
        modelName: tl.modelName,
        reason: `Seit Wechsel zu ${tl.currentPhase.chatterName}: ${tl.vsPreviousPct}% vs. ${tl.previousPhase.chatterName}`,
        severity: tl.vsPreviousPct <= -40 ? "high" : "medium",
        currentChatter: tl.currentPhase.chatterName,
        deltaPct: tl.vsPreviousPct,
        currentAvgPerDay: tl.currentPhase.avgPerDay,
        baselineAvgPerDay: tl.previousPhase.avgPerDay,
      });
      continue;
    }

    // Trigger 2: letzte 7T unter 60% des 30T-Schnitts
    const last30 = tl.daily.slice(-30);
    const last7 = tl.daily.slice(-7);
    if (last30.length >= 14 && last7.length >= 5) {
      const avg30 = last30.reduce((s, p) => s + p.revenue, 0) / last30.length;
      const avg7 = last7.reduce((s, p) => s + p.revenue, 0) / last7.length;
      if (avg30 >= 30 && avg7 < avg30 * 0.6) {
        const dropPct = Math.round(((avg7 - avg30) / avg30) * 100);
        troubles.push({
          modelName: tl.modelName,
          reason: `Letzte 7T deutlich unter eigenem 30T-Schnitt (${dropPct}%)`,
          severity: dropPct <= -50 ? "high" : "medium",
          currentChatter: tl.currentPhase?.chatterName ?? null,
          deltaPct: dropPct,
          currentAvgPerDay: avg7,
          baselineAvgPerDay: avg30,
        });
      }
    }
  }

  // Höchste Severity zuerst, dann größter Drop
  troubles.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
    return (a.deltaPct ?? 0) - (b.deltaPct ?? 0);
  });

  return troubles;
}

/**
 * Quick Trend für die Liste: ↑ / → / ↓ basierend auf letzte 7T vs. davor 7T.
 */
export function computeTrend(daily: DailyPoint[]): "up" | "flat" | "down" | "n/a" {
  if (daily.length < 8) return "n/a";
  const last7 = daily.slice(-7);
  const prev7 = daily.slice(-14, -7);
  if (prev7.length < 5) return "n/a";
  const a = last7.reduce((s, p) => s + p.revenue, 0) / last7.length;
  const b = prev7.reduce((s, p) => s + p.revenue, 0) / prev7.length;
  if (b === 0) return a > 0 ? "up" : "flat";
  const pct = (a - b) / b;
  if (pct > 0.1) return "up";
  if (pct < -0.1) return "down";
  return "flat";
}

export function formatEur(v: number): string {
  return v.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " €";
}
