/**
 * Zentrale Berechnung von Auffälligkeiten ("Anomalies") über einen Zeitraum.
 *
 * Verwendet `chatter_history` als Wahrheit, aggregiert je Chatter im Fenster
 * und berechnet Signale relativ zur Peer-Gruppe und zur eigenen Baseline
 * (Daten VOR dem Fenster, bis zu 30 Tage).
 *
 * Zentrale Werte (Memory):
 *  - Erfolgsmetrik: Umsatz vs. Peer-Schnitt (nicht absolut)
 *  - MassDM-Hebel: Ziel = 6/Tag, dynamisch verschärft wenn Umsatz fehlt
 *  - Krisen-Trigger: Peer / eigener Schnitt / Persistenz
 */
import { supabase } from "@/integrations/supabase/client";
import type { TimeRange } from "@/lib/timerange-categorize";
import { rangeDays } from "@/lib/timerange-categorize";
import { loadActiveChatterNames } from "@/lib/active-chatters";

export type AnomalySeverity = "critical" | "high" | "medium" | "info" | "positive";
export type AnomalyType =
  | "peer_underperform"   // Liegt deutlich unter Peer-Schnitt
  | "self_revenue_drop"   // Eigener Schnitt eingebrochen
  | "persistent_zero"     // Mehrere Tage in Folge unter Ziel
  | "massdm_low"          // < 4/Tag UND Umsatz schwach
  | "massdm_zero_no_rev"  // Keine MassDMs UND kein Umsatz im Zeitraum
  | "high_effort_no_rev"  // Positiv: hohe MassDM-Performance trotz fehlendem Umsatz
  | "peer_overperform"    // Positiv: deutlich über Follower-Erwartung
  | "self_revenue_spike"  // Positiv: eigener Schnitt deutlich übertroffen
  | "comeback"            // Positiv: vorher schwach, jetzt stark
  | "hidden_gem";         // Positiv: kleiner Account + konstant + über Erwartung

/** Liefert true für „positive" Auffälligkeiten (Highlights-Tab). */
export function isPositiveAnomaly(type: AnomalyType): boolean {
  return (
    type === "high_effort_no_rev" ||
    type === "peer_overperform" ||
    type === "self_revenue_spike" ||
    type === "comeback" ||
    type === "hidden_gem"
  );
}

export interface ChatterAnomaly {
  chatter_name: string;
  alert_type: AnomalyType;
  severity: AnomalySeverity;
  message: string;
  metric_value: number;
  baseline_value: number;
  delta_pct: number;
  /** Sortier-Score: höher = wichtiger */
  score: number;
}

interface HistoryRow {
  chatter_name: string;
  analysis_date: string;
  revenue_today: number | null;
  mass_dms: number | null;
  response_delay_days: number | null;
  account: string | null;
}

interface ChatterAggregate {
  name: string;
  rows: HistoryRow[];
  daysActive: number;       // Tage mit Eintrag im Fenster
  totalRevenue: number;
  avgRevenuePerDay: number;
  totalMassDms: number;
  avgMassDmsPerDay: number;
  consecutiveZeroDays: number; // längste 0€-Strecke am Ende des Fensters
  zeroDaysInWindow: number;
  /** Summe der Follower aller jüngsten Accounts dieses Chatters */
  totalFollowers: number;
  accounts: string[];
}

const PAGE = 1000;

function normalize(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
}

