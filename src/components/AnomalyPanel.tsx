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
import { Check, ChevronDown, RotateCcw, Users, TrendingDown, ClipboardCheck, FileText, Video, Flame } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
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
  type ChatterAnomaly,
} from "@/lib/anomaly-window";
import {
  estimateDailyImpactEur,
} from "@/lib/anomaly-actions";
import { emitAnomalyDismissed, onAnomalyDismissed, onChatterDataUpdated } from "@/lib/data-events";
import AnomalyDetailModal from "@/components/AnomalyDetailModal";

interface Props {
  platform: string;
  /** Default time range. */
  defaultRange?: TimeRange;
  /** Compact: less padding, smaller text — used in dashboard. */
  variant?: "default" | "compact";
  /** Click on a chatter row. */
  onChatterSelect?: (name: string) => void;
  /** Optional limit when compact, with "show more" toggle. */
  compactInitialCount?: number;
  /** Hide the time range controls (used when controlled externally). */
  hideTimeControls?: boolean;
  /** Externally controlled range (overrides internal state when set). */
  range?: TimeRange;
  onRangeChange?: (range: TimeRange) => void;
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
}: Props) {
  const { user } = useAuth();
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
    savedAt: number;
  };

  const loadSnapshot = (key: string): Snapshot | null => {
    if (typeof sessionStorage === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as Snapshot;
    } catch { return null; }
  };

  const initialSnap = typeof window !== "undefined" ? loadSnapshot(cacheKey) : null;

  const [loading, setLoading] = useState(!initialSnap);
  const [anomalies, setAnomalies] = useState<ChatterAnomaly[]>(initialSnap?.anomalies ?? []);
  const [reportId, setReportId] = useState<string | null>(initialSnap?.reportId ?? null);
  const [expanded, setExpanded] = useState(false);
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

    const [result, modelsRes, accountsRes, totalRes, prevHistRes, checksRes, notesRes, coachingsRes, catStateRes] = await Promise.all([
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

    // Persist snapshot
    try {
      const snap: Snapshot = {
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
        savedAt: Date.now(),
      };
      sessionStorage.setItem(cacheKey, JSON.stringify(snap));
    } catch { /* quota or unavailable */ }

    setLoading(false);
  }, [user, platform, range, cacheKey]);

  // Mount / range change: nur refreshen wenn kein gültiger Snapshot vorhanden.
  useEffect(() => {
    const snap = loadSnapshot(cacheKey);
    if (snap) {
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
  const prevPeriodLabel = useMemo(() => {
    const days = Math.max(1, rangeDays(range));
    const fromIso = String(range.from).slice(0, 10);
    const prevTo = new Date(new Date(fromIso).getTime() - 86_400_000);
    const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
    const fmt = (d: Date) => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
    return days === 1 ? fmt(prevFrom) : `${fmt(prevFrom)}–${fmt(prevTo)}`;
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
      if (a.severity !== "critical") continue;
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
      if (b.impactPerDay !== a.impactPerDay) return b.impactPerDay - a.impactPerDay;
      if (b.totalFollowers !== a.totalFollowers) return b.totalFollowers - a.totalFollowers;
      return b.topScore - a.topScore;
    });
  }, [anomalies, chatterAccounts, modelFollowers, windowDays]);

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
  const textSize = variant === "compact" ? "text-sm" : "text-[15px]";

  const visibleGroups = variant === "compact" && !expanded
    ? groupedByChatter.slice(0, compactInitialCount)
    : groupedByChatter;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.025] to-white/[0.01] overflow-hidden backdrop-blur-sm">
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

        {/* Premium Progress Bar: X von Y Chattern auffällig (nur kritisch+hoch zählen) */}
        {(() => {
          const criticalChatters = new Set(
            anomalies
              .filter((a) => a.severity === "critical")
              .map((a) => a.chatter_name),
          );
          const flagged = criticalChatters.size;
          const total = Math.max(totalChattersInRange, groupedByChatter.length);
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
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
            {totalChattersInRange > 0
              ? `Alle ${totalChattersInRange} Chatter clean.`
              : "Keine Auffälligkeiten im Zeitraum."}
          </div>
        </div>
      ) : (
        <div className={`${variant === "compact" ? "p-2.5 sm:p-3" : "p-3 sm:p-4"} space-y-2.5 sm:space-y-3`}>
          <AnimatePresence initial={false}>
            {visibleGroups.map((group, idx) => {
              const topSev = SEVERITY_STYLE[group.topSeverity];
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

              // Zahlen-Trio
              const currentAvg = group.items[0]?.metric_value ?? 0;
              const prevAvg = prevWindowAvg.get(group.name) ?? 0;
              const deltaPct = prevAvg > 0
                ? Math.round(((currentAvg - prevAvg) / prevAvg) * 100)
                : null;
              // 0€-Tage: Anzahl Items mit alert_type "persistent_zero" als Proxy nicht ideal —
              // wir nutzen consecutiveZeroDays über metric_value/baseline-Heuristik:
              // Fallback: aus message extrahieren falls vorhanden, sonst null.
              const zeroAlert = group.items.find((a) => a.alert_type === "persistent_zero");
              const zeroDays = zeroAlert ? Math.round(zeroAlert.metric_value) : null;

              return (
                <motion.div
                  key={group.name}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
                  transition={{ duration: 0.22, delay: idx * 0.02 }}
                  onDoubleClick={() => onChatterSelect?.(group.name)}
                  className={`relative rounded-xl border border-white/[0.06] ${topSev.border.split(" ").slice(1).join(" ")} overflow-hidden shadow-[0_2px_12px_-4px_rgba(0,0,0,0.4)] hover:border-white/[0.12] transition-colors`}
                >
                  {/* Severity Akzent-Streifen links */}
                  <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${topSev.dot}`} />

                  {/* Chatter-Header */}
                  <div className={`flex items-start gap-2.5 sm:gap-3 ${variant === "compact" ? "px-3 sm:px-4 py-2.5" : "px-3.5 sm:px-5 py-3 sm:py-3.5"}`}>
                    {/* Rank */}
                    <div className="shrink-0 flex flex-col items-center pt-0.5">
                      <span className="text-[9px] uppercase tracking-wider text-white/25 font-light leading-none">#{rank}</span>
                      <span className="relative flex h-2 w-2 mt-1.5">
                        {group.topSeverity === "critical" && (
                          <span className={`absolute inline-flex h-full w-full rounded-full ${topSev.dot} opacity-60 animate-ping`} />
                        )}
                        <span className={`relative inline-flex h-2 w-2 rounded-full ${topSev.dot}`} />
                      </span>
                    </div>

                    {/* Name + Headline + Stats — Klick = kopieren, Doppelklick = Profil */}
                    <button
                      type="button"
                      onClick={() => copyName(group.name)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        onChatterSelect?.(group.name);
                      }}
                      title="Klick: Name kopieren · Doppelklick: Profil öffnen"
                      className="flex-1 min-w-0 text-left group/name cursor-copy"
                    >
                      {/* Top row: Name + Impact + Status-Pill */}
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className={`${textSize} text-foreground font-medium tracking-tight truncate group-hover/name:text-white transition-colors`}>
                          {group.name}
                        </span>
                        {group.impactPerDay > 0 && (
                          <span className="inline-flex items-baseline gap-0.5 text-[11px] tabular-nums text-red-300/90 font-medium">
                            <span>−{group.impactPerDay.toLocaleString("de-DE")}€</span>
                            <span className="text-[9px] uppercase tracking-wider text-red-300/50 font-light">/Tag</span>
                          </span>
                        )}
                        {sinceRel && sinceRel.days >= 1 && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-500/[0.08] border border-red-500/15 text-[9px] uppercase tracking-wider text-red-200/85 font-medium">
                            <Flame className="h-2.5 w-2.5" />
                            seit {sinceRel.days} {sinceRel.days === 1 ? "Tag" : "Tagen"}
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

                  {/* Zahlen-Trio */}
                  {(currentAvg > 0 || deltaPct !== null || zeroDays !== null) && (
                    <div className="grid grid-cols-3 gap-2 px-3.5 sm:px-5 py-2.5 border-t border-white/[0.04] bg-white/[0.012]">
                      <div className="min-w-0">
                        <div className="text-[9px] uppercase tracking-[0.16em] text-white/35 font-light leading-none">Ø €/Tag</div>
                        <div className="text-[13px] tabular-nums text-foreground/85 font-medium mt-1 leading-none">
                          {currentAvg > 0 ? `${Math.round(currentAvg).toLocaleString("de-DE")} €` : "—"}
                        </div>
                      </div>
                      <div className="min-w-0 border-l border-white/[0.05] pl-2">
                        <div className="text-[9px] uppercase tracking-[0.16em] text-white/35 font-light leading-none">vs. Vorperiode</div>
                        <div className={`text-[13px] tabular-nums font-medium mt-1 leading-none ${
                          deltaPct === null
                            ? "text-white/40"
                            : deltaPct < -10
                            ? "text-red-300/90"
                            : deltaPct < 0
                            ? "text-amber-300/85"
                            : "text-emerald-300/85"
                        }`}>
                          {deltaPct === null ? "—" : `${deltaPct > 0 ? "+" : ""}${deltaPct} %`}
                        </div>
                      </div>
                      <div className="min-w-0 border-l border-white/[0.05] pl-2">
                        <div className="text-[9px] uppercase tracking-[0.16em] text-white/35 font-light leading-none">0 €-Tage</div>
                        <div className={`text-[13px] tabular-nums font-medium mt-1 leading-none ${
                          zeroDays === null ? "text-white/40" : zeroDays >= 3 ? "text-red-300/90" : "text-foreground/85"
                        }`}>
                          {zeroDays === null ? "—" : `${zeroDays}×`}
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
