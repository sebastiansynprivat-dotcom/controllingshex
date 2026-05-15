/**
 * Today Engine — Unified Action Aggregator
 *
 * Wrappt `generateDailyTodos` und `generateRevenueTasks`, normalisiert beide
 * in ein gemeinsames Schema, bündelt Aktionen pro Person (außer Multi-Person
 * oder Account-Only Tasks) und sortiert nach geschätztem €-Hebel.
 *
 * Ergänzt Persistenz: für jede Person wird gezählt, an wie vielen der letzten
 * 7 Tage (exkl. heute) ein „schlechtes" Signal vorlag — das fließt in den Score
 * und liefert das UI-Label „3. Tag in Folge".
 */
import { supabase } from "@/integrations/supabase/client";
import {
  generateDailyTodos,
  type DailyTodo,
  type TodoCategory,
} from "@/lib/daily-todos";
import {
  generateRevenueTasks,
  type RevenueTask,
  type RevenueTaskKind,
} from "@/lib/revenue-tasks";
import { normalizeChatterName } from "@/lib/active-chatters";
import { loadRoiMultipliers } from "@/lib/action-outcomes";
import { loadAccountFitMatrix } from "@/lib/account-fit";
import { generatePotentialSignals, type PotentialSignal, type EvidenceRow } from "@/lib/potential-detector";

export type ActionSourceKind = TodoCategory | RevenueTaskKind | "potential";

export interface ActionSignal {
  source: "todo" | "revenue" | "potential";
  kind: ActionSourceKind;
  title: string;
  why: string;
  /** Geschätzter Wochen-Hebel in € — null wenn keine valide Personen-Baseline. */
  impactEurPerWeek: number | null;
  /** Kurze, menschenlesbare Begründung der Schätzung. */
  impactReason?: string;
  /** Originaler Key — für Done/Snooze/Dismiss-Persistenz. */
  todoKey: string;
  modelName?: string | null;
  compareWith?: string | null;
  secondaryChatter?: string | null;
  /** v3 — historische Belege (Account-Fit-Matrix), max 3 Zeilen */
  evidence?: EvidenceRow[];
}

export interface UnifiedAction {
  /** Stabiler Schlüssel: chatter oder modelName, plus 1. Signal-Key als Fallback */
  bundleKey: string;
  /** Sammelt alle Todo-Keys dieses Bündels für Done/Snooze/Dismiss-Status */
  todoKeys: string[];
  chatterName: string | null;
  modelName: string | null;
  secondaryChatter: string | null;
  signals: ActionSignal[];
  /** Berechnet aus allen Signalen */
  totalImpactEurPerWeek: number;
  /** 1..7 — wie viele Tage (von 6 vorherigen) zeigte dieser Chatter Schwäche */
  persistence: number;
  /** 0..3 — Umsatzanteil-Multiplier */
  importance: number;
  /** Gemeinsamer Score für Sortierung (höher = wichtiger) */
  score: number;
  /** Höchste Urgency-Kategorie für Tab-Farbe */
  primaryKind: ActionSourceKind;
  /** Hauptsächlicher visueller „Mood" */
  tone: "critical" | "warning" | "info" | "positive";
  /** Models, die dieser Chatter heute betreut, mit Follower-Anzeige */
  modelInfo: string;
  /** B1 — Peak-Stunden-Fenster aus 21T Hourly-Stats (UTC-Stunden) */
  peakWindow: { startHour: number; endHour: number } | null;
  /** B1 — Aktuelle Stunde liegt im Peak-Fenster */
  inPeakNow: boolean;
  /** B2 — Konfidenz der €-Schätzung: 'low' (<5T), 'medium' (5–14T), 'high' (≥15T) */
  confidence: "low" | "medium" | "high";
  /** B3 — Geschätzte Folgekosten/Wo wenn heute nichts passiert (nur kritisch/warning) */
  costOfInactionEurPerWeek: number;
  /** A1 — Aus action_outcomes gelernter ROI-Multiplier (1.0 = neutral) */
  roiMultiplier: number;
}

interface HistoryRow {
  chatter_name: string;
  analysis_date: string;
  revenue_today: number | null;
  mass_dms: number | null;
  open_chats: number | null;
  response_delay_days: number | null;
  account: string | null;
}