async function loadWindow(
  userId: string,
  platform: string,
  range: TimeRange,
): Promise<HistoryRow[]> {
  const all: HistoryRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("chatter_history")
      .select("chatter_name, analysis_date, revenue_today, mass_dms, response_delay_days, account")
      .eq("user_id", userId)
      .eq("platform", platform)
      .gte("analysis_date", range.from)
      .lte("analysis_date", range.to)
      .order("analysis_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...(data as HistoryRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function loadBaseline(
  userId: string,
  platform: string,
  beforeIso: string,
  daysBack = 30,
): Promise<HistoryRow[]> {
  const fromDate = new Date(beforeIso + "T00:00:00Z");
  fromDate.setUTCDate(fromDate.getUTCDate() - daysBack);
  const fromIso = fromDate.toISOString().split("T")[0];

  // Bis EINEN Tag vor Fensterstart
  const beforeDate = new Date(beforeIso + "T00:00:00Z");
  beforeDate.setUTCDate(beforeDate.getUTCDate() - 1);
  const toIso = beforeDate.toISOString().split("T")[0];
  if (toIso < fromIso) return [];

  const all: HistoryRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("chatter_history")
      .select("chatter_name, analysis_date, revenue_today, mass_dms, response_delay_days, account")
      .eq("user_id", userId)
      .eq("platform", platform)
      .gte("analysis_date", fromIso)
      .lte("analysis_date", toIso)
      .order("analysis_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...(data as HistoryRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

/**
 * Lädt die KOMPLETTE chatter_history des Workspaces (für die Lernkurve).
 * Genutzt um „erwartetes €/Tag bei N Followern" zu lernen.
 */
async function loadFullHistory(userId: string, platform: string): Promise<HistoryRow[]> {
  const all: HistoryRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("chatter_history")
      .select("chatter_name, analysis_date, revenue_today, mass_dms, response_delay_days, account")
      .eq("user_id", userId)
      .eq("platform", platform)
      .order("analysis_date", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...(data as HistoryRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
    if (offset > 20000) break; // safety cap
  }
  return all;
}

/** Lädt alle Models (Follower-Zahlen) für Workspace */
async function loadModels(userId: string, platform: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { data } = await supabase
    .from("models")
    .select("model_name, follower_count")
    .eq("user_id", userId)
    .eq("platform", platform);
  for (const m of data ?? []) {
    map.set(String(m.model_name).toLowerCase().trim(), Number(m.follower_count ?? 0));
  }
  return map;
}

function parseAccounts(account: string | null): string[] {
  if (!account) return [];
  return account
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Lernkurve: erwartetes €/Tag in Abhängigkeit der Follower-Summe.
 *
 * Methode: Sammle pro (Chatter, Tag) den Tagesumsatz und die Follower-Summe seiner
 * Accounts an dem Tag. Bilde dann via gleitendem Bucket (log-spaced) den **Median**
 * — Median ist robuster gegen 0€-Tage und Ausreißer als Mittelwert.
 */
export interface PeerCurve {
  /** Liefert erwartetes €/Tag für eine Follower-Summe. 0 wenn keine Daten. */
  expected: (followers: number) => number;
  /** Anzahl Datentage in die Kurve eingeflossen */
  sampleSize: number;
  /** Bandbreite — kleinste & größte Follower-Werte in den Daten */
  followerRange: [number, number];
}

function buildPeerCurve(
  history: HistoryRow[],
  modelFollowers: Map<string, number>,
): PeerCurve {
  // Sammle Datapoints (followerSum, revenue)
  const points: { f: number; r: number }[] = [];
  for (const row of history) {
    const accs = parseAccounts(row.account);
    if (accs.length === 0) continue;
    let fSum = 0;
    let known = false;
    for (const a of accs) {
      const fc = modelFollowers.get(a.toLowerCase().trim());
      if (fc !== undefined) {
        fSum += fc;
        known = true;
      }
    }
    if (!known || fSum <= 0) continue;
    points.push({ f: fSum, r: Number(row.revenue_today ?? 0) });
  }

  if (points.length < 10) {
    return { expected: () => 0, sampleSize: points.length, followerRange: [0, 0] };
  }

  // Sortiere nach Follower aufsteigend
  points.sort((a, b) => a.f - b.f);
  const minF = points[0].f;
  const maxF = points[points.length - 1].f;

  // Vorberechnete Smoothed-Kurve: für jeden Punkt der Median seines log-Nachbarschaftsfensters.
  // Wir nehmen ein Fenster von ±35% Follower-Distanz — passt sich der lokalen Dichte an.
  const cache: { f: number; med: number }[] = [];
  let cursorLow = 0;
  let cursorHigh = 0;
  for (let i = 0; i < points.length; i++) {
    const f = points[i].f;
    const lo = f * 0.65;
    const hi = f * 1.35;
    while (cursorLow < points.length && points[cursorLow].f < lo) cursorLow++;
    while (cursorHigh < points.length && points[cursorHigh].f <= hi) cursorHigh++;
    const slice = points.slice(cursorLow, cursorHigh);
    if (slice.length < 5) continue;
    const sorted = [...slice].map((p) => p.r).sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    cache.push({ f, med });
  }

  if (cache.length === 0) {
    return { expected: () => 0, sampleSize: points.length, followerRange: [minF, maxF] };
  }

  // Lookup: linear interpolieren zwischen nächsten Cache-Punkten
  return {
    sampleSize: points.length,
    followerRange: [minF, maxF],
    expected: (followers: number) => {
      if (followers <= cache[0].f) return cache[0].med;
      if (followers >= cache[cache.length - 1].f) return cache[cache.length - 1].med;
      // binäre Suche
      let lo = 0;
      let hi = cache.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cache[mid].f <= followers) lo = mid;
        else hi = mid;
      }
      const a = cache[lo];
      const b = cache[hi];
      const t = (followers - a.f) / (b.f - a.f || 1);
      return a.med + (b.med - a.med) * t;
    },
  };
}

function aggregate(
  rows: HistoryRow[],
  range: TimeRange,
  modelFollowers: Map<string, number>,
): Map<string, ChatterAggregate> {
  const days = rangeDays(range);
  const byName = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const k = normalize(r.chatter_name);
    const list = byName.get(k) || [];
    list.push(r);
    byName.set(k, list);
  }
  const out = new Map<string, ChatterAggregate>();
  for (const [key, list] of byName) {
    list.sort((a, b) => a.analysis_date.localeCompare(b.analysis_date));
    const totalRev = list.reduce((s, r) => s + Number(r.revenue_today ?? 0), 0);
    const totalDM = list.reduce((s, r) => s + Number(r.mass_dms ?? 0), 0);
    const zeroDays = list.filter((r) => Number(r.revenue_today ?? 0) === 0).length;

    // längste 0€-Streak am Ende
    let streak = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (Number(list[i].revenue_today ?? 0) === 0) streak++;
      else break;
    }

    // Jüngster Account-Eintrag im Fenster (list ist asc → letzter Eintrag)
    let accounts: string[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const accs = parseAccounts(list[i].account);
      if (accs.length > 0) {
        accounts = accs;
        break;
      }
    }
    const totalFollowers = accounts.reduce(
      (s, a) => s + (modelFollowers.get(a.toLowerCase().trim()) ?? 0),
      0,
    );

    out.set(key, {
      name: list[0].chatter_name,
      rows: list,
      daysActive: list.length,
      totalRevenue: totalRev,
      // Wichtig: Durchschnitt nur über echte Report-Tage des Chatters rechnen.
      // Sonst wird ein Chatter im 30d-Fenster künstlich schlechtgerechnet,
      // wenn erst z.B. 15 Tage Daten vorhanden sind.
      avgRevenuePerDay: totalRev / Math.max(1, list.length),
      totalMassDms: totalDM,
      avgMassDmsPerDay: totalDM / Math.max(1, list.length),
      consecutiveZeroDays: streak,
      zeroDaysInWindow: zeroDays,
      totalFollowers,
      accounts,
    });
  }
  return out;
}

function aggregateBaseline(rows: HistoryRow[]): Map<string, { avgRevenue: number; avgMassDms: number; days: number }> {
  const out = new Map<string, { avgRevenue: number; avgMassDms: number; days: number }>();
  const byName = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const k = normalize(r.chatter_name);
    const list = byName.get(k) || [];
    list.push(r);
    byName.set(k, list);
  }
  for (const [key, list] of byName) {
    const days = list.length;
    if (days === 0) continue;
    const rev = list.reduce((s, r) => s + Number(r.revenue_today ?? 0), 0) / days;
    const dm = list.reduce((s, r) => s + Number(r.mass_dms ?? 0), 0) / days;
    out.set(key, { avgRevenue: rev, avgMassDms: dm, days });
  }
  return out;
}

