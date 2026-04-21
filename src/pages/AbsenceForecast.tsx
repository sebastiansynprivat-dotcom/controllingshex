import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarX, ChevronRight, CheckCircle2, XCircle, Clock, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import {
  forecastAbsenceMany,
  backtestAbsence,
  type AbsenceForecast,
  type AbsencePoint,
  type AbsenceForecastInput,
} from "@/lib/absence-forecast";
import { cn } from "@/lib/utils";

interface AnalysisChatter { name: string; account?: string }
interface AnalysisCategory { chatters: AnalysisChatter[] }
interface AnalysisResult { categories: AnalysisCategory[] }
function isAnalysisResult(v: unknown): v is AnalysisResult {
  return !!v && typeof v === "object" && Array.isArray((v as AnalysisResult).categories);
}

const BAND_META: Record<AbsenceForecast["band"], { label: string; emoji: string; chip: string; dot: string; border: string }> = {
  critical: { label: "Akut", emoji: "🔴", chip: "bg-red-500/15 text-red-400 border-red-500/30", dot: "bg-red-500", border: "border-red-500/30" },
  warning:  { label: "Warnung", emoji: "🟠", chip: "bg-orange-500/10 text-orange-400 border-orange-500/30", dot: "bg-orange-400", border: "border-orange-500/25" },
  watch:    { label: "Beobachten", emoji: "🟡", chip: "bg-amber-500/10 text-amber-400 border-amber-500/25", dot: "bg-amber-400", border: "border-amber-500/20" },
  stable:   { label: "Stabil", emoji: "🟢", chip: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400", border: "border-emerald-500/15" },
};

function PresenceStrip({ history }: { history: AbsencePoint[] }) {
  // Zeigt die letzten ~21 Tage als Mini-Streifen (gefüllt = anwesend, leer = Aussetzer)
  const last = history.slice(-21);
  return (
    <div className="flex items-center gap-[2px]">
      {last.map((p, i) => (
        <div
          key={i}
          className={cn(
            "w-1.5 h-4 rounded-sm transition-colors",
            p.present ? "bg-emerald-400/70" : "bg-white/10",
          )}
          title={`${p.date} — ${p.present ? "anwesend" : "Aussetzer"}`}
        />
      ))}
    </div>
  );
}

interface HistRow { chatter_name: string; account: string | null; analysis_date: string; revenue_today: number | null }

export default function AbsenceForecastPage() {
  const { platform } = usePlatform();
  const [loading, setLoading] = useState(true);
  const [forecasts, setForecasts] = useState<AbsenceForecast[]>([]);
  const [historyMap, setHistoryMap] = useState<Map<string, AbsencePoint[]>>(new Map());
  const [backtestResult, setBacktestResult] = useState<ReturnType<typeof backtestAbsence> | null>(null);
  const [openChatter, setOpenChatter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "alerts">("alerts");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);

      // 1) Aktiver Chatter-Liste aus letztem Report
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

      // 2) History (volle 30 Tage) — nur revenue_today nötig
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const sinceStr = since.toISOString().split("T")[0];

      const { data: histRows } = await supabase
        .from("chatter_history")
        .select("chatter_name, account, analysis_date, revenue_today")
        .eq("platform", platform)
        .gte("analysis_date", sinceStr)
        .order("analysis_date", { ascending: true });

      // 3) Pro Chatter eine Tagesreihe bauen (1 Eintrag/Tag, max revenue über alle accounts)
      const byChatterDay = new Map<string, Map<string, number>>();
      for (const r of (histRows || []) as HistRow[]) {
        const k = r.chatter_name;
        if (!byChatterDay.has(k)) byChatterDay.set(k, new Map());
        const dayMap = byChatterDay.get(k)!;
        const rev = Number(r.revenue_today) || 0;
        const prev = dayMap.get(r.analysis_date) ?? 0;
        if (rev > prev) dayMap.set(r.analysis_date, rev);
      }

      // 4) Vollständige Tagesreihe ohne Lücken (jeder Tag muss vorkommen — fehlend = Aussetzer)
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
        // Erster Tag mit Daten — vorher gabs den Chatter offiziell nicht → ignorieren
        const firstDate = [...dayMap.keys()].sort()[0];
        const series: AbsencePoint[] = [];
        for (const d of allDates) {
          if (d < firstDate) continue;
          const rev = dayMap.get(d) ?? 0;
          series.push({ date: d, present: rev > 0 });
        }
        if (series.length >= 5) histMap.set(ch.name, series);
      }
      if (cancelled) return;
      setHistoryMap(histMap);

      // 5) Forecasts
      const inputs: AbsenceForecastInput[] = [];
      for (const ch of activeChatters) {
        const h = histMap.get(ch.name);
        if (!h) continue;
        inputs.push({ chatter: ch.name, account: ch.account, history: h });
      }
      const fcs = forecastAbsenceMany(inputs);
      if (cancelled) return;
      setForecasts(fcs);

      // 6) Backtest
      const bt = backtestAbsence(histMap, 0.45);
      if (cancelled) return;
      setBacktestResult(bt);

      setLoading(false);
    };
    run().catch(e => { console.error("AbsenceForecast", e); setLoading(false); });
    return () => { cancelled = true; };
  }, [platform]);

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

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 min-w-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={platform}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-5xl mx-auto p-2 sm:p-8 lg:p-12 space-y-8"
          >
            <header className="space-y-2">
              <div className="flex items-center gap-3">
                <CalendarX className="h-6 w-6 text-amber-400/80" />
                <h1 className="text-2xl sm:text-3xl font-extralight tracking-tight text-foreground">
                  Abwesenheits-Muster
                </h1>
              </div>
              <p className="text-white/40 text-sm font-light tracking-wide max-w-2xl">
                Erkennt das individuelle Anwesenheitsmuster jedes Chatters und warnt,
                <span className="text-white/60"> bevor</span> der nächste Aussetzer kommt — damit du rechtzeitig eingreifen kannst.
              </p>
            </header>

            <Tabs defaultValue="forecast" className="space-y-6">
              <TabsList className="bg-white/[0.03] border border-white/[0.06]">
                <TabsTrigger value="forecast">Prognose</TabsTrigger>
                <TabsTrigger value="backtest">Treffer-Quote</TabsTrigger>
              </TabsList>

              {/* ───────── Prognose Tab ───────── */}
              <TabsContent value="forecast" className="space-y-4">
                {loading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="h-6 w-6 border border-white/20 border-t-white/60 rounded-full animate-spin" />
                  </div>
                ) : forecasts.length === 0 ? (
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
                    <p className="text-foreground/60 font-light">Keine ausreichende History.</p>
                    <p className="text-white/40 text-sm font-light mt-1">
                      Mindestens 5 Tage Daten pro Chatter benötigt.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Counts + Filter */}
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
                        >
                          Nur Warnungen
                        </button>
                        <button
                          onClick={() => setFilter("all")}
                          className={cn("px-3 py-1.5 text-xs font-light transition-colors",
                            filter === "all" ? "bg-white/[0.08] text-foreground" : "text-white/40 hover:text-white/70")}
                        >
                          Alle
                        </button>
                      </div>
                    </div>

                    {visible.length === 0 ? (
                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
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
                          return (
                            <div
                              key={f.chatter}
                              className={cn("rounded-xl border bg-white/[0.02] overflow-hidden transition-colors hover:border-white/[0.12]", meta.border)}
                            >
                              <button onClick={() => toggle(f.chatter)} className="w-full flex items-center gap-4 px-4 py-3.5 text-left">
                                <div className={cn("flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium", meta.chip)}>
                                  <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
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
                                  <p className="text-white/60 text-xs font-light tabular-nums">
                                    {f.pattern.patternLabel}
                                  </p>
                                  {f.predictedDropDate && (
                                    <p className="text-orange-400/70 text-[10px] font-light tabular-nums">
                                      Tipp: ~{new Date(f.predictedDropDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                                    </p>
                                  )}
                                </div>
                                <ChevronRight className={cn("h-4 w-4 text-white/30 shrink-0 transition-transform", isOpen && "rotate-90")} />
                              </button>

                              {isOpen && (
                                <div className="border-t border-white/[0.04] bg-black/20 px-4 py-4 space-y-3">
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                    <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                                      <p className="text-white/40 font-light">Aktueller Streak</p>
                                      <p className="text-foreground/90 tabular-nums mt-0.5">{f.currentStreakDays} Tage</p>
                                    </div>
                                    <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                                      <p className="text-white/40 font-light">Typisch / Max</p>
                                      <p className="text-foreground/90 tabular-nums mt-0.5">
                                        {f.pattern.avgPresentStreak.toFixed(1)} / {f.pattern.maxPresentStreak}
                                      </p>
                                    </div>
                                    <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                                      <p className="text-white/40 font-light">Lücken (30d)</p>
                                      <p className="text-foreground/90 tabular-nums mt-0.5">
                                        {f.pattern.gapCount} · max {f.pattern.maxGap}d
                                      </p>
                                    </div>
                                    <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                                      <p className="text-white/40 font-light">Anwesenheit</p>
                                      <p className="text-foreground/90 tabular-nums mt-0.5">
                                        {Math.round(f.pattern.presenceRate * 100)}%
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-2 pt-1">
                                    <button
                                      onClick={() => setOpenChatter(f.chatter)}
                                      className="text-xs font-light px-3 py-1.5 rounded-lg bg-primary/10 text-primary/80 hover:bg-primary/20 transition-colors"
                                    >
                                      Detail öffnen
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </TabsContent>

              {/* ───────── Backtest Tab ───────── */}
              <TabsContent value="backtest" className="space-y-4">
                {loading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="h-6 w-6 border border-white/20 border-t-white/60 rounded-full animate-spin" />
                  </div>
                ) : !backtestResult || backtestResult.totalPredictions === 0 ? (
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
                    <p className="text-foreground/60 font-light">Noch nicht genug History für Backtest.</p>
                    <p className="text-white/40 text-sm font-light mt-1">Mindestens 12 Tage History pro Chatter benötigt.</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                        <p className="text-white/40 text-xs font-light">Vorhersagen</p>
                        <p className="text-foreground text-2xl font-extralight tabular-nums mt-1">
                          {backtestResult.totalPredictions}
                        </p>
                      </div>
                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                        <p className="text-emerald-400/70 text-xs font-light">Treffer</p>
                        <p className="text-emerald-300 text-2xl font-extralight tabular-nums mt-1">
                          {backtestResult.hits}
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                        <p className="text-white/40 text-xs font-light">Trefferquote</p>
                        <p className="text-foreground text-2xl font-extralight tabular-nums mt-1">
                          {Math.round(backtestResult.hitRate * 100)}%
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-white/[0.04]">
                        <p className="text-foreground/70 text-xs font-medium tracking-wide uppercase">
                          Historische Vorhersagen
                        </p>
                      </div>
                      <div className="divide-y divide-white/[0.04] max-h-96 overflow-y-auto">
                        {backtestResult.details.slice(0, 50).map((d, i) => (
                          <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                            {d.actualGapWithin2Days ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-400/80 shrink-0" />
                            ) : (
                              <XCircle className="h-4 w-4 text-white/20 shrink-0" />
                            )}
                            <span className="text-foreground/70 font-light truncate flex-1">{d.chatter}</span>
                            <span className="text-white/30 text-xs tabular-nums">{d.pivotDate}</span>
                            <span className="text-amber-400/70 text-xs tabular-nums w-16 text-right">
                              {Math.round(d.predictedProb * 100)}%
                            </span>
                            <span className="text-white/40 text-xs tabular-nums w-16 text-right">
                              Streak {d.currentStreak}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <p className="text-white/30 text-xs font-light text-center">
                      Hit = Prognose ≥ 45% wurde von tatsächlichem Aussetzer in den nächsten 2 Tagen gefolgt
                    </p>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </motion.div>
        </AnimatePresence>
      </div>
      <ChatterSlideOver
        open={!!openChatter}
        onClose={() => setOpenChatter(null)}
        chatterName={openChatter || ""}
        platform={platform}
      />
    </div>
  );
}
