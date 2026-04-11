import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import { useAuth } from "@/contexts/AuthContext";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Trophy, CalendarIcon } from "lucide-react";
import { format, startOfDay, startOfWeek, startOfMonth, subDays } from "date-fns";
import { de } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

type FilterMode = "today" | "week" | "month" | "custom";

export default function Leaderboard() {
  const { platform } = usePlatform();
  const { session } = useAuth();
  const [filter, setFilter] = useState<FilterMode>("month");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [selectedChatter, setSelectedChatter] = useState<string | null>(null);

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (filter) {
      case "today":
        return { from: startOfDay(now), to: now };
      case "week":
        return { from: startOfWeek(now, { weekStartsOn: 1 }), to: now };
      case "month":
        return { from: startOfMonth(now), to: now };
      case "custom":
        return {
          from: customRange?.from ?? subDays(now, 30),
          to: customRange?.to ?? now,
        };
    }
  }, [filter, customRange]);

  const { data: leaderboard = [], isLoading } = useQuery({
    queryKey: ["leaderboard", platform, filter, dateRange.from, dateRange.to],
    queryFn: async () => {
      const fromStr = format(dateRange.from, "yyyy-MM-dd");
      const toStr = format(dateRange.to, "yyyy-MM-dd");

      const { data, error } = await supabase
        .from("chatter_history")
        .select("chatter_name, revenue_today, analysis_date")
        .eq("platform", platform)
        .eq("user_id", session?.user?.id ?? "")
        .gte("analysis_date", fromStr)
        .lte("analysis_date", toStr);

      if (error) throw error;

      const grouped = (data ?? []).reduce<
        Record<string, { total: number; days: Set<string> }>
      >((acc, row) => {
        const name = row.chatter_name;
        if (!acc[name]) acc[name] = { total: 0, days: new Set() };
        acc[name].total += Number(row.revenue_today ?? 0);
        acc[name].days.add(row.analysis_date);
        return acc;
      }, {});

      return Object.entries(grouped)
        .map(([name, { total, days }]) => ({
          name,
          total: Math.round(total * 100) / 100,
          activeDays: days.size,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 20);
    },
    enabled: !!session?.user?.id,
  });

  const medalColors = [
    "from-yellow-500/20 to-yellow-600/5 border-yellow-500/30",
    "from-gray-300/20 to-gray-400/5 border-gray-400/30",
    "from-amber-700/20 to-amber-800/5 border-amber-700/30",
  ];

  const filterButtons: { label: string; mode: FilterMode }[] = [
    { label: "Heute", mode: "today" },
    { label: "Woche", mode: "week" },
    { label: "Monat", mode: "month" },
    { label: "Custom", mode: "custom" },
  ];

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Trophy className="h-5 w-5 text-yellow-500" />
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Chatter Leaderboard
        </h1>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {filterButtons.map((fb) => (
          <Button
            key={fb.mode}
            size="sm"
            variant={filter === fb.mode ? "default" : "outline"}
            onClick={() => setFilter(fb.mode)}
            className="text-xs"
          >
            {fb.label}
          </Button>
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
          <div className="h-5 w-5 border border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      ) : leaderboard.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-20">
          Keine Daten im gewählten Zeitraum.
        </p>
      ) : (
        <ol className="space-y-2">
          {leaderboard.map((entry, i) => {
            const isTopThree = i < 3;
            return (
              <li
                key={entry.name}
                onClick={() => setSelectedChatter(entry.name)}
                className={cn(
                  "flex items-center gap-4 px-4 py-3 rounded-xl border cursor-pointer transition-all duration-200 hover:bg-white/[0.03]",
                  isTopThree
                    ? `bg-gradient-to-r ${medalColors[i]} border`
                    : "border-white/[0.06] bg-white/[0.02]"
                )}
              >
                {/* Rank */}
                <span
                  className={cn(
                    "w-7 text-center text-sm font-semibold shrink-0",
                    i === 0 && "text-yellow-500",
                    i === 1 && "text-gray-400",
                    i === 2 && "text-amber-700",
                    i > 2 && "text-white/30"
                  )}
                >
                  {i + 1}
                </span>

                {/* Name + days */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {entry.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {entry.activeDays} {entry.activeDays === 1 ? "Tag" : "Tage"} aktiv
                  </p>
                </div>

                {/* Revenue */}
                <span className="text-sm font-semibold text-foreground tabular-nums">
                  {entry.total.toLocaleString("de-DE", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  €
                </span>
              </li>
            );
          })}
        </ol>
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