const SEVERITY_RANK: Record<AnomalySeverity, number> = { critical: 4, high: 3, medium: 2, info: 1, positive: 0 };

export interface ComputeResult {
  anomalies: ChatterAnomaly[];
  /** map<normalizedName, ChatterAnomaly[]> */
  byChatter: Map<string, ChatterAnomaly[]>;
  /** kontext infos */
  windowDays: number;
  reportId: string | null;
  /** Globaler Mittelwert (Fallback / Anzeige) */
  peerAvgRevenuePerDay: number;
  /** Lernkurve aus kompletter Workspace-Historie: erwartetes €/Tag bei N Followern. */
  peerCurve: PeerCurve;
}

/**
 * Berechnet alle Auffälligkeiten für einen Zeitraum.
 *
 * @param userId           auth user id
 * @param platform         workspace platform
 * @param range            zeitraum
 * @param activeReportId   id des aktuell wirksamen Reports (für dismissals).
 *                         Wenn null, werden keine Dismissals gefiltert.
 */
export async function computeAnomaliesForWindow(
  userId: string,
  platform: string,
  range: TimeRange,
  activeReportId: string | null,
): Promise<ComputeResult> {
  const days = rangeDays(range);
  const [windowRows, baselineRows, fullHistory, modelFollowers, activeNames] = await Promise.all([
    loadWindow(userId, platform, range),
    loadBaseline(userId, platform, range.from, 30),
    loadFullHistory(userId, platform),
    loadModels(userId, platform),
    loadActiveChatterNames(platform),
  ]);

  const agg = aggregate(windowRows, range, modelFollowers);
  const baseline = aggregateBaseline(baselineRows);
  const peerCurve = buildPeerCurve(fullHistory, modelFollowers);

  // Globaler Mittelwert nur als Fallback / für UI-Anzeige
  const peerValues = [...agg.values()]
    .filter((a) => a.daysActive >= Math.min(2, days))
    .map((a) => a.avgRevenuePerDay);
  const peerAvg =
    peerValues.length > 0 ? peerValues.reduce((s, v) => s + v, 0) / peerValues.length : 0;

  // Workspace-Median der Follower-Summe pro Chatter — definiert "kleiner Account".
  const followerSums = [...agg.values()]
    .map((a) => a.totalFollowers)
    .filter((f) => f > 0)
    .sort((a, b) => a - b);
  const followerMedian = followerSums.length > 0
    ? followerSums[Math.floor(followerSums.length / 2)]
    : 0;

  // MassDM-Ziel skaliert mit Fensterlänge (6/Tag)
  const massDmTargetPerDay = 6;

  // Onboarding-Filter: ein Chatter mit weniger als 5 historischen Reporttagen
  // (gesamte Workspace-Historie, nicht nur Fenster) wird ausgeblendet.
  const totalDaysByChatter = new Map<string, Set<string>>();
  for (const r of fullHistory) {
    const k = normalize(r.chatter_name);
    const set = totalDaysByChatter.get(k) ?? new Set<string>();
    set.add(r.analysis_date);
    totalDaysByChatter.set(k, set);
  }
  const ONBOARDING_MIN_DAYS = 5;

  const anomalies: ChatterAnomaly[] = [];

  for (const a of agg.values()) {
    // Chatter, die nicht mehr im aktuellen Report stehen, sind „raus" → ausblenden.
    if (activeNames !== null && !activeNames.has(normalize(a.name))) continue;
    const totalDays = totalDaysByChatter.get(normalize(a.name))?.size ?? 0;
    if (totalDays < ONBOARDING_MIN_DAYS) continue;
    const baseHere = baseline.get(normalize(a.name));
    const haveOwnHistory = baseHere && baseHere.days >= 3;

    // ── 1. Peer-Underperform (follower-basierte Erwartung) ──
    // Erwartung kommt aus Workspace-Lernkurve. Fällt diese aus (zu wenige Daten),
    // greifen wir auf den globalen Peer-Mittelwert zurück.
    const expectedFromCurve =
      a.totalFollowers > 0 ? peerCurve.expected(a.totalFollowers) : 0;
    const useExpected = expectedFromCurve > 0;
    const expected = useExpected ? expectedFromCurve : peerAvg;

    // Mindestens 4 Tage aktiv im Fenster (sonst zu wenig Daten)
    const minDaysForPeer = Math.min(4, days);
    if (
      expected > 5 &&
      a.avgRevenuePerDay < expected * 0.5 &&
      a.daysActive >= minDaysForPeer
    ) {
      const deltaPct = -((expected - a.avgRevenuePerDay) / expected) * 100;
      const severity: AnomalySeverity =
        a.avgRevenuePerDay < expected * 0.25 ? "high" : "medium";
      const ctx = useExpected
        ? `erwartet ${expected.toFixed(0)}€ bei ${a.totalFollowers.toLocaleString("de-DE")} Followern`
        : `Peer-Schnitt ${expected.toFixed(0)}€`;
      anomalies.push({
        chatter_name: a.name,
        alert_type: "peer_underperform",
        severity,
        metric_value: a.avgRevenuePerDay,
        baseline_value: expected,
        delta_pct: Math.round(deltaPct),
        message: `Ø ${a.avgRevenuePerDay.toFixed(0)}€/Tag — ${Math.round(Math.abs(deltaPct))}% unter Erwartung (${ctx})`,
        score: SEVERITY_RANK[severity] * 10 + Math.abs(deltaPct) / 10,
      });
    }

    // ── 2. Self Revenue Drop ─────────────────────────────────
    if (haveOwnHistory && baseHere!.avgRevenue >= 30) {
      const dropPct = ((baseHere!.avgRevenue - a.avgRevenuePerDay) / baseHere!.avgRevenue) * 100;
      if (dropPct >= 35) {
        const severity: AnomalySeverity = dropPct >= 70 ? "critical" : dropPct >= 55 ? "high" : "medium";
        anomalies.push({
          chatter_name: a.name,
          alert_type: "self_revenue_drop",
          severity,
          metric_value: a.avgRevenuePerDay,
          baseline_value: baseHere!.avgRevenue,
          delta_pct: -Math.round(dropPct),
          message: `Ø ${a.avgRevenuePerDay.toFixed(0)}€ — ${Math.round(dropPct)}% unter eigenem Schnitt (${baseHere!.avgRevenue.toFixed(0)}€)`,
          score: SEVERITY_RANK[severity] * 10 + dropPct / 10,
        });
      }
    }

    // ── 3. Persistent Zero ───────────────────────────────────
    if (a.consecutiveZeroDays >= Math.min(3, days)) {
      const severity: AnomalySeverity =
        a.consecutiveZeroDays >= 7 ? "critical" : a.consecutiveZeroDays >= 5 ? "high" : "medium";
      anomalies.push({
        chatter_name: a.name,
        alert_type: "persistent_zero",
        severity,
        metric_value: a.consecutiveZeroDays,
        baseline_value: 0,
        delta_pct: 0,
        message: `${a.consecutiveZeroDays} Tage in Folge 0€`,
        score: SEVERITY_RANK[severity] * 10 + a.consecutiveZeroDays,
      });
    }

    // ── 4. MassDM — nur wenn auch der Umsatz schwach ist ─────
    // Regel: MassDM-Alarm NUR wenn (a) MassDMs < 4/Tag UND (b) Umsatz unter Erwartung.
    // Hohe MassDM-Performance trotz fehlendem Umsatz = positiver Trigger (er zieht durch).
    const revenueBenchmark = useExpected ? expected : peerAvg;
    const revenueWeak = revenueBenchmark > 0
      ? a.avgRevenuePerDay < revenueBenchmark * 0.5
      : a.avgRevenuePerDay < 30;
    const noRevenue = a.avgRevenuePerDay < 5;

    if (a.daysActive >= Math.min(2, days)) {
      // 4a. Negativer Alarm: wenig DMs UND schwacher Umsatz
      if (a.avgMassDmsPerDay < 4 && revenueWeak) {
        const dmShortfall = massDmTargetPerDay - a.avgMassDmsPerDay;
        let severity: AnomalySeverity;
        const type: AnomalyType =
          noRevenue && a.avgMassDmsPerDay < 1 ? "massdm_zero_no_rev" : "massdm_low";

        if (type === "massdm_zero_no_rev") severity = "critical";
        else if (noRevenue && a.avgMassDmsPerDay < 2) severity = "high";
        else severity = "medium";

        const msg =
          type === "massdm_zero_no_rev"
            ? `Praktisch keine MassDMs (${a.avgMassDmsPerDay.toFixed(1)}/Tag) UND kein Umsatz`
            : `Ø ${a.avgMassDmsPerDay.toFixed(1)} MassDMs/Tag (Ziel 6) — ${noRevenue ? "kein Umsatz" : "Umsatz unter Erwartung"}`;

        anomalies.push({
          chatter_name: a.name,
          alert_type: type,
          severity,
          metric_value: a.avgMassDmsPerDay,
          baseline_value: massDmTargetPerDay,
          delta_pct: -Math.round((dmShortfall / massDmTargetPerDay) * 100),
          message: msg,
          score: SEVERITY_RANK[severity] * 10 + dmShortfall + (noRevenue ? 8 : 0),
        });
      }

      // 4b. Positiver Trigger: er zieht trotz fehlendem Umsatz durch (≥6 DMs/Tag, kein Umsatz)
      if (a.avgMassDmsPerDay >= 6 && noRevenue) {
        anomalies.push({
          chatter_name: a.name,
          alert_type: "high_effort_no_rev",
          severity: "positive",
          metric_value: a.avgMassDmsPerDay,
          baseline_value: massDmTargetPerDay,
          delta_pct: Math.round(((a.avgMassDmsPerDay - massDmTargetPerDay) / massDmTargetPerDay) * 100),
          message: `Ø ${a.avgMassDmsPerDay.toFixed(1)} MassDMs/Tag — zieht voll durch, Umsatz folgt erfahrungsgemäß`,
          score: 0.5, // ganz unten in der Liste
        });
    }

    // ── 5. POSITIV: Peer-Overperform ─────────────────────────
    // Deutlich über erwartetem €/Tag bei seiner Follower-Summe.
    if (
      useExpected &&
      expected > 5 &&
      a.daysActive >= Math.min(4, days) &&
      a.avgRevenuePerDay >= expected * 1.5
    ) {
      const overPct = ((a.avgRevenuePerDay - expected) / expected) * 100;
      anomalies.push({
        chatter_name: a.name,
        alert_type: "peer_overperform",
        severity: "positive",
        metric_value: a.avgRevenuePerDay,
        baseline_value: expected,
        delta_pct: Math.round(overPct),
        message: `Ø ${a.avgRevenuePerDay.toFixed(0)}€/Tag — ${Math.round(overPct)}% über Erwartung (erwartet ${expected.toFixed(0)}€ bei ${a.totalFollowers.toLocaleString("de-DE")} Followern)`,
        score: 50 + Math.min(overPct, 300) / 5,
      });
    }

    // ── 6. POSITIV: Self Revenue Spike ───────────────────────
    if (haveOwnHistory && baseHere!.avgRevenue >= 30) {
      const upPct = ((a.avgRevenuePerDay - baseHere!.avgRevenue) / baseHere!.avgRevenue) * 100;
      if (upPct >= 50 && a.daysActive >= Math.min(3, days)) {
        anomalies.push({
          chatter_name: a.name,
          alert_type: "self_revenue_spike",
          severity: "positive",
          metric_value: a.avgRevenuePerDay,
          baseline_value: baseHere!.avgRevenue,
          delta_pct: Math.round(upPct),
          message: `Ø ${a.avgRevenuePerDay.toFixed(0)}€ — +${Math.round(upPct)}% über eigenem Schnitt (${baseHere!.avgRevenue.toFixed(0)}€)`,
          score: 55 + Math.min(upPct, 300) / 5,
        });
      }
    }

    // ── 7. POSITIV: Comeback ─────────────────────────────────
    // Vorher schwach (<30€/Tag bei ≥5 Baselinetagen), jetzt deutlich stark (≥60€/Tag).
    if (
      baseHere &&
      baseHere.days >= 5 &&
      baseHere.avgRevenue < 30 &&
      a.avgRevenuePerDay >= 60 &&
      a.daysActive >= Math.min(3, days)
    ) {
      anomalies.push({
        chatter_name: a.name,
        alert_type: "comeback",
        severity: "positive",
        metric_value: a.avgRevenuePerDay,
        baseline_value: baseHere.avgRevenue,
        delta_pct: baseHere.avgRevenue > 0
          ? Math.round(((a.avgRevenuePerDay - baseHere.avgRevenue) / baseHere.avgRevenue) * 100)
          : 0,
        message: `Comeback: Ø ${a.avgRevenuePerDay.toFixed(0)}€/Tag (vorher nur ${baseHere.avgRevenue.toFixed(0)}€) — Turnaround läuft`,
        score: 70 + Math.min(a.avgRevenuePerDay, 500) / 10,
      });
    }
  }
  }

  // Dismissals nur anwenden wenn report bekannt
  let dismissed = new Set<string>();
  if (activeReportId) {
    const { data } = await supabase
      .from("alert_dismissals")
      .select("chatter_name, alert_type")
      .eq("user_id", userId)
      .eq("platform", platform)
      .eq("report_id", activeReportId);
    if (data) {
      for (const d of data) {
        dismissed.add(`${normalize(d.chatter_name)}|${d.alert_type}`);
      }
    }
  }

  const visible = anomalies.filter(
    (a) => !dismissed.has(`${normalize(a.chatter_name)}|${a.alert_type}`),
  );
  visible.sort((a, b) => b.score - a.score);

  const byChatter = new Map<string, ChatterAnomaly[]>();
  for (const a of visible) {
    const k = normalize(a.chatter_name);
    const list = byChatter.get(k) || [];
    list.push(a);
    byChatter.set(k, list);
  }

  return {
    anomalies: visible,
    byChatter,
    windowDays: days,
    reportId: activeReportId,
    peerAvgRevenuePerDay: peerAvg,
    peerCurve,
  };
}

