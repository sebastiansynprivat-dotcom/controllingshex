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
import { fetchAllPaged } from "@/lib/paged";

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

export type ActionSourceKind = TodoCategory | RevenueTaskKind | "potential" | "wakeup";

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
  /** Talent-Karte: erlaubt „Anderer Account"-Button, sperrt diese Kombi 7T */
  rejectAccount?: { riser: string; account: string } | null;
  /** Optionale Metadaten aus der Revenue-Task, z. B. für chronologische Sortierung. */
  meta?: {
    downgradeSince?: string;
  };
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
  /** Für Downgrade-Kandidaten: frühestes Datum, ab dem das Muster gilt (YYYY-MM-DD). */
  downgradeSince: string | null;
}

type TodayEngineResult = {
  primary: UnifiedAction[];
  watchlist: UnifiedAction[];
  wins: UnifiedAction[];
  totalImpactEurPerWeek: number;
};

const TODAY_ENGINE_CACHE_TTL_MS = 45_000;
const todayEngineCache = new Map<string, { ts: number; promise: Promise<TodayEngineResult> }>();

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
  "upgrade",
  "downgrade",
  "phase",
  // Account-only
  "slot",
  "model",
  "mismatch",
  // v3 Potenzial — eigene Karte mit Evidence-Block, nicht in Personenbündel
  "potential",
  // Wins müssen eigenständig bleiben; sonst werden sie von Verzug/Recovery derselben Person verschluckt.
  "positive",
]);

const TONE_BY_KIND: Record<ActionSourceKind, "critical" | "warning" | "info" | "positive"> = {
  verzug: "critical",
  recovery: "critical",
  revenue: "warning",
  activity: "warning",
  phase: "warning",
  mismatch: "warning",
  swap: "info",
  upgrade: "info",
  downgrade: "warning",
  slot: "warning",
  model: "info",
  talent: "info",
  positive: "positive",
  potential: "info",
  wakeup: "info",
};

const KIND_PRIORITY: ActionSourceKind[] = [
  "verzug",
  "recovery",
  "wakeup",
  "revenue",
  "potential",
  "phase",
  "mismatch",
  "activity",
  "slot",
  "swap",
  "upgrade",
  "downgrade",
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

  const [rows, models, hourlyRows] = await Promise.all([
    fetchAllPaged<HistoryRow>((from, to) =>
      supabase
        .from("chatter_history")
        .select("chatter_name, analysis_date, revenue_today, mass_dms, open_chats, response_delay_days, account")
        .eq("user_id", user.id)
        .ilike("platform", platform)
        .gte("analysis_date", since)
        .order("analysis_date", { ascending: false })
        .range(from, to)
    ),
    fetchAllPaged<{ model_name: string; follower_count: number }>((from, to) =>
      supabase
        .from("models")
        .select("model_name, follower_count")
        .eq("user_id", user.id)
        .ilike("platform", platform)
        .range(from, to)
    ),
    fetchAllPaged<{ chatter_name: string; hour: number; revenue: number | null }>((from, to) =>
      supabase
        .from("chatter_hourly_stats")
        .select("chatter_name, hour, revenue")
        .eq("user_id", user.id)
        .ilike("platform", platform)
        .gte("date", sinceHourly)
        .range(from, to)
    ),
  ]);

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
  /** Alle offenen Negativ-/Info-Aktionen, nach höchstem €-Hebel sortiert. */
  primary: UnifiedAction[];
  /** Legacy-Feld: keine künstliche Auslagerung mehr. */
  watchlist: UnifiedAction[];
  /** Wins / proaktive Beobachtungen */
  wins: UnifiedAction[];
  totalImpactEurPerWeek: number;
}

interface WakeupHit {
  chatterName: string;
  chatterKey: string;
  daysSilent: number;
  todayRev: number;
  todayDms: number;
  unreadDelta: number;
  medianRevenue: number;
  sampleSize: number;
}

