import { useMemo } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { TrendingUp, TrendingDown, Minus, ChevronRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtEur, type ModelOverviewRow, type TrendDirection } from "@/lib/model-tracking-overview";
import { categorizeRowsByChatterAge, aggregateModelCountDaily, aggregateModelsInDeclineDaily, NEW_CHATTER_THRESHOLD_DAYS, type BucketDefinition } from "@/lib/model-tracking-buckets";

interface Props {
  open: boolean;
  onClose: () => void;
  direction: TrendDirection | null;
  rows: ModelOverviewRow[];
  onSelectModel: (name: string, chatter: string | null) => void;
}

const DIRECTION_META: Record<Exclude<TrendDirection, "none">, {
  title: string;
  subtitle: string;
  icon: typeof TrendingUp;
  accent: string;
  fill: string;
  stroke: string;
  dot: string;
}> = {
  up: {
    title: "Wachstum",
    subtitle: "Models mit positivem Umsatztrend im Zeitraum",
    icon: TrendingUp,
    accent: "text-emerald-300",
    fill: "hsl(160, 70%, 50% / 0.2)",
    stroke: "hsl(160, 70%, 55%)",
    dot: "bg-emerald-400",
  },
  flat: {
    title: "Stabil",
    subtitle: "Models ohne signifikante Bewegung",
    icon: Minus,
    accent: "text-white/70",
    fill: "hsl(0, 0%, 100% / 0.1)",
    stroke: "hsl(0, 0%, 80%)",
    dot: "bg-white/50",
  },
  down: {
    title: "Rückgang",
    subtitle: "Models mit negativem Umsatztrend im Zeitraum",
    icon: TrendingDown,
    accent: "text-red-300",
    fill: "hsl(0, 70%, 60% / 0.2)",
    stroke: "hsl(0, 70%, 65%)",
    dot: "bg-red-400",
  },
};

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

