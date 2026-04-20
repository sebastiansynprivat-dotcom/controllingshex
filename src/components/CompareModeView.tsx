import { useEffect, useMemo, useState } from "react";
import { TrendingDown, TrendingUp, Minus, Crown, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import CompareFilterPanel from "@/components/CompareFilterPanel";
import {
  applyCompareFilter,
  computeCompareStats,
  loadCompareState,
  saveCompareState,
  formatEur,
  formatPct,
  formatTrendPct,
  DEFAULT_PRESETS,
  type ComparePreset,
  type ApplyFilterContext,
  type FilteredChatter,
} from "@/lib/compare-filters";
import type { TimeRange, HistoryRow as RangeHistoryRow } from "@/lib/timerange-categorize";
import type { ActionCategoryName } from "@/lib/action-categories";
import type { AccountTierId } from "@/lib/account-tiers";

interface Props {
  chatters: ApplyFilterContext["chatters"];
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

export default function CompareModeView({
  chatters,
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
  const statsA = useMemo(() => computeCompareStats(filteredA, ctx), [filteredA, ctx]);
  const statsB = useMemo(() => computeCompareStats(filteredB, ctx), [filteredB, ctx]);

  const identical = useMemo(
    () => JSON.stringify(state.setA) === JSON.stringify(state.setB),
    [state.setA, state.setB]
  );

  const applyPreset = (p: ComparePreset) =>
    setState((s) => ({ ...s, setA: p.setA, setB: p.setB }));

  return (
    <div className="flex-1 overflow-y-auto pb-6 space-y-3">
      {/* Preset bar — horizontal scroll on mobile */}
      <div className="flex gap-1.5 overflow-x-auto whitespace-nowrap -mx-1 px-1 pb-1 scrollbar-none">
        {[...DEFAULT_PRESETS, ...state.customPresets].map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p)}
            className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-medium border bg-white/[0.03] border-white/[0.06] text-white/70 hover:text-foreground hover:border-white/15 transition-all"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Two true side-by-side comparison cards */}
      <div className="grid grid-cols-2 gap-2 md:gap-3">
        <div className="space-y-2 md:space-y-3 min-w-0">
          <CompareFilterPanel
            label="Set A"
            accent="emerald"
            filter={state.setA}
            onChange={(f) => setState((s) => ({ ...s, setA: f }))}
            allLabels={allLabels}
          />
          <CompareCard stats={statsA} items={filteredA} accent="emerald" onChatterClick={onChatterClick} />
        </div>
        <div className="space-y-2 md:space-y-3 min-w-0">
          <CompareFilterPanel
            label="Set B"
            accent="sky"
            filter={state.setB}
            onChange={(f) => setState((s) => ({ ...s, setB: f }))}
            allLabels={allLabels}
          />
          <CompareCard stats={statsB} items={filteredB} accent="sky" onChatterClick={onChatterClick} />
        </div>
      </div>

      {/* Delta box (full width below) */}
      <DeltaBox statsA={statsA} statsB={statsB} identical={identical} />
    </div>
  );
}

/* --------------------------- Sub Components ---------------------- */

function CompareCard({
  stats,
  items,
  accent,
  onChatterClick,
}: {
  stats: ReturnType<typeof computeCompareStats>;
  items: FilteredChatter[];
  accent: "emerald" | "sky";
  onChatterClick: (n: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const accentText = accent === "emerald" ? "text-emerald-300" : "text-sky-300";
  const accentGradient =
    accent === "emerald"
      ? "from-emerald-500/[0.08] via-emerald-500/[0.02] to-transparent"
      : "from-sky-500/[0.08] via-sky-500/[0.02] to-transparent";
  const accentBorder = accent === "emerald" ? "border-emerald-500/20" : "border-sky-500/20";

  if (stats.count === 0) {
    return (
      <div
        className={cn(
          "rounded-xl border bg-gradient-to-b backdrop-blur-sm p-3 md:p-4 min-h-[280px] flex flex-col items-center justify-center text-center",
          accentBorder,
          accentGradient
        )}
      >
        <p className="text-xs text-muted-foreground">Keine Treffer</p>
        <p className="text-[10px] text-muted-foreground/70 mt-1">Filter lockern</p>
      </div>
    );
  }

  const TrendIcon = stats.trend > 0.05 ? TrendingUp : stats.trend < -0.05 ? TrendingDown : Minus;
  const trendColor =
    stats.trend > 0.05 ? "text-emerald-400" : stats.trend < -0.05 ? "text-red-400" : "text-muted-foreground";

  // sort by avgRevWindow desc to surface top chatters
  const sorted = [...items].sort((a, b) => b.avgRevWindow - a.avgRevWindow);
  const top = sorted[0];
  const next = sorted.slice(1, 4);
  const rest = sorted.slice(4);

  return (
    <div
      className={cn(
        "rounded-xl border bg-gradient-to-b backdrop-blur-sm overflow-hidden",
        accentBorder,
        accentGradient
      )}
    >
      {/* Hero */}
      <div className="px-2.5 md:px-4 pt-3 md:pt-4 pb-2 md:pb-3 text-center border-b border-white/[0.04]">
        <div className={cn("text-2xl md:text-4xl font-bold tabular-nums leading-none", accentText)}>
          {stats.count}
        </div>
        <div className="text-[9px] md:text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
          Chatter
        </div>
        <div className="mt-2 md:mt-3 text-base md:text-2xl font-semibold tabular-nums text-foreground/95 leading-none">
          {formatEur(stats.avgRev)}
        </div>
        <div className="text-[9px] md:text-[10px] text-muted-foreground mt-0.5">Ø € / Tag</div>
      </div>

      {/* Secondary KPIs */}
      <div className="px-2.5 md:px-4 py-2 md:py-2.5 border-b border-white/[0.04] space-y-1">
        <div className="flex items-center justify-between text-[10px] md:text-[11px]">
          <span className="text-muted-foreground">Σ</span>
          <span className="tabular-nums text-foreground/90">{formatEur(stats.sumRev)}</span>
        </div>
        <div className="flex items-center justify-between text-[10px] md:text-[11px]">
          <span className="text-muted-foreground">⊘</span>
          <span className="tabular-nums text-foreground/90">{formatPct(stats.zeroRate)}</span>
        </div>
        <div className="flex items-center justify-between text-[10px] md:text-[11px]">
          <span className="text-muted-foreground">Trend</span>
          <span className={cn("inline-flex items-center gap-0.5 tabular-nums", trendColor)}>
            <TrendIcon className="h-3 w-3" />
            {formatTrendPct(stats.trend)}
          </span>
        </div>
      </div>

      {/* Top chatter highlight */}
      {top && (
        <button
          type="button"
          onClick={() => onChatterClick(top.name)}
          className="w-full px-2.5 md:px-4 py-2 md:py-2.5 text-left hover:bg-white/[0.03] transition-colors border-b border-white/[0.04]"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Crown className={cn("h-3 w-3 shrink-0", accentText)} />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Top</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] md:text-sm text-foreground/95 truncate min-w-0">{top.name}</span>
            <span className="text-[11px] md:text-sm tabular-nums font-medium text-foreground/95 shrink-0">
              {formatEur(top.avgRevWindow)}
            </span>
          </div>
        </button>
      )}

      {/* Next 3 */}
      {next.length > 0 && (
        <div className="divide-y divide-white/[0.04]">
          {next.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => onChatterClick(c.name)}
              className="w-full px-2.5 md:px-4 py-1.5 md:py-2 text-left hover:bg-white/[0.03] transition-colors flex items-baseline justify-between gap-2"
            >
              <span className="text-[10px] md:text-xs text-foreground/85 truncate min-w-0">{c.name}</span>
              <span className="text-[10px] md:text-xs tabular-nums text-foreground/85 shrink-0">
                {formatEur(c.avgRevWindow)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Expand rest */}
      {rest.length > 0 && (
        <>
          {expanded && (
            <div className="divide-y divide-white/[0.04] max-h-[35vh] overflow-y-auto border-t border-white/[0.04]">
              {rest.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => onChatterClick(c.name)}
                  className="w-full px-2.5 md:px-4 py-1.5 md:py-2 text-left hover:bg-white/[0.03] transition-colors flex items-baseline justify-between gap-2"
                >
                  <span className="text-[10px] md:text-xs text-foreground/80 truncate min-w-0">{c.name}</span>
                  <span className="text-[10px] md:text-xs tabular-nums text-foreground/80 shrink-0">
                    {formatEur(c.avgRevWindow)}
                  </span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="w-full px-2.5 md:px-4 py-1.5 md:py-2 text-[10px] md:text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/[0.03] transition-colors flex items-center justify-center gap-1 border-t border-white/[0.04]"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" /> weniger
              </>
            ) : (
              <>
                +{rest.length} weitere <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}

function DeltaBox({
  statsA,
  statsB,
  identical,
}: {
  statsA: ReturnType<typeof computeCompareStats>;
  statsB: ReturnType<typeof computeCompareStats>;
  identical: boolean;
}) {
  if (identical) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 text-center text-[11px] text-muted-foreground">
        Gleiche Auswahl — kein Vergleich
      </div>
    );
  }
  if (statsA.count === 0 || statsB.count === 0) return null;

  const dAvg = statsB.avgRev - statsA.avgRev;
  const dSum = statsB.sumRev - statsA.sumRev;
  const dZero = (statsB.zeroRate - statsA.zeroRate) * 100;
  const dCount = statsB.count - statsA.count;

  const winner = dAvg > 0 ? "B" : dAvg < 0 ? "A" : null;

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-2.5 md:p-3 space-y-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-primary/80">
        <span>Δ A → B</span>
        {winner && <span className="text-foreground/80 normal-case tracking-normal">Set {winner} stärker</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <DeltaPill label="Ø €" delta={dAvg} fmt={formatEur} positiveGood />
        <DeltaPill label="Σ €" delta={dSum} fmt={formatEur} positiveGood />
        <DeltaPill
          label="⊘"
          delta={dZero}
          fmt={(n) => `${n.toFixed(0)}pp`}
          positiveGood={false}
        />
        <DeltaPill label="#" delta={dCount} fmt={(n) => `${n}`} positiveGood />
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
