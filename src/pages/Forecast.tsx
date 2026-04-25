import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertOctagon, TrendingDown, MessageSquare, Clock, Inbox, Users, Sparkles, ChevronRight, Target, CheckCircle2, XCircle, CalendarX, Brain, ChevronDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { onChatterDataUpdated } from "@/lib/data-events";
import { onChatterDataUpdated } from "@/lib/data-events";
import { usePlatform } from "@/contexts/PlatformContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RiskBadge } from "@/components/RiskBadge";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { AbsenceForecastPanel, AbsenceBacktestPanel } from "@/components/AbsencePanel";
import { MLForecastPanel } from "@/components/MLForecastPanel";
import { loadBenchmarks, findCluster, type BenchmarkBundle } from "@/lib/peer-benchmarks";
import {
  computeRiskScores,
  backtest,
  type RiskScore,
  type ForecastInput,
  type HistoryPoint,
  type SignalContribution,
} from "@/lib/risk-forecast";

interface AnalysisChatter {
  name: string;
  startDate?: string;
  account?: string;
}
interface AnalysisCategory { chatters: AnalysisChatter[] }
interface AnalysisResult { categories: AnalysisCategory[] }

function isAnalysisResult(v: unknown): v is AnalysisResult {
  return !!v && typeof v === "object" && Array.isArray((v as AnalysisResult).categories);
}

interface HistRow {
  chatter_name: string;
  account: string | null;
  analysis_date: string;
  revenue_today: number | null;
  response_delay_days: number | null;
  mass_dms: number | null;
  open_chats: number | null;
}

const SIGNAL_ICON: Record<SignalContribution["key"], React.ComponentType<{ className?: string }>> = {
  revenue: TrendingDown,
  delay: Clock,
  massdm: MessageSquare,
  openchats: Inbox,
  peer: Users,
  onboarding: Sparkles,
  tier: Target,
  absence: CalendarX,
};

function daysBetween(start: string | undefined, today: Date): number | null {
  if (!start) return null;
  const d = new Date(start);
  if (isNaN(d.getTime())) return null;
  return Math.floor((today.getTime() - d.getTime()) / 86_400_000);
}

function Sparkline({ values, band }: { values: number[]; band: RiskScore["band"] }) {
  if (values.length < 2) return <div className="h-6 w-16" />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const w = 64, h = 24;
  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return [x, y] as const;
  });
  const linePts = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPts = `0,${h} ${linePts} ${w},${h}`;
  const stroke = band === "critical" ? "hsl(0 80% 62%)" : band === "high" ? "hsl(25 90% 58%)" : band === "medium" ? "hsl(45 90% 58%)" : "hsl(155 60% 50%)";
  const gradId = `spark-${band}`;
  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#${gradId})`} />
      <polyline points={linePts} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PremiumSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="premium-spinner"><span /><span /><span /></div>
    </div>
  );
}

