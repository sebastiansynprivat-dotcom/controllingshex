import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { X } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceArea, ReferenceLine, CartesianGrid, AreaChart, Area } from "recharts";
import { TrendingDown, TrendingUp, AlertTriangle, User } from "lucide-react";
import { loadModelTimeline, formatEur, type ModelTimeline, type ChatterPhase } from "@/lib/model-tracking";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import ModelNotesLabelsPanel from "@/components/ModelNotesLabelsPanel";
import { toast } from "sonner";

function copyChatter(name: string, e?: React.SyntheticEvent) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  navigator.clipboard.writeText(name);
  toast.success(`Chatter "${name}" kopiert`);
}


interface Props {
  open: boolean;
  onClose: () => void;
  modelName: string | null;
  platform: string;
  /** Wenn gesetzt, wird unter dem Model-Verlauf eine Vergleichsansicht für diesen Chatter eingeblendet. */
  focusChatter?: string | null;
  /** Split-View: rendert das Panel auf der linken Bildschirmhälfte ohne Overlay, damit daneben ein zweites Panel sichtbar bleibt. */
  splitView?: boolean;
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

export default function ModelPerformanceSlideOver({ open, onClose, modelName, platform, focusChatter, splitView = false }: Props) {
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
              {modelName && <ModelNotesLabelsPanel platform={platform} modelName={modelName} />}


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
                      <button
                        type="button"
                        key={name}
                        onClick={(e) => copyChatter(name, e)}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.07] hover:border-white/[0.12] transition-colors cursor-pointer"
                        title="Klick zum Kopieren"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: color }}
                        />
                        <span className="text-[10px] text-white/55 font-light">{name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Vergleich Chatter ↔ Model */}
              {focusChatter && (
                <ChatterCompareCard
                  platform={platform}
                  chatterName={focusChatter}
                  modelName={modelName!}
                  fromDate={dateRange.from}
                  toDate={dateRange.to}
                />
              )}

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
          <button
            type="button"
            onClick={(e) => copyChatter(phase.chatterName, e)}
            className="text-[14px] text-foreground/85 font-light hover:text-white hover:underline underline-offset-2 cursor-pointer transition-colors text-left"
            title="Klick zum Kopieren"
          >
            {phase.chatterName}
          </button>
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

interface ChatterDay {
  date: string;
  thisModel: number;
  others: number;
  total: number;
}

function ChatterCompareCard({
  platform,
  chatterName,
  modelName,
  fromDate,
  toDate,
}: {
  platform: string;
  chatterName: string;
  modelName: string;
  fromDate: string;
  toDate: string;
}) {
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState<ChatterDay[]>([]);
  const [otherModels, setOtherModels] = useState<{ name: string; revenue: number }[]>([]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("chatter_history")
        .select("analysis_date, account, revenue_today")
        .eq("platform", platform)
        .eq("chatter_name", chatterName)
        .gte("analysis_date", fromDate)
        .lte("analysis_date", toDate)
        .order("analysis_date", { ascending: true });

      const byDay = new Map<string, ChatterDay>();
      const byOther = new Map<string, number>();
      for (const r of data || []) {
        const d = r.analysis_date as string;
        const acc = (r.account || "").trim();
        const rev = Number(r.revenue_today) || 0;
        const isThis = acc.toLowerCase() === modelName.toLowerCase();
        const cur = byDay.get(d) || { date: d, thisModel: 0, others: 0, total: 0 };
        if (isThis) cur.thisModel += rev;
        else {
          cur.others += rev;
          if (acc) byOther.set(acc, (byOther.get(acc) ?? 0) + rev);
        }
        cur.total = cur.thisModel + cur.others;
        byDay.set(d, cur);
      }
      if (cancel) return;
      setDays([...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)));
      setOtherModels(
        [...byOther.entries()]
          .map(([name, revenue]) => ({ name, revenue }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5),
      );
      setLoading(false);
    })().catch(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [platform, chatterName, modelName, fromDate, toDate]);

  const totals = useMemo(() => {
    const thisModel = days.reduce((s, d) => s + d.thisModel, 0);
    const others = days.reduce((s, d) => s + d.others, 0);
    const activeDays = days.filter((d) => d.total > 0).length;
    return { thisModel, others, total: thisModel + others, activeDays };
  }, [days]);

  return (
    <div className="premium-card rounded-2xl overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-white/[0.05] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-primary/10 border border-primary/20 shrink-0">
            <User className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase">
              Vergleich Chatter
            </p>
            <p className="text-[14px] text-foreground/85 font-light truncate mt-0.5">{chatterName}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-wider text-white/30 font-light">Ø/Tag</p>
          <p className="text-[13px] gold-text font-light tabular-nums">
            {formatEur(totals.activeDays > 0 ? totals.total / totals.activeDays : 0)}
          </p>
        </div>
      </div>

      {loading && (
        <div className="p-6 text-center text-white/30 text-sm font-light">Lade Vergleich …</div>
      )}

      {!loading && days.length === 0 && (
        <div className="p-6 text-center text-white/30 text-sm font-light">
          Keine Daten für {chatterName} im Zeitraum.
        </div>
      )}

      {!loading && days.length > 0 && (
        <div className="p-4 sm:p-5 space-y-4">
          {/* Split-Anteil */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
              <p className="text-[10px] uppercase tracking-wider text-primary/70 font-light">
                Bei {modelName}
              </p>
              <p className="text-lg gold-text font-light tabular-nums mt-1">{formatEur(totals.thisModel)}</p>
              <p className="text-[10px] text-white/30 font-light">
                {totals.total > 0 ? Math.round((totals.thisModel / totals.total) * 100) : 0}% von Gesamt
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-wider text-white/40 font-light">
                Andere Models
              </p>
              <p className="text-lg text-foreground/80 font-light tabular-nums mt-1">{formatEur(totals.others)}</p>
              <p className="text-[10px] text-white/30 font-light">
                {otherModels.length} {otherModels.length === 1 ? "Model" : "Models"}
              </p>
            </div>
          </div>

          {/* Chart Vergleich */}
          <div>
            <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase mb-2">
              Umsatz {chatterName} · {modelName} vs. andere Models
            </p>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={days} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
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
                    formatter={(v: number, n: string) => [
                      `${(v as number).toFixed(0)} €`,
                      n === "thisModel" ? modelName : "Andere",
                    ]}
                    labelFormatter={(v) => `Datum: ${v}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="others"
                    stackId="1"
                    stroke="hsl(0 0% 100% / 0.25)"
                    fill="hsl(0 0% 100% / 0.08)"
                    strokeWidth={1}
                  />
                  <Area
                    type="monotone"
                    dataKey="thisModel"
                    stackId="1"
                    stroke="hsl(45, 90%, 60%)"
                    fill="hsl(45, 90%, 60% / 0.25)"
                    strokeWidth={1.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Andere Models breakdown */}
          {otherModels.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase">
                Andere Models von {chatterName}
              </p>
              <div className="space-y-1">
                {otherModels.map((m) => (
                  <div
                    key={m.name}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                  >
                    <span className="text-[12px] text-foreground/75 font-light truncate">{m.name}</span>
                    <span className="text-[12px] text-foreground/55 font-light tabular-nums">
                      {formatEur(m.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
