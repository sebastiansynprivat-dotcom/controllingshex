import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { motion, useMotionValue, useTransform, useAnimation, type PanInfo } from "framer-motion";
import { Users, Zap, CalendarDays, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { usePlatform } from "@/contexts/PlatformContext";
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
    }),
    [chatters, rangeHistory, range, recategorizedMap, labelsByChatter, tierIdsByChatter, alertChatterNames, firstSeenByChatter]
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

  // Indep. State pro Seite: Index + skipped (an Stack-Ende verschoben)
  const [idxA, setIdxA] = useState(0);
  const [idxB, setIdxB] = useState(0);
  const [skippedA, setSkippedA] = useState<string[]>([]);
  const [skippedB, setSkippedB] = useState<string[]>([]);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const { platform } = usePlatform();

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

  // Render-Reihenfolge: nicht-skipped zuerst, dann skipped am Ende
  const orderedA = useMemo(() => {
    const skip = new Set(skippedA);
    return [...stackA.filter((c) => !skip.has(c.name)), ...stackA.filter((c) => skip.has(c.name))];
  }, [stackA, skippedA]);
  const orderedB = useMemo(() => {
    const skip = new Set(skippedB);
    return [...stackB.filter((c) => !skip.has(c.name)), ...stackB.filter((c) => skip.has(c.name))];
  }, [stackB, skippedB]);

  const currentA = orderedA[idxA];
  const currentB = orderedB[idxB];

  return (
    <div className="flex-1 overflow-y-auto pb-6 space-y-3" style={{ touchAction: "pan-y" }}>
      {/* Filter chip headers (Presets sind im Akkordeon integriert) */}
      <div className="grid grid-cols-2 gap-2 md:gap-3">
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
      <div className="grid grid-cols-2 gap-2 md:gap-3 items-start">
        <CompareSlot
          accent="emerald"
          item={currentA}
          enrichedMap={enrichedByName}
          stackLength={orderedA.length}
          idx={idxA}
          onSwipeNext={() => setIdxA((i) => Math.min(i + 1, orderedA.length))}
          onSwipeSkip={() => {
            if (currentA) {
              setSkippedA((s) => [...s.filter((n) => n !== currentA.name), currentA.name]);
              setIdxA((i) => Math.min(i + 1, orderedA.length));
            }
          }}
          onReset={() => { setIdxA(0); setSkippedA([]); }}
          onTap={handleCardSingleClick}
          onDoubleTap={handleCardDoubleClick}
        />
        <CompareSlot
          accent="sky"
          item={currentB}
          enrichedMap={enrichedByName}
          stackLength={orderedB.length}
          idx={idxB}
          onSwipeNext={() => setIdxB((i) => Math.min(i + 1, orderedB.length))}
          onSwipeSkip={() => {
            if (currentB) {
              setSkippedB((s) => [...s.filter((n) => n !== currentB.name), currentB.name]);
              setIdxB((i) => Math.min(i + 1, orderedB.length));
            }
          }}
          onReset={() => { setIdxB(0); setSkippedB([]); }}
          onTap={handleCardSingleClick}
          onDoubleTap={handleCardDoubleClick}
        />
      </div>

      {/* Live Δ between currently visible chatters */}
      <LiveDeltaBox a={currentA} b={currentB} enrichedMap={enrichedByName} />

      {/* Compare Dialog — beide Performance-Profile nebeneinander */}
      <Dialog open={compareDialogOpen} onOpenChange={setCompareDialogOpen}>
        <DialogContent className="max-w-[1400px] w-[95vw] h-[90vh] p-0 overflow-hidden gap-0 border-white/10">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.08] bg-white/[0.02]">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground/80">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              <span className="capitalize">{currentA?.name.replace(/_/g, " ") ?? "—"}</span>
              <span className="text-muted-foreground mx-1">vs</span>
              <span className="inline-block h-2 w-2 rounded-full bg-sky-400" />
              <span className="capitalize">{currentB?.name.replace(/_/g, " ") ?? "—"}</span>
            </div>
            <button
              type="button"
              onClick={() => setCompareDialogOpen(false)}
              className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-white/[0.06] text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 divide-x divide-white/[0.08] flex-1 overflow-hidden">
            <div className="overflow-y-auto">
              {currentA && (
                <ChatterSlideOver
                  open={compareDialogOpen}
                  onClose={() => setCompareDialogOpen(false)}
                  chatterName={currentA.name}
                  platform={platform}
                  inline
                />
              )}
            </div>
            <div className="overflow-y-auto">
              {currentB && (
                <ChatterSlideOver
                  open={compareDialogOpen}
                  onClose={() => setCompareDialogOpen(false)}
                  chatterName={currentB.name}
                  platform={platform}
                  inline
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* --------------------------- Slot Wrapper ------------------------ */

function CompareSlot({
  accent,
  item,
  enrichedMap,
  stackLength,
  idx,
  onSwipeNext,
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
  onSwipeNext: () => void;
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
          "rounded-2xl border bg-white/[0.02] backdrop-blur-sm p-4 min-h-[280px] md:min-h-[420px] flex flex-col items-center justify-center text-center",
          accentBorder
        )}
      >
        <p className="text-xs text-muted-foreground">Keine Treffer</p>
        <p className="text-[10px] text-muted-foreground/70 mt-1">Filter lockern</p>
      </div>
    );
  }

  if (idx >= stackLength || !item) {
    return (
      <div
        className={cn(
          "rounded-2xl border bg-white/[0.02] backdrop-blur-sm p-4 min-h-[280px] md:min-h-[420px] flex flex-col items-center justify-center text-center gap-3",
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
          onSwipeLR={onSwipeNext}
          onSwipeUp={onSwipeSkip}
          onSingleClick={() => onTap(item.name)}
          onDoubleClick={onDoubleTap}
        />
      </div>
      <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground/70 tabular-nums">
        <span>{idx + 1} / {stackLength}</span>
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
  onSwipeLR,
  onSwipeUp,
  onSingleClick,
}: {
  accentHsl: string;
  item: FilteredChatter;
  enriched: SwapChatter | undefined;
  onSwipeLR: () => void;
  onSwipeUp: () => void;
  onSingleClick: () => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-6, 0, 6]);
  const controls = useAnimation();

  const handleDragEnd = useCallback(
    async (_e: unknown, info: PanInfo) => {
      const { offset } = info;
      const ax = Math.abs(offset.x);
      const ay = Math.abs(offset.y);
      if (ay > ax && offset.y < -SWIPE_THRESHOLD) {
        await controls.start({ y: -500, opacity: 0, transition: { duration: 0.18 } });
        onSwipeUp();
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
    [controls, onSwipeLR, onSwipeUp]
  );

  const handleClick = useCallback(() => {
    if (Math.abs(x.get()) >= 6 || Math.abs(y.get()) >= 6) return;
    onSingleClick();
  }, [x, y, onSingleClick]);

  // Daten-Quellen: enriched (Swap) bevorzugt, sonst Fallback aus FilteredChatter
  const tier = enriched?.tier ?? "—";
  const followers = enriched?.followers ?? 0;
  const skill = enriched?.skillScore ?? 0;
  const avgRev = enriched?.avgRevenue ?? item.avgRevWindow;
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
        className="p-2.5 md:p-4 border border-white/[0.06] rounded-2xl min-h-[280px] md:min-h-[420px] flex flex-col"
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
        <h3 className="text-sm md:text-xl font-semibold text-foreground capitalize truncate leading-tight">
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
            <p className="text-[8px] md:text-[10px] uppercase tracking-wider text-white/40">7T-Ø</p>
            <p className="text-[11px] md:text-sm font-semibold text-foreground tabular-nums truncate">{formatEur(avgRev)}</p>
          </div>
          <div className="rounded-md bg-white/[0.03] border border-white/[0.06] p-1.5 md:p-2.5">
            <p className="text-[8px] md:text-[10px] uppercase tracking-wider text-white/40">Heute</p>
            <p className="text-[11px] md:text-sm font-semibold text-foreground tabular-nums truncate">{formatEur(today)}</p>
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

  const avgA = ea?.avgRevenue ?? a.avgRevWindow;
  const avgB = eb?.avgRevenue ?? b.avgRevWindow;
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
