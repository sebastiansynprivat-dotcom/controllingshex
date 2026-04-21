/**
 * Absence-Pattern Engine
 *
 * Lernt das individuelle Anwesenheitsmuster jedes Chatters über die volle History
 * und prognostiziert, wann der nächste "Aussetzer" wahrscheinlich ist.
 *
 * Idee: Wir suchen nicht nach festen Schwellen, sondern nach *Regelmäßigkeit*.
 * Beispiel: Ein Chatter ist immer 3 Tage da, dann 1 Tag weg. Sobald sein
 * aktueller "Da-Streak" sich seinem typischen Maximum nähert, kommt eine Warnung
 * BEVOR er offline geht — damit man rechtzeitig eingreifen kann.
 *
 * Datenbasis: chatter_history.revenue_today (0 = Aussetzer, >0 = anwesend)
 */

export interface AbsencePoint {
  date: string;          // YYYY-MM-DD
  present: boolean;      // revenue > 0
}

export interface AbsenceForecastInput {
  chatter: string;
  account: string | null;
  /** sortiert ASC nach Datum (volle History, idealerweise 30 Tage) */
  history: AbsencePoint[];
}

export interface AbsencePattern {
  /** Anteil Tage mit Anwesenheit (0..1) */
  presenceRate: number;
  /** durchschnittliche Länge eines Anwesenheits-Streaks */
  avgPresentStreak: number;
  /** maximaler Anwesenheits-Streak in der History */
  maxPresentStreak: number;
  /** durchschnittliche Länge einer Abwesenheits-Lücke */
  avgGap: number;
  /** maximale Lücke in der History */
  maxGap: number;
  /** Anzahl Lücken in der History */
  gapCount: number;
  /** Standardabweichung der Streak-Längen — niedrig = sehr regelmäßig */
  streakStability: number;
  /** menschenlesbares Pattern-Label, z.B. "3 Tage da, 1 Tag weg" */
  patternLabel: string;
  /** wieviele Tage History wir haben */
  historyDays: number;
}

export interface AbsenceForecast {
  chatter: string;
  account: string | null;
  pattern: AbsencePattern;
  /** aktueller Anwesenheits-Streak in Tagen (0 wenn heute schon Aussetzer) */
  currentStreakDays: number;
  /** Wahrscheinlichkeit für Aussetzer in den nächsten 1–2 Tagen (0..1) */
  nextDropProbability: number;
  /** Risk-Band */
  band: "stable" | "watch" | "warning" | "critical";
  /** Hauptaussage in einem Satz */
  message: string;
  /** wann der letzte Aussetzer war (Tage zurück, null = nie) */
  daysSinceLastGap: number | null;
  /** geschätzter Offline-Tag (ISO date, null wenn keine klare Prognose) */
  predictedDropDate: string | null;
}

/* ------------------------------------------------------------------ */
/*  STATISTIK                                                          */
/* ------------------------------------------------------------------ */

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = average(values);
  const variance = average(values.map(v => (v - avg) ** 2));
  return Math.sqrt(variance);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

/* ------------------------------------------------------------------ */
/*  PATTERN-EXTRAKTION                                                 */
/* ------------------------------------------------------------------ */

/**
 * Zerlegt die History in alternierende Blöcke aus Anwesenheits-Streaks und Lücken.
 * Returns: [{type: "present"|"gap", length: number}, ...]
 */
function extractRuns(history: AbsencePoint[]): { type: "present" | "gap"; length: number }[] {
  const runs: { type: "present" | "gap"; length: number }[] = [];
  if (history.length === 0) return runs;

  let currentType: "present" | "gap" = history[0].present ? "present" : "gap";
  let length = 1;

  for (let i = 1; i < history.length; i++) {
    const t: "present" | "gap" = history[i].present ? "present" : "gap";
    if (t === currentType) {
      length++;
    } else {
      runs.push({ type: currentType, length });
      currentType = t;
      length = 1;
    }
  }
  runs.push({ type: currentType, length });
  return runs;
}

function buildPatternLabel(avgPresent: number, avgGap: number, gapCount: number): string {
  if (gapCount === 0) return "durchgehend anwesend";
  const p = Math.max(1, Math.round(avgPresent));
  const g = Math.max(1, Math.round(avgGap));
  return `~${p} Tag${p > 1 ? "e" : ""} da, ${g} Tag${g > 1 ? "e" : ""} weg`;
}