/** Latest report id for the active workspace (used to scope dismissals). */
export async function loadActiveReportId(
  userId: string,
  platform: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("analysis_reports")
    .select("id")
    .eq("user_id", userId)
    .eq("platform", platform)
    .not("result_json", "is", null)
    .order("analysis_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function dismissAnomaly(params: {
  userId: string;
  platform: string;
  chatterName: string;
  alertType: AnomalyType;
  reportId: string;
}): Promise<void> {
  await supabase.from("alert_dismissals").insert({
    user_id: params.userId,
    platform: params.platform,
    chatter_name: params.chatterName,
    alert_type: params.alertType,
    report_id: params.reportId,
  } as any);
}

export async function dismissChatter(params: {
  userId: string;
  platform: string;
  chatterName: string;
  alertTypes: AnomalyType[];
  reportId: string;
}): Promise<void> {
  if (params.alertTypes.length === 0) return;
  const rows = params.alertTypes.map((t) => ({
    user_id: params.userId,
    platform: params.platform,
    chatter_name: params.chatterName,
    alert_type: t,
    report_id: params.reportId,
  }));
  await supabase.from("alert_dismissals").insert(rows as any);
}

export async function undismissAnomaly(params: {
  userId: string;
  platform: string;
  chatterName: string;
  alertType: AnomalyType;
  reportId: string;
}): Promise<void> {
  await supabase
    .from("alert_dismissals")
    .delete()
    .eq("user_id", params.userId)
    .eq("platform", params.platform)
    .eq("chatter_name", params.chatterName)
    .eq("alert_type", params.alertType)
    .eq("report_id", params.reportId);
}

