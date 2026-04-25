/**
 * Bewertungs-Engine v2
 *
 * Liefert pro Chatter eine `CategoryDecision` mit:
 *  - finaler Action-Kategorie
 *  - Liste menschenlesbarer Reasons
 *  - Roh-Signalen (für UI / Debug)
 *  - Confidence (low/medium/high)
 *
 * Verbesserungen gegenüber v1:
 *  - Punkt 3: BELOHNEN auch bei persönlichem Aufwärtstrend / Konstanz, nicht nur Top-20%
 *  - Punkt 4: Soft-Onboarding bis Tag 14 (mildere Schwellen)
 *  - Punkt 6: lastDelay statt maxDelay (kein „klebriger" alter Verzug)
 *  - Punkt 7: Aggregation per chatter_name (Account-Wechsel zerstören Kontinuität nicht)
 *  - Punkt 8: Reasons + Signals → Erklärbarkeit
 *  - Punkt 9: Peer-Benchmark-Schutz/Push (siehe `peer-benchmarks.ts`)
 */
import type { ActionCategoryName } from "@/lib/action-categories";
import type { HistoryRow } from "@/lib/timerange-categorize";
import type { BenchmarkBundle, ChatterBenchmark } from "@/lib/peer-benchmarks";
import { getChatterBenchmark } from "@/lib/peer-benchmarks";

export interface CategorySignals {
  /** Anzahl History-Tage im Fenster */
  count: number;
  /** Ø Tagesumsatz */
  avgRev: number;
  /** Median Tagesumsatz */
  medianRev: number;
  /** Anteil 0€-Tage (0..1) */
  zeroRate: number;
  /** Antwortverzug am jüngsten Tag im Fenster */
  lastDelay: number;
  /** Maximaler Verzug im Fenster (nur als Kontext) */
  maxDelay: number;
  /**
   * Trend: 7d-Median vs 30d-Median (oder volle Fensterlänge wenn kürzer).
   * Wert: relative Veränderung (-1..+inf). +0.10 = 7d liegt 10% über 30d.
   */
  trend7v30: number;
  /** Aktueller „über persönlichem Median"-Streak (Tage in Folge am Ende des Fensters) */
  consistencyStreak: number;
  /** Im Fenster verschiedenen Accounts zugeordnete Anzahl */
  accountChanges: number;
  /** Liste verschiedener Accounts im Fenster (für Tooltip) */
  accounts: string[];
  /** Peer-Benchmark % vom Cluster-Median (heute) — null wenn nicht verfügbar */
  peerPctOfMedian: number | null;
  /** Onboarding-Tag (1..5 = harte Onboarding-Phase, 6..14 = Grace-Phase, sonst null) */
  onboardingDay: number | null;
}

export interface CategoryDecision {
  name: ActionCategoryName;
  reasons: string[];
  signals: CategorySignals;
  confidence: "low" | "medium" | "high";
}

export interface CategorizeOptions {
  /** Onboarding-Startdaten (normalized chatter name → ISO date YYYY-MM-DD) */
  onboardingStarts?: Map<string, string>;
  /** Heutiger Account je Chatter (für Peer-Benchmark-Lookup) */
  todaysAccountByChatter?: Map<string, string>;
  /** Heutige Follower je Chatter (für Peer-Benchmark-Lookup) */
  todaysFollowersByChatter?: Map<string, number>;
  /** Heutiger Tagesumsatz je Chatter */
  todaysRevenueByChatter?: Map<string, number>;
  /** Peer-Benchmark Bundle. Optional. */
  benchmarks?: BenchmarkBundle | null;
}