async function detectWakeups(
  platform: string,
  stats: Map<string, ChatterStats>,
): Promise<WakeupHit[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const today = todayISO();
  const since = isoDaysAgo(4);
  const yesterday = isoDaysAgo(1);

  type HistRow = { chatter_name: string; analysis_date: string; revenue_today: number | null; mass_dms: number | null };
  type LiveTodayRow = { chatter_name: string; revenue: number | null; mass_dms: number | null; unread_chats: number | null };
  type LiveYestRow = { chatter_name: string; unread_chats: number | null };
  const historyRows = await fetchAllPaged<HistRow>((from, to) =>
    supabase
      .from("chatter_history")
      .select("chatter_name, analysis_date, revenue_today, mass_dms")
      .eq("user_id", user.id)
      .ilike("platform", platform)
      .gte("analysis_date", since)
      .range(from, to)
  );

  // Letzter Report = max(analysis_date) im 5T-Fenster — nur Chatter daraus zulassen
  let latestReportDate = "";
  for (const r of historyRows) {
    if (r.analysis_date > latestReportDate) latestReportDate = r.analysis_date;
  }
  const inLatestReport = new Set<string>();
  const liveNames: string[] = [];
  if (latestReportDate) {
    const seen = new Set<string>();
    for (const r of historyRows) {
      if (r.analysis_date === latestReportDate && r.chatter_name) {
        const key = normalizeChatterName(r.chatter_name);
        inLatestReport.add(key);
        if (!seen.has(key)) {
          seen.add(key);
          liveNames.push(r.chatter_name);
        }
      }
    }
  }

  const nameChunks: string[][] = [];
  for (let i = 0; i < liveNames.length; i += 50) {
    nameChunks.push(liveNames.slice(i, i + 50));
  }
  const [liveRows, liveYestRows] = await Promise.all([
    Promise.all(nameChunks.map((names) => fetchAllPaged<LiveTodayRow>((from, to) =>
      supabase
        .from("chatter_history_live")
        .select("chatter_name, revenue, mass_dms, unread_chats")
        .ilike("platform", platform)
        .eq("date", today)
        .in("chatter_name", names)
        .range(from, to)
      , 500))).then((chunks) => chunks.flat()),
    Promise.all(nameChunks.map((names) => fetchAllPaged<LiveYestRow>((from, to) =>
      supabase
        .from("chatter_history_live")
        .select("chatter_name, unread_chats")
        .ilike("platform", platform)
        .eq("date", yesterday)
        .in("chatter_name", names)
        .range(from, to)
      , 500))).then((chunks) => chunks.flat()),
  ]);

  // Per-chatter pro Tag aggregieren
  const byChatterDay = new Map<string, Map<string, { rev: number; dm: number }>>();
  for (const r of historyRows) {
    if (!r.chatter_name) continue;
    const k = normalizeChatterName(r.chatter_name);
    if (!byChatterDay.has(k)) byChatterDay.set(k, new Map());
    const d = byChatterDay.get(k)!.get(r.analysis_date) ?? { rev: 0, dm: 0 };
    d.rev += Number(r.revenue_today) || 0;
    d.dm += r.mass_dms ?? 0;
    byChatterDay.get(k)!.set(r.analysis_date, d);
  }

  // Live heute aggregieren
  const liveToday = new Map<string, { rev: number; dm: number; unread: number }>();
  for (const r of liveRows) {
    if (!r.chatter_name) continue;
    const k = normalizeChatterName(r.chatter_name);
    const cur = liveToday.get(k) ?? { rev: 0, dm: 0, unread: 0 };
    cur.rev += Number(r.revenue) || 0;
    cur.dm += r.mass_dms ?? 0;
    cur.unread += r.unread_chats ?? 0;
    liveToday.set(k, cur);
  }
  const unreadYest = new Map<string, number>();
  for (const r of liveYestRows) {
    if (!r.chatter_name) continue;
    const k = normalizeChatterName(r.chatter_name);
    unreadYest.set(k, (unreadYest.get(k) ?? 0) + (r.unread_chats ?? 0));
  }

  const silentDays = [1, 2, 3, 4].map(isoDaysAgo);
  const hits: WakeupHit[] = [];

  for (const [k, stat] of stats) {
    if (stat.sampleSize < 1 || stat.medianRevenue <= 0) continue; // Brand-Neue raus
    if (!inLatestReport.has(k)) continue; // Nur Chatter aus dem letzten Report

    const days = byChatterDay.get(k);
    let silent = 0;
    for (const d of silentDays) {
      const entry = days?.get(d);
      if (!entry || (entry.rev === 0 && entry.dm === 0)) silent++;
      else break; // Lücke unterbrochen
    }
    if (silent < 4) continue;

    // Heute-Aktivität
    const todayHist = days?.get(today) ?? { rev: 0, dm: 0 };
    const live = liveToday.get(k) ?? { rev: 0, dm: 0, unread: 0 };
    const todayRev = Math.max(todayHist.rev, live.rev);
    const todayDms = Math.max(todayHist.dm, live.dm);
    const unreadY = unreadYest.get(k) ?? 0;
    const unreadDelta = unreadY > 0 ? unreadY - live.unread : 0;

    const awake = todayRev > 0 || todayDms > 0 || unreadDelta >= 3;
    if (!awake) continue;

    // Original chatter_name aus history holen (Capitalisierung)
    let original = k;
    for (const r of historyRows) {
      if (normalizeChatterName(r.chatter_name) === k) { original = r.chatter_name; break; }
    }

    hits.push({
      chatterName: original,
      chatterKey: k,
      daysSilent: silent,
      todayRev,
      todayDms,
      unreadDelta,
      medianRevenue: stat.medianRevenue,
      sampleSize: stat.sampleSize,
    });
  }
  return hits;
}

