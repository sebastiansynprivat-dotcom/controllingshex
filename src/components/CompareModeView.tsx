import { useEffect, useMemo, useState } from "react";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
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

      {/* Two true side-by-side columns (also on mobile) */}
      <div className="grid grid-cols-2 gap-2 md:gap-3">
        <div className="space-y-2 md:space-y-3 min-w-0">
          <CompareFilterPanel
            label="Set A"
            accent="emerald"
            filter={state.setA}
            onChange={(f) => setState((s) => ({ ...s, setA: f }))}
            allLabels={allLabels}
          />
          <StatsCard stats={statsA} accent="emerald" />
          <ChatterList items={filteredA} onClick={onChatterClick} />
        </div>
        <div className="space-y-2 md:space-y-3 min-w-0">
          <CompareFilterPanel
            label="Set B"
            accent="sky"
            filter={state.setB}
            onChange={(f) => setState((s) => ({ ...s, setB: f }))}
            allLabels={allLabels}
          />
          <StatsCard stats={statsB} accent="sky" />
          <ChatterList items={filteredB} onClick={onChatterClick} />
        </div>
      </div>

      {/* Delta box (full width below) */}
      <DeltaBox statsA={statsA} statsB={statsB} identical={identical} />
    </div>
  );
}

/* --------------------------- Sub Components ---------------------- */

function StatsCard({
  stats,
  accent,
}: {
  stats: ReturnType<typeof computeCompareStats>;
  accent: "emerald" | "sky";
}) {
  const accentText = accent === "emerald" ? "text-emerald-300" : "text-sky-300";
  if (stats.count === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 md:p-3 text-center">
        <p className="text-[11px] text-muted-foreground">Keine Treffer</p>
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">Filter lockern</p>
      </div>
    );
  }

  const TrendIcon = stats.trend > 0.05 ? TrendingUp : stats.trend < -0.05 ? TrendingDown : Minus;
  const trendColor =
    stats.trend > 0.05 ? "text-emerald-400" : stats.trend < -0.05 ? "text-red-400" : "text-muted-foreground";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 md:p-3 space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className={cn("text-lg md:text-2xl font-semibold tabular-nums leading-none", accentText)}>
          {stats.count}
        </span>
        <span className="text-[10px] text-muted-foreground">Chatter</span>
      </div>
      {/* Compact one-line stats on mobile, structured on desktop */}
      <div className="md:hidden space-y-1">
        <div className="text-[11px] tabular-nums text-foreground/90 truncate">
          Ø {formatEur(stats.avgRev)}
        </div>
        <div className="text-[11px] tabular-nums text-foreground/90 truncate">
          Σ {formatEur(stats.sumRev)}
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="tabular-nums text-foreground/80">⊘ {formatPct(stats.zeroRate)}</span>
          <span className={cn("inline-flex items-center gap-0.5 tabular-nums", trendColor)}>
            <TrendIcon className="h-3 w-3" />
            {formatTrendPct(stats.trend)}
          </span>
        </div>
      </div>
      <div className="hidden md:block space-y-1.5">
        <Stat label="Ø € / Tag" value={formatEur(stats.avgRev)} />
        <Stat label="Σ € im Fenster" value={formatEur(stats.sumRev)} />
        <Stat label="Null-Tage" value={formatPct(stats.zeroRate)} />
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Trend</span>
          <span className={cn("inline-flex items-center gap-1 tabular-nums", trendColor)}>
            <TrendIcon className="h-3 w-3" /> {formatTrendPct(stats.trend)}
          </span>
        </div>
      </div>
      {stats.topChatter && (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between text-[10px] md:text-[11px] pt-1 border-t border-white/[0.04]">
          <span className="text-muted-foreground">Top</span>
          <span className="text-foreground/90 truncate md:max-w-[60%]">
            {stats.topChatter.name}
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground/90 tabular-nums">{value}</span>
    </div>
  );
}

function ChatterList({ items, onClick }: { items: FilteredChatter[]; onClick: (n: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="px-2 md:px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-white/[0.04]">
        Chatter ({items.length})
      </div>
      <div className="max-h-[40vh] md:max-h-72 overflow-y-auto divide-y divide-white/[0.04]">
        {items.map((c) => {
          const trend = c.zeroRateWindow;
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => onClick(c.name)}
              className="w-full px-2 md:px-3 py-1.5 text-left hover:bg-white/[0.03] transition-colors block"
            >
              {/* Mobile: stacked. Desktop: row */}
              <div className="md:flex md:items-center md:justify-between">
                <div className="min-w-0 md:flex-1">
                  <div className="text-[11px] md:text-xs text-foreground/90 truncate">{c.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate hidden md:block">
                    {c.account || "—"} · {c.category || "—"}
                  </div>
                </div>
                <div className="flex items-center justify-between md:block md:text-right md:shrink-0 md:ml-2 mt-0.5 md:mt-0">
                  <div className="text-[11px] md:text-xs tabular-nums text-foreground/90">
                    {formatEur(c.avgRevWindow)}
                  </div>
                  <div
                    className={cn(
                      "text-[10px] tabular-nums",
                      trend >= 0.5 ? "text-red-400" : trend >= 0.3 ? "text-amber-400" : "text-muted-foreground"
                    )}
                  >
                    {formatPct(trend)}⊘
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
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
