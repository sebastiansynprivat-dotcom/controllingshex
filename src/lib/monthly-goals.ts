/**
 * Monatsziel-Helpers: Zahlen aus Notizen extrahieren + Fortschritt berechnen.
 */

/**
 * Extrahiert eine Zielzahl (EUR) aus einem freien Notiztext.
 * Akzeptiert Tausender-Trenner (Punkt oder Leerzeichen) und Komma als Dezimalzeichen.
 * Beispiele:
 *   "2.000"     -> 2000
 *   "2,000"     -> 2000  (wird als Tausender interpretiert wenn Form passt)
 *   "1500 EUR"  -> 1500
 *   "Ziel 3.500,50€" -> 3500.5
 */
export function parseGoalFromNote(text: string | null | undefined): number | null {
  if (!text) return null;
  // Wenn ein ":" im Text ist, nur den Teil DANACH parsen — sonst pickt der
  // Regex Jahreszahlen wie "Mai 2026" aus dem Label-Prefix.
  const colonIdx = text.lastIndexOf(":");
  const haystack = colonIdx >= 0 ? text.slice(colonIdx + 1) : text;
  // Finde ersten Zahlenblock mit optionalen Tausender-Trennern und optionalem Dezimalteil
  const match = haystack.match(/-?\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  let raw = match[0];

  // Wenn Format "1.234" oder "1.234.567" -> Tausender; Punkte raus
  // Wenn Format "1234.5" (ein Punkt + 1-2 Nachkommastellen am Ende) -> Dezimal
  const hasComma = raw.includes(",");
  if (hasComma) {
    // Komma = Dezimal, Punkte/Leerzeichen = Tausender
    raw = raw.replace(/[.\s]/g, "").replace(",", ".");
  } else {
    // Kein Komma. Punkt-Heuristik: wenn jeder Punkt von genau 3 Ziffern gefolgt ist, Tausender.
    const dotParts = raw.split(".");
    if (dotParts.length > 1 && dotParts.slice(1).every((p) => /^\d{3}$/.test(p))) {
      raw = dotParts.join("");
    }
    raw = raw.replace(/\s/g, "");
  }
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export type GoalStatus = "on_track" | "close" | "off_track";

export interface GoalProgress {
  goal: number;
  currentRevenue: number;
  daysInMonth: number;
  daysPassed: number;       // inkl. heute
  daysRemaining: number;    // inkl. heute? -> nein, ab morgen. Min 1 für Division.
  dailyTarget: number;          // Ziel / Tage im Monat
  expectedSoFar: number;        // dailyTarget * daysPassed
  requiredPerRemainingDay: number; // (Ziel - aktuell) / verbleibendeTageInkl.Heute
  progressPct: number;          // currentRevenue / goal * 100
  pacePct: number;              // currentRevenue / expectedSoFar * 100
  deficit: number;              // expectedSoFar - currentRevenue (positiv = im Rückstand)
  status: GoalStatus;
}

export function computeGoalProgress(
  goal: number,
  currentRevenue: number,
  today: Date = new Date(),
): GoalProgress {
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Reports kommen mit 1 Tag Verzögerung: am 2. Mai liegt erst der Report vom 1. Mai vor.
  // Stichtag = gestern. Am 1. eines Monats gibt es noch keine erfassten Tage (daysPassed = 0).
  const daysPassed = Math.max(0, today.getDate() - 1);
  // Verbleibende Tage inkl. heute (heute generiert noch Umsatz, ist aber noch nicht erfasst).
  const daysRemainingIncToday = Math.max(1, daysInMonth - daysPassed);

  const dailyTarget = goal / daysInMonth;
  const expectedSoFar = dailyTarget * daysPassed;
  const requiredPerRemainingDay = Math.max(0, (goal - currentRevenue) / daysRemainingIncToday);
  const progressPct = goal > 0 ? (currentRevenue / goal) * 100 : 0;
  const pacePct = expectedSoFar > 0 ? (currentRevenue / expectedSoFar) * 100 : 100;
  const deficit = expectedSoFar - currentRevenue;

  let status: GoalStatus;
  if (pacePct >= 95) status = "on_track";
  else if (pacePct >= 80) status = "close";
  else status = "off_track";

  return {
    goal,
    currentRevenue,
    daysInMonth,
    daysPassed,
    daysRemaining: daysRemainingIncToday,
    dailyTarget,
    expectedSoFar,
    requiredPerRemainingDay,
    progressPct,
    pacePct,
    deficit,
    status,
  };
}

export function formatEUR(n: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  }).format(n);
}

/**
 * Schlägt ein Monatsziel basierend auf dem Ø Tagesumsatz der letzten 30 Tage vor.
 * Formel: avgDaily * Tage im aktuellen Monat * 1.10, gerundet auf 50 €.
 */
export function suggestMonthlyGoal(avgDailyRevenue: number, today: Date = new Date()): number {
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const raw = avgDailyRevenue * daysInMonth * 1.10;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(50, Math.round(raw / 50) * 50);
}

/**
 * Splittet einen Account-String aus chatter_history in einzelne Model-Slugs.
 * Akzeptiert Komma oder Semikolon als Trenner. Lowercase + trim. Leere Tokens raus.
 */
export function splitAccounts(account: string | null | undefined): string[] {
  if (!account) return [];
  return account
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * Berechnet pro Model den Ø EUR/Tag über die übergebenen History-Rows (letzte 60 Tage).
 * Mehrere Models in einer Row teilen den Umsatz gleichmäßig (Anteilig).
 * 0-€-Tage zählen mit (drücken den Schnitt – realistisch).
 * Key = lowercase model slug.
 */
export function computeModelBaselines(
  rows: Array<{ account: string | null; revenue_today: number | null; analysis_date: string }>,
): Map<string, number> {
  const sumByModel = new Map<string, number>();
  const daysByModel = new Map<string, Set<string>>();
  for (const r of rows) {
    const models = splitAccounts(r.account);
    if (models.length === 0) continue;
    const rev = Number(r.revenue_today ?? 0);
    const share = rev / models.length;
    for (const m of models) {
      sumByModel.set(m, (sumByModel.get(m) ?? 0) + share);
      if (!daysByModel.has(m)) daysByModel.set(m, new Set());
      daysByModel.get(m)!.add(r.analysis_date);
    }
  }
  const result = new Map<string, number>();
  for (const [m, sum] of sumByModel) {
    const days = daysByModel.get(m)?.size ?? 0;
    if (days > 0) result.set(m, sum / days);
  }
  return result;
}

/**
 * Ziel = Σ(Ø EUR/Tag pro Model im Roster) × Tage im Monat × stretch, auf 50 € gerundet.
 * Models ohne Baseline werden mit 0 gewichtet.
 */
export function suggestFromModels(
  roster: string[],
  baselines: Map<string, number>,
  today: Date = new Date(),
  stretch: number = 1.10,
): { goal: number; modelBaselineEurPerDay: number } {
  const baseline = roster.reduce(
    (acc, m) => acc + (baselines.get(m.toLowerCase()) ?? 0),
    0,
  );
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const raw = baseline * daysInMonth * stretch;
  const goal = Number.isFinite(raw) && raw > 0 ? Math.max(50, Math.round(raw / 50) * 50) : 0;
  return { goal, modelBaselineEurPerDay: baseline };
}

