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
  // Finde ersten Zahlenblock mit optionalen Tausender-Trennern und optionalem Dezimalteil
  const match = text.match(/-?\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/);
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
  const daysPassed = today.getDate(); // 1..daysInMonth
  const daysRemainingIncToday = Math.max(1, daysInMonth - daysPassed + 1);

  const dailyTarget = goal / daysInMonth;
  const expectedSoFar = dailyTarget * daysPassed;
  const requiredPerRemainingDay = Math.max(0, (goal - currentRevenue) / daysRemainingIncToday);
  const progressPct = goal > 0 ? (currentRevenue / goal) * 100 : 0;
  const pacePct = expectedSoFar > 0 ? (currentRevenue / expectedSoFar) * 100 : 0;
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
