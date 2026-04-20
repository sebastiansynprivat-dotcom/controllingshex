import { useEffect, useMemo, useState } from "react";
import { ArrowRight, TrendingDown, TrendingUp, Minus } from "lucide-react";
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
  type CompareFilter,
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
  onChatterClick: (chatterName: string) => void;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
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
  onChatterClick,
}: Props) {
  const [state, setState] = useState(() => loadCompareState());
  const [activeMobile, setActiveMobile] = useState<"A" | "B">("A");

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
    }),
    [chatters, rangeHistory, range, recategorizedMap, labelsByChatter, tierIdsByChatter, alertChatterNames]
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
      {/* Preset bar */}
      <div className="flex flex-wrap gap-1.5">
        {[...DEFAULT_PRESETS, ...state.customPresets].map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p)}
            className="px-2.5 py-1 rounded-md text-[10px] font-medium border bg-white/[0.03] border-white/[0.06] text-white/70 hover:text-foreground hover:border-white/15 transition-all"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Mobile A/B switcher */}
      <div className="md:hidden flex p-0.5 rounded-full bg-white/[0.03] border border-white/[0.06]">
        {(["A", "B"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setActiveMobile(s)}
            className={cn(
              "flex-1 text-xs font-medium py-1 rounded-full transition-all",
              activeMobile === s
                ? "bg-white/[0.08] text-foreground"
                : "text-muted-foreground"
            )}
          >
            Set {s}
          </button>
        ))}
      </div>

      {/* Two-column filter + stats */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className={cn("space-y-3", activeMobile === "B" && "hidden md:block")}>
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
        <div className={cn("space-y-3", activeMobile === "A" && "hidden md:block")}>
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

      {/* Delta box */}
      <DeltaBox statsA={statsA} statsB={statsB} identical={identical} />
    </div>
  );
}

/* --------------------------- Sub Components ---------------------- */

function StatsCard({ stats, accent }: { stats: ReturnType<typeof computeCompareStats>; accent: "emerald" | "sky" }) {
  const accentText = accent === "emerald" ? "text-emerald-300" : "text-sky-300";
  if (stats.count === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
        <p className="text-xs text-muted-foreground">Keine Chatter im Filter</p>
        <p className="text-[10px] text-muted-foreground/70 mt-1">Lockere die Kriterien.</p>
      </div>
    );
  }

  const trendIcon = stats.trend > 0.05 ? TrendingUp : stats.trend < -0.05 ? TrendingDown : Minus;
  const TrendIcon = trendIcon;
  const trendColor =
    stats.trend > 0.05 ? "text-emerald-400" : stats.trend < -0.05 ? "text-red-400" : "text-muted-foreground";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className={cn("text-2xl font-semibold tabular-nums", accentText)}>{stats.count}</span>
        <span className="text-[10px] text-muted-foreground">Chatter</span>
      </div>
      <Stat label="Ø € / Tag" value={formatEur(stats.avgRev)} />
      <Stat label="Σ € im Fenster" value={formatEur(stats.sumRev)} />
      <Stat label="Null-Tage" value={formatPct(stats.zeroRate)} />
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Trend</span>
        <span className={cn("inline-flex items-center gap-1 tabular-nums", trendColor)}>
          <TrendIcon className="h-3 w-3" /> {formatTrendPct(stats.trend)}
        </span>
      </div>
      {stats.topChatter && (
        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-white/[0.04]">
          <span className="text-muted-foreground">Top</span>
          <span className="text-foreground/90 truncate max-w-[60%]">
            {stats.topChatter.name} · {formatEur(stats.topChatter.avgRev)}
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
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-white/[0.04]">
        Chatter ({items.length})
      </div>
      <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.04]">
        {items.map((c) => {
          const trend = c.zeroRateWindow;
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => onClick(c.name)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-white/[0.03] transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs text-foreground/90 truncate">{c.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {c.account || "—"} · {c.category || "—"}
                </div>
              </div>
              <div className="text-right shrink-0 ml-2">
                <div className="text-xs tabular-nums text-foreground/90">{formatEur(c.avgRevWindow)}</div>
                <div
                  className={cn(
                    "text-[10px] tabular-nums",
                    trend >= 0.5 ? "text-red-400" : trend >= 0.3 ? "text-amber-400" : "text-muted-foreground"
                  )}
                >
                  {formatPct(trend)} ⊘
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
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center text-xs text-muted-foreground">
        Gleiche Auswahl — kein Vergleich möglich
      </div>
    );
  }
  if (statsA.count === 0 || statsB.count === 0) return null;

  const dAvg = statsB.avgRev - statsA.avgRev;
  const dSum = statsB.sumRev - statsA.sumRev;
  const dZero = (statsB.zeroRate - statsA.zeroRate) * 100;
  const dCount = statsB.count - statsA.count;

  const fmtSign = (n: number, fmt: (x: number) => string) => `${n > 0 ? "+" : ""}${fmt(Math.abs(n) * Math.sign(n))}`;
  const winner = dAvg > 0 ? "B" : dAvg < 0 ? "A" : null;

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3 space-y-1.5">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-primary/80">
        <span>Δ Set A → Set B</span>
        {winner && <span className="text-foreground/80">Set {winner} besser bei Ø €</span>}
      </div>
      <DeltaRow label="Ø € / Tag" value={fmtSign(dAvg, formatEur)} positive={dAvg > 0} />
      <DeltaRow label="Σ € Fenster" value={fmtSign(dSum, formatEur)} positive={dSum > 0} />
      <DeltaRow label="Null-Tage" value={`${dZero > 0 ? "+" : ""}${dZero.toFixed(0)}pp`} positive={dZero < 0} />
      <DeltaRow label="Anzahl" value={`${dCount > 0 ? "+" : ""}${dCount}`} positive={dCount > 0} />
    </div>
  );
}

function DeltaRow({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground inline-flex items-center gap-1">
        <ArrowRight className="h-3 w-3" /> {label}
      </span>
      <span className={cn("tabular-nums font-medium", positive ? "text-emerald-400" : "text-red-400")}>{value}</span>
    </div>
  );
}
