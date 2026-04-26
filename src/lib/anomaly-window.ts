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

export type AnomalySeverity = "critical" | "high" | "medium" | "info";
export type AnomalyType =
  | "peer_underperform"   // Liegt deutlich unter Peer-Schnitt
  | "self_revenue_drop"   // Eigener Schnitt eingebrochen
  | "persistent_zero"     // Mehrere Tage in Folge unter Ziel
  | "massdm_low"          // < 6/Tag — verschärft wenn auch Umsatz schwach
  | "massdm_zero_no_rev"; // Keine MassDMs UND kein Umsatz im Zeitraum

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
      .select("chatter_name, analysis_date, revenue_today, mass_dms, response_delay_days")
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
      .select("chatter_name, analysis_date, revenue_today, mass_dms, response_delay_days")
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

function aggregate(rows: HistoryRow[], range: TimeRange): Map<string, ChatterAggregate> {
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

    out.set(key, {
      name: list[0].chatter_name,
      rows: list,
      daysActive: list.length,
      totalRevenue: totalRev,
      avgRevenuePerDay: totalRev / days,
      totalMassDms: totalDM,
      avgMassDmsPerDay: totalDM / days,
      consecutiveZeroDays: streak,
      zeroDaysInWindow: zeroDays,
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

const SEVERITY_RANK: Record<AnomalySeverity, number> = { critical: 4, high: 3, medium: 2, info: 1 };

export interface ComputeResult {
  anomalies: ChatterAnomaly[];
  /** map<normalizedName, ChatterAnomaly[]> */
  byChatter: Map<string, ChatterAnomaly[]>;
  /** kontext infos */
  windowDays: number;
  reportId: string | null;
  peerAvgRevenuePerDay: number;
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
  const [windowRows, baselineRows] = await Promise.all([
    loadWindow(userId, platform, range),
    loadBaseline(userId, platform, range.from, 30),
  ]);

  const agg = aggregate(windowRows, range);
  const baseline = aggregateBaseline(baselineRows);

  // Peer Schnitt = Durchschnitt der avgRevenuePerDay aller Chatter im Fenster
  const peerValues = [...agg.values()]
    .filter((a) => a.daysActive >= Math.min(2, days))
    .map((a) => a.avgRevenuePerDay);
  const peerAvg =
    peerValues.length > 0 ? peerValues.reduce((s, v) => s + v, 0) / peerValues.length : 0;

  // MassDM-Ziel skaliert mit Fensterlänge (6/Tag)
  const massDmTargetPerDay = 6;

  const anomalies: ChatterAnomaly[] = [];

  for (const a of agg.values()) {
    const baseHere = baseline.get(normalize(a.name));
    const haveOwnHistory = baseHere && baseHere.days >= 3;

    // ── 1. Peer-Underperform ─────────────────────────────────
    if (peerAvg > 5 && a.avgRevenuePerDay < peerAvg * 0.5 && a.daysActive >= Math.min(2, days)) {
      const deltaPct = peerAvg > 0 ? -((peerAvg - a.avgRevenuePerDay) / peerAvg) * 100 : 0;
      const severity: AnomalySeverity =
        a.avgRevenuePerDay < peerAvg * 0.25 ? "high" : "medium";
      anomalies.push({
        chatter_name: a.name,
        alert_type: "peer_underperform",
        severity,
        metric_value: a.avgRevenuePerDay,
        baseline_value: peerAvg,
        delta_pct: Math.round(deltaPct),
        message: `Ø ${a.avgRevenuePerDay.toFixed(0)}€/Tag — ${Math.round(Math.abs(deltaPct))}% unter Peer-Schnitt (${peerAvg.toFixed(0)}€)`,
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

    // ── 4. MassDM dynamisch ──────────────────────────────────
    // Ziel: 6/Tag. Härter werten wenn Umsatz fehlt.
    const dmShortfall = massDmTargetPerDay - a.avgMassDmsPerDay; // 0 wenn Ziel erreicht
    if (dmShortfall > 0 && a.daysActive >= Math.min(2, days)) {
      const noRevenue = a.avgRevenuePerDay < 5;
      const lowRevenue = a.avgRevenuePerDay < (peerAvg > 0 ? peerAvg * 0.5 : 30);

      // Regulärer MassDM-low
      if (a.avgMassDmsPerDay < 4) {
        let severity: AnomalySeverity = "medium";
        if (noRevenue && a.avgMassDmsPerDay < 2) severity = "critical";
        else if (noRevenue || (lowRevenue && a.avgMassDmsPerDay < 2)) severity = "high";
        else if (lowRevenue) severity = "medium";
        else severity = "info";

        // type wechseln wenn ganz extrem
        const type: AnomalyType =
          noRevenue && a.avgMassDmsPerDay < 1
            ? "massdm_zero_no_rev"
            : "massdm_low";

        const msg =
          type === "massdm_zero_no_rev"
            ? `Praktisch keine MassDMs (${a.avgMassDmsPerDay.toFixed(1)}/Tag) UND kein Umsatz`
            : `Ø ${a.avgMassDmsPerDay.toFixed(1)} MassDMs/Tag (Ziel 6)${noRevenue ? " — kein Umsatz" : lowRevenue ? " — schwacher Umsatz" : ""}`;

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
  massdm_low:           { label: "MassDMs < 6/Tag",          emoji: "📨" },
  massdm_zero_no_rev:   { label: "Keine MassDMs & kein Umsatz", emoji: "🚨" },
};

export const SEVERITY_STYLE: Record<AnomalySeverity, { dot: string; border: string; label: string; text: string }> = {
  critical: { dot: "bg-red-500",     border: "border-l-red-500/70 bg-red-500/[0.05]",     label: "Kritisch", text: "text-red-300" },
  high:     { dot: "bg-orange-400",  border: "border-l-orange-400/70 bg-orange-400/[0.05]", label: "Hoch",   text: "text-orange-200" },
  medium:   { dot: "bg-yellow-400",  border: "border-l-yellow-400/70 bg-yellow-400/[0.04]", label: "Mittel", text: "text-yellow-200" },
  info:     { dot: "bg-emerald-400", border: "border-l-emerald-400/70 bg-emerald-400/[0.04]", label: "Info", text: "text-emerald-200" },
};
