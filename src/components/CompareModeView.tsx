import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { motion, useMotionValue, useTransform, useAnimation, type PanInfo } from "framer-motion";
import { Users, Coins, MessageSquare, CalendarDays, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { usePlatform } from "@/contexts/PlatformContext";
import { supabase } from "@/integrations/supabase/client";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import CompareFilterPanel from "@/components/CompareFilterPanel";
import {
  applyCompareFilter,
  loadCompareState,
  saveCompareState,
  formatEur,
  DEFAULT_PRESETS,
  type ComparePreset,
  type ApplyFilterContext,
  type FilteredChatter,
} from "@/lib/compare-filters";
import {
  listAllSwapChatters,
  formatSkill,
  type SwapChatter,
  type SwapInput,
  type SwapModelInfo,
} from "@/lib/swap-suggestions";
import { formatFollowers } from "@/lib/model-performance";
import { rangeLabel } from "@/lib/timerange-categorize";
import type { TimeRange, HistoryRow as RangeHistoryRow } from "@/lib/timerange-categorize";
import type { ActionCategoryName } from "@/lib/action-categories";
import type { AccountTierId } from "@/lib/account-tiers";

interface Props {
  chatters: ApplyFilterContext["chatters"];
  swapInputs: SwapInput[];
  models: SwapModelInfo[];
  rangeHistory: RangeHistoryRow[];
  range: TimeRange;
  recategorizedMap: Map<string, ActionCategoryName>;
  labelsByChatter: Map<string, Set<string>>;
  tierIdsByChatter: Map<string, AccountTierId[]>;
  alertChatterNames: Set<string>;
  allLabels: Array<{ id: string; label_name: string; color: string }>;
  firstSeenByChatter?: Map<string, string>;
  followersByChatter?: Map<string, number>;
  reportId?: string | null;
  onChatterClick: (chatterName: string) => void;
}

const SWIPE_THRESHOLD = 120; // gemäß Memory: nur Distanz, keine velocity

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
}

function formatStartDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "2-digit" });
}

