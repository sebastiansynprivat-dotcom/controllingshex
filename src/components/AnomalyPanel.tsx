/**
 * Wiederverwendbares Auffälligkeiten-Panel mit Zeitraumfilter.
 *
 * Wird im Dashboard, in der dedizierten Auffälligkeiten-Page und im
 * Swipe-Mode verwendet — alle synchron via `onAnomalyDismissed`.
 *
 * Abhaken (✓) gilt **bis zum nächsten Report** (per `report_id`-Bindung).
 */
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ChevronUp, RotateCcw, Users, TrendingDown, ClipboardCheck, FileText, Video, Flame, Sparkles, SlidersHorizontal, X, Clock, AlertTriangle } from "lucide-react";
import { loadActiveSnoozes, snoozeChatterUntilTomorrow, unsnoozeChatter, buildSnoozedChatterSet, type AnomalySnooze } from "@/lib/anomaly-snooze";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import TimeRangeToggle from "@/components/TimeRangeToggle";
import {
  buildTimeRange,
  rangeLabel,
  rangeDays,
  type TimeRange,
} from "@/lib/timerange-categorize";
import {
  computeAnomaliesForWindow,
  loadActiveReportId,
  dismissAnomaly,
  dismissChatter,
  ANOMALY_LABELS,
  SEVERITY_STYLE,
  isPositiveAnomaly,
  type ChatterAnomaly,
} from "@/lib/anomaly-window";
import {
  estimateDailyImpactEur,
} from "@/lib/anomaly-actions";
import { emitAnomalyDismissed, onAnomalyDismissed, onChatterDataUpdated, onChatterLabelsUpdated } from "@/lib/data-events";
import { loadChatterLabels, loadLabelAssignments, type ChatterLabel } from "@/lib/chatter-labels";
import { normalizeChatterName, loadActiveChatterNames } from "@/lib/active-chatters";
import AnomalyDetailModal from "@/components/AnomalyDetailModal";
import { useAnomalyTray, TRAY_DRAG_MIME } from "@/hooks/use-anomaly-tray";

const SNAPSHOT_VERSION = 5;
const PAGE_SIZE = 1000;

/** Heute-Style Glow + Pill pro Severity — verleiht Karten Premium-Tiefe. */
const SEVERITY_GLOW: Record<string, { glow: string; pill: string; accent: string; dotShadow: string }> = {
  critical: {
    glow: "from-red-500/12 via-red-500/[0.035]",
    pill: "border-red-400/30 bg-red-500/[0.08] text-red-200",
    accent: "text-red-300",
    dotShadow: "shadow-[0_0_8px_rgba(239,68,68,0.5)]",
  },
  high: {
    glow: "from-orange-500/11 via-orange-500/[0.03]",
    pill: "border-orange-400/30 bg-orange-500/[0.07] text-orange-200",
    accent: "text-orange-300",
    dotShadow: "shadow-[0_0_8px_rgba(251,146,60,0.45)]",
  },
  medium: {
    glow: "from-amber-500/10 via-amber-500/[0.03]",
    pill: "border-amber-400/25 bg-amber-500/[0.06] text-amber-200",
    accent: "text-amber-300",
    dotShadow: "shadow-[0_0_8px_rgba(245,158,11,0.4)]",
  },
  info: {
    glow: "from-sky-500/9 via-sky-500/[0.025]",
    pill: "border-sky-400/25 bg-sky-500/[0.06] text-sky-200",
    accent: "text-sky-300",
    dotShadow: "shadow-[0_0_8px_rgba(56,189,248,0.35)]",
  },
  positive: {
    glow: "from-emerald-500/10 via-emerald-500/[0.03]",
    pill: "border-emerald-400/25 bg-emerald-500/[0.06] text-emerald-200",
    accent: "text-emerald-300",
    dotShadow: "shadow-[0_0_8px_rgba(16,185,129,0.4)]",
  },
};


