import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import { useAuth } from "@/contexts/AuthContext";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Trophy, CalendarIcon, ArrowUp, ArrowDown, Minus, Sparkles, Flame, TrendingUp, Crown } from "lucide-react";
import { toast } from "sonner";
import { format, startOfDay, startOfWeek, startOfMonth, subDays, differenceInCalendarDays } from "date-fns";
import { de } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";

type FilterMode = "today" | "week" | "month" | "custom";

interface LeaderboardEntry {
  name: string;
  total: number;
  activeDays: number;
  prevTotal: number;
  prevRank: number | null;
  rank: number;
  rankDelta: number | null; // positive = aufgestiegen, negative = abgefallen, null = neu
  pctChange: number | null; // % vs. previous period
  isNew: boolean;
}

interface Highlight {
  id: string;
  icon: typeof Flame;
  text: string;
  tone: "fire" | "gold" | "rise" | "new";
}

const displayName = (n: string) =>
  n.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function Leaderboard() {
  const { platform } = usePlatform();
  const { session } = useAuth();
  const [filter, setFilter] = useState<FilterMode>("month");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [selectedChatter, setSelectedChatter] = useState<string | null>(null);

  const { dateRange, prevRange } = useMemo(() => {
    const now = new Date();
    let from: Date, to: Date;
    switch (filter) {
      case "today":
        from = startOfDay(now); to = now; break;
      case "week":
        from = startOfWeek(now, { weekStartsOn: 1 }); to = now; break;
      case "month":
        from = startOfMonth(now); to = now; break;
      case "custom":
        from = customRange?.from ?? subDays(now, 30);
        to = customRange?.to ?? now;
        break;
    }
    const lengthDays = Math.max(1, differenceInCalendarDays(to, from) + 1);
    const prevTo = subDays(from, 1);
    const prevFrom = subDays(prevTo, lengthDays - 1);
    return { dateRange: { from, to }, prevRange: { from: prevFrom, to: prevTo } };
  }, [filter, customRange]);

  const { data: leaderboard = [], isLoading } = useQuery({
    queryKey: ["leaderboard", platform, filter, dateRange.from, dateRange.to],
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const fromStr = format(dateRange.from, "yyyy-MM-dd");
      const toStr = format(dateRange.to, "yyyy-MM-dd");
      const prevFromStr = format(prevRange.from, "yyyy-MM-dd");
      const prevToStr = format(prevRange.to, "yyyy-MM-dd");

      // Fetch active chatter names from the latest report
      const { data: latestReport } = await supabase
        .from("analysis_reports")
        .select("result_json")
        .eq("platform", platform)
        .eq("user_id", session?.user?.id ?? "")
        .order("analysis_date", { ascending: false })
        .limit(1)
        .single();

      const normalize = (n: string) => n.toLowerCase().replace(/[_ ]+/g, "_").trim();

      const activeNames = new Set<string>();
      if (latestReport?.result_json) {
        const result = latestReport.result_json as any;
        const categories = result?.categories ?? [];
        for (const cat of categories) {
          for (const ch of cat.chatters ?? []) {
            if (ch.name) activeNames.add(normalize(ch.name));
          }
        }
      }

      // Current + previous period in parallel
      const [currentRes, prevRes] = await Promise.all([
        supabase
          .from("chatter_history")
          .select("chatter_name, revenue_today, analysis_date")
          .eq("platform", platform)
          .eq("user_id", session?.user?.id ?? "")
          .gte("analysis_date", fromStr)
          .lte("analysis_date", toStr),
        supabase
          .from("chatter_history")
          .select("chatter_name, revenue_today")
          .eq("platform", platform)
          .eq("user_id", session?.user?.id ?? "")
          .gte("analysis_date", prevFromStr)
          .lte("analysis_date", prevToStr),
      ]);

      if (currentRes.error) throw currentRes.error;

      const grouped = (currentRes.data ?? []).reduce<
        Record<string, { total: number; days: Set<string> }>
      >((acc, row) => {
        const name = row.chatter_name;
        if (activeNames.size > 0 && !activeNames.has(normalize(name))) return acc;
        if (!acc[name]) acc[name] = { total: 0, days: new Set() };
        acc[name].total += Number(row.revenue_today ?? 0);
        acc[name].days.add(row.analysis_date);
        return acc;
      }, {});

      const prevGrouped = (prevRes.data ?? []).reduce<Record<string, number>>((acc, row) => {
        const name = row.chatter_name;
        acc[name] = (acc[name] ?? 0) + Number(row.revenue_today ?? 0);
        return acc;
      }, {});

      // Previous ranking (only chatters with revenue > 0)
      const prevSorted = Object.entries(prevGrouped)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);
      const prevRankMap = new Map<string, number>();
      prevSorted.forEach(([name], i) => prevRankMap.set(name, i + 1));

      const sorted = Object.entries(grouped)
        .map(([name, { total, days }]) => ({
          name,
          total: Math.round(total * 100) / 100,
          activeDays: days.size,
          prevTotal: Math.round((prevGrouped[name] ?? 0) * 100) / 100,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 20);

      return sorted.map((entry, i) => {
        const rank = i + 1;
        const prevRank = prevRankMap.get(entry.name) ?? null;
        const isNew = entry.prevTotal === 0;
        const rankDelta = prevRank == null ? null : prevRank - rank; // positive = stieg auf
        const pctChange =
          entry.prevTotal > 0
            ? Math.round(((entry.total - entry.prevTotal) / entry.prevTotal) * 100)
            : entry.total > 0
              ? null // "neu" -> kein %
              : 0;
        return { ...entry, rank, prevRank, rankDelta, pctChange, isNew };
      });
    },
    enabled: !!session?.user?.id,
  });

  // ── Highlights für Live-Ticker ──
  const highlights = useMemo<Highlight[]>(() => {
    if (!leaderboard.length) return [];
    const list: Highlight[] = [];

    // 1) Neuer #1 (Krone wechselt)
    const top = leaderboard[0];
    if (top && top.rankDelta != null && top.rankDelta > 0) {
      list.push({
        id: "new-king",
        icon: Crown,
        tone: "gold",
        text: `${displayName(top.name)} ist neue Nr. 1 (vorher #${top.prevRank})`,
      });
    }

    // 2) Größter %-Aufstieg (nur mit gültigem pctChange > 50)
    const biggestGain = [...leaderboard]
      .filter((e) => e.pctChange != null && e.pctChange > 50)
      .sort((a, b) => (b.pctChange ?? 0) - (a.pctChange ?? 0))[0];
    if (biggestGain) {
      list.push({
        id: `gain-${biggestGain.name}`,
        icon: Flame,
        tone: "fire",
        text: `${displayName(biggestGain.name)} +${biggestGain.pctChange}% diese Periode`,
      });
    }

    // 3) Größter Rang-Sprung (Aufstieg)
    const biggestJump = [...leaderboard]
      .filter((e) => e.rankDelta != null && e.rankDelta >= 3)
      .sort((a, b) => (b.rankDelta ?? 0) - (a.rankDelta ?? 0))[0];
    if (biggestJump && biggestJump.name !== top?.name) {
      list.push({
        id: `jump-${biggestJump.name}`,
        icon: TrendingUp,
        tone: "rise",
        text: `${displayName(biggestJump.name)} springt ${biggestJump.rankDelta} Plätze nach oben`,
      });
    }

    // 4) Neueinsteiger in Top 10
    const newcomer = leaderboard.slice(0, 10).find((e) => e.isNew);
    if (newcomer) {
      list.push({
        id: `new-${newcomer.name}`,
        icon: Sparkles,
        tone: "new",
        text: `${displayName(newcomer.name)} neu in Top 10 auf #${newcomer.rank}`,
      });
    }

    return list;
  }, [leaderboard]);

  // Ticker-Rotation
  const [tickerIdx, setTickerIdx] = useState(0);
  useEffect(() => {
    if (highlights.length <= 1) return;
    const t = setInterval(() => setTickerIdx((i) => (i + 1) % highlights.length), 4000);
    return () => clearInterval(t);
  }, [highlights.length]);
  useEffect(() => { setTickerIdx(0); }, [highlights.length]);

  const filterButtons: { label: string; mode: FilterMode }[] = [
    { label: "Heute", mode: "today" },
    { label: "Woche", mode: "week" },
    { label: "Monat", mode: "month" },
    { label: "Custom", mode: "custom" },
  ];

  const toneClasses: Record<Highlight["tone"], string> = {
    fire: "from-orange-500/20 to-red-500/10 border-orange-500/30 text-orange-200",
    gold: "from-yellow-500/20 to-amber-500/10 border-yellow-500/30 text-yellow-100",
    rise: "from-emerald-500/20 to-green-500/10 border-emerald-500/30 text-emerald-100",
    new: "from-sky-500/20 to-blue-500/10 border-sky-500/30 text-sky-100",
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="premium-stat rounded-lg p-2">
          <Trophy className="h-4 w-4 text-primary" style={{ filter: 'drop-shadow(0 0 6px hsl(40 50% 60% / 0.5))' }} />
        </div>
        <div>
          <h1 className="text-xl font-extralight tracking-tight text-foreground">
            Chatter Leaderboard
          </h1>
          <p className="text-[10px] gold-text-subtle uppercase tracking-[0.2em] font-medium mt-0.5">Top Performer</p>
        </div>
      </div>

      {/* Live-Ticker */}
      {highlights.length > 0 && (
        <div className="premium-card relative h-12 overflow-hidden rounded-xl">
          <AnimatePresence mode="wait">
            {highlights[tickerIdx] && (() => {
              const h = highlights[tickerIdx];
              const Icon = h.icon;
              return (
                <motion.div
                  key={h.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className={cn(
                    "absolute inset-0 flex items-center gap-3 px-4 bg-gradient-to-r border-l-2",
                    toneClasses[h.tone],
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium truncate">{h.text}</span>
                  {highlights.length > 1 && (
                    <div className="ml-auto flex gap-1 shrink-0">
                      {highlights.map((_, i) => (
                        <span
                          key={i}
                          className={cn(
                            "h-1 w-1 rounded-full transition-all",
                            i === tickerIdx ? "bg-white/70 w-3" : "bg-white/20",
                          )}
                        />
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            })()}
          </AnimatePresence>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {filterButtons.map((fb) => (
          <button
            key={fb.mode}
            onClick={() => setFilter(fb.mode)}
            className={cn(
              "premium-chip px-3.5 py-1.5 rounded-lg text-[11px] font-light tracking-wide transition-all duration-300 border whitespace-nowrap active:scale-[0.97]",
              filter === fb.mode
                ? "bg-primary/12 border-primary/35 text-primary"
                : "bg-white/[0.03] border-white/[0.06] text-white/55 hover:text-white/85 hover:bg-white/[0.05] hover:border-white/[0.1]",
            )}
          >
            {fb.label}
          </button>
        ))}

        {filter === "custom" && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="text-xs gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5" />
                {customRange?.from
                  ? `${format(customRange.from, "dd.MM.", { locale: de })} – ${customRange?.to ? format(customRange.to, "dd.MM.", { locale: de }) : "…"}`
                  : "Zeitraum wählen"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={customRange}
                onSelect={setCustomRange}
                numberOfMonths={2}
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="premium-spinner"><span /><span /><span /></div>
        </div>
      ) : leaderboard.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-20 font-light italic">
          Keine Daten im gewählten Zeitraum.
        </p>
      ) : (
        <LayoutGroup>
          <ol className="space-y-2">
            <AnimatePresence initial={false}>
              {leaderboard.map((entry, i) => {
                const isTopThree = i < 3;
                const delta = entry.rankDelta;
                const pct = entry.pctChange;

                return (
                  <motion.li
                    key={entry.name}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{
                      layout: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
                      opacity: { duration: 0.3, delay: i * 0.02 },
                      y: { duration: 0.3, delay: i * 0.02 },
                    }}
                    onClick={() => setSelectedChatter(entry.name)}
                    className={cn(
                      "premium-card premium-card-interactive flex items-center gap-3 px-4 py-3.5 rounded-xl cursor-pointer relative",
                      i === 0 && "glow-band-gold",
                      i === 1 && "glow-band-silver",
                      i === 2 && "glow-band-bronze",
                    )}
                  >
                    {/* Rank */}
                    <div className="w-8 flex items-center justify-center shrink-0">
                      {i === 0 ? (
                        <Crown className="h-4 w-4 text-yellow-400" style={{ filter: 'drop-shadow(0 0 8px hsl(45 90% 60% / 0.6))' }} />
                      ) : (
                        <span
                          className={cn(
                            "text-base font-extralight tracking-tight tabular-nums",
                            i === 1 && "text-gray-300",
                            i === 2 && "text-amber-600",
                            i > 2 && "text-white/35",
                          )}
                        >
                          {i + 1}
                        </span>
                      )}
                    </div>

                    {/* Rank delta indicator */}
                    <div className="w-9 shrink-0 flex items-center justify-center">
                      {entry.isNew ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                          NEU
                        </span>
                      ) : delta == null ? (
                        <Minus className="h-3 w-3 text-white/20" />
                      ) : delta > 0 ? (
                        <span className="flex items-center gap-0.5 text-emerald-400 text-[11px] font-semibold tabular-nums">
                          <ArrowUp className="h-3 w-3" />
                          {delta}
                        </span>
                      ) : delta < 0 ? (
                        <span className="flex items-center gap-0.5 text-red-400 text-[11px] font-semibold tabular-nums">
                          <ArrowDown className="h-3 w-3" />
                          {Math.abs(delta)}
                        </span>
                      ) : (
                        <Minus className="h-3 w-3 text-white/30" />
                      )}
                    </div>

                    {/* Name + days */}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium text-foreground truncate cursor-copy hover:text-primary transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          const dn = displayName(entry.name);
                          navigator.clipboard.writeText(dn);
                          toast("Name kopiert", { description: dn });
                        }}
                        title="Klicken zum Kopieren"
                      >
                        {displayName(entry.name)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {entry.activeDays} {entry.activeDays === 1 ? "Tag" : "Tage"} aktiv
                      </p>
                    </div>

                    {/* Revenue + % change */}
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <span className={cn(
                        "text-sm tabular-nums tracking-tight",
                        isTopThree ? "font-extralight gold-text text-base" : "font-light text-foreground"
                      )}>
                        {entry.total.toLocaleString("de-DE", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        €
                      </span>
                      {pct != null && pct !== 0 && (
                        <span
                          className={cn(
                            "text-[10px] font-semibold tabular-nums",
                            pct > 0 ? "text-emerald-400" : "text-red-400",
                          )}
                        >
                          {pct > 0 ? "+" : ""}
                          {pct}%
                        </span>
                      )}
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        </LayoutGroup>
      )}

      {/* SlideOver */}
      <ChatterSlideOver
        open={!!selectedChatter}
        onClose={() => setSelectedChatter(null)}
        chatterName={selectedChatter ?? ""}
        platform={platform}
      />
    </div>
  );
}