export default function TrendCategoryDetailSheet({ open, onClose, direction, rows, onSelectModel }: Props) {
  const meta = direction && direction !== "none" ? DIRECTION_META[direction] : null;

  const filteredRows = useMemo(() => {
    if (!direction) return [];
    return rows.filter((r) => r.trend === direction);
  }, [rows, direction]);

  const aggregated = useMemo(() => {
    const base = direction === "down"
      ? aggregateModelsInDeclineDaily(filteredRows)
      : aggregateModelCountDaily(filteredRows);
    return base.map((d, i) => {
      if (i === 0) return { ...d, deltaPct: null as number | null, isNew: false };
      const prev = base[i - 1].count;
      if (prev === 0 && d.count === 0) return { ...d, deltaPct: 0, isNew: false };
      if (prev === 0 && d.count > 0) return { ...d, deltaPct: null, isNew: true };
      return { ...d, deltaPct: Math.round(((d.count - prev) / prev) * 100), isNew: false };
    });
  }, [filteredRows, direction]);

  const totalRevenue = useMemo(
    () => filteredRows.reduce((s, r) => s + r.totalRevenue, 0),
    [filteredRows],
  );

  // Möglicher Umsatz: pro Model = Ø der Chatter-Schnitte (jeder Chatter zählt gleich)
  // × Gesamttage im Zeitraum. So sieht man, was möglich wäre, wenn jeder Chatter
  // auf den kompletten Schnitt aller Chatter des Models käme.
  const potentialRevenue = useMemo(() => {
    let sum = 0;
    for (const r of filteredRows) {
      const totalDays = r.daily.length;
      if (totalDays === 0) { sum += r.totalRevenue; continue; }
      if (r.chatterAvgs.length === 0) { sum += r.totalRevenue; continue; }
      const meanChatterAvg = r.chatterAvgs.reduce((s, c) => s + c.avgPerActiveDay, 0) / r.chatterAvgs.length;
      sum += meanChatterAvg * totalDays;
    }
    return sum;
  }, [filteredRows]);

  const deltaPotential = Math.max(0, potentialRevenue - totalRevenue);

  const buckets = useMemo<BucketDefinition[]>(
    () => (direction ? categorizeRowsByChatterAge(filteredRows, direction) : []),
    [filteredRows, direction],
  );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl bg-[#0e0e0e] border-l border-white/[0.06] overflow-y-auto p-0"
      >
        <div className="p-6 sm:p-8 space-y-6">
          {meta && (
            <>
              <SheetHeader className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
                  <SheetTitle className={cn("text-2xl font-extralight tracking-tight", meta.accent)}>
                    {meta.title}
                  </SheetTitle>
                </div>
                <p className="text-[11px] text-white/30 font-light tracking-wider uppercase">
                  {meta.subtitle}
                </p>
              </SheetHeader>

              {/* Kennzahlen */}
              <div className="grid grid-cols-2 gap-2">
                <div className="premium-card rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-white/45 font-semibold">Models</p>
                  <p className="text-2xl font-extralight tabular-nums text-foreground/90 mt-1">{filteredRows.length}</p>
                </div>
                <div className="premium-card rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-white/45 font-semibold">Gesamt-Umsatz</p>
                  <p className="text-2xl font-extralight tabular-nums text-foreground/90 mt-1">{fmtEur(totalRevenue)}</p>
                </div>
              </div>

              {/* Möglicher Umsatz */}
              <div className="premium-card rounded-xl p-3 border border-yellow-400/15 bg-gradient-to-b from-yellow-400/[0.04] to-transparent">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-yellow-200/70 font-semibold">Möglicher Umsatz</p>
                    <p className="text-[10.5px] text-white/40 font-light mt-0.5">
                      Wenn jeder Chatter auf den Ø-Schnitt aller Chatter des Models käme
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-2xl font-extralight tabular-nums text-yellow-100">{fmtEur(potentialRevenue)}</p>
                    {deltaPotential > 0 && (
                      <p className="text-[10.5px] text-yellow-200/55 font-light tabular-nums mt-0.5">
                        + {fmtEur(deltaPotential)} möglich
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Aggregierter Graph */}
              <div className="premium-card rounded-2xl p-4 sm:p-5">
                <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase mb-3">
                  {direction === "down" ? "Models im Rückgang pro Tag" : "Models pro Tag aktiv"}
                </p>
                {aggregated.length < 2 ? (
                  <div className="h-32 flex items-center justify-center text-[12px] text-white/30 font-light">
                    Zu wenig Datenpunkte für einen Verlauf.
                  </div>
                ) : (
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={aggregated} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="2 4" stroke="hsl(0 0% 100% / 0.04)" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatDateShort}
                          tick={{ fill: "hsl(0 0% 100% / 0.3)", fontSize: 10 }}
                          stroke="hsl(0 0% 100% / 0.05)"
                        />
                        <YAxis
                          tick={{ fill: "hsl(0 0% 100% / 0.3)", fontSize: 10 }}
                          stroke="hsl(0 0% 100% / 0.05)"
                          allowDecimals={false}
                          tickFormatter={(v) => `${Math.round(Number(v))}`}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#141414",
                            border: "1px solid hsl(0 0% 100% / 0.08)",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                          labelFormatter={(v) => `Datum: ${v}`}
                          formatter={(value: number, _name, item: any) => {
                            const d = item?.payload?.deltaPct as number | null | undefined;
                            const isNew = !!item?.payload?.isNew;
                            const label = direction === "down" ? "Im Rückgang" : "Aktiv";
                            let suffix = "";
                            if (isNew) suffix = " · neu ggü. Vortag";
                            else if (typeof d === "number") suffix = ` · ${d > 0 ? "+" : ""}${d}% ggü. Vortag`;
                            return [`${value} Models${suffix}`, label];
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="count"
                          stroke={meta.stroke}
                          fill={meta.fill}
                          strokeWidth={1.8}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {aggregated.length >= 2 && (
                  <DailyDeltaStrip data={aggregated} direction={direction} />
                )}
              </div>

              {/* Buckets */}
              <div className="space-y-3">
                <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase">
                  Aufteilung nach Chatter-Alter
                </p>
                <p className="text-[10.5px] text-white/35 font-light -mt-2">
                  Schwelle: alt = ≥ {NEW_CHATTER_THRESHOLD_DAYS} Tage auf dem Model
                </p>
                {buckets.map((b) => (
                  <BucketCard
                    key={b.key}
                    bucket={b}
                    onSelectModel={onSelectModel}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DailyDeltaStrip({
  data,
  direction,
}: {
  data: Array<{ date: string; count: number; deltaPct: number | null; isNew: boolean }>;
  direction: TrendDirection | null;
}) {
  // Bei "down" ist ein Anstieg der Anzahl schlecht (rot), Rückgang gut (grün).
  // Bei "up"/sonst ist mehr besser.
  const invert = direction === "down";
  return (
    <div className="mt-3 -mx-1 overflow-x-auto">
      <div className="flex gap-1 px-1 min-w-min">
        {data.map((d, i) => {
          const isFirst = i === 0;
          let cls = "border-white/10 bg-white/[0.03] text-white/50";
          let icon = "–";
          let text = "—";
          if (isFirst) {
            // Startwert
          } else if (d.isNew) {
            cls = invert
              ? "border-red-500/30 bg-red-500/[0.08] text-red-300"
              : "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300";
            icon = "▲";
            text = "neu";
          } else if (d.deltaPct === null || d.deltaPct === 0) {
            icon = "–";
            text = "0%";
          } else if (d.deltaPct > 0) {
            cls = invert
              ? "border-red-500/30 bg-red-500/[0.08] text-red-300"
              : "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300";
            icon = "▲";
            text = `+${d.deltaPct}%`;
          } else {
            cls = invert
              ? "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300"
              : "border-red-500/30 bg-red-500/[0.08] text-red-300";
            icon = "▼";
            text = `${d.deltaPct}%`;
          }
          return (
            <div
              key={d.date}
              className={cn(
                "shrink-0 flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-md border text-[9.5px] font-light tabular-nums",
                cls,
              )}
              title={`${d.date} · ${d.count} Models${d.deltaPct !== null && !d.isNew ? ` · ${d.deltaPct > 0 ? "+" : ""}${d.deltaPct}%` : ""}`}
            >
              <span className="text-[10px] leading-none">{icon}</span>
              <span className="leading-none">{text}</span>
              <span className="text-[8.5px] text-white/30 leading-none mt-0.5">
                {d.date.slice(5).replace("-", "/")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BucketCard({
  bucket,
  onSelectModel,
}: {
  bucket: BucketDefinition;
  onSelectModel: (name: string, chatter: string | null) => void;
}) {
  const total = bucket.models.reduce((s, m) => s + m.totalRevenue, 0);
  const toneClasses = {
    down: "border-red-500/25 bg-red-500/[0.04]",
    warn: "border-amber-500/25 bg-amber-500/[0.04]",
    neutral: "border-white/[0.07] bg-white/[0.02]",
    up: "border-emerald-500/25 bg-emerald-500/[0.04]",
  }[bucket.tone];
  const toneText = {
    down: "text-red-300",
    warn: "text-amber-300",
    neutral: "text-white/70",
    up: "text-emerald-300",
  }[bucket.tone];

  if (bucket.models.length === 0) {
    return (
      <div className={cn("rounded-xl border p-3 opacity-50", toneClasses)}>
        <div className="flex items-center justify-between">
          <span className={cn("text-[11.5px] font-medium", toneText)}>{bucket.label}</span>
          <span className="text-[10px] text-white/30 tabular-nums">0</span>
        </div>
        <p className="text-[10.5px] text-white/35 font-light mt-0.5">{bucket.description}</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border overflow-hidden", toneClasses)}>
      <div className="px-3 py-2.5 border-b border-white/[0.05]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {bucket.tone === "down" && <AlertTriangle className="h-3 w-3 text-red-300 shrink-0" />}
            <span className={cn("text-[12px] font-medium truncate", toneText)}>{bucket.label}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-white/55 tabular-nums">{bucket.models.length}</span>
            <span className="text-[10.5px] text-white/35 tabular-nums">· {fmtEur(total)}</span>
          </div>
        </div>
        <p className="text-[10.5px] text-white/40 font-light mt-0.5">{bucket.description}</p>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {bucket.models.slice(0, 25).map((m) => (
          <button
            key={m.modelName}
            onClick={() => onSelectModel(m.modelName, m.currentChatter)}
            className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-white/[0.025] transition-colors text-left"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[12px] text-foreground/90 font-light truncate">{m.modelName}</div>
              <div className="text-[10px] text-white/35 font-light truncate mt-0.5">
                {m.currentChatter ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(m.currentChatter!);
                      toast.success(`Chatter "${m.currentChatter}" kopiert`);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        navigator.clipboard.writeText(m.currentChatter!);
                        toast.success(`Chatter "${m.currentChatter}" kopiert`);
                      }
                    }}
                    className="hover:text-white/70 hover:underline underline-offset-2 cursor-pointer transition-colors"
                  >
                    {m.currentChatter}
                  </span>
                ) : (
                  "kein Chatter"
                )}
                {m.currentPhaseDays != null && ` · Phase ${m.currentPhaseDays}T`}
              </div>
            </div>
            <MiniSpark points={m.daily.map((p) => p.revenue)} stroke={bucket.tone === "down" ? "rgb(252,165,165)" : bucket.tone === "up" ? "rgb(110,231,183)" : "rgba(255,255,255,0.5)"} />
            <div className="text-right shrink-0 min-w-[64px]">
              <div className="text-[11.5px] text-foreground/85 font-light tabular-nums">{fmtEur(m.totalRevenue)}</div>
              {m.trendPct != null && (
                <div className={cn("text-[10px] font-light tabular-nums", bucket.tone === "down" ? "text-red-300" : bucket.tone === "up" ? "text-emerald-300" : "text-white/45")}>
                  {m.trendPct > 0 ? "+" : ""}{m.trendPct}%
                </div>
              )}
            </div>
            <ChevronRight className="h-3 w-3 text-white/20 shrink-0" />
          </button>
        ))}
        {bucket.models.length > 25 && (
          <div className="px-3 py-2 text-[10.5px] text-white/35 font-light">
            +{bucket.models.length - 25} weitere
          </div>
        )}
      </div>
    </div>
  );
}

function MiniSpark({ points, stroke }: { points: number[]; stroke: string }) {
  if (points.length < 2) return <div className="w-12 h-5 shrink-0" />;
  const w = 48, h = 20;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0 opacity-90">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