export default function CompareModeView({
  chatters,
  swapInputs,
  models,
  rangeHistory,
  range,
  recategorizedMap,
  labelsByChatter,
  tierIdsByChatter,
  alertChatterNames,
  allLabels,
  firstSeenByChatter,
  followersByChatter,
  reportId,
  onChatterClick,
}: Props) {
  const [state, setState] = useState(() => loadCompareState());

  useEffect(() => {
    saveCompareState(state);
  }, [state]);

  const ctx: ApplyFilterContext = useMemo(
    () => ({
      chatters,
      rangeHistory,
      range,
      recategorizedMap,
      labelsByChatter,
      tierIdsByChatter,
      alertChatterNames,
      firstSeenByChatter,
      followersByChatter,
    }),
    [chatters, rangeHistory, range, recategorizedMap, labelsByChatter, tierIdsByChatter, alertChatterNames, firstSeenByChatter, followersByChatter]
  );

  const filteredA = useMemo(() => applyCompareFilter(state.setA, ctx), [state.setA, ctx]);
  const filteredB = useMemo(() => applyCompareFilter(state.setB, ctx), [state.setB, ctx]);

  // Enriched SwapChatter pool — pro normalisiertem Namen den höchsten-Skill Eintrag
  const enrichedByName = useMemo(() => {
    const all = listAllSwapChatters(swapInputs, models);
    const map = new Map<string, SwapChatter>();
    for (const sc of all) {
      const key = normalizeName(sc.name);
      const existing = map.get(key);
      if (!existing || sc.skillScore > existing.skillScore) map.set(key, sc);
    }
    return map;
  }, [swapInputs, models]);

  // Sortierte Stacks (avgRevWindow desc) — ein Chatter pro Stack-Slot
  const stackA = useMemo(
    () => [...filteredA].sort((a, b) => b.avgRevWindow - a.avgRevWindow),
    [filteredA]
  );
  const stackB = useMemo(
    () => [...filteredB].sort((a, b) => b.avgRevWindow - a.avgRevWindow),
    [filteredB]
  );

  const identical = useMemo(
    () => JSON.stringify(state.setA) === JSON.stringify(state.setB),
    [state.setA, state.setB]
  );

  const applyPreset = (p: ComparePreset) =>
    setState((s) => ({ ...s, setA: p.setA, setB: p.setB }));

  // Indep. State pro Seite: Index + skipped (an Stack-Ende verschoben) + dismissed (bis nächster Report ausgeblendet)
  const [idxA, setIdxA] = useState(0);
  const [idxB, setIdxB] = useState(0);
  const [skippedA, setSkippedA] = useState<string[]>([]);
  const [skippedB, setSkippedB] = useState<string[]>([]);
  const dismissKey = reportId ? `compare.dismissed.${reportId}` : null;
  const [dismissedA, setDismissedA] = useState<Set<string>>(new Set());
  const [dismissedB, setDismissedB] = useState<Set<string>>(new Set());

  // Load dismissed from localStorage when reportId changes
  useEffect(() => {
    if (!dismissKey) {
      setDismissedA(new Set());
      setDismissedB(new Set());
      return;
    }
    try {
      const raw = localStorage.getItem(dismissKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { a?: string[]; b?: string[] };
        setDismissedA(new Set(parsed.a || []));
        setDismissedB(new Set(parsed.b || []));
      } else {
        setDismissedA(new Set());
        setDismissedB(new Set());
      }
    } catch {
      setDismissedA(new Set());
      setDismissedB(new Set());
    }
  }, [dismissKey]);

  // Persist dismissed
  useEffect(() => {
    if (!dismissKey) return;
    try {
      localStorage.setItem(
        dismissKey,
        JSON.stringify({ a: Array.from(dismissedA), b: Array.from(dismissedB) })
      );
    } catch {}
  }, [dismissKey, dismissedA, dismissedB]);

  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const { platform } = usePlatform();

  // Profil-Stats pro Chatter (Ø Tagesumsatz, Ø MassDMs/Tag) — identische Berechnung
  // wie im Chatter-Profil (Slideover). Live via Realtime auf chatter_history.
  const [profileStats, setProfileStats] = useState<Map<string, { avgRev: number; avgDMs: number }>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase
        .from("chatter_history")
        .select("chatter_name, revenue_today, mass_dms")
        .eq("platform", platform);
      if (cancelled || error || !data) return;
      const acc = new Map<string, { sumRev: number; sumDM: number; n: number }>();
      for (const r of data as Array<{ chatter_name: string | null; revenue_today: number | null; mass_dms: number | null }>) {
        if (!r.chatter_name) continue;
        const key = normalizeName(r.chatter_name);
        const cur = acc.get(key) ?? { sumRev: 0, sumDM: 0, n: 0 };
        cur.sumRev += Number(r.revenue_today) || 0;
        cur.sumDM += Number(r.mass_dms) || 0;
        cur.n += 1;
        acc.set(key, cur);
      }
      const out = new Map<string, { avgRev: number; avgDMs: number }>();
      for (const [k, v] of acc) {
        out.set(k, { avgRev: v.n > 0 ? v.sumRev / v.n : 0, avgDMs: v.n > 0 ? Math.round(v.sumDM / v.n) : 0 });
      }
      setProfileStats(out);
    };
    load();
    const channel = supabase
      .channel(`compare-history-${platform}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chatter_history" }, () => {
        load();
      })
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [platform]);

  // Reset wenn sich Filter/Stack ändert
  useEffect(() => { setIdxA(0); setSkippedA([]); }, [state.setA]);
  useEffect(() => { setIdxB(0); setSkippedB([]); }, [state.setB]);

  const handleCardSingleClick = useCallback((name: string) => {
    const display = name.replace(/_/g, " ");
    navigator.clipboard?.writeText(display).then(
      () => toast.success(`Name kopiert: ${display}`),
      () => toast.error("Kopieren fehlgeschlagen")
    );
  }, []);

  const handleCardDoubleClick = useCallback(() => {
    setCompareDialogOpen(true);
  }, []);

  // Render-Reihenfolge: dismissed komplett raus, dann nicht-skipped, dann skipped am Ende
  const orderedA = useMemo(() => {
    const visible = stackA.filter((c) => !dismissedA.has(c.name));
    const skip = new Set(skippedA);
    return [...visible.filter((c) => !skip.has(c.name)), ...visible.filter((c) => skip.has(c.name))];
  }, [stackA, skippedA, dismissedA]);
  const orderedB = useMemo(() => {
    const visible = stackB.filter((c) => !dismissedB.has(c.name));
    const skip = new Set(skippedB);
    return [...visible.filter((c) => !skip.has(c.name)), ...visible.filter((c) => skip.has(c.name))];
  }, [stackB, skippedB, dismissedB]);

  const currentA = orderedA[idxA];
  const currentB = orderedB[idxB];
  const metricLabel = useMemo(() => `Ø ${rangeLabel(range)}`, [range]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-3" style={{ touchAction: "pan-y", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
      {/* Filter chip headers (Presets sind im Akkordeon integriert) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3">
        <CompareFilterPanel
          label="Set A"
          accent="emerald"
          filter={state.setA}
          onChange={(f) => setState((s) => ({ ...s, setA: f }))}
          allLabels={allLabels}
          presets={[...DEFAULT_PRESETS, ...state.customPresets].map((p) => ({ ...p, setB: p.setA }))}
          side="A"
          onApplyPreset={(p) => setState((s) => ({ ...s, setA: p.setA }))}
        />
        <CompareFilterPanel
          label="Set B"
          accent="sky"
          filter={state.setB}
          onChange={(f) => setState((s) => ({ ...s, setB: f }))}
          allLabels={allLabels}
          presets={[...DEFAULT_PRESETS, ...state.customPresets].map((p) => ({ ...p, setA: p.setB }))}
          side="B"
          onApplyPreset={(p) => setState((s) => ({ ...s, setB: p.setB }))}
        />
      </div>

      {identical && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-center text-[11px] text-muted-foreground">
          Gleiche Auswahl — Filter unterscheiden
        </div>
      )}

      {/* Two true side-by-side swipe cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-3 items-start">
        <CompareSlot
          accent="emerald"
          item={currentA}
          enrichedMap={enrichedByName}
          stackLength={orderedA.length}
          idx={idxA}
          dismissedCount={dismissedA.size}
          metricLabel={metricLabel}
          onSwipeDismiss={() => {
            if (currentA) {
              const name = currentA.name;
              setDismissedA((d) => {
                const next = new Set(d);
                next.add(name);
                return next;
              });
              // idx bleibt — der nächste Chatter rückt an dieselbe Stelle
            }
          }}
          onSwipeSkip={() => {
            if (currentA) {
              // Name ans Ende verschieben — idx bleibt, dort rückt der nächste auf.
              // So bleibt der skipped am Stapel-Ende für später erreichbar.
              setSkippedA((s) => [...s.filter((n) => n !== currentA.name), currentA.name]);
            }
          }}
          onReset={() => { setIdxA(0); setSkippedA([]); setDismissedA(new Set()); }}
          onTap={handleCardSingleClick}
          onDoubleTap={handleCardDoubleClick}
        />
        <CompareSlot
          accent="sky"
          item={currentB}
          enrichedMap={enrichedByName}
          stackLength={orderedB.length}
          idx={idxB}
          dismissedCount={dismissedB.size}
          metricLabel={metricLabel}
          onSwipeDismiss={() => {
            if (currentB) {
              const name = currentB.name;
              setDismissedB((d) => {
                const next = new Set(d);
                next.add(name);
                return next;
              });
            }
          }}
          onSwipeSkip={() => {
            if (currentB) {
              setSkippedB((s) => [...s.filter((n) => n !== currentB.name), currentB.name]);
            }
          }}
          onReset={() => { setIdxB(0); setSkippedB([]); setDismissedB(new Set()); }}
          onTap={handleCardSingleClick}
          onDoubleTap={handleCardDoubleClick}
        />
      </div>

      {/* Live Δ between currently visible chatters */}
      <LiveDeltaBox a={currentA} b={currentB} enrichedMap={enrichedByName} />

      {/* Compare Dialog — Desktop: side-by-side, Mobile: Tabs (volle Breite) */}
      <CompareProfileDialog
        open={compareDialogOpen}
        onOpenChange={setCompareDialogOpen}
        currentA={currentA}
        currentB={currentB}
        platform={platform}
      />
    </div>
  );
}

/* --------------------------- Compare Dialog (responsive) ------------------------ */

function CompareProfileDialog({
  open,
  onOpenChange,
  currentA,
  currentB,
  platform,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentA: FilteredChatter | undefined;
  currentB: FilteredChatter | undefined;
  platform: string;
}) {
  const [activeTab, setActiveTab] = useState<"A" | "B">("A");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 overflow-hidden gap-0 border-white/10 max-w-[1400px] w-screen h-[100dvh] sm:w-[95vw] sm:h-[90vh] sm:rounded-lg rounded-none"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {/* Header: kompakt, mit großem Schließen-Button */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-white/[0.08] bg-white/[0.02] shrink-0">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground/80 min-w-0 flex-1">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
            <span className="capitalize truncate">{currentA?.name.replace(/_/g, " ") ?? "—"}</span>
            <span className="text-muted-foreground mx-1 shrink-0">vs</span>
            <span className="inline-block h-2 w-2 rounded-full bg-sky-400 shrink-0" />
            <span className="capitalize truncate">{currentB?.name.replace(/_/g, " ") ?? "—"}</span>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Schließen"
            className="inline-flex items-center justify-center h-11 w-11 rounded-md hover:bg-white/[0.08] active:bg-white/[0.12] text-white/60 hover:text-white transition-colors shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mobile: Tab-Switch zwischen den zwei Profilen */}
        <div className="sm:hidden flex p-1 m-2 mb-0 rounded-lg bg-white/[0.04] border border-white/[0.06] shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("A")}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-md text-xs font-medium transition-all",
              activeTab === "A"
                ? "bg-emerald-500/15 text-emerald-200 shadow-sm"
                : "text-white/55 hover:text-white/80"
            )}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="capitalize truncate max-w-[120px]">{currentA?.name.replace(/_/g, " ") ?? "A"}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("B")}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-md text-xs font-medium transition-all",
              activeTab === "B"
                ? "bg-sky-500/15 text-sky-200 shadow-sm"
                : "text-white/55 hover:text-white/80"
            )}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />
            <span className="capitalize truncate max-w-[120px]">{currentB?.name.replace(/_/g, " ") ?? "B"}</span>
          </button>
        </div>

        {/* Desktop: side-by-side */}
        <div className="hidden sm:grid sm:grid-cols-2 divide-x divide-white/[0.08] flex-1 overflow-hidden">
          <div className="overflow-y-auto">
            {currentA && (
              <ChatterSlideOver
                open={open}
                onClose={() => onOpenChange(false)}
                chatterName={currentA.name}
                platform={platform}
                inline
              />
            )}
          </div>
          <div className="overflow-y-auto">
            {currentB && (
              <ChatterSlideOver
                open={open}
                onClose={() => onOpenChange(false)}
                chatterName={currentB.name}
                platform={platform}
                inline
              />
            )}
          </div>
        </div>

        {/* Mobile: nur das aktive Profil */}
        <div className="sm:hidden flex-1 overflow-y-auto">
          {activeTab === "A" && currentA && (
            <ChatterSlideOver
              open={open}
              onClose={() => onOpenChange(false)}
              chatterName={currentA.name}
              platform={platform}
              inline
            />
          )}
          {activeTab === "B" && currentB && (
            <ChatterSlideOver
              open={open}
              onClose={() => onOpenChange(false)}
              chatterName={currentB.name}
              platform={platform}
              inline
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Slot Wrapper ------------------------ */

function CompareSlot({
  accent,
  item,
  enrichedMap,
  stackLength,
  idx,
  dismissedCount,
  metricLabel,
  onSwipeDismiss,
  onSwipeSkip,
  onReset,
  onTap,
  onDoubleTap,
}: {
  accent: "emerald" | "sky";
  item: FilteredChatter | undefined;
  enrichedMap: Map<string, SwapChatter>;
  stackLength: number;
  idx: number;
  dismissedCount: number;
  metricLabel: string;
  onSwipeDismiss: () => void;
  onSwipeSkip: () => void;
  onReset: () => void;
  onTap: (name: string) => void;
  onDoubleTap: () => void;
}) {
  const accentHsl = accent === "emerald" ? "152 70% 45%" : "200 90% 55%";
  const accentBorder = accent === "emerald" ? "border-emerald-500/20" : "border-sky-500/20";

  if (stackLength === 0) {
    return (
      <div
        className={cn(
          "rounded-2xl border bg-white/[0.02] backdrop-blur-sm p-4 min-h-[220px] sm:min-h-[280px] md:min-h-[420px] flex flex-col items-center justify-center text-center gap-3",
          accentBorder
        )}
      >
        <p className="text-xs text-muted-foreground">
          {dismissedCount > 0 ? `Alle abgehakt (${dismissedCount})` : "Keine Treffer"}
        </p>
        <p className="text-[10px] text-muted-foreground/70">
          {dismissedCount > 0 ? "Bis zum nächsten Report ausgeblendet" : "Filter lockern"}
        </p>
        {dismissedCount > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
          >
            <RotateCcw className="h-3 w-3" /> Zurücksetzen
          </button>
        )}
      </div>
    );
  }

  if (idx >= stackLength || !item) {
    return (
      <div
        className={cn(
          "rounded-2xl border bg-white/[0.02] backdrop-blur-sm p-4 min-h-[220px] sm:min-h-[280px] md:min-h-[420px] flex flex-col items-center justify-center text-center gap-3",
          accentBorder
        )}
      >
        <p className="text-xs text-foreground/80">Alle durch ({stackLength})</p>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      </div>
    );
  }

  const enriched = enrichedMap.get(normalizeName(item.name));

  return (
    <div className="space-y-1.5">
      {/* Slot-Container: clipped — Drag der Karte bleibt INNERHALB dieses Slots sichtbar */}
      <div className="relative w-full overflow-hidden rounded-2xl">
          <CompareSwipeCard
          accentHsl={accentHsl}
          item={item}
          enriched={enriched}
            metricLabel={metricLabel}
          onSwipeLR={onSwipeDismiss}
          onSwipeDown={onSwipeSkip}
          onSingleClick={() => onTap(item.name)}
          onDoubleClick={onDoubleTap}
        />
      </div>
      <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground/70 tabular-nums">
        <span>{idx + 1} / {stackLength}</span>
        {dismissedCount > 0 && (
          <span className="text-muted-foreground/50">· {dismissedCount} abgehakt</span>
        )}
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
          title="Reset"
        >
          <RotateCcw className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  );
}

/* --------------------------- Swipe Card -------------------------- */

function CompareSwipeCard({
  accentHsl,
  item,
  enriched,
  metricLabel,
  onSwipeLR,
  onSwipeDown,
  onSingleClick,
  onDoubleClick,
}: {
  accentHsl: string;
  item: FilteredChatter;
  enriched: SwapChatter | undefined;
  metricLabel: string;
  onSwipeLR: () => void;
  onSwipeDown: () => void;
  onSingleClick: () => void;
  onDoubleClick: () => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-6, 0, 6]);
  const controls = useAnimation();
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDragEnd = useCallback(
    async (_e: unknown, info: PanInfo) => {
      const { offset } = info;
      const ax = Math.abs(offset.x);
      const ay = Math.abs(offset.y);
      // Vertikal dominant → Down-Swipe = ans Stack-Ende (skip)
      if (ay > ax && offset.y > SWIPE_THRESHOLD) {
        await controls.start({ y: 500, opacity: 0, transition: { duration: 0.18 } });
        onSwipeDown();
        controls.set({ x: 0, y: 0, opacity: 1 });
        return;
      }
      // Up-Swipe ebenfalls als Skip behandeln (Symmetrie)
      if (ay > ax && offset.y < -SWIPE_THRESHOLD) {
        await controls.start({ y: -500, opacity: 0, transition: { duration: 0.18 } });
        onSwipeDown();
        controls.set({ x: 0, y: 0, opacity: 1 });
        return;
      }
      if (offset.x > SWIPE_THRESHOLD) {
        await controls.start({ x: 350, opacity: 0, transition: { duration: 0.18 } });
        onSwipeLR();
        controls.set({ x: 0, y: 0, opacity: 1 });
        return;
      }
      if (offset.x < -SWIPE_THRESHOLD) {
        await controls.start({ x: -350, opacity: 0, transition: { duration: 0.18 } });
        onSwipeLR();
        controls.set({ x: 0, y: 0, opacity: 1 });
        return;
      }
      controls.start({ x: 0, y: 0, transition: { type: "spring", stiffness: 300, damping: 28 } });
    },
    [controls, onSwipeLR, onSwipeDown]
  );

  const handleClick = useCallback(() => {
    if (Math.abs(x.get()) >= 6 || Math.abs(y.get()) >= 6) return;
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      onDoubleClick();
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onSingleClick();
    }, 250);
  }, [x, y, onSingleClick, onDoubleClick]);

  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
  }, []);

  // Daten-Quellen: enriched (Swap) bevorzugt, sonst Fallback aus FilteredChatter
  const tier = enriched?.tier ?? "—";
  const followers = enriched?.followers ?? 0;
  const skill = enriched?.skillScore ?? 0;
  const avgRev = item.avgRevWindow;
  const today = enriched?.currentRevenue ?? item.currentRevenue ?? 0;
  const firstSeen = enriched?.firstSeen ?? null;
  const account = enriched?.account ?? item.account ?? "";

  return (
    <motion.div
      drag
      dragElastic={0.18}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      animate={controls}
      style={{ x, y, rotate, touchAction: "none" }}
      className="relative w-full rounded-2xl overflow-hidden select-none cursor-grab active:cursor-grabbing"
    >
      <div
        className="absolute inset-x-0 top-0 h-[2px] z-10"
        style={{ background: `linear-gradient(90deg, transparent, hsl(${accentHsl} / 0.7), transparent)` }}
      />
      <div
          className="p-3 sm:p-2.5 md:p-4 border border-white/[0.06] rounded-2xl min-h-[220px] sm:min-h-[280px] md:min-h-[420px] flex flex-col"
        style={{
          background: `radial-gradient(140% 100% at 50% -20%, hsl(${accentHsl} / 0.08) 0%, transparent 55%), linear-gradient(180deg, hsl(240 6% 8%) 0%, hsl(240 6% 5%) 100%)`,
          boxShadow: `0 16px 40px -20px hsl(240 10% 0% / 0.6), inset 0 1px 0 hsl(0 0% 100% / 0.04)`,
        }}
      >
        {/* Tier-Pill */}
        <div className="flex items-center justify-between mb-2">
          <span
            className="text-[8px] md:text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md border truncate"
            style={{
              color: `hsl(${accentHsl})`,
              borderColor: `hsl(${accentHsl} / 0.35)`,
              background: `hsl(${accentHsl} / 0.08)`,
            }}
          >
            {tier}
          </span>
        </div>

        {/* Name */}
        <h3 className="text-base sm:text-sm md:text-xl font-semibold text-foreground capitalize truncate leading-tight">
          {item.name.replace(/_/g, " ")}
        </h3>
        <p className="text-[9px] md:text-xs text-white/45 truncate">@ {account || "—"}</p>
        <div className="flex items-center gap-2 mt-1 mb-2 md:mb-3 flex-wrap">
          <p className="text-[9px] md:text-xs text-white/40 inline-flex items-center gap-1">
            <Users className="h-2.5 w-2.5 md:h-3 md:w-3" />
            {formatFollowers(followers)}
          </p>
        </div>

        {/* Skill Bar */}
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-1.5 md:p-3 mb-2 md:mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] md:text-[10px] uppercase tracking-wider text-white/45 inline-flex items-center gap-1">
              <Zap className="h-2.5 w-2.5 md:h-3 md:w-3" /> Skill
            </span>
            <span className="text-[11px] md:text-base font-bold tabular-nums" style={{ color: `hsl(${accentHsl})` }}>
              {formatSkill(skill)}
            </span>
          </div>
          <div className="h-1 md:h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.round(skill * 100)}%`,
                background: `linear-gradient(90deg, hsl(${accentHsl} / 0.6), hsl(${accentHsl}))`,
              }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-1.5 md:gap-2 mt-auto">
          <div className="rounded-md bg-white/[0.03] border border-white/[0.06] p-1.5 md:p-2.5">
            <p className="text-[8px] md:text-[10px] uppercase tracking-wider text-white/40">{metricLabel}</p>
            <p className="text-sm sm:text-[11px] md:text-sm font-semibold text-foreground tabular-nums truncate">{formatEur(avgRev)}</p>
          </div>
          <div className="rounded-md bg-white/[0.03] border border-white/[0.06] p-1.5 md:p-2.5">
            <p className="text-[8px] md:text-[10px] uppercase tracking-wider text-white/40">Heute</p>
            <p className="text-sm sm:text-[11px] md:text-sm font-semibold text-foreground tabular-nums truncate">{formatEur(today)}</p>
          </div>
        </div>

        {firstSeen && (
          <p className="hidden md:inline-flex items-center gap-1 text-[10px] text-white/35 mt-2">
            <CalendarDays className="h-3 w-3" /> seit {formatStartDate(firstSeen)}
          </p>
        )}
      </div>
    </motion.div>
  );
}