export function analyzePattern(history: AbsencePoint[]): AbsencePattern {
  const runs = extractRuns(history);
  const presentRuns = runs.filter(r => r.type === "present").map(r => r.length);
  const gapRuns = runs.filter(r => r.type === "gap").map(r => r.length);

  const presenceRate = history.length > 0
    ? history.filter(h => h.present).length / history.length
    : 0;

  const avgPresentStreak = presentRuns.length > 0 ? average(presentRuns) : 0;
  const maxPresentStreak = presentRuns.length > 0 ? Math.max(...presentRuns) : 0;
  const avgGap = gapRuns.length > 0 ? average(gapRuns) : 0;
  const maxGap = gapRuns.length > 0 ? Math.max(...gapRuns) : 0;
  const streakStability = stdDev(presentRuns);

  return {
    presenceRate,
    avgPresentStreak,
    maxPresentStreak,
    avgGap,
    maxGap,
    gapCount: gapRuns.length,
    streakStability,
    patternLabel: buildPatternLabel(avgPresentStreak, avgGap, gapRuns.length),
    historyDays: history.length,
  };
}

/* ------------------------------------------------------------------ */
/*  FORECAST                                                           */
/* ------------------------------------------------------------------ */

function computeCurrentStreak(history: AbsencePoint[]): number {
  // zähle vom Ende rückwärts: wieviele Tage in Folge "present"?
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].present) streak++;
    else break;
  }
  return streak;
}

function computeDaysSinceLastGap(history: AbsencePoint[]): number | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (!history[i].present) {
      return history.length - 1 - i;
    }
  }
  return null;
}

/**
 * Wahrscheinlichkeit, dass in den nächsten 1-2 Tagen ein Aussetzer kommt.
 *
 * Heuristik:
 *  - aktueller Streak / typischer Streak >= 1.0 → hoch
 *  - aktueller Streak / typischer Streak >= 0.8 → mittel
 *  - sonst niedrig
 *
 *  Dazu: Stabilität (niedrige stdDev) macht die Prognose verlässlicher.
 */
function computeDropProbability(
  currentStreak: number,
  pattern: AbsencePattern,
): number {
  // Wenn keine Lücken in der History → kein Pattern, niedriges Risiko
  if (pattern.gapCount === 0) return 0;
  // Wenn aktuell schon Aussetzer (streak === 0) → 0 (wir prognostizieren BEVOR es passiert)
  if (currentStreak === 0) return 0;

  const avg = Math.max(1, pattern.avgPresentStreak);
  const max = Math.max(1, pattern.maxPresentStreak);

  // Ratio relativ zum typischen Maximum
  const ratioToMax = currentStreak / max;
  const ratioToAvg = currentStreak / avg;

  // Basis-Wahrscheinlichkeit aus dem Verhältnis
  let prob = 0;
  if (ratioToMax >= 1.0) prob = 0.85;
  else if (ratioToMax >= 0.85) prob = 0.65;
  else if (ratioToAvg >= 1.0) prob = 0.45;
  else if (ratioToAvg >= 0.7) prob = 0.25;
  else prob = 0.1;

  // Stabilitäts-Bonus: niedrige stdDev → verlässlicheres Pattern → Prognose schärfer
  const stabilityFactor = pattern.streakStability < 1 ? 1.15
    : pattern.streakStability < 2 ? 1.0
    : 0.85;
  prob *= stabilityFactor;

  // Häufigkeits-Bonus: viele Lücken → klares Muster
  if (pattern.gapCount >= 4) prob *= 1.1;
  else if (pattern.gapCount === 1) prob *= 0.7;

  return Math.max(0, Math.min(1, prob));
}

function bandFor(prob: number): AbsenceForecast["band"] {
  if (prob >= 0.7) return "critical";
  if (prob >= 0.45) return "warning";
  if (prob >= 0.2) return "watch";
  return "stable";
}

