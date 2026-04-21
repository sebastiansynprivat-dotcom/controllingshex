import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import {
  forecastAbsenceMany,
  backtestAbsence,
  type AbsenceForecast,
  type AbsencePoint,
  type AbsenceForecastInput,
} from "@/lib/absence-forecast";
import { cn } from "@/lib/utils";

function PremiumSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="premium-spinner"><span /><span /><span /></div>
    </div>
  );
}

interface AnalysisChatter { name: string; account?: string }
interface AnalysisCategory { chatters: AnalysisChatter[] }
interface AnalysisResult { categories: AnalysisCategory[] }
function isAnalysisResult(v: unknown): v is AnalysisResult {
  return !!v && typeof v === "object" && Array.isArray((v as AnalysisResult).categories);
}

const BAND_META: Record<AbsenceForecast["band"], { label: string; chip: string; dot: string; border: string }> = {
  critical: { label: "Akut", chip: "bg-red-500/15 text-red-400 border-red-500/30", dot: "bg-red-500", border: "border-red-500/30" },
  warning:  { label: "Warnung", chip: "bg-orange-500/10 text-orange-400 border-orange-500/30", dot: "bg-orange-400", border: "border-orange-500/25" },
  watch:    { label: "Beobachten", chip: "bg-amber-500/10 text-amber-400 border-amber-500/25", dot: "bg-amber-400", border: "border-amber-500/20" },
  stable:   { label: "Stabil", chip: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400", border: "border-emerald-500/15" },
};

function PresenceStrip({ history }: { history: AbsencePoint[] }) {
  const last = history.slice(-21);
  return (
    <div className="flex items-center gap-[3px]">
      {last.map((p, i) => (
        <div
          key={i}
          className={cn(
            "w-1.5 h-4 rounded-[2px] transition-transform",
            p.present
              ? "bg-gradient-to-b from-emerald-300/90 to-emerald-500/70 shadow-[0_0_4px_hsl(155_60%_50%/0.4)]"
              : "bg-gradient-to-b from-white/[0.04] to-black/40 border border-white/[0.04]",
          )}
          title={`${p.date} — ${p.present ? "anwesend" : "Aussetzer"}`}
        />
      ))}
    </div>
  );
}

interface HistRow { chatter_name: string; account: string | null; analysis_date: string; revenue_today: number | null }

interface Loaded {
  forecasts: AbsenceForecast[];
  historyMap: Map<string, AbsencePoint[]>;
  backtest: ReturnType<typeof backtestAbsence> | null;
}

function useAbsenceData(): { loading: boolean; data: Loaded | null } {
  const { platform } = usePlatform();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const { data: reportRows } = await supabase
        .from("analysis_reports")
        .select("result_json")
        .eq("platform", platform)
        .not("result_json", "is", null)
        .order("analysis_date", { ascending: false })
        .limit(1);

      const result = reportRows?.[0]?.result_json;
      const activeChatters: { name: string; account: string | null }[] = [];
      if (isAnalysisResult(result)) {
        for (const cat of result.categories) {
          for (const ch of cat.chatters) {
            activeChatters.push({ name: ch.name, account: ch.account?.trim() || null });
          }
        }
      }

      const since = new Date();
      since.setDate(since.getDate() - 30);
      const sinceStr = since.toISOString().split("T")[0];

      const { data: histRows } = await supabase
        .from("chatter_history")
        .select("chatter_name, account, analysis_date, revenue_today")
        .eq("platform", platform)
        .gte("analysis_date", sinceStr)
        .order("analysis_date", { ascending: true });

      const byChatterDay = new Map<string, Map<string, number>>();
      for (const r of (histRows || []) as HistRow[]) {
        const k = r.chatter_name;
        if (!byChatterDay.has(k)) byChatterDay.set(k, new Map());
        const dayMap = byChatterDay.get(k)!;
        const rev = Number(r.revenue_today) || 0;
        const prev = dayMap.get(r.analysis_date) ?? 0;
        if (rev > prev) dayMap.set(r.analysis_date, rev);
      }

      const allDates: string[] = [];
      const today = new Date();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        allDates.push(d.toISOString().split("T")[0]);
      }

      const histMap = new Map<string, AbsencePoint[]>();
      for (const ch of activeChatters) {
        const dayMap = byChatterDay.get(ch.name);
        if (!dayMap || dayMap.size === 0) continue;
        const firstDate = [...dayMap.keys()].sort()[0];
        const series: AbsencePoint[] = [];
        for (const d of allDates) {
          if (d < firstDate) continue;
          const rev = dayMap.get(d) ?? 0;
          series.push({ date: d, present: rev > 0 });
        }
        if (series.length >= 5) histMap.set(ch.name, series);
      }

      const inputs: AbsenceForecastInput[] = [];
      for (const ch of activeChatters) {
        const h = histMap.get(ch.name);
        if (!h) continue;
        inputs.push({ chatter: ch.name, account: ch.account, history: h });
      }
      const fcs = forecastAbsenceMany(inputs);
      const bt = backtestAbsence(histMap, 0.45);

      if (cancelled) return;
      setData({ forecasts: fcs, historyMap: histMap, backtest: bt });
      setLoading(false);
    };
    run().catch(e => { console.error("AbsencePanel", e); setLoading(false); });
    return () => { cancelled = true; };
  }, [platform]);

  return { loading, data };
}