async function buildTodayActionsUncached(platform: string): Promise<TodayEngineResult> {
  const [todos, revTasks, statsBundle, roiMap, fitMatrix, modelsRes] = await Promise.all([
    generateDailyTodos(platform),
    generateRevenueTasks(platform),
    loadChatterStats(platform),
    loadRoiMultipliers(platform),
    loadAccountFitMatrix(platform),
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return { data: [] as { model_name: string; follower_count: number }[] };
      const rows = await fetchAllPaged<{ model_name: string; follower_count: number }>((from, to) =>
        supabase
          .from("models")
          .select("model_name, follower_count")
          .eq("user_id", data.user!.id)
          .ilike("platform", platform)
          .range(from, to)
      );
      return { data: rows };
    }),

  ]);
  const { stats, importanceFor } = statsBundle;

  // === Live-Snapshot (chatter_history_live) für Refresh-Layer ===
  // Nimmt pro Chatter den neuesten vorhandenen Echtzeit-Snapshot. Kein Datumsfenster:
  // die Detailansicht zeigt denselben Snapshot, deshalb muss Today dieselbe Wahrheit nutzen.
  type LiveSnap = { rev: number; dm: number; unread: number; oldest: number; updatedAt: number };
  const liveSnap = new Map<string, LiveSnap>();
  try {
    type Row = { chatter_name: string; date: string; revenue: number | null; mass_dms: number | null; unread_chats: number | null; oldest_chat: number | null; updated_at: string | null };
    const relevantNames = Array.from(new Set(
      [...todos.map((t) => t.chatterName), ...revTasks.map((r) => r.chatterName)]
        .filter((name): name is string => Boolean(name)),
    ));
    const nameChunks: string[][] = [];
    for (let i = 0; i < relevantNames.length; i += 50) {
      nameChunks.push(relevantNames.slice(i, i + 50));
    }
    const liveRows = (
      await Promise.all(nameChunks.map((names) => fetchAllPaged<Row>((from, to) =>
        supabase
          .from("chatter_history_live")
          .select("chatter_name, date, revenue, mass_dms, unread_chats, oldest_chat, updated_at")
          .ilike("platform", platform)
          .in("chatter_name", names)
          .range(from, to)
        , 500)))
    ).flat();
    const sorted = [...liveRows].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
    });
    // Aggregation: nehme die neueste Zeile pro Chatter (entspricht today-bevorzugt, sonst gestern).
    // Falls für denselben Chatter & date mehrere Zeilen existieren (mehrere telegram_id), summieren wir
    // innerhalb des neuesten Datums.
    const newestDateByChatter = new Map<string, string>();
    for (const r of sorted) {
      if (!r.chatter_name) continue;
      const k = normalizeChatterName(r.chatter_name);
      if (!newestDateByChatter.has(k)) newestDateByChatter.set(k, r.date);
      if (newestDateByChatter.get(k) !== r.date) continue; // nur Zeilen des neuesten Datums berücksichtigen
      const cur = liveSnap.get(k) ?? { rev: 0, dm: 0, unread: 0, oldest: 0, updatedAt: 0 };
      cur.rev += Number(r.revenue) || 0;
      cur.dm += r.mass_dms ?? 0;
      cur.unread += r.unread_chats ?? 0;
      cur.oldest = Math.max(cur.oldest, Number(r.oldest_chat) || 0);
      const upd = r.updated_at ? new Date(r.updated_at).getTime() : 0;
      if (upd > cur.updatedAt) cur.updatedAt = upd;
      liveSnap.set(k, cur);
    }
  } catch (e) {
    console.warn("[today-engine] live snapshot failed", e);
  }


  function refreshWhy(kind: ActionSourceKind, chatterKey: string | null, why: string, meta?: Record<string, any>): string {
    if (!chatterKey) return why;
    const live = liveSnap.get(chatterKey);
    if (!live) return why;
    const parts: string[] = [];
    if (meta?.todayOpenChats != null && live.unread !== Number(meta.todayOpenChats)) {
      parts.push(`${live.unread} offen`);
    }
    if ((kind === "verzug" || meta?.delayDays != null) && Math.abs(live.oldest - Number(meta?.delayDays ?? 0)) >= 1) {
      parts.push(`ältester ${Math.round(live.oldest)}T`);
    }
    if (kind === "revenue" && meta?.todayRevenue != null && Math.abs(live.rev - Number(meta.todayRevenue)) >= 5) {
      parts.push(`${Math.round(live.rev)}€`);
    }
    if (kind === "activity" && meta?.todayMassDms != null && live.dm !== Number(meta.todayMassDms)) {
      parts.push(`${live.dm} DMs`);
    }
    if (parts.length === 0) return why;
    return `${why} (live jetzt: ${parts.join(" · ")})`;
  }

  /** Ersetzt veraltete Snapshot-Zahlen im Title (z.B. "X offene Chats", "X Tage Verzug") durch Live-Werte. */
  function refreshTitle(chatterKey: string | null, title: string, meta?: Record<string, any>): string {
    if (!chatterKey) return title;
    const live = liveSnap.get(chatterKey);
    if (!live) return title;
    let out = title;
    // "X offene Chats"
    if (/\b\d+\s+offene Chats\b/.test(out)) {
      out = out.replace(/\b\d+\s+offene Chats\b/, `${live.unread} offene Chats`);
    }
    // "X Tage Verzug" — nur ersetzen, wenn signifikant abweichend (≥1 Tag).
    const verzugMatch = out.match(/\b(\d+)\s+Tage?\s+Verzug\b/);
    if (verzugMatch) {
      const snapDelay = Number(verzugMatch[1]);
      const liveDelay = Math.round(live.oldest);
      if (Math.abs(snapDelay - liveDelay) >= 1) {
        out = out.replace(/\b\d+\s+Tage?\s+Verzug\b/, `${liveDelay} Tage Verzug`);
      }
    }
    return out;
  }

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
    const chatterKey = t.chatterName ? normalizeChatterName(t.chatterName) : null;
    const est = estimateImpactForTodo(t, stat);
    const why = refreshWhy(t.category, chatterKey, t.why, t.meta);
    signals.push({
      chatterName: t.chatterName ?? null,
      chatterKey,
      modelKey: t.modelName ? t.modelName.toLowerCase() : null,
      secondary: t.compareWith ?? null,
      signal: {
        source: "todo",
        kind: t.category,
        title: refreshTitle(chatterKey, t.title, t.meta),
        why,
        impactEurPerWeek: est.impact != null ? Math.round(est.impact) : null,
        impactReason: est.reason,
        todoKey: t.key,
        modelName: t.modelName ?? null,
        compareWith: t.compareWith ?? null,
        rejectAccount: t.category === "talent" && t.meta?.rejectAccountRiser && t.meta?.rejectAccountName
          ? { riser: t.meta.rejectAccountRiser, account: t.meta.rejectAccountName }
          : null,
      },
    });
  }
  for (const r of revTasks) {
    const stat = r.chatterName ? stats.get(normalizeChatterName(r.chatterName)) : undefined;
    const chatterKey = r.chatterName ? normalizeChatterName(r.chatterName) : null;
    const est = estimateImpactForRevenueTask(r, stat);
    let impact = est.impact != null ? Math.round(est.impact) : null;
    let why = r.why;
    let evidence: EvidenceRow[] | undefined;

    // Account-Tausch: keine Fit-Matrix-Gegenprüfung mehr (Engine entscheidet selbst)


    signals.push({
      chatterName: r.chatterName ?? null,
      chatterKey: r.chatterName ? normalizeChatterName(r.chatterName) : null,
      modelKey: r.modelName ? r.modelName.toLowerCase() : null,
      secondary: r.secondaryChatter ?? null,
      signal: {
        source: "revenue",
        kind: r.kind,
        title: r.title,
        why,
        impactEurPerWeek: impact,
        impactReason: est.reason,
        todoKey: r.key,
        modelName: r.modelName ?? null,
        secondaryChatter: r.secondaryChatter ?? null,
        evidence,
        meta: r.meta,
      },
    });
  }

  // v3 — Potenzial-Signale (Hidden Star, Wrong Fit, Riser) als eigene Karten
  for (const p of potentialSignals) {
    const stat = stats.get(normalizeChatterName(p.chatterName));
    const med = stat?.medianRevenue ?? 0;
    const cap = (v: number) => (med > 0 ? Math.min(v, med * 14) : v);
    const impact = Math.round(cap(p.impactEurPerWeek));
    signals.push({
      chatterName: p.chatterName,
      chatterKey: normalizeChatterName(p.chatterName),
      modelKey: p.modelName ? p.modelName.toLowerCase() : null,
      secondary: p.secondaryChatter,
      signal: {
        source: "potential",
        kind: "potential",
        title: p.title,
        why: p.why,
        impactEurPerWeek: impact,
        impactReason: p.impactReason,
        todoKey: p.todoKey,
        modelName: p.modelName,
        secondaryChatter: p.secondaryChatter,
        evidence: p.evidence,
      },
    });
  }

  // Wake-Up Signale: Chatter waren ≥4T still und sind heute wieder aktiv
  try {
    const wakeups = await detectWakeups(platform, stats);
    for (const w of wakeups) {
      const cap = w.medianRevenue > 0 ? w.medianRevenue * 14 : Infinity;
      const impact = Math.round(Math.min(cap, w.medianRevenue * 7 * 0.5));
      const parts: string[] = [];
      if (w.todayRev > 0) parts.push(`${fmtE(w.todayRev)} €`);
      if (w.todayDms > 0) parts.push(`${w.todayDms} Mass-DMs`);
      if (w.unreadDelta >= 3) parts.push(`${w.unreadDelta} Chats abgebaut`);
      const activity = parts.length > 0 ? parts.join(" · ") : "wieder online";
      signals.push({
        chatterName: w.chatterName,
        chatterKey: w.chatterKey,
        modelKey: null,
        secondary: null,
        signal: {
          source: "revenue",
          kind: "wakeup",
          title: `Wieder aktiv nach ${w.daysSilent} Tagen`,
          why: `War ${w.daysSilent} Tage still — heute ${activity}. Jetzt 30 s reinrufen, bevor wieder Funk weg.`,
          impactEurPerWeek: impact > 0 ? impact : null,
          impactReason: impact > 0 ? `Median ${fmtE(w.medianRevenue)} €/Tag × 7 × 50 % Rückgewinn` : "Zu wenig Historie",
          todoKey: `wakeup:${w.chatterKey}:${todayISO()}`,
          modelName: null,
        },
      });
    }
  } catch (e) {
    console.warn("[today-engine] wakeup detector failed", e);
  }

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
      : primaryKind === "potential" ? 1.4
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

    const downgradeSince = sigs
      .map((s) => s.meta?.downgradeSince)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;

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
      downgradeSince,
    });
  }

  actions.sort((a, b) => b.score - a.score);

  const wins = actions.filter((a) => a.tone === "positive");
  const talents = actions.filter((a) => a.tone !== "positive" && a.primaryKind === "talent");
  const negatives = actions.filter((a) => a.tone !== "positive" && a.primaryKind !== "talent");
  const primary = [...negatives, ...talents].sort((a, b) => b.score - a.score);
  const watchlist: UnifiedAction[] = [];
  const totalImpactEurPerWeek = primary.reduce((s, a) => s + a.totalImpactEurPerWeek, 0);

  return { primary, watchlist, wins, totalImpactEurPerWeek };
}

export async function buildTodayActions(platform: string): Promise<TodayEngineResult> {
  const key = platform.toLowerCase().trim();
  const cached = todayEngineCache.get(key);
  if (cached && Date.now() - cached.ts < TODAY_ENGINE_CACHE_TTL_MS) return cached.promise;

  const promise = buildTodayActionsUncached(platform).catch((error) => {
    todayEngineCache.delete(key);
    throw error;
  });
  todayEngineCache.set(key, { ts: Date.now(), promise });
  return promise;
}