async function loadAllTimeRevenueRows(userId: string, platform: string) {
  const rows: { chatter_name: string; revenue_today: number | null; analysis_date: string }[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("chatter_history")
      .select("chatter_name, revenue_today, analysis_date")
      .eq("user_id", userId)
      .eq("platform", platform)
      .order("analysis_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

interface Props {
  platform: string;
  /** Default time range. */
  defaultRange?: TimeRange;
  /** Compact: less padding, smaller text — used in dashboard. */
  variant?: "default" | "compact" | "today";
  /** Click on a chatter row. */
  onChatterSelect?: (name: string) => void;
  /** Optional limit when compact, with "show more" toggle. */
  compactInitialCount?: number;
  /** Hide the time range controls (used when controlled externally). */
  hideTimeControls?: boolean;
  /** Externally controlled range (overrides internal state when set). */
  range?: TimeRange;
  onRangeChange?: (range: TimeRange) => void;
  /** Force a specific mode and hide the internal mode toggle (Vergleich-Modus). */
  forcedMode?: "problems" | "highlights";
}

export default function AnomalyPanel({
  platform,
  defaultRange,
  variant = "default",
  onChatterSelect,
  compactInitialCount = 5,
  hideTimeControls = false,
  range: rangeProp,
  onRangeChange,
  forcedMode,
}: Props) {
  const { user } = useAuth();
  const tray = useAnomalyTray();
  const [internalRange, setInternalRange] = useState<TimeRange>(
    () => defaultRange ?? buildTimeRange("7d"),
  );
  const range = rangeProp ?? internalRange;
  const setRange = onRangeChange ?? setInternalRange;

  const sourceIdRef = useRef<string>(`ap-${Math.random().toString(36).slice(2, 10)}`);

  // Cache-Key für Snapshot in sessionStorage (überlebt PWA Background / Tab-Wechsel).
  const cacheKey = useMemo(() => {
    const fromIso = String(range.from).slice(0, 10);
    const toIso = String(range.to).slice(0, 10);
    return `anomaly-snapshot::${platform}::${fromIso}::${toIso}`;
  }, [platform, range]);

  type Snapshot = {
    version: number;
    anomalies: ChatterAnomaly[];
    peerAvg: number;
    totalChattersInRange: number;
    modelFollowers: [string, number][];
    chatterAccounts: [string, string[]][];
    reportId: string | null;
    // Controlling-Erweiterungen
    lastChecks: [string, string][];        // chatter -> ISO date
    lastNotes: [string, { date: string; snippet: string }][];
    lastCoachings: [string, string][];     // chatter -> ISO timestamp
    categorySince: [string, { since: string; category: string }][];
    prevWindowAvg: [string, number][];     // chatter -> avg eur/day in previous window
    allTimeAvg: [string, number][];        // chatter -> avg eur/day across full history
    firstSeen?: [string, string][];        // chatter -> earliest analysis_date (ISO)
    savedAt: number;
  };

  const loadSnapshot = (key: string): Snapshot | null => {
    if (typeof sessionStorage === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const snap = JSON.parse(raw) as Snapshot;
      return snap.version === SNAPSHOT_VERSION ? snap : null;
    } catch { return null; }
  };

  const initialSnap = typeof window !== "undefined" ? loadSnapshot(cacheKey) : null;

  const [loading, setLoading] = useState(!initialSnap);
  const [anomalies, setAnomalies] = useState<ChatterAnomaly[]>(initialSnap?.anomalies ?? []);
  const [reportId, setReportId] = useState<string | null>(initialSnap?.reportId ?? null);
  const [expanded, setExpanded] = useState(false);
  const [internalMode, setInternalMode] = useState<"problems" | "highlights">(() => {
    if (typeof sessionStorage === "undefined") return "problems";
    try {
      const stored = sessionStorage.getItem("anomalies.mode");
      return stored === "highlights" ? "highlights" : "problems";
    } catch { return "problems"; }
  });
  const mode: "problems" | "highlights" = forcedMode ?? internalMode;
  const setMode = setInternalMode;
  useEffect(() => {
    if (forcedMode) return;
    try { sessionStorage.setItem("anomalies.mode", internalMode); } catch { /* noop */ }
  }, [internalMode, forcedMode]);

  // Range-Filter pro Panel (Follower & Ø Lifetime-Tagesumsatz)
  type RangeFilters = { followerMin: number | null; followerMax: number | null; revMin: number | null; revMax: number | null };
  const FILTERS_KEY = `anomalies.filters.${forcedMode ?? "single"}`;
  const loadFilters = (): RangeFilters => {
    if (typeof sessionStorage === "undefined") return { followerMin: null, followerMax: null, revMin: null, revMax: null };
    try {
      const raw = sessionStorage.getItem(FILTERS_KEY);
      if (!raw) return { followerMin: null, followerMax: null, revMin: null, revMax: null };
      const p = JSON.parse(raw);
      return {
        followerMin: typeof p.followerMin === "number" ? p.followerMin : null,
        followerMax: typeof p.followerMax === "number" ? p.followerMax : null,
        revMin: typeof p.revMin === "number" ? p.revMin : null,
        revMax: typeof p.revMax === "number" ? p.revMax : null,
      };
    } catch { return { followerMin: null, followerMax: null, revMin: null, revMax: null }; }
  };
  const [filters, setFiltersRaw] = useState<RangeFilters>(() => loadFilters());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const setFilters = (f: RangeFilters) => {
    setFiltersRaw(f);
    try { sessionStorage.setItem(FILTERS_KEY, JSON.stringify(f)); } catch { /* noop */ }
  };
  const activeFilterCount =
    (filters.followerMin != null && filters.followerMin > 0 ? 1 : 0) +
    (filters.followerMax != null && filters.followerMax > 0 ? 1 : 0) +
    (filters.revMin != null && filters.revMin > 0 ? 1 : 0) +
    (filters.revMax != null && filters.revMax > 0 ? 1 : 0);
  const resetFilters = () => setFilters({ followerMin: null, followerMax: null, revMin: null, revMax: null });

  const [pendingDismiss, setPendingDismiss] = useState<Set<string>>(new Set());


  const [peerAvg, setPeerAvg] = useState(initialSnap?.peerAvg ?? 0);
  const [detailAnomaly, setDetailAnomaly] = useState<ChatterAnomaly | null>(null);
  const [modelFollowers, setModelFollowers] = useState<Map<string, number>>(
    () => new Map(initialSnap?.modelFollowers ?? []),
  );
  const [chatterAccounts, setChatterAccounts] = useState<Map<string, string[]>>(
    () => new Map(initialSnap?.chatterAccounts ?? []),
  );
  const [totalChattersInRange, setTotalChattersInRange] = useState(
    initialSnap?.totalChattersInRange ?? 0,
  );

  // Controlling-Daten
  const [lastChecks, setLastChecks] = useState<Map<string, string>>(
    () => new Map(initialSnap?.lastChecks ?? []),
  );
  const [lastNotes, setLastNotes] = useState<Map<string, { date: string; snippet: string }>>(
    () => new Map(initialSnap?.lastNotes ?? []),
  );
  const [lastCoachings, setLastCoachings] = useState<Map<string, string>>(
    () => new Map(initialSnap?.lastCoachings ?? []),
  );
  const [categorySince, setCategorySince] = useState<Map<string, { since: string; category: string }>>(
    () => new Map(initialSnap?.categorySince ?? []),
  );
  const [prevWindowAvg, setPrevWindowAvg] = useState<Map<string, number>>(
    () => new Map(initialSnap?.prevWindowAvg ?? []),
  );
  const [allTimeAvg, setAllTimeAvg] = useState<Map<string, number>>(
    () => new Map(initialSnap?.allTimeAvg ?? []),
  );
  const [firstSeen, setFirstSeen] = useState<Map<string, string>>(
    () => new Map(initialSnap?.firstSeen ?? []),
  );

  // Chatter-Labels (live-synchronisiert mit SlideOver)
  const [chatterLabels, setChatterLabels] = useState<ChatterLabel[]>([]);
  const [labelAssignmentRows, setLabelAssignmentRows] = useState<{ label_id: string; chatter_key: string }[]>([]);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      const [lbls, asgs] = await Promise.all([
        loadChatterLabels(platform),
        loadLabelAssignments(platform),
      ]);
      if (cancel) return;
      setChatterLabels(lbls);
      setLabelAssignmentRows(asgs.map((a) => ({ label_id: a.label_id, chatter_key: a.chatter_key })));
    };
    load();
    const off = onChatterLabelsUpdated(() => { load(); });
    return () => { cancel = true; off(); };
  }, [platform]);

  // Aktive Chatter (im neuesten Report) — Auffälligkeiten von "rausgeflogenen" Chattern ausblenden
  const [activeChatterNames, setActiveChatterNames] = useState<Set<string> | null>(null);
  useEffect(() => {
    let cancel = false;
    const load = async () => {
      const names = await loadActiveChatterNames(platform);
      if (!cancel) setActiveChatterNames(names);
    };
    load();
    const off = onChatterDataUpdated(() => { load(); });
    return () => { cancel = true; off(); };
  }, [platform]);

  // Snoozes — nur relevant für variant="today", aber überall geladen für Uhr-Marker.
  const [snoozes, setSnoozes] = useState<AnomalySnooze[]>([]);
  const reloadSnoozes = useCallback(async () => {
    if (!user) return;
    const rows = await loadActiveSnoozes(user.id, platform);
    setSnoozes(rows);
  }, [user, platform]);
  useEffect(() => { reloadSnoozes(); }, [reloadSnoozes]);
  const snoozedSet = useMemo(() => buildSnoozedChatterSet(snoozes), [snoozes]);
  const isSnoozed = useCallback(
    (name: string) => snoozedSet.has(normalizeChatterName(name)),
    [snoozedSet],
  );

  const handleSnoozeChatter = async (name: string) => {
    if (!user) return;
    // optimistisch
    setSnoozes((prev) => [
      ...prev,
      {
        id: `tmp-${Date.now()}`,
        chatter_name: name,
        alert_type: null,
        snoozed_until: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      },
    ]);
    try {
      await snoozeChatterUntilTomorrow({ userId: user.id, platform, chatterName: name });
      toast.success(`„${name}" bis morgen ausgeblendet`);
      await reloadSnoozes();
    } catch (err) {
      console.error("[AnomalyPanel] snooze failed:", err);
      toast.error("Snooze fehlgeschlagen");
      await reloadSnoozes();
    }
  };

  const handleUnsnoozeChatter = async (name: string) => {
    if (!user) return;
    setSnoozes((prev) => prev.filter((s) => s.chatter_name !== name));
    try {
      await unsnoozeChatter({ userId: user.id, platform, chatterName: name });
      await reloadSnoozes();
    } catch (err) {
      console.error("[AnomalyPanel] unsnooze failed:", err);
      await reloadSnoozes();
    }
  };


  const labelsByChatter = useMemo(() => {
    const labelById = new Map(chatterLabels.map((l) => [l.id, l]));
    const m = new Map<string, ChatterLabel[]>();
    for (const a of labelAssignmentRows) {
      const lbl = labelById.get(a.label_id);
      if (!lbl) continue;
      const arr = m.get(a.chatter_key) ?? [];
      arr.push(lbl);
      m.set(a.chatter_key, arr);
    }
    return m;
  }, [chatterLabels, labelAssignmentRows]);


  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const rid = await loadActiveReportId(user.id, platform);
    setReportId(rid);
    const fromIso = String(range.from).slice(0, 10);
    const toIso = String(range.to).slice(0, 10);
    const days = Math.max(1, rangeDays(range));
    // Vorperioden-Fenster (gleiche Länge direkt davor)
    const prevTo = new Date(new Date(fromIso).getTime() - 86_400_000);
    const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
    const prevFromIso = prevFrom.toISOString().slice(0, 10);
    const prevToIso = prevTo.toISOString().slice(0, 10);

    const [result, modelsRes, accountsRes, totalRes, prevHistRes, checksRes, notesRes, coachingsRes, catStateRes, allTimeRows] = await Promise.all([
      computeAnomaliesForWindow(user.id, platform, range, rid),
      supabase
        .from("models")
        .select("model_name, follower_count")
        .eq("user_id", user.id)
        .eq("platform", platform),
      supabase
        .from("chatter_history")
        .select("chatter_name, account, analysis_date")
        .eq("user_id", user.id)
        .eq("platform", platform)
        .not("account", "is", null)
        .order("analysis_date", { ascending: false })
        .limit(2000),
      supabase
        .from("chatter_history")
        .select("chatter_name")
        .eq("user_id", user.id)
        .eq("platform", platform)
        .gte("analysis_date", fromIso)
        .lte("analysis_date", toIso)
        .limit(5000),
      supabase
        .from("chatter_history")
        .select("chatter_name, revenue_today")
        .eq("user_id", user.id)
        .eq("platform", platform)
        .gte("analysis_date", prevFromIso)
        .lte("analysis_date", prevToIso)
        .limit(5000),
      supabase
        .from("daily_chatter_checks")
        .select("chatter_name, check_date")
        .eq("user_id", user.id)
        .eq("platform", platform)
        .order("check_date", { ascending: false })
        .limit(2000),
      supabase
        .from("coaching_notes")
        .select("chatter_name, note_text, created_at")
        .eq("user_id", user.id)
        .eq("platform", platform)
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase
        .from("video_coachings")
        .select("chatter_name, sent_at")
        .eq("user_id", user.id)
        .eq("platform", platform)
        .order("sent_at", { ascending: false })
        .limit(2000),
      supabase
        .from("chatter_category_state")
        .select("chatter_name, current_category, since_date")
        .eq("user_id", user.id)
        .eq("platform", platform),
      loadAllTimeRevenueRows(user.id, platform),
    ]);
    setAnomalies(result.anomalies);
    setPeerAvg(result.peerAvgRevenuePerDay);

    const uniq = new Set<string>();
    for (const r of totalRes.data ?? []) uniq.add(r.chatter_name);
    setTotalChattersInRange(uniq.size);

    const fmap = new Map<string, number>();
    for (const m of modelsRes.data ?? []) {
      fmap.set(m.model_name.toLowerCase().trim(), Number(m.follower_count ?? 0));
    }
    setModelFollowers(fmap);

    const amap = new Map<string, string[]>();
    for (const row of accountsRes.data ?? []) {
      if (amap.has(row.chatter_name)) continue;
      const accs = String(row.account)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (accs.length > 0) amap.set(row.chatter_name, accs);
    }
    setChatterAccounts(amap);

    // Letzte Aktivität — first occurrence wins (Daten kommen sortiert DESC)
    const cmap = new Map<string, string>();
    for (const row of checksRes.data ?? []) {
      if (!cmap.has(row.chatter_name)) cmap.set(row.chatter_name, row.check_date);
    }
    setLastChecks(cmap);

    const nmap = new Map<string, { date: string; snippet: string }>();
    for (const row of notesRes.data ?? []) {
      if (nmap.has(row.chatter_name)) continue;
      const text = String(row.note_text ?? "").trim();
      const snippet = text.length > 80 ? text.slice(0, 80) + "…" : text;
      nmap.set(row.chatter_name, { date: row.created_at, snippet });
    }
    setLastNotes(nmap);

    const vmap = new Map<string, string>();
    for (const row of coachingsRes.data ?? []) {
      if (!vmap.has(row.chatter_name)) vmap.set(row.chatter_name, row.sent_at);
    }
    setLastCoachings(vmap);

    const smap = new Map<string, { since: string; category: string }>();
    for (const row of catStateRes.data ?? []) {
      smap.set(row.chatter_name, { since: row.since_date, category: row.current_category });
    }
    setCategorySince(smap);

    // Vorperioden-Ø pro Chatter (Summe / Tage_mit_Eintrag)
    const prevAgg = new Map<string, { sum: number; days: number }>();
    for (const row of prevHistRes.data ?? []) {
      const cur = prevAgg.get(row.chatter_name) ?? { sum: 0, days: 0 };
      cur.sum += Number(row.revenue_today ?? 0);
      cur.days += 1;
      prevAgg.set(row.chatter_name, cur);
    }
    const pmap = new Map<string, number>();
    for (const [name, { sum, days }] of prevAgg) {
      pmap.set(name, days > 0 ? sum / days : 0);
    }
    setPrevWindowAvg(pmap);

    // All-Time Ø pro Chatter (Summe aller Reports / Tage_mit_Eintrag)
    // + erstes Auftauchen (frühestes analysis_date) — Rows kommen ASC sortiert.
    const allAgg = new Map<string, { sum: number; days: number }>();
    const fsmap = new Map<string, string>();
    for (const row of allTimeRows) {
      const cur = allAgg.get(row.chatter_name) ?? { sum: 0, days: 0 };
      cur.sum += Number(row.revenue_today ?? 0);
      cur.days += 1;
      allAgg.set(row.chatter_name, cur);
      if (row.analysis_date && !fsmap.has(row.chatter_name)) {
        fsmap.set(row.chatter_name, String(row.analysis_date).slice(0, 10));
      }
    }
    const atmap = new Map<string, number>();
    for (const [name, { sum, days }] of allAgg) {
      atmap.set(name, days > 0 ? sum / days : 0);
    }
    setAllTimeAvg(atmap);
    setFirstSeen(fsmap);

    // Persist snapshot
    try {
      const snap: Snapshot = {
        version: SNAPSHOT_VERSION,
        anomalies: result.anomalies,
        peerAvg: result.peerAvgRevenuePerDay,
        totalChattersInRange: uniq.size,
        modelFollowers: [...fmap.entries()],
        chatterAccounts: [...amap.entries()],
        reportId: rid,
        lastChecks: [...cmap.entries()],
        lastNotes: [...nmap.entries()],
        lastCoachings: [...vmap.entries()],
        categorySince: [...smap.entries()],
        prevWindowAvg: [...pmap.entries()],
        allTimeAvg: [...atmap.entries()],
        firstSeen: [...fsmap.entries()],
        savedAt: Date.now(),
      };
      sessionStorage.setItem(cacheKey, JSON.stringify(snap));
    } catch { /* quota or unavailable */ }

    setLoading(false);
  }, [user, platform, range, cacheKey]);

  // Mount / range change: nur refreshen wenn kein gültiger Snapshot vorhanden.
  useEffect(() => {
    const snap = loadSnapshot(cacheKey);
    // Migration: alte Snapshots ohne allTimeAvg verwerfen, damit der neue Wert geladen wird.
    if (snap && Array.isArray(snap.allTimeAvg)) {
      setAnomalies(snap.anomalies);
      setPeerAvg(snap.peerAvg);
      setTotalChattersInRange(snap.totalChattersInRange);
      setModelFollowers(new Map(snap.modelFollowers));
      setChatterAccounts(new Map(snap.chatterAccounts));
      setReportId(snap.reportId);
      setLastChecks(new Map(snap.lastChecks ?? []));
      setLastNotes(new Map(snap.lastNotes ?? []));
      setLastCoachings(new Map(snap.lastCoachings ?? []));
      setCategorySince(new Map(snap.categorySince ?? []));
      setPrevWindowAvg(new Map(snap.prevWindowAvg ?? []));
      setAllTimeAvg(new Map(snap.allTimeAvg ?? []));
      setFirstSeen(new Map(snap.firstSeen ?? []));
      setLoading(false);
      return;
    }
    refresh();
  }, [refresh, cacheKey]);

  // Hilfs-Funktion: Snapshot mit aktuellem anomalies-State patchen.
  const patchSnapshotAnomalies = useCallback((next: ChatterAnomaly[]) => {
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (!raw) return;
      const snap = JSON.parse(raw);
      snap.anomalies = next;
      sessionStorage.setItem(cacheKey, JSON.stringify(snap));
    } catch { /* noop */ }
  }, [cacheKey]);

  useEffect(() => {
    const offData = onChatterDataUpdated(() => {
      // Neuer Report → alle Snapshots dieser Plattform invalidieren
      try {
        const prefix = `anomaly-snapshot::${platform}::`;
        const toRemove: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(prefix)) toRemove.push(k);
        }
        toRemove.forEach((k) => sessionStorage.removeItem(k));
      } catch { /* noop */ }
      refresh();
    });
    const offDismiss = onAnomalyDismissed((payload) => {
      if (payload.sourceId === sourceIdRef.current) return;
      if (payload.chatterName) {
        setAnomalies((prev) => {
          const next = prev.filter((x) => {
            if (x.chatter_name !== payload.chatterName) return true;
            if (payload.alertType && x.alert_type !== payload.alertType) return true;
            return false;
          });
          patchSnapshotAnomalies(next);
          return next;
        });
      } else {
        refresh();
      }
    });
    return () => {
      offData();
      offDismiss();
    };
  }, [refresh, platform, patchSnapshotAnomalies]);

  const handleDismiss = async (a: ChatterAnomaly) => {
    if (!user || !reportId) return;
    const key = `${a.chatter_name}|${a.alert_type}`;
    setPendingDismiss((p) => new Set(p).add(key));
    setAnomalies((prev) => {
      const next = prev.filter(
        (x) => !(x.chatter_name === a.chatter_name && x.alert_type === a.alert_type),
      );
      patchSnapshotAnomalies(next);
      return next;
    });
    try {
      await dismissAnomaly({
        userId: user.id,
        platform,
        chatterName: a.chatter_name,
        alertType: a.alert_type,
        reportId,
      });
      emitAnomalyDismissed({
        sourceId: sourceIdRef.current,
        chatterName: a.chatter_name,
        alertType: a.alert_type,
      });
    } catch (err) {
      console.error("[AnomalyPanel] dismiss failed:", err);
      // rollback
      refresh();
    } finally {
      setPendingDismiss((p) => {
        const next = new Set(p);
        next.delete(key);
        return next;
      });
    }
  };

  const handleDismissChatter = async (chatterName: string, items: ChatterAnomaly[]) => {
    if (!user || !reportId || items.length === 0) return;
    const key = `chatter|${chatterName}`;
    setPendingDismiss((p) => new Set(p).add(key));
    setAnomalies((prev) => {
      const next = prev.filter((x) => x.chatter_name !== chatterName);
      patchSnapshotAnomalies(next);
      return next;
    });
    try {
      await dismissChatter({
        userId: user.id,
        platform,
        chatterName,
        alertTypes: items.map((i) => i.alert_type),
        reportId,
      });
      emitAnomalyDismissed({
        sourceId: sourceIdRef.current,
        chatterName,
      });
    } catch (err) {
      console.error("[AnomalyPanel] dismiss chatter failed:", err);
      refresh();
    } finally {
      setPendingDismiss((p) => {
        const next = new Set(p);
        next.delete(key);
        return next;
      });
    }
  };

  const counts = useMemo(() => {
    return {
      critical: anomalies.filter((a) => a.severity === "critical").length,
      high: anomalies.filter((a) => a.severity === "high").length,
      medium: anomalies.filter((a) => a.severity === "medium").length,
      info: anomalies.filter((a) => a.severity === "info").length,
    };
  }, [anomalies]);

  // Gruppiere pro Chatter — alle Critical-Kandidaten + alle Items mit Impact.
  // Sortierung: Geschätzter Umsatz-Impact pro Tag (€) absteigend.
  // Tiebreaker: Follower-Summe, dann Score.
  const windowDays = useMemo(() => rangeDays(range), [range]);
  const { prevPeriodLabel, prevPeriodTooltip } = useMemo(() => {
    const days = Math.max(1, rangeDays(range));
    const fromIso = String(range.from).slice(0, 10);
    const toIso = String(range.to).slice(0, 10);
    const curFrom = new Date(fromIso);
    const curTo = new Date(toIso);
    const prevTo = new Date(curFrom.getTime() - 86_400_000);
    const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
    const fmtShort = (d: Date) => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
    const fmtFull = (d: Date) => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    const label = days === 1 ? fmtShort(prevFrom) : `${fmtShort(prevFrom)}–${fmtShort(prevTo)}`;
    const dayWord = days === 1 ? "Tag" : "Tage";
    const curRange = days === 1 ? fmtFull(curFrom) : `${fmtFull(curFrom)} – ${fmtFull(curTo)}`;
    const prevRange = days === 1 ? fmtFull(prevFrom) : `${fmtFull(prevFrom)} – ${fmtFull(prevTo)}`;
    const tooltip = `Vergleich gleicher Länge (${days} ${dayWord})\nAktuell: ${curRange}\nVorperiode: ${prevRange}`;
    return { prevPeriodLabel: label, prevPeriodTooltip: tooltip };
  }, [range]);
  const groupedByChatter = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        topScore: number;
        topSeverity: ChatterAnomaly["severity"];
        items: ChatterAnomaly[];
        totalFollowers: number;
        impactPerDay: number;
        impactWindow: number;
      }
    >();
    for (const a of anomalies) {
      if (mode === "highlights") {
        if (!isPositiveAnomaly(a.alert_type)) continue;
      } else {
        if (a.severity !== "critical") continue;
      }
      if (activeChatterNames && !activeChatterNames.has(normalizeChatterName(a.chatter_name))) continue;

      const key = a.chatter_name;
      const entry = map.get(key);
      if (entry) {
        entry.items.push(a);
        if (a.score > entry.topScore) {
          entry.topScore = a.score;
          entry.topSeverity = a.severity;
        }
      } else {
        const accs = chatterAccounts.get(a.chatter_name) ?? [];
        const totalFollowers = accs.reduce(
          (s, acc) => s + (modelFollowers.get(acc.toLowerCase().trim()) ?? 0),
          0,
        );
        map.set(key, {
          name: a.chatter_name,
          topScore: a.score,
          topSeverity: a.severity,
          items: [a],
          totalFollowers,
          impactPerDay: 0,
          impactWindow: 0,
        });
      }
    }
    // Impact pro Gruppe berechnen
    for (const entry of map.values()) {
      entry.impactPerDay = estimateDailyImpactEur(entry.items);
      entry.impactWindow = entry.impactPerDay * Math.max(1, windowDays);
    }
    return [...map.values()].sort((a, b) => {
      if (mode === "highlights") {
        if (b.topScore !== a.topScore) return b.topScore - a.topScore;
        return b.totalFollowers - a.totalFollowers;
      }
      if (b.impactPerDay !== a.impactPerDay) return b.impactPerDay - a.impactPerDay;
      if (b.totalFollowers !== a.totalFollowers) return b.totalFollowers - a.totalFollowers;
      return b.topScore - a.topScore;
    });
  }, [anomalies, chatterAccounts, modelFollowers, windowDays, activeChatterNames, mode]);

  const copyName = useCallback(async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      toast.success(`„${name}" kopiert`);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { navigator.vibrate(10); } catch { /* noop */ }
      }
    } catch {
      toast.error("Kopieren fehlgeschlagen");
    }
  }, []);

  // Relative Datums-Helfer
  const relDays = (iso: string | undefined): { days: number; label: string } | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
    if (diff <= 0) return { days: 0, label: "heute" };
    if (diff === 1) return { days: 1, label: "gestern" };
    if (diff < 30) return { days: diff, label: `vor ${diff} Tagen` };
    if (diff < 365) return { days: diff, label: `vor ${Math.round(diff / 7)} Wo.` };
    return { days: diff, label: `vor ${Math.round(diff / 30)} Mon.` };
  };

  const fmtShortDate = (iso: string | undefined): string => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  };

  // Gesamtsumme Impact pro Tag (für Header)
  const totalImpactPerDay = useMemo(
    () => groupedByChatter.reduce((s, g) => s + g.impactPerDay, 0),
    [groupedByChatter],
  );

  const padding = variant === "compact" ? "px-3 sm:px-4 py-3" : "px-4 sm:px-5 py-3 sm:py-4";
  const textSize = variant === "compact" ? "text-[15px]" : "text-[16.5px] sm:text-[17px]";

  const getChatterFollowers = (name: string) => {
    const accs = chatterAccounts.get(name) ?? [];
    let max = 0;
    for (const acc of accs) {
      const f = modelFollowers.get(acc.toLowerCase().trim()) ?? 0;
      if (f > max) max = f;
    }
    return max;
  };
  const fMin = filters.followerMin ?? 0;
  const fMax = filters.followerMax && filters.followerMax > 0 ? filters.followerMax : Infinity;
  const rMin = filters.revMin ?? 0;
  const rMax = filters.revMax && filters.revMax > 0 ? filters.revMax : Infinity;
  const isCompactLike = variant === "compact" || variant === "today";
  const visibleGroups = (isCompactLike && !expanded
    ? groupedByChatter.slice(0, compactInitialCount)
    : groupedByChatter
  ).filter((g) => {
    if (tray.has(g.name)) return false;
    // Im Heute-Tab: gesnoozte Chatter ausblenden (auf /auffaelligkeiten bleiben sie sichtbar).
    if (variant === "today" && isSnoozed(g.name)) return false;
    const fol = getChatterFollowers(g.name);
    if (fol < fMin || fol > fMax) return false;
    const avg = allTimeAvg.get(g.name) ?? 0;
    if (avg < rMin || avg > rMax) return false;
    return true;
  });

  // Split für Heute-Tab: "Neu heute" (< 3 Tage auffällig) vs. "Eskaliert" (≥ 3 Tage).
  const ESCALATION_DAYS = 3;
  const todaySections = useMemo(() => {
    if (variant !== "today") return null;
    const fresh: typeof visibleGroups = [];
    const escalated: typeof visibleGroups = [];
    for (const g of visibleGroups) {
      const since = categorySince.get(g.name);
      const sinceRel = since ? relDays(since.since) : null;
      const days = sinceRel?.days ?? 0;
      if (days >= ESCALATION_DAYS) escalated.push(g);
      else fresh.push(g);
    }
    return { fresh, escalated };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, visibleGroups, categorySince]);

  const snoozedCount = snoozes.filter((s) => !s.alert_type).length;


  // Drop-Handler: Karte aus der Ablage zurück in die Übersicht ziehen.
  const handlePanelDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(TRAY_DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    try {
      const item = JSON.parse(raw) as { name?: string };
      if (item?.name) tray.remove(item.name);
    } catch { /* noop */ }
  };
  const handlePanelDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(TRAY_DRAG_MIME)) e.preventDefault();
  };

  return (
    <div
      onDragOver={handlePanelDragOver}
      onDrop={handlePanelDrop}
      className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.025] to-white/[0.01] overflow-hidden backdrop-blur-sm"
    >
      {/* Header */}
      <div className={`${padding} border-b border-white/[0.04] space-y-3`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <div className="flex items-baseline gap-2 sm:gap-3 min-w-0">
            <div className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-white/40 font-light">
              Auffälligkeiten
            </div>
            <div className="text-[10px] text-white/35 font-light truncate">{rangeLabel(range)}</div>
          </div>
          {!hideTimeControls && (
            <div className="-mx-1 sm:mx-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TimeRangeToggle value={range} onChange={setRange} />
            </div>
          )}
        </div>

        {/* Mode-Toggle: Probleme vs. Highlights (im Vergleich-Modus ausgeblendet) */}
        {!forcedMode && (() => {
          const activeSet = activeChatterNames;
          const problemChatters = new Set<string>();
          const highlightChatters = new Set<string>();
          for (const a of anomalies) {
            if (activeSet && !activeSet.has(normalizeChatterName(a.chatter_name))) continue;
            if (isPositiveAnomaly(a.alert_type)) highlightChatters.add(a.chatter_name);
            else if (a.severity === "critical") problemChatters.add(a.chatter_name);
          }
          const Btn = ({ k, label, count, tone }: { k: "problems" | "highlights"; label: string; count: number; tone: "red" | "emerald" }) => {
            const active = mode === k;
            const activeCls = tone === "red"
              ? "bg-red-500/[0.12] border-red-400/30 text-red-100"
              : "bg-emerald-500/[0.12] border-emerald-400/30 text-emerald-100";
            return (
              <button
                type="button"
                onClick={() => setMode(k)}
                className={cn(
                  "flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-medium uppercase tracking-wider transition-all",
                  active
                    ? activeCls
                    : "border-white/[0.06] bg-white/[0.02] text-white/55 hover:text-white/80 hover:bg-white/[0.04]",
                )}
              >
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  tone === "red" ? "bg-red-400" : "bg-emerald-400",
                )} />
                {label}
                <span className="tabular-nums opacity-70">· {count}</span>
              </button>
            );
          };
          return (
            <div className="flex items-center gap-2">
              <Btn k="problems" label="Probleme" count={problemChatters.size} tone="red" />
              <Btn k="highlights" label="Highlights" count={highlightChatters.size} tone="emerald" />
            </div>
          );
        })()}

        {/* Premium Progress Bar: nur im Probleme-Mode */}
        {mode === "problems" && (() => {
          const criticalChatters = new Set(
            anomalies
              .filter((a) => a.severity === "critical")
              .map((a) => a.chatter_name),
          );
          const flagged = criticalChatters.size;
          const activeCount = activeChatterNames?.size ?? 0;
          const total = activeCount > 0
            ? Math.max(activeCount, groupedByChatter.length)
            : Math.max(totalChattersInRange, groupedByChatter.length);
          const pct = total > 0 ? Math.min(100, (flagged / total) * 100) : 0;
          const tone = "from-red-500/80 via-red-400/70 to-orange-400/70";
          const glow = "shadow-[0_0_18px_-2px_rgba(248,113,113,0.45)]";
          return (
            <div className="space-y-2.5">
              <div className="flex items-end justify-between gap-3 flex-wrap">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-2xl sm:text-3xl font-light tabular-nums text-foreground tracking-tight">
                    {flagged}
                  </span>
                  <span className="text-xs text-white/40 font-light">
                    von {total} {total === 1 ? "Chatter" : "Chattern"} brennt
                  </span>
                </div>
                {totalImpactPerDay > 0 && (
                  <div className="flex items-baseline gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/[0.08] border border-red-500/20">
                    <TrendingDown className="h-3 w-3 text-red-300/80 self-center" />
                    <span className="text-sm font-medium tabular-nums text-red-200">
                      ~{totalImpactPerDay.toLocaleString("de-DE")}€
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-red-200/60 font-light">
                      / Tag offen
                    </span>
                  </div>
                )}
              </div>
              <div className="relative h-1.5 w-full rounded-full bg-white/[0.05] overflow-hidden">
                <motion.div
                  initial={false}
                  animate={{ width: `${pct}%` }}
                  transition={{ type: "spring", stiffness: 140, damping: 22, mass: 0.6 }}
                  className={`h-full rounded-full bg-gradient-to-r ${tone} ${glow}`}
                >
                  <div className="h-full w-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent)] bg-[length:200%_100%] animate-[shimmer_2.4s_linear_infinite]" />
                </motion.div>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-white/35 font-light">
                <span>Sortiert nach Umsatz-Impact</span>
                {counts.critical > 0 && (
                  <span className="flex items-center gap-1 ml-auto">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    {counts.critical} kritisch
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        {/* Highlights-Header: Anzahl Aufwärtssignale */}
        {mode === "highlights" && (
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-2xl sm:text-3xl font-light tabular-nums text-emerald-200 tracking-tight">
                {groupedByChatter.length}
              </span>
              <span className="text-xs text-white/40 font-light">
                {groupedByChatter.length === 1 ? "Chatter im Aufwind" : "Chatter im Aufwind"}
              </span>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-emerald-300/60 font-light">
              Sortiert nach Stärke
            </span>
          </div>
        )}

        {/* Range-Filter: Follower & Ø Lifetime-Tagesumsatz */}
        <div className="rounded-xl border border-white/[0.05] bg-white/[0.015]">
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-white/55 hover:text-white/80 transition-colors"
          >
            <span className="inline-flex items-center gap-1.5">
              <SlidersHorizontal className="h-3 w-3" />
              <span className="uppercase tracking-[0.2em] font-medium">Filter</span>
              {activeFilterCount > 0 && (
                <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-md bg-white/[0.08] text-white/80 text-[10px] tabular-nums">
                  {activeFilterCount} aktiv
                </span>
              )}
            </span>
            <span className="inline-flex items-center gap-2">
              {activeFilterCount > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); resetFilters(); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); resetFilters(); } }}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] text-white/50 hover:text-white/80 hover:bg-white/[0.05]"
                >
                  <X className="h-3 w-3" /> Reset
                </span>
              )}
              {filtersOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </span>
          </button>
          {filtersOpen && (
            <div className="px-3 pb-3 pt-1 space-y-3 border-t border-white/[0.04]">
              {/* Follower */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-white/45 font-medium">Follower (Model)</span>
                  <span className="text-[10px] text-white/35 tabular-nums">
                    {(filters.followerMin ?? 0).toLocaleString("de-DE")} – {filters.followerMax && filters.followerMax > 0 ? filters.followerMax.toLocaleString("de-DE") : "∞"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="Min"
                    value={filters.followerMin ?? ""}
                    onChange={(e) => setFilters({ ...filters, followerMin: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[12px] tabular-nums text-white/85 placeholder:text-white/30 focus:outline-none focus:border-white/20"
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="Max (∞)"
                    value={filters.followerMax ?? ""}
                    onChange={(e) => setFilters({ ...filters, followerMax: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[12px] tabular-nums text-white/85 placeholder:text-white/30 focus:outline-none focus:border-white/20"
                  />
                </div>
              </div>
              {/* Ø Lifetime-Tagesumsatz */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-white/45 font-medium">Ø Tagesumsatz (Lifetime)</span>
                  <span className="text-[10px] text-white/35 tabular-nums">
                    {(filters.revMin ?? 0).toLocaleString("de-DE")}€ – {filters.revMax && filters.revMax > 0 ? filters.revMax.toLocaleString("de-DE") + "€" : "∞"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="Min €"
                    value={filters.revMin ?? ""}
                    onChange={(e) => setFilters({ ...filters, revMin: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[12px] tabular-nums text-white/85 placeholder:text-white/30 focus:outline-none focus:border-white/20"
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="Max € (∞)"
                    value={filters.revMax ?? ""}
                    onChange={(e) => setFilters({ ...filters, revMax: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[12px] tabular-nums text-white/85 placeholder:text-white/30 focus:outline-none focus:border-white/20"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>


      {/* Body */}
      {loading ? (
        <div className="flex items-center gap-2 px-5 py-6 text-xs text-white/40 font-light">
          <div className="h-3 w-3 border border-white/20 border-t-white/60 rounded-full animate-spin" />
          Berechne Auffälligkeiten…
        </div>
      ) : groupedByChatter.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <div className="inline-flex items-center gap-2 text-xs text-white/40 font-light">
            <span className={cn("h-1.5 w-1.5 rounded-full", mode === "highlights" ? "bg-sky-400/70" : "bg-emerald-400/70")} />
            {mode === "highlights"
              ? "Noch keine Highlights im Zeitraum — schau auch in 30 Tage."
              : (activeChatterNames?.size ?? totalChattersInRange) > 0
                ? `Alle ${activeChatterNames?.size ?? totalChattersInRange} Chatter clean.`
                : "Keine Auffälligkeiten im Zeitraum."}
          </div>
        </div>
      ) : (
        <div className={`${variant === "compact" ? "p-2.5 sm:p-3" : "p-3 sm:p-4"} space-y-2.5 sm:space-y-3`}>
          <AnimatePresence initial={false}>
            {visibleGroups.map((group, idx) => {
              const topSev = SEVERITY_STYLE[group.topSeverity];
              const sevGlow = SEVERITY_GLOW[group.topSeverity] ?? SEVERITY_GLOW.info;
              const chatterKey = `chatter|${group.name}`;
              const isPending = pendingDismiss.has(chatterKey);
              const accs = chatterAccounts.get(group.name) ?? [];
              const topItem = group.items[0];
              const topMeta = ANOMALY_LABELS[topItem.alert_type];
              const rank = idx + 1;

              // Controlling-Daten
              const since = categorySince.get(group.name);
              const sinceRel = since ? relDays(since.since) : null;
              const lastCheckRel = relDays(lastChecks.get(group.name));
              const lastNote = lastNotes.get(group.name);
              const lastCoachingRel = relDays(lastCoachings.get(group.name));

              // Zahlen-Trio: All-Time vs. Zeitraum
              const currentAvg = group.items[0]?.metric_value ?? 0;
              const allAvg = allTimeAvg.get(group.name) ?? 0;
              const dropPct = allAvg > 0
                ? Math.round(((currentAvg - allAvg) / allAvg) * 100)
                : null;
              const zeroAlert = group.items.find((a) => a.alert_type === "persistent_zero");
              const zeroDays = zeroAlert ? Math.round(zeroAlert.metric_value) : null;
              const chatterLabelsForGroup = labelsByChatter.get(normalizeChatterName(group.name)) ?? [];

              // "Neu am Start" — wenn Chatter weniger Historie hat als das gewählte Zeitfenster
              const firstSeenIso = firstSeen.get(group.name);
              const firstSeenRel = relDays(firstSeenIso);
              const isNewerThanWindow =
                firstSeenRel != null && windowDays > 1 && firstSeenRel.days + 1 < windowDays;
              const firstSeenDays = firstSeenRel ? Math.max(1, firstSeenRel.days + 1) : 0;

              return (
                <motion.div
                  key={group.name}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
                  transition={{ duration: 0.22, delay: idx * 0.02 }}
                  draggable
                  onDragStart={(e) => {
                    const dt = (e as unknown as React.DragEvent).dataTransfer;
                    if (!dt) return;
                    dt.effectAllowed = "move";
                    dt.setData(
                      TRAY_DRAG_MIME,
                      JSON.stringify({
                        name: group.name,
                        kind: mode === "highlights" ? "highlight" : "problem",
                        severity: group.topSeverity,
                        message: topItem.message,
                        impactPerDay: Math.round(group.impactPerDay),
                      }),
                    );
                  }}
                  className="group relative cursor-grab active:cursor-grabbing"
                >
                  {/* Hintergrund-Glow (Severity) — Heute-Style */}
                  <div
                    className={cn(
                      "absolute -inset-px rounded-2xl bg-gradient-to-b to-transparent opacity-80 pointer-events-none",
                      sevGlow.glow,
                    )}
                  />

                  <div className="relative flex flex-col overflow-hidden rounded-2xl bg-white/[0.025] backdrop-blur-xl border border-white/[0.06] shadow-2xl transition-all duration-300 group-hover:border-white/[0.12] group-hover:bg-white/[0.04] group-hover:-translate-y-px group-hover:shadow-[0_18px_50px_-22px_rgba(0,0,0,0.7)]">

                  {/* Chatter-Header */}
                  <div className={`flex items-start gap-2.5 sm:gap-3 ${variant === "compact" ? "px-4 sm:px-5 py-3" : "px-4 sm:px-5 py-4 sm:py-4.5"}`}>
                    {/* Rank */}
                    <div className="shrink-0 flex flex-col items-center pt-0.5">
                      <span className="text-[9px] uppercase tracking-[0.18em] text-white/25 font-light leading-none">#{rank}</span>

                      <span className="relative flex h-2 w-2 mt-1.5">
                        {group.topSeverity === "critical" && (
                          <span className={`absolute inline-flex h-full w-full rounded-full ${topSev.dot} opacity-60 animate-ping`} />
                        )}
                        <span className={cn("relative inline-flex h-2 w-2 rounded-full", topSev.dot, sevGlow.dotShadow)} />
                      </span>
                    </div>

                    {/* Name + Headline + Stats — Klick öffnet Performance-Profil */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChatterSelect?.(group.name);
                      }}
                      title="Performance-Profil öffnen"
                      className="flex-1 min-w-0 text-left group/name cursor-pointer"
                    >
                      {/* Top row: Name + Impact + Status-Pill + Labels */}
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className={cn(textSize, "text-white/95 font-semibold tracking-tight truncate group-hover/name:text-white transition-colors")}>
                          {group.name}
                        </span>
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider shrink-0",
                            sevGlow.pill,
                          )}
                        >
                          {topSev.label}
                        </span>
                        {chatterLabelsForGroup.slice(0, 3).map((lbl) => (
                          <span
                            key={lbl.id}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-white/[0.08] bg-white/[0.04] text-[10px] font-medium text-white/80 shrink-0"
                            title={lbl.label_name}
                          >
                            <span
                              className="inline-block h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: lbl.color, boxShadow: `0 0 6px ${lbl.color}66` }}
                            />
                            <span className="truncate max-w-[140px]">{lbl.label_name}</span>
                          </span>
                        ))}
                        {chatterLabelsForGroup.length > 3 && (
                          <span className="text-[10px] text-white/45 font-light shrink-0">
                            +{chatterLabelsForGroup.length - 3}
                          </span>
                        )}
                        {mode === "problems" && group.impactPerDay > 0 && (
                          <span className={cn("inline-flex items-baseline gap-0.5 text-[12px] tabular-nums font-medium", sevGlow.accent)}>
                            <span>−{group.impactPerDay.toLocaleString("de-DE")}€</span>
                            <span className="text-[9px] uppercase tracking-wider opacity-60 font-light">/Tag</span>
                          </span>
                        )}
                        {mode === "problems" && sinceRel && sinceRel.days >= 1 && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-500/[0.08] border border-red-500/15 text-[9px] uppercase tracking-wider text-red-200/85 font-medium"
                            title={`Dauer der Auffälligkeit: ${sinceRel.days} ${sinceRel.days === 1 ? "Tag" : "Tage"} in Folge auffällig (z. B. 0€-Umsatz, unter Peer-Schnitt oder keine MassDMs). Je länger, desto dringender.`}
                          >
                            <Flame className="h-2.5 w-2.5" />
                            auffällig seit {sinceRel.days} {sinceRel.days === 1 ? "Tag" : "Tagen"}
                          </span>
                        )}
                        {isNewerThanWindow && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sky-500/[0.08] border border-sky-400/20 text-[9px] uppercase tracking-wider text-sky-200/90 font-medium"
                            title={`Dieser Chatter ist erst seit ${firstSeenDays} ${firstSeenDays === 1 ? "Tag" : "Tagen"} am Start. Das gewählte Zeitfenster (${windowDays} Tage) ist länger als die verfügbare Historie — die Auswertung basiert nur auf den vorhandenen Tagen.`}
                          >
                            <Sparkles className="h-2.5 w-2.5" />
                            erst seit {firstSeenDays} {firstSeenDays === 1 ? "Tag" : "Tagen"} am Start
                          </span>
                        )}
                      </div>


                      {/* Headline-Message */}
                      <div className="text-[12px] sm:text-[13px] text-white/70 font-light mt-1 leading-snug">
                        <span className="opacity-80">{topMeta.emoji}</span>{" "}
                        {topItem.message}
                      </div>

                      {/* Accounts (kompakt) */}
                      {accs.length > 0 && (
                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                          {accs.length > 1 && (
                            <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-white/35 font-light">
                              <Users className="h-2.5 w-2.5" />
                              {accs.length}
                            </span>
                          )}
                          {accs.slice(0, 3).map((acc) => {
                            const fc = modelFollowers.get(acc.toLowerCase().trim());
                            return (
                              <span
                                key={acc}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-white/[0.06] bg-white/[0.02] text-[10px] font-light text-white/60"
                              >
                                <span className="text-white/75">{acc}</span>
                                {fc !== undefined && (
                                  <span className="text-white/35 tabular-nums">
                                    {fc >= 1000 ? `${(fc / 1000).toFixed(fc >= 10000 ? 0 : 1)}k` : fc}
                                  </span>
                                )}
                              </span>
                            );
                          })}
                          {accs.length > 3 && (
                            <span className="text-[10px] text-white/35 font-light">+{accs.length - 3}</span>
                          )}
                        </div>
                      )}





                      {/* Weitere Signale Hint */}
                      {group.items.length > 1 && (
                        <div className="text-[10px] uppercase tracking-wider text-white/30 font-light mt-1.5">
                          +{group.items.length - 1} weitere{group.items.length === 2 ? "s" : ""} Signal{group.items.length === 2 ? "" : "e"}
                        </div>
                      )}
                    </button>

                    {/* Erledigt */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDismissChatter(group.name, group.items);
                      }}
                      disabled={isPending}
                      title="Chatter komplett abhaken (bis zum nächsten Report)"
                      className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg border border-white/[0.06] bg-white/[0.02] text-white/45 hover:bg-emerald-500/10 hover:border-emerald-400/30 hover:text-emerald-200 transition-all disabled:opacity-40"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Zahlen-Trio: All-Time Ø · Zeitraum Ø · Abfall % */}
                  {(allAvg > 0 || currentAvg > 0 || dropPct !== null) && (
                    <div className="grid grid-cols-3 gap-2 px-3.5 sm:px-5 py-2.5 border-t border-white/[0.04] bg-white/[0.012]">
                      <div
                        className="min-w-0"
                        title="Durchschnittlicher Tagesumsatz über alle bisherigen Reports dieses Chatters (Lebenszeit-Schnitt, unabhängig vom Zeitraumfilter)."
                      >
                        <div className="text-[9px] uppercase tracking-[0.16em] text-white/35 font-light leading-none">Ø €/Tag · All-Time</div>
                        <div className="text-[13px] tabular-nums text-foreground/85 font-medium mt-1 leading-none">
                          {allAvg > 0 ? `${Math.round(allAvg).toLocaleString("de-DE")} €` : "—"}
                        </div>
                      </div>
                      <div
                        className="min-w-0 border-l border-white/[0.05] pl-2"
                        title={`Durchschnittlicher Tagesumsatz im aktuell gewählten Zeitraum (${rangeLabel(range)})${zeroDays !== null ? ` · ${zeroDays}× 0€-Tage in Folge` : ""}.`}
                      >
                        <div className="text-[9px] uppercase tracking-[0.16em] text-white/35 font-light leading-none">Ø €/Tag · Zeitraum</div>
                        <div className="text-[13px] tabular-nums text-foreground/85 font-medium mt-1 leading-none">
                          {currentAvg > 0 ? `${Math.round(currentAvg).toLocaleString("de-DE")} €` : "—"}
                        </div>
                      </div>
                      <div
                        className="min-w-0 border-l border-white/[0.05] pl-2"
                        title={
                          dropPct === null
                            ? "Kein All-Time-Vergleich möglich — zu wenig Historie."
                            : `Zeitraum: Ø ${Math.round(currentAvg).toLocaleString("de-DE")}€/Tag · All-Time: Ø ${Math.round(allAvg).toLocaleString("de-DE")}€/Tag → ${dropPct > 0 ? "+" : ""}${dropPct}%`
                        }
                      >
                        <div className="text-[9px] uppercase tracking-[0.16em] text-white/35 font-light leading-none">vs. All-Time</div>
                        <div className={`text-[13px] tabular-nums font-medium mt-1 leading-none ${
                          dropPct === null
                            ? "text-white/40"
                            : dropPct < -10
                            ? "text-red-300/90"
                            : dropPct < 0
                            ? "text-amber-300/85"
                            : "text-emerald-300/85"
                        }`}>
                          {dropPct === null ? "—" : `${dropPct > 0 ? "+" : ""}${dropPct} %`}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Letzte-Aktivität-Footer */}
                  {(lastCheckRel || lastNote || lastCoachingRel) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 sm:px-5 py-2 border-t border-white/[0.04] bg-white/[0.008] text-[10px] font-light">
                      {lastCheckRel ? (
                        <span
                          className={`inline-flex items-center gap-1 ${
                            lastCheckRel.days <= 1 ? "text-emerald-300/80" : lastCheckRel.days <= 7 ? "text-white/55" : "text-amber-300/75"
                          }`}
                        >
                          <ClipboardCheck className="h-2.5 w-2.5" />
                          Check {lastCheckRel.label}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-300/70">
                          <ClipboardCheck className="h-2.5 w-2.5" />
                          noch kein Check
                        </span>
                      )}
                      {lastNote && (
                        <span
                          className="inline-flex items-center gap-1 text-white/55"
                          title={lastNote.snippet}
                        >
                          <FileText className="h-2.5 w-2.5" />
                          Notiz {fmtShortDate(lastNote.date)}
                        </span>
                      )}
                      {lastCoachingRel && (
                        <span className="inline-flex items-center gap-1 text-white/55">
                          <Video className="h-2.5 w-2.5" />
                          Coaching {lastCoachingRel.label}
                        </span>
                      )}
                    </div>
                  )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {!loading && anomalies.length > 0 && (
        <>
          {variant === "compact" && groupedByChatter.length > compactInitialCount && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center justify-center gap-1 py-2 text-[10px] uppercase tracking-wider text-white/30 hover:text-white/60 hover:bg-white/[0.02] transition-colors border-t border-white/[0.04]"
            >
              {expanded ? "Weniger" : `${groupedByChatter.length - compactInitialCount} weitere Chatter`}
              <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}

          <button
            type="button"
            onClick={() => refresh()}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] uppercase tracking-wider text-white/25 hover:text-white/55 transition-colors border-t border-white/[0.03]"
          >
            <RotateCcw className="h-3 w-3" />
            Neu berechnen
          </button>
        </>
      )}

      <AnomalyDetailModal
        open={!!detailAnomaly}
        onOpenChange={(o) => !o && setDetailAnomaly(null)}
        anomaly={detailAnomaly}
        range={range}
        peerAvgRevenuePerDay={peerAvg}
      />
    </div>
  );
}