/* ───────── Prognose-Panel ───────── */
export function AbsenceForecastPanel() {
  const { platform } = usePlatform();
  const { loading, data } = useAbsenceData();
  const [openChatter, setOpenChatter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "alerts">("alerts");

  const forecasts = data?.forecasts || [];
  const historyMap = data?.historyMap || new Map<string, AbsencePoint[]>();

  const visible = useMemo(() => {
    if (filter === "alerts") return forecasts.filter(f => f.band !== "stable");
    return forecasts;
  }, [forecasts, filter]);

  const counts = useMemo(() => {
    const c = { critical: 0, warning: 0, watch: 0, stable: 0 };
    for (const f of forecasts) c[f.band]++;
    return c;
  }, [forecasts]);

  const toggle = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  if (loading) {
    return <PremiumSpinner />;
  }

  if (forecasts.length === 0) {
    return (
      <div className="premium-card rounded-xl p-8 text-center">
        <p className="text-foreground/60 font-light">Keine ausreichende History.</p>
        <p className="text-white/40 text-sm font-light mt-1">Mindestens 5 Tage Daten pro Chatter benötigt.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["critical", "warning", "watch", "stable"] as const).map(b => (
          <div key={b} className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-light", BAND_META[b].chip)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", BAND_META[b].dot)} />
            {BAND_META[b].label} <span className="tabular-nums opacity-70">{counts[b]}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center rounded-lg border border-white/[0.06] overflow-hidden">
          <button
            onClick={() => setFilter("alerts")}
            className={cn("px-3 py-1.5 text-xs font-light transition-colors",
              filter === "alerts" ? "bg-white/[0.08] text-foreground" : "text-white/40 hover:text-white/70")}
          >Nur Warnungen</button>
          <button
            onClick={() => setFilter("all")}
            className={cn("px-3 py-1.5 text-xs font-light transition-colors",
              filter === "all" ? "bg-white/[0.08] text-foreground" : "text-white/40 hover:text-white/70")}
          >Alle</button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="premium-card rounded-xl p-8 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-400/80 mx-auto mb-3" />
          <p className="text-foreground/80 font-light">Keine akuten Abwesenheits-Warnungen.</p>
          <p className="text-white/40 text-sm font-light mt-1">Alle Chatter im stabilen Muster.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(f => {
            const meta = BAND_META[f.band];
            const isOpen = expanded.has(f.chatter);
            const probPct = Math.round(f.nextDropProbability * 100);
            const glowClass = f.band === "critical" ? "glow-band-critical" : f.band === "warning" ? "glow-band-warning" : "";
            return (
              <div key={f.chatter} className={cn("premium-card premium-card-interactive rounded-xl overflow-hidden", glowClass)}>
                <button onClick={() => toggle(f.chatter)} className="w-full flex items-center gap-4 px-4 py-3.5 text-left">
                  <div className={cn("premium-chip flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium tabular-nums", meta.chip)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot, f.band === "critical" && "animate-pulse")} />
                    {probPct}%
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-foreground font-light truncate">{f.chatter}</span>
                      {f.account && <span className="text-white/30 text-xs font-light truncate">@{f.account}</span>}
                    </div>
                    <p className="text-white/50 text-xs font-light truncate mt-0.5">{f.message}</p>
                  </div>
                  <PresenceStrip history={historyMap.get(f.chatter) || []} />
                  <div className="text-right shrink-0 hidden sm:block">
                    <p className="text-white/60 text-xs font-light tabular-nums">{f.pattern.patternLabel}</p>
                    {f.predictedDropDate && (
                      <p className="text-orange-400/70 text-[10px] font-light tabular-nums">
                        Tipp: ~{new Date(f.predictedDropDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                      </p>
                    )}
                  </div>
                  <ChevronRight
                    className="h-4 w-4 text-white/30 shrink-0 transition-transform duration-300"
                    style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="exp"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-white/[0.04] bg-black/30 px-4 py-4 space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          {[
                            { label: "Aktueller Streak", value: `${f.currentStreakDays} Tage` },
                            { label: "Typisch / Max", value: `${f.pattern.avgPresentStreak.toFixed(1)} / ${f.pattern.maxPresentStreak}` },
                            { label: "Lücken (30d)", value: `${f.pattern.gapCount} · max ${f.pattern.maxGap}d` },
                            { label: "Anwesenheit", value: `${Math.round(f.pattern.presenceRate * 100)}%` },
                          ].map((item, idx) => (
                            <motion.div
                              key={item.label}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.03, duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                              className="premium-chip px-3 py-2 rounded-lg bg-white/[0.025] border border-white/[0.05]"
                            >
                              <p className="text-white/40 font-light">{item.label}</p>
                              <p className="text-foreground/90 tabular-nums mt-0.5">{item.value}</p>
                            </motion.div>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            onClick={() => setOpenChatter(f.chatter)}
                            className="text-xs font-light px-3 py-1.5 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors premium-chip"
                          >Detail öffnen</button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      <ChatterSlideOver
        open={!!openChatter}
        onClose={() => setOpenChatter(null)}
        chatterName={openChatter || ""}
        platform={platform}
      />
    </div>
  );
}

/* ───────── Backtest-Panel (Abwesenheit) ───────── */
export function AbsenceBacktestPanel() {
  const { loading, data } = useAbsenceData();
  const bt = data?.backtest || null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 border border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    );
  }
  if (!bt || bt.totalPredictions === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
        <p className="text-foreground/60 font-light">Noch nicht genug History für Abwesenheits-Backtest.</p>
        <p className="text-white/40 text-sm font-light mt-1">Mindestens 12 Tage History pro Chatter benötigt.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <p className="text-white/40 text-xs font-light">Vorhersagen</p>
          <p className="text-foreground text-2xl font-extralight tabular-nums mt-1">{bt.totalPredictions}</p>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <p className="text-emerald-400/70 text-xs font-light">Treffer</p>
          <p className="text-emerald-300 text-2xl font-extralight tabular-nums mt-1">{bt.hits}</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <p className="text-white/40 text-xs font-light">Trefferquote</p>
          <p className="text-foreground text-2xl font-extralight tabular-nums mt-1">{Math.round(bt.hitRate * 100)}%</p>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/[0.04]">
          <p className="text-foreground/70 text-xs font-medium tracking-wide uppercase">Historische Abwesenheits-Vorhersagen</p>
        </div>
        <div className="divide-y divide-white/[0.04] max-h-96 overflow-y-auto">
          {bt.details.slice(0, 50).map((d, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {d.actualGapWithin2Days ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400/80 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-white/20 shrink-0" />
              )}
              <span className="text-foreground/70 font-light truncate flex-1">{d.chatter}</span>
              <span className="text-white/30 text-xs tabular-nums">{d.pivotDate}</span>
              <span className="text-amber-400/70 text-xs tabular-nums w-16 text-right">{Math.round(d.predictedProb * 100)}%</span>
              <span className="text-white/40 text-xs tabular-nums w-16 text-right">Streak {d.currentStreak}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-white/30 text-xs font-light text-center">
        Hit = Prognose ≥ 45% wurde von tatsächlichem Aussetzer in den nächsten 2 Tagen gefolgt
      </p>
    </div>
  );
}
