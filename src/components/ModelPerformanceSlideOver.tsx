import { useEffect, useState, useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceArea, ReferenceLine, CartesianGrid } from "recharts";
import { TrendingDown, TrendingUp, AlertTriangle, ArrowRight } from "lucide-react";
import { loadModelTimeline, formatEur, type ModelTimeline, type ChatterPhase } from "@/lib/model-tracking";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  modelName: string | null;
  platform: string;
}

const PHASE_COLORS = [
  "hsl(45, 90%, 55%)",
  "hsl(200, 80%, 60%)",
  "hsl(280, 70%, 65%)",
  "hsl(160, 70%, 50%)",
  "hsl(0, 70%, 60%)",
  "hsl(30, 80%, 55%)",
];

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

export default function ModelPerformanceSlideOver({ open, onClose, modelName, platform }: Props) {
  const [period, setPeriod] = useState<7 | 14 | 30 | 90>(30);
  const [tl, setTl] = useState<ModelTimeline | null>(null);
  const [loading, setLoading] = useState(false);

  const dateRange = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - period);
    return { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] };
  }, [period]);

  useEffect(() => {
    if (!open || !modelName) return;
    setLoading(true);
    loadModelTimeline(platform, modelName, dateRange.from, dateRange.to)
      .then(setTl)
      .finally(() => setLoading(false));
  }, [open, modelName, platform, dateRange]);

  const chatterColors = useMemo(() => {
    const map = new Map<string, string>();
    if (!tl) return map;
    let i = 0;
    for (const p of tl.phases) {
      if (!map.has(p.chatterName)) {
        map.set(p.chatterName, PHASE_COLORS[i % PHASE_COLORS.length]);
        i++;
      }
    }
    return map;
  }, [tl]);

  const phasesReversed = useMemo(() => (tl ? [...tl.phases].reverse() : []), [tl]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl bg-[#0e0e0e] border-l border-white/[0.06] overflow-y-auto p-0"
      >
        <div className="p-6 sm:p-8 space-y-6">
          <SheetHeader className="space-y-1">
            <SheetTitle className="text-2xl font-extralight tracking-tight text-foreground">
              {modelName}
            </SheetTitle>
            <p className="text-[11px] text-white/30 font-light tracking-wider uppercase">
              Performance & Chatter-Verlauf
            </p>
          </SheetHeader>

          {/* Periode */}
          <div className="flex gap-2">
            {([7, 14, 30, 90] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[11px] font-light tracking-wide border transition-all",
                  period === p
                    ? "bg-primary/15 border-primary/35 text-primary"
                    : "bg-white/[0.03] border-white/[0.06] text-white/55 hover:text-white/85"
                )}
              >
                {p}T
              </button>
            ))}
          </div>

          {loading && (
            <div className="text-center py-12 text-white/30 text-sm font-light">Lade Daten …</div>
          )}

          {!loading && tl && tl.daily.length === 0 && (
            <div className="text-center py-12 text-white/30 text-sm font-light">
              Keine Umsatz-Daten in diesem Zeitraum.
            </div>
          )}

          {!loading && tl && tl.daily.length > 0 && (
            <>
              {/* Krisen-Alarm */}
              {tl.vsPreviousPct !== null && tl.vsPreviousPct <= -20 && tl.currentPhase && tl.previousPhase && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-4 flex gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[13px] text-red-300 font-light leading-relaxed">
                      Seit Wechsel zu <span className="font-medium">{tl.currentPhase.chatterName}</span>{" "}
                      vor {tl.currentPhase.days} Tagen: <span className="font-medium">{tl.vsPreviousPct}%</span> Umsatz vs. {tl.previousPhase.chatterName}.
                    </p>
                  </div>
                </div>
              )}

              {tl.vsPreviousPct !== null && tl.vsPreviousPct >= 20 && tl.currentPhase && tl.previousPhase && (
                <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.05] p-4 flex gap-3">
                  <TrendingUp className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-[13px] text-emerald-300 font-light leading-relaxed">
                    {tl.currentPhase.chatterName} performt <span className="font-medium">+{tl.vsPreviousPct}%</span> besser als {tl.previousPhase.chatterName}.
                  </p>
                </div>
              )}

              {/* Chart */}
              <div className="premium-card rounded-2xl p-4 sm:p-5">
                <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase mb-3">
                  Umsatz-Verlauf
                </p>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={tl.daily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                        tickFormatter={(v) => `${v}€`}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#141414",
                          border: "1px solid hsl(0 0% 100% / 0.08)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        labelFormatter={(v) => `Datum: ${v}`}
                        formatter={(value: number, _name: string, item: any) => [
                          `${value.toFixed(0)} €`,
                          item?.payload?.chatter || "—",
                        ]}
                      />
                      {/* Phasen-Bänder */}
                      {tl.phases.map((p, i) => (
                        <ReferenceArea
                          key={i}
                          x1={p.fromDate}
                          x2={p.toDate}
                          fill={chatterColors.get(p.chatterName)}
                          fillOpacity={0.06}
                          stroke="none"
                        />
                      ))}
                      {/* Wechsel-Linien */}
                      {tl.phases.slice(1).map((p, i) => (
                        <ReferenceLine
                          key={`line-${i}`}
                          x={p.fromDate}
                          stroke="hsl(0 0% 100% / 0.25)"
                          strokeDasharray="3 3"
                        />
                      ))}
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        stroke="hsl(45, 90%, 60%)"
                        strokeWidth={2}
                        dot={{ r: 2.5, fill: "hsl(45, 90%, 60%)" }}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Phase Legende */}
                {tl.phases.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {Array.from(chatterColors.entries()).map(([name, color]) => (
                      <div
                        key={name}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.05]"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: color }}
                        />
                        <span className="text-[10px] text-white/55 font-light">{name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Chatter-History */}
              <div className="premium-card rounded-2xl overflow-hidden">
                <div className="p-4 sm:p-5 border-b border-white/[0.05]">
                  <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase">
                    Chatter-Historie ({tl.phases.length})
                  </p>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {phasesReversed.length === 0 && (
                    <div className="p-6 text-center text-white/25 text-sm font-light">Keine Phasen.</div>
                  )}
                  {phasesReversed.map((p, idx) => {
                    const isCurrent = idx === 0;
                    const next = idx > 0 ? phasesReversed[idx - 1] : null;
                    const prev = phasesReversed[idx + 1] || null;
                    const vsPrev: number | null =
                      prev && prev.avgPerDay > 0
                        ? Math.round(((p.avgPerDay - prev.avgPerDay) / prev.avgPerDay) * 100)
                        : null;
                    return (
                      <PhaseRow
                        key={`${p.chatterName}-${p.fromDate}`}
                        phase={p}
                        isCurrent={isCurrent}
                        vsPrev={vsPrev}
                        color={chatterColors.get(p.chatterName) || "#888"}
                      />
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PhaseRow({ phase, isCurrent, vsPrev, color }: {
  phase: ChatterPhase;
  isCurrent: boolean;
  vsPrev: number | null;
  color: string;
}) {
  return (
    <div className="p-4 sm:p-5 flex items-center gap-4">
      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] text-foreground/85 font-light">{phase.chatterName}</span>
          {isCurrent && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/25">
              Aktuell
            </span>
          )}
        </div>
        <div className="text-[10px] text-white/30 font-light mt-0.5">
          {formatDateShort(phase.fromDate)} – {isCurrent ? "heute" : formatDateShort(phase.toDate)} · {phase.days} Tage
        </div>
      </div>
      <div className="text-right">
        <div className="text-[13px] font-light gold-text tabular-nums">{formatEur(phase.avgPerDay)}</div>
        <div className="text-[10px] text-white/30 font-light">Ø / Tag</div>
      </div>
      <div className="text-right w-16">
        {vsPrev === null ? (
          <span className="text-[10px] text-white/20 font-light">—</span>
        ) : vsPrev >= 0 ? (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-400 font-light">
            <TrendingUp className="h-3 w-3" /> +{vsPrev}%
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-red-400 font-light">
            <TrendingDown className="h-3 w-3" /> {vsPrev}%
          </span>
        )}
      </div>
    </div>
  );
}