/* --------------------------- Live Delta -------------------------- */

function LiveDeltaBox({
  a,
  b,
  enrichedMap,
}: {
  a: FilteredChatter | undefined;
  b: FilteredChatter | undefined;
  enrichedMap: Map<string, SwapChatter>;
}) {
  if (!a || !b) return null;

  const ea = enrichedMap.get(normalizeName(a.name));
  const eb = enrichedMap.get(normalizeName(b.name));

  const avgA = a.avgRevWindow;
  const avgB = b.avgRevWindow;
  const skillA = ea?.skillScore ?? 0;
  const skillB = eb?.skillScore ?? 0;
  const todayA = ea?.currentRevenue ?? a.currentRevenue ?? 0;
  const todayB = eb?.currentRevenue ?? b.currentRevenue ?? 0;

  const dAvg = avgB - avgA;
  const dSkill = skillB - skillA;
  const dToday = todayB - todayA;

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-2.5 space-y-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-primary/80">
        <span>Δ A → B</span>
        <span className="text-foreground/70 normal-case tracking-normal truncate ml-2 min-w-0">
          {a.name} vs {b.name}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <DeltaPill label="Ø €" delta={dAvg} fmt={formatEur} positiveGood />
        <DeltaPill label="Skill" delta={dSkill} fmt={(n) => n.toFixed(2)} positiveGood />
        <DeltaPill label="Heute" delta={dToday} fmt={formatEur} positiveGood />
      </div>
    </div>
  );
}

function DeltaPill({
  label,
  delta,
  fmt,
  positiveGood,
}: {
  label: string;
  delta: number;
  fmt: (n: number) => string;
  positiveGood: boolean;
}) {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const isGood = (delta > 0 && positiveGood) || (delta < 0 && !positiveGood);
  const isBad = (delta < 0 && positiveGood) || (delta > 0 && !positiveGood);
  const color = isGood ? "text-emerald-400" : isBad ? "text-red-400" : "text-muted-foreground";
  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums font-medium", color)}>
        {sign}
        {fmt(Math.abs(delta))}
      </span>
    </div>
  );
}