function buildMessage(input: {
  currentStreak: number;
  pattern: AbsencePattern;
  prob: number;
}): string {
  const { currentStreak, pattern, prob } = input;
  if (pattern.gapCount === 0) {
    return `Durchgehend anwesend (${pattern.historyDays}d), kein Risiko-Muster erkennbar.`;
  }
  if (currentStreak === 0) {
    return `Aktuell offline. Pattern: ${pattern.patternLabel}.`;
  }
  if (prob >= 0.7) {
    return `Aktuell ${currentStreak} Tage in Folge da — Pattern erwartet jetzt einen Aussetzer.`;
  }
  if (prob >= 0.45) {
    return `${currentStreak}. Tag in Folge — typisch sind ${Math.round(pattern.avgPresentStreak)}, max ${pattern.maxPresentStreak}. Aussetzer wahrscheinlich.`;
  }
  if (prob >= 0.2) {
    return `${currentStreak} Tage da, Pattern stabil. Beobachten.`;
  }
  return `${currentStreak} Tage anwesend, kein akutes Pattern-Signal.`;
}

export function forecastAbsence(input: AbsenceForecastInput): AbsenceForecast {
  const { chatter, account, history } = input;
  const pattern = analyzePattern(history);
  const currentStreak = computeCurrentStreak(history);
  const daysSinceLastGap = computeDaysSinceLastGap(history);
  const prob = computeDropProbability(currentStreak, pattern);

  // Predicted drop date: wenn Streak ≥ avg, dann tippe avgPresentStreak - currentStreak Tage
  let predictedDropDate: string | null = null;
  if (pattern.gapCount > 0 && currentStreak > 0 && history.length > 0) {
    const lastDate = history[history.length - 1].date;
    const expectedRemaining = Math.max(0, Math.round(pattern.avgPresentStreak) - currentStreak);
    if (expectedRemaining <= 2) {
      predictedDropDate = addDays(lastDate, expectedRemaining + 1);
    }
  }

  return {
    chatter,
    account,
    pattern,
    currentStreakDays: currentStreak,
    nextDropProbability: prob,
    band: bandFor(prob),
    message: buildMessage({ currentStreak, pattern, prob }),
    daysSinceLastGap,
    predictedDropDate,
  };
}

export function forecastAbsenceMany(inputs: AbsenceForecastInput[]): AbsenceForecast[] {
  return inputs
    .map(forecastAbsence)
    .sort((a, b) => b.nextDropProbability - a.nextDropProbability);
}

/* ------------------------------------------------------------------ */
/*  BACKTESTING                                                        */
/* ------------------------------------------------------------------ */

export interface AbsenceBacktestResult {
  totalPredictions: number;
  hits: number;
  hitRate: number;
  details: {
    chatter: string;
    pivotDate: string;
    predictedProb: number;
    actualGapWithin2Days: boolean;
    currentStreak: number;
  }[];
}

/**
 * Backtest: für jeden Pivot-Tag T
 *  - berechne Pattern + Forecast mit Daten bis T
 *  - check ob in T+1..T+2 wirklich ein Aussetzer kam
 *  - Hit, wenn prob >= 0.45 UND tatsächlich Aussetzer
 */
export function backtestAbsence(
  fullHistoryByChatter: Map<string, AbsencePoint[]>,
  threshold: number = 0.45,
): AbsenceBacktestResult {
  const details: AbsenceBacktestResult["details"] = [];
  let hits = 0;
  let total = 0;

  for (const [chatter, full] of fullHistoryByChatter) {
    if (full.length < 12) continue; // brauchen genug History für Pattern + Test

    for (let pivot = 10; pivot < full.length - 2; pivot++) {
      const train = full.slice(0, pivot + 1);
      const testWindow = full.slice(pivot + 1, pivot + 3); // nächste 2 Tage
      if (testWindow.length < 1) continue;

      const fc = forecastAbsence({ chatter, account: null, history: train });
      if (fc.nextDropProbability < threshold) continue;

      const actualGap = testWindow.some(p => !p.present);
      total++;
      if (actualGap) hits++;
      details.push({
        chatter,
        pivotDate: full[pivot].date,
        predictedProb: fc.nextDropProbability,
        actualGapWithin2Days: actualGap,
        currentStreak: fc.currentStreakDays,
      });
    }
  }

  return {
    totalPredictions: total,
    hits,
    hitRate: total > 0 ? hits / total : 0,
    details: details.sort((a, b) => b.predictedProb - a.predictedProb),
  };
}