const SOLO_KINDS = new Set<ActionSourceKind>([
  // Multi-Person — eigene Karten
  "talent",
  "swap",
  "phase",
  // Account-only
  "slot",
  "model",
  "mismatch",
  // v3 Potenzial — eigene Karte mit Evidence-Block, nicht in Personenbündel
  "potential",
]);

const TONE_BY_KIND: Record<ActionSourceKind, "critical" | "warning" | "info" | "positive"> = {
  verzug: "critical",
  recovery: "critical",
  revenue: "warning",
  activity: "warning",
  phase: "warning",
  mismatch: "warning",
  swap: "info",
  slot: "warning",
  model: "info",
  talent: "info",
  positive: "positive",
  potential: "info",
};

const KIND_PRIORITY: ActionSourceKind[] = [
  "verzug",
  "recovery",
  "revenue",
  "potential",
  "phase",
  "mismatch",
  "activity",
  "slot",
  "swap",
  "model",
  "talent",
  "positive",
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface ChatterStats {
  /** Median € an Tagen mit Umsatz > 0 (30T, exkl. heute). */
  medianRevenue: number;
  /** P75 € an aktiven Tagen — was an guten Tagen drin ist. */
  p75Revenue: number;
  /** Median Mass-DMs an aktiven Tagen. */
  medianMassDms: number;
  /** Ø € an Tagen mit ≥3 Mass-DMs. */
  revenueWithMassDms: number;
  /** Ø € an Tagen mit 0 Mass-DMs. */
  revenueWithoutMassDms: number;
  /** Differenz: was Mass-DMs dieser Person historisch bringen (€/Tag). */
  massDmLift: number;
  /** Anzahl auswertbarer Tage in 30T-Fenster. */
  sampleSize: number;
  weakDays: number;
  weakStreak: number;
  modelInfo: string;
  /** B1 — Peak-Stunden-Fenster (lokale Stunde 0–23) aus 21T Hourly-Revenue. */
  peakWindow: { startHour: number; endHour: number } | null;
}

function p75(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(s.length * 0.75));
  return s[idx];
}

