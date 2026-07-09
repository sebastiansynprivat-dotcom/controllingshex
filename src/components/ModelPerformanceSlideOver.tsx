import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { X } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceArea, ReferenceLine, CartesianGrid, AreaChart, Area } from "recharts";
import { TrendingDown, TrendingUp, AlertTriangle, User } from "lucide-react";
import { loadModelTimeline, loadModelHistoryForModel, formatEur, type ModelTimeline, type ChatterPhase } from "@/lib/model-tracking";
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

interface LifetimeChatterStats {
  chatterName: string;
  totalRevenue: number;
  activeDays: number;
  avgPerDay: number;
  firstDate: string;
  lastDate: string;
}

export default function ModelPerformanceSlideOver({ open, onClose, modelName, platform, focusChatter, splitView = false }: Props) {
  const [period, setPeriod] = useState<7 | 14 | 30 | 90>(30);
  const [tl, setTl] = useState<ModelTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [lifetime, setLifetime] = useState<LifetimeChatterStats[]>([]);

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

  // Lifetime aggregate pro Chatter für dieses Model – für den Gesamt-Vergleich.
  useEffect(() => {
    if (!open || !modelName) return;
    let cancel = false;
    (async () => {
      const data = await loadModelHistoryForModel(platform, modelName);
      if (cancel) return;
      const byChatter = new Map<string, { total: number; days: Set<string>; first: string; last: string }>();
      for (const row of data) {
        const name = row.chatterName;
        const date = row.date;
        if (!name || !date) continue;
        const rev = Number(row.revenue) || 0;
        if (!byChatter.has(name)) byChatter.set(name, { total: 0, days: new Set(), first: date, last: date });
        const s = byChatter.get(name)!;
        s.total += rev;
        s.days.add(date);
        if (date < s.first) s.first = date;
        if (date > s.last) s.last = date;
      }
      const arr: LifetimeChatterStats[] = Array.from(byChatter.entries()).map(([chatterName, s]) => ({
        chatterName,
        totalRevenue: s.total,
        activeDays: s.days.size,
        avgPerDay: s.days.size > 0 ? s.total / s.days.size : 0,
        firstDate: s.first,
        lastDate: s.last,
      }));
      arr.sort((a, b) => b.avgPerDay - a.avgPerDay);
      setLifetime(arr);
    })();
    return () => { cancel = true; };
  }, [open, modelName, platform]);

  const chatterColors = useMemo(() => {
    const map = new Map<string, string>();
    let i = 0;
    // Phasen zuerst (Reihenfolge im Chart) …
    for (const p of tl?.phases ?? []) {
      if (!map.has(p.chatterName)) {
        map.set(p.chatterName, PHASE_COLORS[i % PHASE_COLORS.length]);
        i++;
      }
    }
    // … dann restliche Chatter aus dem Lifetime-Set, damit die Vergleichs-Karte
    // jedem Chatter eine stabile Farbe zuweisen kann.
    for (const l of lifetime) {
      if (!map.has(l.chatterName)) {
        map.set(l.chatterName, PHASE_COLORS[i % PHASE_COLORS.length]);
        i++;
      }
    }
    return map;
  }, [tl, lifetime]);

  // Chart-Daten pro Chatter aufsplitten, damit jede Chatter-Phase in ihrer
  // eigenen Farbe im Umsatz-Verlauf gezeichnet wird.
  const chartData = useMemo(() => {
    if (!tl) return [] as Array<Record<string, any>>;
    const chatters = Array.from(chatterColors.keys());
    const rows: Record<string, any>[] = tl.daily.map((d) => {
      const row: Record<string, any> = { date: d.date, chatter: d.chatter, revenue: d.revenue };
      for (const c of chatters) row[`c__${c}`] = null;
      if (d.chatter) row[`c__${d.chatter}`] = d.revenue;
      return row;
    });
    // An Chatter-Wechseln den vorherigen Chatter am Wechsel-Tag mitzeichnen,
    // damit die Segmente ohne Lücke zusammenlaufen.
    for (let i = 1; i < tl.daily.length; i++) {
      const prev = tl.daily[i - 1];
      const cur = tl.daily[i];
      if (prev.chatter && cur.chatter && prev.chatter !== cur.chatter) {
        rows[i][`c__${prev.chatter}`] = cur.revenue;
      }
    }
    return rows;
  }, [tl, chatterColors]);

  // Aggregat pro Chatter im aktuellen Zeitraum (kann mehrere Phasen desselben
  // Chatters umfassen).
  const periodByChatter = useMemo(() => {
    const map = new Map<string, { total: number; days: number }>();
    for (const p of tl?.phases ?? []) {
      const cur = map.get(p.chatterName) ?? { total: 0, days: 0 };
      cur.total += p.totalRevenue;
      cur.days += p.days;
      map.set(p.chatterName, cur);
    }
    return map;
  }, [tl]);

  const phasesReversed = useMemo(() => (tl ? [...tl.phases].reverse() : []), [tl]);

  const body = (
    <div className={splitView ? "p-4 sm:p-6 space-y-5" : "p-6 sm:p-8 space-y-6"}>

      <div className="space-y-1 pr-10">
        <h2 className="text-xl sm:text-2xl font-extralight tracking-tight text-foreground truncate">
          {modelName}
        </h2>
        <p className="text-[11px] text-white/30 font-light tracking-wider uppercase">
          Performance & Chatter-Verlauf
        </p>
      </div>

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
          <div className="premium-card rounded-2xl p-4 sm:p-5 min-w-0">
            <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase mb-3">
              Umsatz-Verlauf
            </p>
            <PhaseTimelineBar phases={tl.phases} chatterColors={chatterColors} />
            <div className={splitView ? "h-56 w-full min-w-0" : "h-64 w-full min-w-0"}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                    cursor={{ stroke: "hsl(0 0% 100% / 0.15)", strokeWidth: 1 }}
                    wrapperStyle={{ zIndex: 60, outline: "none", pointerEvents: "none" }}
                    allowEscapeViewBox={{ x: true, y: true }}
                    offset={12}
                    isAnimationActive={false}
                    content={({ active, payload, label }: any) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]?.payload || {};
                      const rev = Number(p.revenue ?? 0);
                      const color = p.chatter ? chatterColors.get(p.chatter) : undefined;
                      return (
                        <div
                          className="rounded-lg border border-white/10 bg-[#141414]/95 backdrop-blur-md px-3 py-2 shadow-2xl"
                          style={{ fontSize: 12, minWidth: 140 }}
                        >
                          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">
                            {formatDateShort(label)}
                          </div>
                          <div className="text-[14px] font-medium text-white">
                            {rev.toFixed(0)} €
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 min-w-0">
                            {color && <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />}
                            <span className="text-[11px] text-white/60 truncate">{p.chatter || "—"}</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  {tl.phases.map((p, i) => (
                    <ReferenceArea
                      key={i}
                      x1={p.fromDate}
                      x2={p.toDate}
                      fill={chatterColors.get(p.chatterName)}
                      fillOpacity={0.16}
                      stroke="none"
                    />
                  ))}
                  {tl.phases.slice(1).map((p, i) => (
                    <ReferenceLine
                      key={`line-${i}`}
                      x={p.fromDate}
                      stroke={chatterColors.get(p.chatterName) || "hsl(0 0% 100% / 0.35)"}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                  ))}
                  {Array.from(chatterColors.entries()).map(([name, color]) => (
                    <Line
                      key={`line-${name}`}
                      type="monotone"
                      dataKey={`c__${name}`}
                      name={name}
                      stroke={color}
                      strokeWidth={3}
                      connectNulls={false}
                      dot={{ r: 3, fill: color, stroke: "#0e0e0e", strokeWidth: 1.5 }}
                      activeDot={{ r: 5, stroke: color, strokeWidth: 2, fill: "#0e0e0e" }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {chatterColors.size > 0 && (
              <div className="flex flex-wrap gap-2 mt-3 min-w-0">
                {Array.from(chatterColors.entries()).map(([name, color]) => (
                  <button
                    type="button"
                    key={name}
                    onClick={(e) => copyChatter(name, e)}
                    className="flex min-w-0 items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.07] hover:border-white/[0.12] transition-colors cursor-pointer"
                    title="Klick zum Kopieren"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                    <span className="truncate text-[10px] text-white/55 font-light">{name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Chatter-Vergleich: Ø/Tag pro Chatter im Zeitraum + Lifetime */}
          <ChatterComparisonCard
            periodByChatter={periodByChatter}
            lifetime={lifetime}
            chatterColors={chatterColors}
            periodDays={period}
          />


          {focusChatter && (
            <ChatterCompareCard
              platform={platform}
              chatterName={focusChatter}
              modelName={modelName!}
              fromDate={dateRange.from}
              toDate={dateRange.to}
            />
          )}

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
  );

  if (splitView) {
    return (
      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ x: -40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -40, opacity: 0 }}
            transition={{ type: "spring", damping: 32, stiffness: 280, opacity: { duration: 0.3 } }}
            className="fixed inset-y-0 left-0 z-50 w-1/2 border-r border-white/[0.06] bg-[#0e0e0e] overflow-y-auto shadow-[20px_0_60px_-15px_rgba(0,0,0,0.6)]"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Schließen"
              className="absolute right-4 top-4 z-10 h-8 w-8 rounded-md flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            {body}
          </motion.aside>
        )}
      </AnimatePresence>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl bg-[#0e0e0e] border-l border-white/[0.06] overflow-y-auto p-0"
      >
        {body}
      </SheetContent>
    </Sheet>
  );
}

function PhaseTimelineBar({ phases, chatterColors }: { phases: ChatterPhase[]; chatterColors: Map<string, string> }) {
  const totalDays = phases.reduce((sum, p) => sum + p.days, 0);
  if (phases.length === 0 || totalDays <= 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
      <div className="flex h-7 w-full overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.03]">
        {phases.map((p, i) => {
          const color = chatterColors.get(p.chatterName) || "hsl(0 0% 100% / 0.35)";
          const width = Math.max(8, (p.days / totalDays) * 100);
          return (
            <div
              key={`${p.chatterName}-${p.fromDate}-${i}`}
              className="relative min-w-0 border-r border-background/35 last:border-r-0"
              style={{ width: `${width}%`, background: `linear-gradient(90deg, ${color}44, ${color}88)` }}
              title={`${p.chatterName}: ${formatDateShort(p.fromDate)} – ${formatDateShort(p.toDate)} · ${formatEur(p.avgPerDay)} Ø/Tag`}
            >
              <div className="absolute inset-0 flex items-center px-2 min-w-0">
                <span className="truncate text-[10px] font-medium text-white drop-shadow-sm">{p.chatterName}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 grid gap-1.5">
        {phases.map((p, i) => {
          const color = chatterColors.get(p.chatterName) || "hsl(0 0% 100% / 0.35)";
          return (
            <div key={`${p.chatterName}-${p.fromDate}-meta-${i}`} className="flex items-center justify-between gap-3 text-[10.5px] font-light min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                <span className="truncate text-white/65">{p.chatterName}</span>
                <span className="text-white/25 shrink-0">· {formatDateShort(p.fromDate)}–{formatDateShort(p.toDate)}</span>
              </div>
              <span className="shrink-0 tabular-nums gold-text-subtle">{formatEur(p.avgPerDay)} Ø/Tag</span>
            </div>
          );
        })}
      </div>
    </div>
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

/**
 * Chatter-Vergleich: Ø/Tag pro Chatter im gewählten Zeitraum PLUS Lifetime.
 * Farbcodiert wie im Umsatz-Verlauf, sortiert nach Ø/Tag im Zeitraum.
 */
function ChatterComparisonCard({
  periodByChatter,
  lifetime,
  chatterColors,
  periodDays,
}: {
  periodByChatter: Map<string, { total: number; days: number }>;
  lifetime: LifetimeChatterStats[];
  chatterColors: Map<string, string>;
  periodDays: number;
}) {
  const rows = useMemo(() => {
    const names = new Set<string>([
      ...periodByChatter.keys(),
      ...lifetime.map((l) => l.chatterName),
    ]);
    const lifetimeMap = new Map(lifetime.map((l) => [l.chatterName, l]));
    const items = Array.from(names).map((name) => {
      const p = periodByChatter.get(name);
      const l = lifetimeMap.get(name);
      const periodAvg = p && p.days > 0 ? p.total / p.days : 0;
      return {
        name,
        color: chatterColors.get(name) || "#666",
        periodTotal: p?.total ?? 0,
        periodDays: p?.days ?? 0,
        periodAvg,
        lifetimeAvg: l?.avgPerDay ?? 0,
        lifetimeTotal: l?.totalRevenue ?? 0,
        lifetimeDays: l?.activeDays ?? 0,
        inPeriod: !!p && p.days > 0,
      };
    });
    items.sort((a, b) => {
      if (a.inPeriod !== b.inPeriod) return a.inPeriod ? -1 : 1;
      return (b.inPeriod ? b.periodAvg : b.lifetimeAvg) - (a.inPeriod ? a.periodAvg : a.lifetimeAvg);
    });
    return items;
  }, [periodByChatter, lifetime, chatterColors]);

  const maxAvg = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.inPeriod ? r.periodAvg : r.lifetimeAvg), 0),
    [rows]
  );

  if (rows.length === 0) return null;

  const topPeriod = rows.find((r) => r.inPeriod);
  const bottomPeriod = [...rows].reverse().find((r) => r.inPeriod);
  const spreadPct =
    topPeriod && bottomPeriod && bottomPeriod.periodAvg > 0 && topPeriod !== bottomPeriod
      ? Math.round(((topPeriod.periodAvg - bottomPeriod.periodAvg) / bottomPeriod.periodAvg) * 100)
      : null;

  return (
    <div className="premium-card rounded-2xl overflow-hidden min-w-0">
      <div className="p-4 sm:p-5 border-b border-white/[0.05] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase">
            Chatter-Vergleich
          </p>
          <p className="text-[10.5px] text-white/35 font-light mt-0.5">
            Ø / Tag im {periodDays}-Tage-Zeitraum · Lifetime als Referenz
          </p>
        </div>
        {spreadPct !== null && (
          <div className="text-right shrink-0">
            <div className="text-[13px] font-light gold-text tabular-nums">+{spreadPct}%</div>
            <div className="text-[9px] text-white/30 uppercase tracking-wider">Spread</div>
          </div>
        )}
      </div>
      <div className="divide-y divide-white/[0.04]">
        {rows.map((r) => {
          const barPct =
            maxAvg > 0
              ? Math.max(2, Math.round(((r.inPeriod ? r.periodAvg : r.lifetimeAvg) / maxAvg) * 100))
              : 0;
          return (
            <div key={r.name} className={cn("p-4 sm:p-5", !r.inPeriod && "opacity-60")}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                <button
                  type="button"
                  onClick={(e) => copyChatter(r.name, e)}
                  className="flex-1 min-w-0 text-left text-[13.5px] text-foreground/85 font-light hover:text-white hover:underline underline-offset-2 truncate"
                  title="Klick zum Kopieren"
                >
                  {r.name}
                </button>
                {!r.inPeriod && (
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.04] text-white/40 border border-white/[0.06] shrink-0">
                    Nur historisch
                  </span>
                )}
                <div className="text-right shrink-0">
                  <div className="text-[13.5px] font-light gold-text tabular-nums">
                    {formatEur(r.inPeriod ? r.periodAvg : r.lifetimeAvg)}
                  </div>
                  <div className="text-[9.5px] text-white/30 font-light">Ø / Tag</div>
                </div>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${barPct}%`,
                    background: `linear-gradient(90deg, ${r.color}55, ${r.color})`,
                  }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-[10.5px] font-light text-white/45 tabular-nums">
                <span>
                  {r.inPeriod ? (
                    <>Zeitraum: <span className="text-white/70">{formatEur(r.periodTotal)}</span> · {r.periodDays}T</>
                  ) : (
                    <>Keine Aktivität im Zeitraum</>
                  )}
                </span>
                <span>
                  Lifetime: <span className="text-white/70">{formatEur(r.lifetimeAvg)}</span> Ø · {r.lifetimeDays}T
                </span>
              </div>
            </div>
          );
        })}
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
