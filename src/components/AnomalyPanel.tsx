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
import { Check, ChevronDown, RotateCcw, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import TimeRangeToggle from "@/components/TimeRangeToggle";
import {
  buildTimeRange,
  rangeLabel,
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
  const [loading, setLoading] = useState(true);
  const [anomalies, setAnomalies] = useState<ChatterAnomaly[]>([]);
  const [reportId, setReportId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pendingDismiss, setPendingDismiss] = useState<Set<string>>(new Set());
  const [peerAvg, setPeerAvg] = useState(0);
  const [detailAnomaly, setDetailAnomaly] = useState<ChatterAnomaly | null>(null);
  /** model_name (lowercased) -> follower_count */
  const [modelFollowers, setModelFollowers] = useState<Map<string, number>>(new Map());
  /** chatter_name -> array of account names (raw) */
  const [chatterAccounts, setChatterAccounts] = useState<Map<string, string[]>>(new Map());
  /** Anzahl unique Chatter im Zeitraum (Basis für Progress Bar) */
  const [totalChattersInRange, setTotalChattersInRange] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const rid = await loadActiveReportId(user.id, platform);
    setReportId(rid);
    const fromIso = String(range.from).slice(0, 10);
    const toIso = String(range.to).slice(0, 10);
    const [result, modelsRes, accountsRes, totalRes] = await Promise.all([
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

    // Pro Chatter den jüngsten account-Eintrag nehmen (history ist desc sortiert)
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

    setLoading(false);
  }, [user, platform, range]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const offData = onChatterDataUpdated(() => refresh());
    const offDismiss = onAnomalyDismissed((payload) => {
      // Eigenes Event ignorieren — wir haben den State lokal schon aktualisiert
      if (payload.sourceId === sourceIdRef.current) return;
      // Fremdes Event: lokal filtern statt komplett neu laden
      if (payload.chatterName) {
        setAnomalies((prev) =>
          prev.filter((x) => {
            if (x.chatter_name !== payload.chatterName) return true;
            if (payload.alertType && x.alert_type !== payload.alertType) return true;
            return false;
          }),
        );
      } else {
        // Kein Payload: Fallback auf Refresh
        refresh();
      }
    });
    return () => {
      offData();
      offDismiss();
    };
  }, [refresh]);

  const handleDismiss = async (a: ChatterAnomaly) => {
    if (!user || !reportId) return;
    const key = `${a.chatter_name}|${a.alert_type}`;
    setPendingDismiss((p) => new Set(p).add(key));
    setAnomalies((prev) =>
      prev.filter((x) => !(x.chatter_name === a.chatter_name && x.alert_type === a.alert_type)),
    );
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
    setAnomalies((prev) => prev.filter((x) => x.chatter_name !== chatterName));
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

  // Gruppiere pro Chatter — nur wirklich rote Critical-Kandidaten anzeigen.
  // Sortierung: Chatter mit den meisten Followern (Summe aller Accounts) zuerst,
  // bei Gleichstand zählt der Score als Tiebreaker.
  const groupedByChatter = useMemo(() => {
    const map = new Map<string, { name: string; topScore: number; topSeverity: ChatterAnomaly["severity"]; items: ChatterAnomaly[]; totalFollowers: number }>();
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
        map.set(key, { name: a.chatter_name, topScore: a.score, topSeverity: a.severity, items: [a], totalFollowers });
      }
    }
    return [...map.values()].sort((a, b) => {
      if (b.totalFollowers !== a.totalFollowers) return b.totalFollowers - a.totalFollowers;
      return b.topScore - a.topScore;
    });
  }, [anomalies, chatterAccounts, modelFollowers]);

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
            <div className="space-y-2">
              <div className="flex items-end justify-between gap-3">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-light tabular-nums text-foreground tracking-tight">
                    {flagged}
                  </span>
                  <span className="text-xs text-white/40 font-light">
                    von {total} {total === 1 ? "Chatter" : "Chattern"} kritisch
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-white/40 font-light">
                  {counts.critical > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                      {counts.critical}
                    </span>
                  )}
                  {counts.high > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                      {counts.high}
                    </span>
                  )}
                  {counts.medium > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
                      {counts.medium}
                    </span>
                  )}
                </div>
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
              return (
                <motion.div
                  key={group.name}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
                  transition={{ duration: 0.22, delay: idx * 0.02 }}
                  className={`relative rounded-xl border border-white/[0.06] ${topSev.border.split(" ").slice(1).join(" ")} overflow-hidden shadow-[0_2px_12px_-4px_rgba(0,0,0,0.4)] hover:border-white/[0.12] transition-colors`}
                >
                  {/* Severity Akzent-Streifen links */}
                  <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${topSev.dot}`} />

                  {/* Chatter-Header */}
                  <div className={`flex items-center gap-2.5 sm:gap-3 ${variant === "compact" ? "px-3 sm:px-4 py-2.5" : "px-3.5 sm:px-5 py-2.5 sm:py-3"} border-b border-white/[0.05] bg-white/[0.015]`}>
                    <span className={`relative flex h-2.5 w-2.5 shrink-0`}>
                      {group.topSeverity === "critical" && (
                        <span className={`absolute inline-flex h-full w-full rounded-full ${topSev.dot} opacity-60 animate-ping`} />
                      )}
                      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${topSev.dot}`} />
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(group.name);
                          toast.success(`„${group.name}" kopiert`);
                        } catch {
                          toast.error("Kopieren fehlgeschlagen");
                        }
                        // Haptic feedback (mobile)
                        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
                          try { navigator.vibrate(15); } catch { /* noop */ }
                        }
                      }}
                      onDoubleClick={() => onChatterSelect?.(group.name)}
                      className="flex-1 min-w-0 text-left group/name"
                    >
                      <div className={`${textSize} text-foreground font-medium tracking-tight truncate group-hover/name:text-white transition-colors`}>
                        {group.name}
                      </div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-white/35 font-light mt-0.5">
                        {group.items.length} {group.items.length === 1 ? "Signal" : "Signale"} · {topSev.label}
                      </div>
                      {(() => {
                        const accs = chatterAccounts.get(group.name) ?? [];
                        if (accs.length === 0) return null;
                        return (
                          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                            {accs.length > 1 && (
                              <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-white/40 font-light">
                                <Users className="h-2.5 w-2.5" />
                                {accs.length} Acc.
                              </span>
                            )}
                            {accs.map((acc) => {
                              const fc = modelFollowers.get(acc.toLowerCase().trim());
                              return (
                                <span
                                  key={acc}
                                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-white/[0.07] bg-white/[0.025] text-[10px] font-light text-white/70"
                                  title={fc !== undefined ? `${fc.toLocaleString("de-DE")} Follower` : "Follower-Anzahl unbekannt"}
                                >
                                  <span className="text-white/85 font-normal">{acc}</span>
                                  {fc !== undefined ? (
                                    <span className="text-white/40 tabular-nums">
                                      {fc >= 1000 ? `${(fc / 1000).toFixed(fc >= 10000 ? 0 : 1)}k` : fc}
                                    </span>
                                  ) : (
                                    <span className="text-white/25">—</span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDismissChatter(group.name, group.items)}
                      disabled={isPending}
                      title="Chatter komplett abhaken (bis zum nächsten Report)"
                      className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] text-[10px] uppercase tracking-wider text-white/45 hover:bg-emerald-500/10 hover:border-emerald-400/30 hover:text-emerald-200 transition-all disabled:opacity-40"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Erledigt</span>
                    </button>
                  </div>

                  {/* Auffälligkeiten gestapelt */}
                  <div className={`${variant === "compact" ? "px-2.5 sm:px-3 py-2" : "px-3 sm:px-4 py-2 sm:py-2.5"} space-y-0.5`}>
                    {group.items.map((a) => {
                      const meta = ANOMALY_LABELS[a.alert_type];
                      const sev = SEVERITY_STYLE[a.severity];
                      const key = `${a.chatter_name}|${a.alert_type}`;
                      return (
                        <div
                          key={key}
                          className="flex items-start gap-3 py-2 px-2 -mx-2 rounded-lg hover:bg-white/[0.025] transition-colors cursor-pointer"
                          onClick={() => onChatterSelect?.(group.name)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onChatterSelect?.(group.name);
                            }
                          }}
                        >
                          <span className="text-base shrink-0 opacity-80 leading-5">{meta.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] uppercase tracking-[0.15em] font-light ${sev.text}`}>
                                {meta.label}
                              </span>
                              <span className="text-[9px] uppercase tracking-wider text-white/25 font-light">
                                · {sev.label}
                              </span>
                            </div>
                            <div className="text-xs text-white/60 font-light mt-0.5 line-clamp-2">
                              {a.message}
                            </div>
                          </div>
                        </div>
                      );
                    })}
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