async function loadChatterStats(
  platform: string,
): Promise<{ stats: Map<string, ChatterStats>; importanceFor: (name: string) => number }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { stats: new Map(), importanceFor: () => 1.0 };
  }

  const since = isoDaysAgo(29); // 30 Tage
  const sinceHourly = isoDaysAgo(20); // 21 Tage Hourly
  const today = todayISO();

  const [historyRes, modelsRes, hourlyRes] = await Promise.all([
    supabase
      .from("chatter_history")
      .select("chatter_name, analysis_date, revenue_today, mass_dms, open_chats, response_delay_days, account")
      .eq("user_id", user.id)
      .ilike("platform", platform)
      .gte("analysis_date", since)
      .order("analysis_date", { ascending: false }),
    supabase
      .from("models")
      .select("model_name, follower_count")
      .eq("user_id", user.id)
      .ilike("platform", platform),
    supabase
      .from("chatter_hourly_stats")
      .select("chatter_name, hour, revenue")
      .eq("user_id", user.id)
      .ilike("platform", platform)
      .gte("date", sinceHourly),
  ]);

  const rows = (historyRes.data ?? []) as HistoryRow[];
  const models = (modelsRes.data ?? []) as { model_name: string; follower_count: number }[];
  const hourlyRows = (hourlyRes.data ?? []) as { chatter_name: string; hour: number; revenue: number | null }[];

  // Pro Chatter: 24h Revenue-Buckets aggregieren → Peak-Window finden
  const hourlyByChatter = new Map<string, number[]>();
  for (const h of hourlyRows) {
    if (!h.chatter_name || h.hour == null) continue;
    const key = normalizeChatterName(h.chatter_name);
    let bucket = hourlyByChatter.get(key);
    if (!bucket) { bucket = new Array(24).fill(0); hourlyByChatter.set(key, bucket); }
    bucket[h.hour] += Number(h.revenue) || 0;
  }
  const peakByChatter = new Map<string, { startHour: number; endHour: number } | null>();
  for (const [k, buckets] of hourlyByChatter) {
    const total = buckets.reduce((s, v) => s + v, 0);
    if (total <= 0) { peakByChatter.set(k, null); continue; }
    // Finde kürzestes zusammenhängendes Fenster, das ≥60% Revenue enthält
    const target = total * 0.6;
    let best: { start: number; end: number; len: number } | null = null;
    for (let start = 0; start < 24; start++) {
      let sum = 0;
      for (let len = 1; len <= 12; len++) {
        sum += buckets[(start + len - 1) % 24];
        if (sum >= target) {
          if (!best || len < best.len) best = { start, end: (start + len) % 24, len };
          break;
        }
      }
    }
    peakByChatter.set(k, best ? { startHour: best.start, endHour: best.end } : null);
  }


  const followersByModel = new Map<string, number>();
  for (const m of models) {
    const k = m.model_name.toLowerCase().trim();
    const v = Number(m.follower_count) || 0;
    if ((followersByModel.get(k) ?? 0) < v) followersByModel.set(k, v);
  }
  const fmtFollowers = (n: number): string => {
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".0", "")}k`;
    return String(n);
  };

  const byChatter = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    if (!r.chatter_name) continue;
    const k = normalizeChatterName(r.chatter_name);
    if (!byChatter.has(k)) byChatter.set(k, []);
    byChatter.get(k)!.push(r);
  }

  const stats = new Map<string, ChatterStats>();
  const totals30 = new Map<string, number>();

  for (const [k, list] of byChatter) {
    const past = list.filter((r) => r.analysis_date !== today);
    const todays = list.filter((r) => r.analysis_date === today);

    // Pro Tag aggregieren (Account-Zeilen summieren)
    const dayMap = new Map<string, { rev: number; dm: number; delay: number }>();
    for (const r of past) {
      const cur = dayMap.get(r.analysis_date) ?? { rev: 0, dm: 0, delay: 0 };
      cur.rev += Number(r.revenue_today) || 0;
      cur.dm += r.mass_dms ?? 0;
      cur.delay = Math.max(cur.delay, r.response_delay_days ?? 0);
      dayMap.set(r.analysis_date, cur);
    }
    const days = Array.from(dayMap.values());
    const activeDays = days.filter((d) => d.rev > 0);
    const med = median(activeDays.map((d) => d.rev));
    const p75r = p75(activeDays.map((d) => d.rev));
    const medDm = median(activeDays.map((d) => d.dm));

    const withDm = activeDays.filter((d) => d.dm >= 3).map((d) => d.rev);
    const withoutDm = activeDays.filter((d) => d.dm === 0).map((d) => d.rev);
    const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    const revWith = avg(withDm);
    const revWithout = avg(withoutDm);
    // Mass-DM-Lift nur wenn beide Seiten ≥2 Datentage haben
    const lift = withDm.length >= 2 && withoutDm.length >= 2 && revWith > revWithout
      ? revWith - revWithout
      : 0;

    let weakDays = 0;
    let weakStreak = 0;
    let streakActive = true;
    for (let i = 1; i <= 6; i++) {
      const day = isoDaysAgo(i);
      const d = dayMap.get(day);
      let weak = false;
      if (!d) {
        if (days.length >= 3) weak = true;
      } else {
        if (
          (med > 0 && d.rev < med * 0.5) ||
          d.delay >= 1 ||
          (med > 0 && d.dm === 0)
        ) {
          weak = true;
        }
      }
      if (weak) {
        weakDays++;
        if (streakActive) weakStreak++;
      } else {
        streakActive = false;
      }
    }

    const accs = new Set<string>();
    for (const e of todays) {
      for (const part of (e.account || "").split(",")) {
        const a = part.trim();
        if (a) accs.add(a);
      }
    }
    const modelInfo = accs.size === 0
      ? ""
      : Array.from(accs)
          .map((a) => `${a} (${fmtFollowers(followersByModel.get(a.toLowerCase()) ?? 0)})`)
          .join(", ");

    stats.set(k, {
      medianRevenue: med,
      p75Revenue: p75r,
      medianMassDms: medDm,
      revenueWithMassDms: revWith,
      revenueWithoutMassDms: revWithout,
      massDmLift: lift,
      sampleSize: days.length,
      weakDays,
      weakStreak,
      modelInfo,
      peakWindow: peakByChatter.get(k) ?? null,
    });

    totals30.set(k, days.reduce((s, d) => s + d.rev, 0));
  }

  const arr = Array.from(totals30.values()).filter((v) => v > 0).sort((a, b) => b - a);
  const top = arr[0] ?? 0;
  const importanceFor = (name: string): number => {
    const v = totals30.get(normalizeChatterName(name)) ?? 0;
    if (top <= 0) return 1.0;
    if (v <= 0) return 0.3;
    const ratio = v / top;
    return Math.min(2.5, Math.max(0.4, 0.5 + 2.0 * Math.sqrt(ratio)));
  };

  return { stats, importanceFor };
}

const MIN_SAMPLE = 5;
const fmtE = (n: number) => Math.round(n).toLocaleString("de-DE");

interface ImpactResult {
  impact: number | null;
  reason: string;
}

/**
 * Personalisierte €-Hebel-Schätzung pro Todo. Liefert null, wenn die
 * Datenbasis zu dünn ist — UI zeigt dann „?" statt einer Phantasiezahl.
 */
function estimateImpactForTodo(t: DailyTodo, stats: ChatterStats | undefined): ImpactResult {
  const meta = t.meta ?? {};
  const noStat = !stats || stats.sampleSize < MIN_SAMPLE;
  const med = stats?.medianRevenue ?? 0;
  const cap = (v: number) => (med > 0 ? Math.min(v, med * 14) : v);

  switch (t.category) {
    case "verzug": {
      if (noStat || med <= 0) return { impact: null, reason: "Zu wenig Historie" };
      const days = Math.min(3, Math.max(1, meta.delayDays ?? 1));
      const impact = cap(med * (days / 3) * 7);
      return {
        impact,
        reason: `Median ${fmtE(med)}€/Tag · ${days}T Verzug ≈ ${Math.round((days / 3) * 100)}% Tagespotenzial × 7`,
      };
    }
    case "revenue": {
      if (noStat) return { impact: null, reason: "Zu wenig Historie" };
      const todayRev = meta.todayRevenue ?? 0;
      const base = meta.baselineRevenue ?? med;
      const gap = Math.max(0, base - todayRev);
      if (gap <= 0) return { impact: null, reason: "Kein klarer Drop" };
      const impact = cap(gap * 7 * 0.6);
      return { impact, reason: `Drop ${fmtE(gap)}€ heute (Ø ${fmtE(base)}€) × 7T × 60% Recovery` };
    }
    case "activity": {
      if (noStat) return { impact: null, reason: "Zu wenig Historie" };
      if (meta.missingMassDms != null && meta.missingMassDms > 0) {
        if (stats!.massDmLift <= 0) {
          return { impact: null, reason: "Kein historischer Mass-DM-Effekt messbar" };
        }
        const ratio = Math.min(1, meta.missingMassDms / 6);
        const impact = cap(stats!.massDmLift * 7 * ratio);
        return {
          impact,
          reason: `Mass-DM-Tage bringen +${fmtE(stats!.massDmLift)}€/Tag · ${meta.missingMassDms} fehlend × 7`,
        };
      }
      if (meta.todayOpenChats != null && meta.baselineOpenChats != null && med > 0) {
        if (meta.todayOpenChats < meta.baselineOpenChats * 2) return { impact: null, reason: "" };
        return { impact: cap(med * 0.25 * 7), reason: `Jam ≈ 25% Tagespotenzial × 7` };
      }
      if (meta.missingDays != null && med > 0) {
        const d = Math.min(3, meta.missingDays);
        return { impact: cap(med * d), reason: `${d}× Median-Tag verloren` };
      }
      return { impact: null, reason: "" };
    }
    case "model": {
      const dropPerDay = meta.modelDropPerDay ?? 0;
      if (dropPerDay <= 0) return { impact: null, reason: "Drop-Höhe nicht quantifizierbar" };
      return { impact: dropPerDay * 7, reason: `Model-Drop ${fmtE(dropPerDay)}€/Tag × 7` };
    }
    case "talent": {
      if (noStat || med <= 0) return { impact: null, reason: "Riser ohne stabile Historie" };
      const score = meta.matchScore ?? 60;
      const impact = cap(med * 7 * (score / 100));
      return {
        impact,
        reason: `Riser-Median ${fmtE(med)}€/Tag × 7 × Match ${Math.round(score)}%`,
      };
    }
    case "positive":
      return { impact: null, reason: "Win — kein €-Hebel" };
  }
}

function estimateImpactForRevenueTask(r: RevenueTask, stats: ChatterStats | undefined): ImpactResult {
  const med = stats?.medianRevenue ?? 0;
  const raw = Math.round(r.impactEurPerWeek);
  if (raw <= 0) return { impact: null, reason: "" };
  const capped = med > 0 ? Math.min(raw, med * 14) : raw;
  const note = capped < raw ? ` (gecappt auf 2× Wochenmedian)` : "";
  return { impact: capped, reason: `${r.kind}-Engine: ${fmtE(capped)}€/Wo${note}` };
}

function pickPrimaryKind(kinds: ActionSourceKind[]): ActionSourceKind {
  for (const k of KIND_PRIORITY) {
    if (kinds.includes(k)) return k;
  }
  return kinds[0];
}

export interface TodayEngineResult {
  /** Top-Aktionen mit höchstem €-Hebel (default 6) */
  primary: UnifiedAction[];
  /** Rest — „im Auge behalten" */
  watchlist: UnifiedAction[];
  /** Wins / proaktive Beobachtungen */
  wins: UnifiedAction[];
  totalImpactEurPerWeek: number;
}

const PRIMARY_LIMIT = 6;

export async function buildTodayActions(platform: string): Promise<TodayEngineResult> {
  const [todos, revTasks, statsBundle, roiMap, fitMatrix, modelsRes] = await Promise.all([
    generateDailyTodos(platform),
    generateRevenueTasks(platform),
    loadChatterStats(platform),
    loadRoiMultipliers(platform),
    loadAccountFitMatrix(platform),
    supabase.auth.getUser().then(({ data }) =>
      data.user
        ? supabase
            .from("models")
            .select("model_name, follower_count")
            .eq("user_id", data.user.id)
            .ilike("platform", platform)
        : { data: [] as { model_name: string; follower_count: number }[] }
    ),
  ]);
  const { stats, importanceFor } = statsBundle;

  // followers-Map für Potential-Detector
  const followersByAcc = new Map<string, number>();
  for (const m of (modelsRes.data ?? []) as { model_name: string; follower_count: number }[]) {
    if (!m.model_name) continue;
    const k = m.model_name.toLowerCase().trim();
    const v = Number(m.follower_count) || 0;
    if ((followersByAcc.get(k) ?? 0) < v) followersByAcc.set(k, v);
  }

  let potentialSignals: PotentialSignal[] = [];
  try {
    potentialSignals = await generatePotentialSignals(platform, fitMatrix, followersByAcc);
  } catch (e) {
    console.warn("[today-engine] potential detector failed", e);
  }

  // Map alle Sources in ActionSignals
  const signals: {
    chatterName: string | null;
    chatterKey: string | null;
    modelKey: string | null;
    signal: ActionSignal;
    secondary: string | null;
  }[] = [];

  for (const t of todos) {
    const stat = t.chatterName ? stats.get(normalizeChatterName(t.chatterName)) : undefined;
    const est = estimateImpactForTodo(t, stat);
    signals.push({
      chatterName: t.chatterName ?? null,
      chatterKey: t.chatterName ? normalizeChatterName(t.chatterName) : null,
      modelKey: t.modelName ? t.modelName.toLowerCase() : null,
      secondary: t.compareWith ?? null,
      signal: {
        source: "todo",
        kind: t.category,
        title: t.title,
        why: t.why,
        impactEurPerWeek: est.impact != null ? Math.round(est.impact) : null,
        impactReason: est.reason,
        todoKey: t.key,
        modelName: t.modelName ?? null,
        compareWith: t.compareWith ?? null,
      },
    });
  }
  for (const r of revTasks) {
    const stat = r.chatterName ? stats.get(normalizeChatterName(r.chatterName)) : undefined;
    const est = estimateImpactForRevenueTask(r, stat);
    signals.push({
      chatterName: r.chatterName ?? null,
      chatterKey: r.chatterName ? normalizeChatterName(r.chatterName) : null,
      modelKey: r.modelName ? r.modelName.toLowerCase() : null,
      secondary: r.secondaryChatter ?? null,
      signal: {
        source: "revenue",
        kind: r.kind,
        title: r.title,
        why: r.why,
        impactEurPerWeek: est.impact != null ? Math.round(est.impact) : null,
        impactReason: est.reason,
        todoKey: r.key,
        modelName: r.modelName ?? null,
        secondaryChatter: r.secondaryChatter ?? null,
      },
    });
  }

  // Bündeln: Solo-Kinds bleiben einzeln; Single-Chatter-Tasks werden pro Chatter zusammengefasst
  const buckets = new Map<string, {
    chatterName: string | null;
    modelName: string | null;
    secondary: string | null;
    signals: ActionSignal[];
  }>();

  for (const s of signals) {
    const isSolo = SOLO_KINDS.has(s.signal.kind);
    let bundleKey: string;
    if (isSolo || !s.chatterKey) {
      bundleKey = `solo:${s.signal.todoKey}`;
    } else {
      bundleKey = `chatter:${s.chatterKey}`;
    }
    if (!buckets.has(bundleKey)) {
      buckets.set(bundleKey, {
        chatterName: s.chatterName,
        modelName: s.signal.modelName ?? null,
        secondary: s.secondary,
        signals: [],
      });
    } else if (!buckets.get(bundleKey)!.chatterName && s.chatterName) {
      buckets.get(bundleKey)!.chatterName = s.chatterName;
    }
    buckets.get(bundleKey)!.signals.push(s.signal);
  }

  // Build UnifiedActions
  const actions: UnifiedAction[] = [];
  for (const [bundleKey, b] of buckets) {
    const sigs = b.signals;
    const kinds = sigs.map((s) => s.kind);
    const primaryKind = pickPrimaryKind(kinds);
    const totalImpact = sigs.reduce((s, x) => s + (x.impactEurPerWeek ?? 0), 0);
    const chatterKey = b.chatterName ? normalizeChatterName(b.chatterName) : null;
    const stat = chatterKey ? stats.get(chatterKey) : undefined;
    const persistence = stat ? Math.max(stat.weakStreak, Math.min(stat.weakDays, 6)) : 1;
    const importance = b.chatterName ? importanceFor(b.chatterName) : 1.0;

    // Score: impact × importance × (1 + persistence/3) × kind-prio-boost
    const kindBoost = primaryKind === "verzug" || primaryKind === "recovery" ? 1.6
      : primaryKind === "revenue" || primaryKind === "phase" ? 1.3
      : primaryKind === "positive" ? 0.4
      : 1.0;
    const persistenceBoost = 1 + persistence / 3.5;

    // B1 — Peak-Window + jetzt-im-Peak (boostet Score)
    const peakWindow = stat?.peakWindow ?? null;
    const nowHour = new Date().getHours();
    const inPeakNow = !!peakWindow && (
      peakWindow.startHour <= peakWindow.endHour
        ? nowHour >= peakWindow.startHour && nowHour < peakWindow.endHour
        : nowHour >= peakWindow.startHour || nowHour < peakWindow.endHour
    );
    const peakBoost = inPeakNow ? 1.25 : 1.0;

    // B2 — Konfidenz aus sampleSize
    const sample = stat?.sampleSize ?? 0;
    const confidence: "low" | "medium" | "high" =
      sample >= 15 ? "high" : sample >= 5 ? "medium" : "low";

    // B3 — Cost-of-Inaction (nur kritisch/warning, ~40–60% des Wochenhebels)
    const tone = TONE_BY_KIND[primaryKind] ?? "info";
    const coiFactor = tone === "critical" ? 0.55 : tone === "warning" ? 0.35 : 0;
    const costOfInactionEurPerWeek = totalImpact > 0 ? Math.round(totalImpact * coiFactor) : 0;

    // A1 — ROI-Multiplier aus historischen Outcomes
    const roiKey = chatterKey ? `${chatterKey}|${primaryKind}` : null;
    const roiMultiplier = (roiKey && roiMap.get(roiKey)) || 1.0;

    const score = totalImpact * importance * persistenceBoost * kindBoost * peakBoost * roiMultiplier;

    actions.push({
      bundleKey,
      todoKeys: sigs.map((s) => s.todoKey),
      chatterName: b.chatterName,
      modelName: b.modelName,
      secondaryChatter: b.secondary,
      signals: sigs,
      totalImpactEurPerWeek: totalImpact,
      persistence,
      importance,
      score,
      primaryKind,
      tone,
      modelInfo: stat?.modelInfo ?? "",
      peakWindow,
      inPeakNow,
      confidence,
      costOfInactionEurPerWeek,
      roiMultiplier,
    });
  }

  actions.sort((a, b) => b.score - a.score);

  const wins = actions.filter((a) => a.tone === "positive");
  const negatives = actions.filter((a) => a.tone !== "positive");
  const primary = negatives.slice(0, PRIMARY_LIMIT);
  const watchlist = negatives.slice(PRIMARY_LIMIT);
  const totalImpactEurPerWeek = primary.reduce((s, a) => s + a.totalImpactEurPerWeek, 0);

  return { primary, watchlist, wins, totalImpactEurPerWeek };
}

