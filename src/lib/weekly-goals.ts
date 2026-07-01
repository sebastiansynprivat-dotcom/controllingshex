/**
 * Wochenziel-Helpers: Fortschritt & Vorschläge auf ISO-Wochen-Basis (Mo–So).
 * Teilen sich Parse-/Format-Helfer mit monthly-goals.
 */
import {
  parseGoalFromNote,
  formatEUR,
  splitAccounts,
  computeModelBaselines,
  type GoalStatus,
} from "@/lib/monthly-goals";

export { parseGoalFromNote, formatEUR, splitAccounts, computeModelBaselines };
export type { GoalStatus };

/** ISO-Wochentag: Mo=1..So=7 */
export function isoWeekday(date: Date): number {
  const d = date.getDay(); // So=0..Sa=6
  return d === 0 ? 7 : d;
}

/** Erster Tag (Montag, lokal 00:00) der Woche, in der `date` liegt. */
export function weekStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = isoWeekday(d) - 1;
  d.setDate(d.getDate() - offset);
  return d;
}

/** Sonntag (lokal 00:00) der Woche, in der `date` liegt. */
export function weekEnd(date: Date): Date {
  const start = weekStart(date);
  start.setDate(start.getDate() + 6);
  return start;
}

/** Montag der nächsten Woche. */
export function firstOfNextWeek(today: Date): Date {
  const next = weekStart(today);
  next.setDate(next.getDate() + 7);
  return next;
}

/** ISO-Wochennummer nach Standard (Thursday-Rule). */
export function isoWeekNumber(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

/** "KW 25 2026" */
export function weekLabel(date: Date): string {
  const { week, year } = isoWeekNumber(date);
  return `KW ${week} ${year}`;
}

function weekLabelWithRange(start: Date): string {
  const { week, year } = isoWeekNumber(start);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  return `KW ${week} ${year} (${fmt(start)}–${fmt(end)})`;
}

/** Label der aktuellen Woche, z.B. "KW 27 2026 (29.06.–05.07.)" */
export function currentWeekLabel(today: Date): string {
  return weekLabelWithRange(weekStart(today));
}

/** Label der nächsten Woche, z.B. "KW 26 2026 (22.–28. Jun)" */
export function nextWeekLabel(today: Date): string {
  const next = firstOfNextWeek(today);
  return weekLabelWithRange(next);
}

/**
 * Liest aus "Wochenziel KW <num> <Year>: ..." den Stichtag (Mo dieser KW).
 * null wenn nicht parsebar.
 */
export function parseTargetWeek(noteText: string | null | undefined): Date | null {
  if (!noteText) return null;
  const m = noteText.match(/Wochenziel\s+KW\s+(\d{1,2})\s+(\d{4})/i);
  if (!m) return null;
  const week = parseInt(m[1], 10);
  const year = parseInt(m[2], 10);
  if (!Number.isFinite(week) || !Number.isFinite(year)) return null;
  // Mo der gegebenen ISO-Woche
  const jan4 = new Date(year, 0, 4);
  const jan4Iso = isoWeekday(jan4);
  const mondayOfWeek1 = new Date(year, 0, 4 - (jan4Iso - 1));
  const target = new Date(mondayOfWeek1);
  target.setDate(target.getDate() + (week - 1) * 7);
  return target;
}

export interface WeekProgress {
  goal: number;
  currentRevenue: number;
  daysInWeek: number;        // immer 7
  daysPassed: number;        // erfasste Tage seit Montag, inkl. Referenzdatum
  daysRemaining: number;     // verbleibende Tage nach dem letzten erfassten Tag (min 1)
  dailyTarget: number;
  expectedSoFar: number;
  requiredPerRemainingDay: number;
  progressPct: number;
  pacePct: number;
  deficit: number;
  status: GoalStatus;
}

/**
 * Fortschritt für die Woche, in der `today` liegt (bzw. die durch `today` angepeilte Woche).
 * `today` ist dabei der letzte tatsächlich erfasste Report-Tag. Wochenziel läuft Mo–Mo:
 * On Track heißt, dass der bisherige Tagesdurchschnitt mindestens Ziel/7 erreicht.
 */
export function computeWeekProgress(
  goal: number,
  currentRevenue: number,
  today: Date = new Date(),
): WeekProgress {
  const daysInWeek = 7;
  const refDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = weekStart(refDate);
  const elapsedDays = Math.floor((refDate.getTime() - start.getTime()) / 86400000) + 1;
  const daysPassed = Math.max(0, Math.min(daysInWeek, elapsedDays));
  const daysRemainingAfterTracked = Math.max(1, daysInWeek - daysPassed);

  const dailyTarget = goal / daysInWeek;
  const expectedSoFar = dailyTarget * daysPassed;
  const requiredPerRemainingDay = Math.max(0, (goal - currentRevenue) / daysRemainingAfterTracked);
  const progressPct = goal > 0 ? (currentRevenue / goal) * 100 : 0;
  const pacePct = expectedSoFar > 0 ? (currentRevenue / expectedSoFar) * 100 : (currentRevenue >= goal ? 100 : 0);
  const deficit = expectedSoFar - currentRevenue;

  let status: GoalStatus;
  if (pacePct >= 100) status = "on_track";
  else if (pacePct >= 80) status = "close";
  else status = "off_track";

  return {
    goal,
    currentRevenue,
    daysInWeek,
    daysPassed,
    daysRemaining: daysRemainingAfterTracked,
    dailyTarget,
    expectedSoFar,
    requiredPerRemainingDay,
    progressPct,
    pacePct,
    deficit,
    status,
  };
}

/**
 * Schlägt ein Wochenziel basierend auf Ø Tagesumsatz vor: avg × 7 × 1.10, gerundet auf 10 €.
 */
export function suggestWeeklyGoal(avgDailyRevenue: number): number {
  const raw = avgDailyRevenue * 7 * 1.10;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(10, Math.round(raw / 10) * 10);
}

/**
 * Ziel = Σ(Ø EUR/Tag pro Model im Roster) × 7 × stretch, auf 10 € gerundet.
 */
export function suggestWeeklyFromModels(
  roster: string[],
  baselines: Map<string, number>,
  stretch: number = 1.10,
): { goal: number; modelBaselineEurPerDay: number } {
  const baseline = roster.reduce(
    (acc, m) => acc + (baselines.get(m.toLowerCase()) ?? 0),
    0,
  );
  const raw = baseline * 7 * stretch;
  const goal = Number.isFinite(raw) && raw > 0 ? Math.max(10, Math.round(raw / 10) * 10) : 0;
  return { goal, modelBaselineEurPerDay: baseline };
}