/* -------------------------- helpers -------------------------- */

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${Math.round(n * 100)}%`;
}
function fmtEur(n: number): string {
  return `${Math.round(n)}€`;
}

/** Aggregiert History-Rows eines Chatters zu Signalen. */
function buildSignals(rows: HistoryRow[]): CategorySignals {
  const sorted = [...rows].sort((a, b) => a.analysis_date.localeCompare(b.analysis_date));
  const revs = sorted.map((r) => r.revenue_today);
  const avgRev = revs.length ? revs.reduce((a, b) => a + b, 0) / revs.length : 0;
  const medianRev = median(revs);
  const zeroDays = revs.filter((r) => r === 0).length;
  const zeroRate = revs.length ? zeroDays / revs.length : 1;
  const lastDelay = sorted.length ? (sorted[sorted.length - 1].response_delay_days || 0) : 0;
  const maxDelay = sorted.reduce((m, r) => Math.max(m, r.response_delay_days || 0), 0);

  // Trend: Vergleiche letzte 7 Tage vs gesamtes Fenster
  let trend7v30 = 0;
  if (sorted.length >= 4) {
    const recent = sorted.slice(-7).map((r) => r.revenue_today);
    const baseline = sorted.length > 7 ? sorted.slice(0, -7).map((r) => r.revenue_today) : sorted.map((r) => r.revenue_today);
    const recentMed = median(recent);
    const baselineMed = median(baseline);
    if (baselineMed > 0) trend7v30 = (recentMed - baselineMed) / baselineMed;
  }

  // Konstanz-Streak: Tage in Folge am Ende ≥ persönlichem Median (und > 0)
  let consistencyStreak = 0;
  if (medianRev > 0) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].revenue_today >= medianRev) consistencyStreak++;
      else break;
    }
  }

  // Account-Wechsel
  const accs = new Set<string>();
  for (const r of sorted) {
    const a = ((r as any).account || "").toString().trim().toLowerCase();
    if (a) accs.add(a);
  }
  const accountList = Array.from(accs);

  return {
    count: sorted.length,
    avgRev,
    medianRev,
    zeroRate,
    lastDelay,
    maxDelay,
    trend7v30,
    consistencyStreak,
    accountChanges: Math.max(0, accountList.length - 1),
    accounts: accountList,
    peerPctOfMedian: null,
    onboardingDay: null,
  };
}

/** Top-20% Cutoff über alle Chatter mit Daten. */
function computeTop20Cutoff(allSignals: CategorySignals[]): number {
  const active = allSignals.filter((s) => s.count > 0 && s.avgRev > 0).map((s) => s.avgRev);
  if (active.length < 5) return Infinity;
  active.sort((a, b) => b - a);
  return active[Math.floor(active.length * 0.2) - 1] ?? active[0];
}

function confidenceFor(count: number): "low" | "medium" | "high" {
  if (count >= 14) return "high";
  if (count >= 5) return "medium";
  return "low";
}

/* -------------------------- main API -------------------------- */

export function categorizeChatters(
  chatterNames: string[],
  history: HistoryRow[],
  options: CategorizeOptions = {}
): Map<string, CategoryDecision> {
  const result = new Map<string, CategoryDecision>();

  // History gruppieren per chatter_name (Punkt 7: Account-Wechsel ignorieren)
  const byChatter = new Map<string, HistoryRow[]>();
  for (const h of history) {
    const key = normalizeName(h.chatter_name);
    if (!byChatter.has(key)) byChatter.set(key, []);
    byChatter.get(key)!.push(h);
  }

  // Signale bauen
  const allSignals = new Map<string, CategorySignals>();
  for (const name of chatterNames) {
    const key = normalizeName(name);
    allSignals.set(key, buildSignals(byChatter.get(key) || []));
  }

  // Onboarding-Tag berechnen
  const today = new Date();
  for (const name of chatterNames) {
    const key = normalizeName(name);
    const sig = allSignals.get(key)!;
    const startIso = options.onboardingStarts?.get(key);
    if (startIso) {
      const start = new Date(startIso + "T00:00:00Z").getTime();
      const days = Math.floor((today.getTime() - start) / 86400000);
      if (days >= 0 && days <= 14) sig.onboardingDay = days + 1; // Tag 1..15
    }
  }

  // Peer-Benchmark anhängen
  if (options.benchmarks) {
    for (const name of chatterNames) {
      const key = normalizeName(name);
      const sig = allSignals.get(key)!;
      const acc = options.todaysAccountByChatter?.get(key) || "";
      const fol = options.todaysFollowersByChatter?.get(key) || 0;
      const rev = options.todaysRevenueByChatter?.get(key) ?? sig.avgRev;
      if (acc && fol > 0) {
        const bm: ChatterBenchmark = getChatterBenchmark(options.benchmarks, acc, fol, rev);
        if (bm.pctOfPeerMedian !== null && bm.confidence !== "low") {
          sig.peerPctOfMedian = bm.pctOfPeerMedian;
        }
      }
    }
  }

  // Top-20% Cutoff (über alle Signale)
  const top20Cutoff = computeTop20Cutoff(Array.from(allSignals.values()));

  // Entscheidung pro Chatter
  for (const name of chatterNames) {
    const key = normalizeName(name);
    const sig = allSignals.get(key)!;
    result.set(key, decide(sig, top20Cutoff));
  }

  return result;
}

function decide(s: CategorySignals, top20Cutoff: number): CategoryDecision {
  const reasons: string[] = [];
  const conf = confidenceFor(s.count);

  // Keine Daten im Fenster
  if (s.count === 0) {
    reasons.push("Keine Daten im gewählten Zeitraum");
    return { name: "BEOBACHTEN", reasons, signals: s, confidence: "low" };
  }

  // Punkt 4: Onboarding-Phasen
  // Tag 1..5 = harte Onboarding-Kategorie (überspringt alles)
  if (s.onboardingDay !== null && s.onboardingDay >= 1 && s.onboardingDay <= 5) {
    reasons.push(`Onboarding Tag ${s.onboardingDay} — Schonfrist`);
    return {
      name: `ONBOARDING TAG ${s.onboardingDay}` as ActionCategoryName,
      reasons,
      signals: s,
      confidence: conf,
    };
  }

  // Tag 6..14 = Grace-Phase: mildere Schwellen
  const grace = s.onboardingDay !== null && s.onboardingDay >= 6 && s.onboardingDay <= 15;
  const T = grace
    ? { sofortZero: 0.9, coachZero: 0.7, coachTrend: -0.5, sofortDelay: 5 }
    : { sofortZero: 0.8, coachZero: 0.5, coachTrend: -0.3, sofortDelay: 3 };

  if (grace) reasons.push(`Onboarding-Grace (Tag ${s.onboardingDay}) — mildere Schwellen`);

  // Punkt 9: Peer-Schutz — wer im Cluster ≥90% Median schafft, geht NICHT in COACHING/SOFORT
  const peerProtected = s.peerPctOfMedian !== null && s.peerPctOfMedian >= 90;

  // 1. SOFORT EINGREIFEN
  // - Sehr hohe 0€-Quote ODER aktueller Verzug > Schwelle
  if (!peerProtected) {
    if (s.zeroRate >= T.sofortZero) {
      reasons.push(`${Math.round(s.zeroRate * 100)}% der Tage 0€ (Schwelle ${Math.round(T.sofortZero * 100)}%)`);
      return { name: "SOFORT EINGREIFEN", reasons, signals: s, confidence: conf };
    }
    if (s.lastDelay > T.sofortDelay) {
      reasons.push(`Aktueller Antwortverzug ${s.lastDelay} Tage`);
      if (s.maxDelay > s.lastDelay) reasons.push(`Max-Verzug im Fenster: ${s.maxDelay} Tage`);
      return { name: "SOFORT EINGREIFEN", reasons, signals: s, confidence: conf };
    }
  }

  // 2. COACHING NÖTIG
  if (!peerProtected) {
    if (s.zeroRate >= T.coachZero) {
      reasons.push(`${Math.round(s.zeroRate * 100)}% der Tage 0€`);
      maybePeerHint(reasons, s);
      return { name: "COACHING NÖTIG", reasons, signals: s, confidence: conf };
    }
    if (s.trend7v30 <= T.coachTrend && s.avgRev > 0) {
      reasons.push(`Trend: 7-Tage-Median ${fmtPct(s.trend7v30)} ggü. Baseline`);
      maybePeerHint(reasons, s);
      return { name: "COACHING NÖTIG", reasons, signals: s, confidence: conf };
    }
    // Punkt 9: Auch unter 50% Peer-Median + aktiv → Coaching
    if (s.peerPctOfMedian !== null && s.peerPctOfMedian < 50 && s.avgRev > 0) {
      reasons.push(`Nur ${s.peerPctOfMedian}% des Cluster-Medians`);
      return { name: "COACHING NÖTIG", reasons, signals: s, confidence: conf };
    }
  } else {
    // Peer-Schutz aktiv — als Reason vermerken
    reasons.push(`Im Cluster-Schnitt (${s.peerPctOfMedian}% vom Median) — kein Coaching nötig`);
  }

  // 3. PUSHEN — Onboarding (Tag 6..14) ODER starker positiver Trend
  if (grace) {
    reasons.push("Frische Onboarding-Grace — aktiv pushen");
    return { name: "PUSHEN", reasons, signals: s, confidence: conf };
  }
  if (s.trend7v30 >= 0.3) {
    reasons.push(`Starker Aufwärtstrend ${fmtPct(s.trend7v30)}`);
    return { name: "PUSHEN", reasons, signals: s, confidence: conf };
  }

  // 4. BELOHNEN — Punkt 3: drei Wege
  // a) 7d-Median ≥ 30d-Median × 1.10
  if (s.trend7v30 >= 0.10 && s.medianRev > 0) {
    reasons.push(`7-Tage-Median ${fmtPct(s.trend7v30)} über Baseline (Median ${fmtEur(s.medianRev)})`);
    return { name: "BELOHNEN", reasons, signals: s, confidence: conf };
  }
  // b) ≥5 Tage in Folge ≥ persönlicher Median
  if (s.consistencyStreak >= 5) {
    reasons.push(`${s.consistencyStreak} Tage in Folge ≥ persönlicher Median (${fmtEur(s.medianRev)})`);
    return { name: "BELOHNEN", reasons, signals: s, confidence: conf };
  }
  // c) Top-20% Umsatz im Fenster
  if (s.avgRev >= top20Cutoff && s.avgRev > 0) {
    reasons.push(`Top-20% Umsatz im Zeitraum (Ø ${fmtEur(s.avgRev)}/Tag)`);
    return { name: "BELOHNEN", reasons, signals: s, confidence: conf };
  }

  // 5. BEOBACHTEN
  reasons.push(`Stabil — Ø ${fmtEur(s.avgRev)}/Tag, ${Math.round(s.zeroRate * 100)}% 0€-Tage`);
  if (s.peerPctOfMedian !== null) reasons.push(`${s.peerPctOfMedian}% vom Cluster-Median`);
  if (s.accountChanges > 0) reasons.push(`${s.accountChanges + 1} verschiedene Accounts im Zeitraum`);
  return { name: "BEOBACHTEN", reasons, signals: s, confidence: conf };
}

function maybePeerHint(reasons: string[], s: CategorySignals): void {
  if (s.peerPctOfMedian !== null) {
    reasons.push(`${s.peerPctOfMedian}% vom Cluster-Median`);
  }
}