export const ANOMALY_LABELS: Record<AnomalyType, { label: string; emoji: string }> = {
  peer_underperform:    { label: "Unter Peer-Schnitt",      emoji: "📉" },
  self_revenue_drop:    { label: "Eigener Schnitt gefallen", emoji: "⚠️" },
  persistent_zero:      { label: "Mehrtägige 0€-Serie",      emoji: "🔥" },
  massdm_low:           { label: "MassDMs < 4/Tag + schwacher Umsatz", emoji: "📨" },
  massdm_zero_no_rev:   { label: "Keine MassDMs & kein Umsatz", emoji: "🚨" },
  high_effort_no_rev:   { label: "Zieht durch — Umsatz folgt", emoji: "💪" },
  peer_overperform:     { label: "Über Erwartung",            emoji: "🚀" },
  self_revenue_spike:   { label: "Eigener Schnitt übertroffen", emoji: "📈" },
  comeback:             { label: "Comeback — Turnaround",     emoji: "✨" },
};

export const SEVERITY_STYLE: Record<AnomalySeverity, { dot: string; border: string; label: string; text: string }> = {
  critical: { dot: "bg-red-500",     border: "border-l-red-500/70 bg-red-500/[0.05]",     label: "Kritisch", text: "text-red-300" },
  high:     { dot: "bg-orange-400",  border: "border-l-orange-400/70 bg-orange-400/[0.05]", label: "Hoch",   text: "text-orange-200" },
  medium:   { dot: "bg-yellow-400",  border: "border-l-yellow-400/70 bg-yellow-400/[0.04]", label: "Mittel", text: "text-yellow-200" },
  info:     { dot: "bg-sky-400",     border: "border-l-sky-400/70 bg-sky-400/[0.04]",       label: "Info",   text: "text-sky-200" },
  positive: { dot: "bg-emerald-400", border: "border-l-emerald-400/70 bg-emerald-400/[0.05]", label: "Positiv", text: "text-emerald-200" },
};