export default function Forecast() {
  const { platform } = usePlatform();
  const [loading, setLoading] = useState(true);
  const [risks, setRisks] = useState<RiskScore[]>([]);
  const [allRisks, setAllRisks] = useState<RiskScore[]>([]);
  const [backtestResult, setBacktestResult] = useState<ReturnType<typeof backtest> | null>(null);
  const [bundle, setBundle] = useState<BenchmarkBundle | null>(null);
  const [openChatter, setOpenChatter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"forecast" | "absence" | "ml" | "backtest">("forecast");
  const [tabMenuOpen, setTabMenuOpen] = useState(false);

  const TAB_META: Record<typeof tab, { label: string; icon: React.ComponentType<{ className?: string }>; hint: string }> = {
    forecast: { label: "Frühwarnung", icon: AlertOctagon, hint: "Crash-Risiko nächste 3 Tage" },
    absence: { label: "Abwesenheit", icon: CalendarX, hint: "Wer fehlt morgen?" },
    ml: { label: "Smart-Modell", icon: Brain, hint: "ML-Vorhersage" },
    backtest: { label: "Treffer-Quote", icon: Target, hint: "Modell-Genauigkeit" },
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);

      // 1. Aktueller Report → liefert Liste aktiver Chatter + startDate + account
      const { data: reportRows } = await supabase
        .from("analysis_reports")
        .select("result_json")
        .eq("platform", platform)
        .not("result_json", "is", null)
        .order("analysis_date", { ascending: false })
        .limit(1);

      const result = reportRows?.[0]?.result_json;
      const activeChatters: { name: string; account: string | null; daysSinceStart: number | null }[] = [];
      const today = new Date();
      if (isAnalysisResult(result)) {
        for (const cat of result.categories) {
          for (const ch of cat.chatters) {
            activeChatters.push({
              name: ch.name,
              account: ch.account?.trim() || null,
              daysSinceStart: daysBetween(ch.startDate, today),
            });
          }
        }
      }

      // 2. History (letzte 30 Tage) für alle Chatter
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const sinceStr = since.toISOString().split("T")[0];

      const { data: histRows } = await supabase
        .from("chatter_history")
        .select("chatter_name, account, analysis_date, revenue_today, response_delay_days, mass_dms, open_chats")
        .eq("platform", platform)
        .gte("analysis_date", sinceStr)
        .order("analysis_date", { ascending: true });

      // 3. Peer-Benchmarks
      const bm = await loadBenchmarks(platform, 30);
      if (cancelled) return;
      setBundle(bm);

      // 4. Gruppiere History: pro Chatter → ein HistoryPoint pro Tag (aggregiert über Accounts)
      const byChatter = new Map<string, Map<string, HistoryPoint>>();
      for (const r of (histRows || []) as HistRow[]) {
        const k = r.chatter_name;
        if (!byChatter.has(k)) byChatter.set(k, new Map());
        const dayMap = byChatter.get(k)!;
        const existing = dayMap.get(r.analysis_date);
        const rev = Number(r.revenue_today) || 0;
        // Pro Tag: nimm max revenue (CSV repliziert oft); summiere chats/dms; max delay
        if (existing) {
          existing.revenue = Math.max(existing.revenue, rev);
          existing.responseDelay = Math.max(existing.responseDelay, Number(r.response_delay_days) || 0);
          existing.massDms = Math.max(existing.massDms, Number(r.mass_dms) || 0);
          existing.openChats = Math.max(existing.openChats, Number(r.open_chats) || 0);
        } else {
          dayMap.set(r.analysis_date, {
            date: r.analysis_date,
            revenue: rev,
            responseDelay: Number(r.response_delay_days) || 0,
            massDms: Number(r.mass_dms) || 0,
            openChats: Number(r.open_chats) || 0,
          });
        }
      }

      // 5. Risk-Inputs bauen
      const inputs: ForecastInput[] = [];
      for (const ch of activeChatters) {
        const dayMap = byChatter.get(ch.name);
        if (!dayMap || dayMap.size < 3) continue;
        const sortedDays = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
        const last7 = sortedDays.slice(-7);

        const followers = ch.account
          ? bm.accountBaselines.get(ch.account.toLowerCase().trim())?.followers ?? 0
          : 0;
        const cluster = findCluster(bm, followers);

        inputs.push({
          chatter: ch.name,
          account: ch.account,
          followers,
          history: last7,
          daysSinceStart: ch.daysSinceStart,
          peerMedian: cluster?.median ?? bm.globalMedian ?? null,
          peerP25: cluster?.p25 ?? bm.globalP25 ?? null,
        });
      }

      const scores = computeRiskScores(inputs);
      if (cancelled) return;
      setAllRisks(scores);
      setRisks(scores.filter(s => s.score >= 60));

      // 6. Backtest (auf voller History)
      const fullHistMap = new Map<string, HistoryPoint[]>();
      for (const [name, dayMap] of byChatter) {
        fullHistMap.set(name, [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)));
      }
      const meta = new Map<string, { account: string | null; followers: number; daysSinceStart: number | null; peerMedian: number | null; peerP25: number | null }>();
      for (const ch of activeChatters) {
        const followers = ch.account
          ? bm.accountBaselines.get(ch.account.toLowerCase().trim())?.followers ?? 0
          : 0;
        const cluster = findCluster(bm, followers);
        meta.set(ch.name, {
          account: ch.account,
          followers,
          daysSinceStart: ch.daysSinceStart,
          peerMedian: cluster?.median ?? bm.globalMedian ?? null,
          peerP25: cluster?.p25 ?? bm.globalP25 ?? null,
        });
      }
      const bt = backtest(fullHistMap, meta, 60, 30);
      if (cancelled) return;
      setBacktestResult(bt);

      setLoading(false);
    };
    run().catch((e) => {
      console.error("Forecast load error", e);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [platform]);

  const totalEuroAtRisk = useMemo(() => risks.reduce((s, r) => s + r.euroAtRisk, 0), [risks]);

  const toggle = (name: string) => {
    setExpanded((prev) => {
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
            className="max-w-5xl mx-auto px-4 py-5 sm:p-8 lg:p-12 space-y-6 sm:space-y-8"
          >
            <header className="space-y-1.5">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <AlertOctagon className="h-5 w-5 sm:h-6 sm:w-6 text-orange-400/80 shrink-0" />
                <h1 className="text-xl sm:text-3xl font-extralight tracking-tight text-foreground">
                  Frühwarnung
                </h1>
              </div>
              <p className="text-white/40 text-xs sm:text-sm font-light tracking-wide">
                Prognose der nächsten 1–3 Tage · {platform}
              </p>
            </header>

            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="space-y-5 sm:space-y-6">
              {/* Mobile: Premium Dropdown */}
              <div className="sm:hidden">
                <Popover open={tabMenuOpen} onOpenChange={setTabMenuOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className="premium-card premium-card-interactive w-full flex items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-left"
                      aria-label="Ansicht wählen"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {(() => { const Icon = TAB_META[tab].icon; return <Icon className="h-3.5 w-3.5 text-orange-400/80 shrink-0" />; })()}
                        <div className="min-w-0 leading-tight">
                          <p className="text-[9px] uppercase tracking-[0.18em] text-white/40 font-medium gold-text-subtle">Ansicht</p>
                          <p className="text-foreground font-light text-[13px] truncate">{TAB_META[tab].label}</p>
                        </div>
                      </div>
                      <ChevronDown
                        className="h-3.5 w-3.5 text-white/40 shrink-0 transition-transform duration-300"
                        style={{ transform: tabMenuOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                      />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={8}
                    className="premium-card w-[calc(100vw-2rem)] max-w-sm p-1.5 border-white/[0.08] bg-black/95 backdrop-blur-xl rounded-xl"
                  >
                    {(Object.keys(TAB_META) as Array<keyof typeof TAB_META>).map((key) => {
                      const meta = TAB_META[key];
                      const Icon = meta.icon;
                      const active = tab === key;
                      return (
                        <button
                          key={key}
                          onClick={() => { setTab(key); setTabMenuOpen(false); }}
                          className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${active ? "bg-white/[0.05]" : "hover:bg-white/[0.03]"}`}
                        >
                          <Icon className={`h-4 w-4 shrink-0 ${active ? "text-orange-400/90" : "text-white/40"}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-light truncate ${active ? "text-foreground" : "text-foreground/75"}`}>{meta.label}</p>
                            <p className="text-[11px] text-white/40 font-light truncate">{meta.hint}</p>
                          </div>
                          {active && <Check className="h-3.5 w-3.5 text-orange-400/90 shrink-0" />}
                        </button>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </div>

              {/* Desktop: Tab-Leiste */}
              <TabsList className="hidden sm:flex bg-transparent border-b border-white/[0.06] rounded-none p-0 h-auto gap-1 w-full justify-start">
                <TabsTrigger
                  value="forecast"
                  className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-3 py-2 text-sm font-light text-white/40 data-[state=active]:text-foreground data-[state=active]:gold-underline-active transition-colors"
                >Frühwarnung</TabsTrigger>
                <TabsTrigger
                  value="absence"
                  className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-3 py-2 text-sm font-light text-white/40 data-[state=active]:text-foreground data-[state=active]:gold-underline-active transition-colors"
                >Abwesenheit</TabsTrigger>
                <TabsTrigger
                  value="ml"
                  className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-3 py-2 text-sm font-light text-white/40 data-[state=active]:text-foreground data-[state=active]:gold-underline-active transition-colors gap-1.5"
                >
                  <Brain className="h-3 w-3" />
                  Smart-Modell
                </TabsTrigger>
                <TabsTrigger
                  value="backtest"
                  className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-3 py-2 text-sm font-light text-white/40 data-[state=active]:text-foreground data-[state=active]:gold-underline-active transition-colors"
                >Treffer-Quote</TabsTrigger>
              </TabsList>

              {/* ───────── Abwesenheits-Tab ───────── */}
              <TabsContent value="absence" className="space-y-4">
                <AbsenceForecastPanel />
              </TabsContent>

              {/* ───────── ML-Tab ───────── */}
              <TabsContent value="ml" className="space-y-4">
                <MLForecastPanel />
              </TabsContent>

              {/* ───────── Forecast Tab ───────── */}
              <TabsContent value="forecast" className="space-y-4">
                {loading ? (
                  <PremiumSpinner />
                ) : risks.length === 0 ? (
                  <div className="premium-card rounded-xl p-8 text-center">
                    <CheckCircle2 className="h-8 w-8 text-emerald-400/80 mx-auto mb-3" />
                    <p className="text-foreground/80 font-light">
                      Keine Chatter mit Risk-Score ≥ 60.
                    </p>
                    <p className="text-white/40 text-sm font-light mt-1">
                      Aktuell keine Crash-Warnungen für die nächsten 3 Tage.
                    </p>
                    {allRisks.length > 0 && (
                      <p className="text-white/30 text-xs font-light mt-3">
                        {allRisks.length} Chatter analysiert · höchster Score: {allRisks[0]?.score ?? 0}
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="premium-card flex items-baseline justify-between gap-3 rounded-xl px-3 sm:px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-foreground/80 font-light text-xs sm:text-sm truncate">
                          {risks.length} Chatter mit hohem Crash-Risiko
                        </p>
                        <p className="text-white/40 text-[11px] sm:text-xs font-light">in den nächsten 3 Tagen</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="gold-text font-medium text-lg sm:text-xl tabular-nums">
                          ~{totalEuroAtRisk}€
                        </p>
                        <p className="text-white/40 text-[11px] sm:text-xs font-light">Geld-Risiko</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {risks.map((r) => {
                        const isOpen = expanded.has(r.chatter);
                        const glowClass = r.band === "critical" ? "glow-band-critical" : r.band === "high" ? "glow-band-high" : "";
                        return (
                          <div
                            key={r.chatter}
                            className={`premium-card premium-card-interactive rounded-xl overflow-hidden ${glowClass}`}
                          >
                            <button
                              onClick={() => toggle(r.chatter)}
                              className="w-full flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 sm:py-3.5 text-left"
                            >
                              <RiskBadge score={r.score} band={r.band} size="md" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2 flex-wrap">
                                  <span className="text-foreground font-light truncate text-sm sm:text-base">{r.chatter}</span>
                                  {r.account && (
                                    <span className="text-white/30 text-xs font-light truncate hidden sm:inline">@{r.account}</span>
                                  )}
                                </div>
                                <p className="text-white/50 text-[11px] sm:text-xs font-light truncate mt-0.5">
                                  {r.mainReason}
                                </p>
                              </div>
                              <div className="hidden sm:block">
                                <Sparkline values={r.revenueTrend} band={r.band} />
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-orange-400/80 text-xs sm:text-sm tabular-nums">~{r.euroAtRisk}€</p>
                                <p className="text-white/30 text-[10px] font-light">in 3T</p>
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
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      {r.signals
                                        .filter(s => s.points > 0)
                                        .sort((a, b) => b.points - a.points)
                                        .map((s, idx) => {
                                          const Icon = SIGNAL_ICON[s.key];
                                          return (
                                            <motion.div
                                              key={s.key}
                                              initial={{ opacity: 0, y: 6 }}
                                              animate={{ opacity: 1, y: 0 }}
                                              transition={{ delay: idx * 0.03, duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                                              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.025] border border-white/[0.05] premium-chip"
                                            >
                                              <Icon className="h-4 w-4 text-white/40 shrink-0" />
                                              <div className="flex-1 min-w-0">
                                                <p className="text-foreground/70 text-xs font-light">{s.label}</p>
                                                <p className="text-white/40 text-[11px] font-light truncate">{s.detail}</p>
                                              </div>
                                              <span className="text-orange-400/80 text-xs tabular-nums">+{s.points}</span>
                                            </motion.div>
                                          );
                                        })}
                                    </div>
                                    <div className="flex flex-wrap gap-2 pt-1">
                                      <button
                                        onClick={() => setOpenChatter(r.chatter)}
                                        className="text-xs font-light px-3 py-1.5 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors premium-chip"
                                      >
                                        Detail öffnen
                                      </button>
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </TabsContent>

              {/* ───────── Backtest Tab ───────── */}
              <TabsContent value="backtest" className="space-y-4">
                {loading ? (
                  <PremiumSpinner />
                ) : !backtestResult || backtestResult.totalPredictions === 0 ? (
                  <div className="premium-card rounded-xl p-8 text-center">
                    <p className="text-foreground/60 font-light">
                      Noch nicht genug History für Backtest.
                    </p>
                    <p className="text-white/40 text-sm font-light mt-1">
                      Mindestens 10 Tage History pro Chatter benötigt.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      <div className="premium-card rounded-xl px-4 py-3">
                        <p className="text-white/40 text-[11px] font-medium tracking-wider uppercase gold-text-subtle">Vorhersagen</p>
                        <p className="text-foreground text-3xl font-extralight tabular-nums mt-1">
                          {backtestResult.totalPredictions}
                        </p>
                      </div>
                      <div className="premium-card rounded-xl px-4 py-3 border-emerald-500/15">
                        <p className="text-emerald-400/80 text-[11px] font-medium tracking-wider uppercase">Treffer</p>
                        <p className="text-emerald-300 text-3xl font-extralight tabular-nums mt-1">
                          {backtestResult.hits}
                        </p>
                      </div>
                      <div className="premium-card rounded-xl px-4 py-3">
                        <p className="text-white/40 text-[11px] font-medium tracking-wider uppercase gold-text-subtle">Trefferquote</p>
                        <p className="gold-text text-3xl font-extralight tabular-nums mt-1">
                          {Math.round(backtestResult.hitRate * 100)}%
                        </p>
                      </div>
                    </div>

                    <div className="premium-card rounded-xl overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-white/[0.04]">
                        <p className="text-[11px] font-medium tracking-wider uppercase gold-text-subtle">
                          Historische Vorhersagen
                        </p>
                      </div>
                      <div className="divide-y divide-white/[0.04] max-h-96 overflow-y-auto">
                        {backtestResult.details.slice(0, 50).map((d, i) => (
                          <div key={i} className="row-accent flex items-center gap-3 px-4 py-2.5 text-sm">
                            {d.hit ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-400/80 shrink-0" />
                            ) : (
                              <XCircle className="h-4 w-4 text-white/20 shrink-0" />
                            )}
                            <span className="text-foreground/70 font-light truncate flex-1">{d.chatter}</span>
                            <span className="text-white/30 text-xs tabular-nums">{d.date}</span>
                            <span className="text-orange-400/60 text-xs tabular-nums w-12 text-right">Risk {d.predictedScore}</span>
                            <span className={`text-xs tabular-nums w-16 text-right ${d.actualDropPct >= 30 ? "text-red-400/80" : "text-white/30"}`}>
                              {d.actualDropPct >= 0 ? "−" : "+"}{Math.abs(d.actualDropPct)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <p className="text-white/30 text-xs font-light text-center">
                      Hit = Risk ≥ 60 wurde von tatsächlichem Revenue-Drop ≥ 30% gefolgt
                    </p>
                  </>
                )}

                <div className="pt-6 space-y-3">
                  <p className="text-[11px] font-medium tracking-wider uppercase gold-text-subtle">
                    Abwesenheits-Prognose
                  </p>
                  <AbsenceBacktestPanel />
                </div>
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
