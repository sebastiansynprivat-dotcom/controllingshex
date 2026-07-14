import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Check, X, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatEUR } from "@/lib/monthly-goals";
import { classifyChannel, type ChatterChannel } from "@/lib/chatter-channel";

interface Props {
  /** Aktiver Workspace – Ergebnisse werden strikt nach Plattform gefiltert. */
  platform: string;
  onOpenChatter?: (chatter: string) => void;
}

interface RawResultRow {
  chatter_name: string;
  platform: string;
  week_key: string;
  week_start: string;
  week_end: string;
  goal_eur: number;
  actual_eur: number;
  achieved: boolean;
}

interface MergedResult {
  chatter_name: string;
  week_key: string;
  week_start: string;
  week_end: string;
  goal_eur: number;
  actual_eur: number;
  achieved: boolean;
  platforms: string[];
}

interface ChatterGroup {
  chatter: string;
  channel: ChatterChannel;
  results: MergedResult[];
  achievedCount: number;
  totalCount: number;
  lastWeekStart: string;
}

const CHANNEL_KEY = "pastWeeklyGoals.channelFilter";
type ChannelFilter = "all" | "whatsapp" | "platform";

function weekRangeLabel(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sStr = s.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  const eStr = e.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${sStr} – ${eStr}`;
}

export default function PastWeeklyGoalsTab({ platform, onOpenChatter }: Props) {
  const [rows, setRows] = useState<RawResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>(() => {
    try {
      const v = localStorage.getItem(CHANNEL_KEY);
      return v === "whatsapp" || v === "platform" ? v : "all";
    } catch { return "all"; }
  });

  useEffect(() => {
    try { localStorage.setItem(CHANNEL_KEY, channelFilter); } catch {}
  }, [channelFilter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Nur Ergebnisse der aktuellen Plattform – Workspaces (Maloum / 4Based /
        // Brezzels) werden strikt getrennt, damit kein fremder Chatter erscheint.
        const { data, error } = await supabase
          .from("weekly_goal_results")
          .select("chatter_name, platform, week_key, week_start, week_end, goal_eur, actual_eur, achieved")
          .eq("platform", platform)
          .order("week_start", { ascending: false });
        if (error) throw error;
        if (!cancelled) setRows((data ?? []) as RawResultRow[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Fehler beim Laden");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [platform]);

  const groups: ChatterGroup[] = useMemo(() => {
    // 1) pro (chatter, week_key) Summen bilden
    const merged = new Map<string, MergedResult>();
    for (const r of rows) {
      const key = `${r.chatter_name}|${r.week_key}`;
      const prev = merged.get(key);
      if (prev) {
        prev.goal_eur += Number(r.goal_eur ?? 0);
        prev.actual_eur += Number(r.actual_eur ?? 0);
        if (!prev.platforms.includes(r.platform)) prev.platforms.push(r.platform);
        prev.achieved = prev.actual_eur >= prev.goal_eur;
      } else {
        merged.set(key, {
          chatter_name: r.chatter_name,
          week_key: r.week_key,
          week_start: r.week_start,
          week_end: r.week_end,
          goal_eur: Number(r.goal_eur ?? 0),
          actual_eur: Number(r.actual_eur ?? 0),
          achieved: Number(r.actual_eur ?? 0) >= Number(r.goal_eur ?? 0),
          platforms: [r.platform],
        });
      }
    }
    // 2) nach Chatter gruppieren
    const map = new Map<string, MergedResult[]>();
    for (const m of merged.values()) {
      const arr = map.get(m.chatter_name) ?? [];
      arr.push(m);
      map.set(m.chatter_name, arr);
    }
    const out: ChatterGroup[] = [];
    for (const [chatter, results] of map) {
      results.sort((a, b) => b.week_start.localeCompare(a.week_start));
      const achievedCount = results.filter((r) => r.achieved).length;
      out.push({
        chatter,
        channel: classifyChannel(chatter),
        results,
        achievedCount,
        totalCount: results.length,
        lastWeekStart: results[0]?.week_start ?? "",
      });
    }
    out.sort((a, b) => b.lastWeekStart.localeCompare(a.lastWeekStart) || a.chatter.localeCompare(b.chatter, "de"));
    return out;
  }, [rows]);

  const filteredGroups = useMemo(() => {
    if (channelFilter === "all") return groups;
    return groups.filter((g) => g.channel === channelFilter);
  }, [groups, channelFilter]);

  const waCount = useMemo(() => groups.filter((g) => g.channel === "whatsapp").length, [groups]);
  const platformCount = groups.length - waCount;

  function toggle(chatter: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(chatter)) next.delete(chatter);
      else next.add(chatter);
      return next;
    });
  }

  const filterBtn = (val: ChannelFilter, label: string, count: number) => {
    const active = channelFilter === val;
    return (
      <button
        type="button"
        onClick={() => setChannelFilter(val)}
        className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors font-light ${
          active
            ? "bg-white/10 border-white/20 text-white"
            : "bg-white/[0.02] border-white/[0.06] text-white/55 hover:text-white/85 hover:bg-white/[0.05]"
        }`}
      >
        {label} <span className="text-white/40">· {count}</span>
      </button>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-white/40">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm font-light">Lade vergangene Wochenziele…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-red-400/20 bg-red-500/5 p-6 text-sm text-red-200">
        {error}
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-8 text-center">
        <Trophy className="h-8 w-8 mx-auto text-white/20 mb-3" />
        <p className="text-sm text-white/55 font-light">
          Noch keine vergangenen Wochenziele gespeichert. Die Snapshots werden jeden Montag automatisch angelegt.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        {filterBtn("all", "Alle", groups.length)}
        {filterBtn("whatsapp", "WhatsApp", waCount)}
        {filterBtn("platform", "Plattform", platformCount)}
        <span className="text-[10px] text-white/30 font-light ml-1">
          plattformübergreifend zusammengeführt
        </span>
      </div>

      {filteredGroups.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-6 text-center text-[12px] text-white/45 font-light">
          Keine Chatter im aktuellen Filter.
        </div>
      ) : filteredGroups.map((g) => {
        const isOpen = expanded.has(g.chatter);
        const rate = g.totalCount > 0 ? Math.round((g.achievedCount / g.totalCount) * 100) : 0;
        const rateCls =
          rate >= 75 ? "text-emerald-200 border-emerald-300/30 bg-emerald-400/10"
          : rate >= 40 ? "text-amber-200 border-amber-300/30 bg-amber-400/10"
          : "text-red-200 border-red-300/30 bg-red-400/10";
        const channelBadge = g.channel === "whatsapp"
          ? "text-emerald-200/85 border-emerald-500/20 bg-emerald-500/[0.08]"
          : "text-sky-200/85 border-sky-500/20 bg-sky-500/[0.08]";
        return (
          <div
            key={g.chatter}
            className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden"
          >
            <button
              onClick={() => toggle(g.chatter)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
            >
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-white/45 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-white/45 shrink-0" />
              )}
              <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                <span
                  className="text-sm sm:text-base font-medium text-white/90 truncate cursor-pointer hover:underline decoration-white/30 underline-offset-4"
                  onClick={(e) => { e.stopPropagation(); onOpenChatter?.(g.chatter); }}
                  title="Profil öffnen"
                >
                  {g.chatter}
                </span>
                <span className={`text-[9px] uppercase tracking-[0.16em] font-light px-1.5 py-0.5 rounded border ${channelBadge}`}>
                  {g.channel === "whatsapp" ? "WhatsApp" : "Plattform"}
                </span>
                <span className="text-[11px] text-white/40 font-light tabular-nums">
                  {g.totalCount} {g.totalCount === 1 ? "Woche" : "Wochen"}
                </span>
              </div>
              <span className={`text-[11px] tabular-nums px-2 py-0.5 rounded-full border font-light ${rateCls}`}>
                {g.achievedCount}/{g.totalCount} · {rate}%
              </span>
            </button>

            {isOpen && (
              <div className="px-3 sm:px-4 pb-3 pt-1 space-y-2 border-t border-white/[0.05]">
                {g.results.map((r) => {
                  const diff = Number(r.actual_eur) - Number(r.goal_eur);
                  const pct = Number(r.goal_eur) > 0
                    ? Math.round((Number(r.actual_eur) / Number(r.goal_eur)) * 100)
                    : 0;
                  return (
                    <div
                      key={r.week_key}
                      className={`rounded-xl border px-3 sm:px-4 py-2.5 flex items-center gap-3 ${
                        r.achieved
                          ? "border-emerald-300/20 bg-emerald-400/[0.04]"
                          : "border-white/[0.05] bg-white/[0.01]"
                      }`}
                    >
                      <div className="shrink-0">
                        {r.achieved ? (
                          <div className="h-7 w-7 rounded-full bg-emerald-400/15 border border-emerald-300/30 flex items-center justify-center">
                            <Check className="h-3.5 w-3.5 text-emerald-200" />
                          </div>
                        ) : (
                          <div className="h-7 w-7 rounded-full bg-red-400/10 border border-red-300/20 flex items-center justify-center">
                            <X className="h-3.5 w-3.5 text-red-200" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] sm:text-[13px] text-white/85 font-medium">
                          {weekRangeLabel(r.week_start, r.week_end)}
                          {r.platforms.length > 1 && (
                            <span className="ml-2 text-[10px] text-white/45 font-light">
                              · {r.platforms.join(" + ")}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-white/45 font-light tabular-nums">
                          Ziel <span className="text-white/70">{formatEUR(Number(r.goal_eur))}</span>
                          {" · "}
                          erreicht <span className="text-white/70">{formatEUR(Number(r.actual_eur))}</span>
                          {" · "}
                          <span className={r.achieved ? "text-emerald-200" : "text-white/55"}>{pct}%</span>
                        </div>
                      </div>
                      <div className={`shrink-0 text-[12px] tabular-nums font-medium ${
                        diff >= 0 ? "text-emerald-200" : "text-red-200"
                      }`}>
                        {diff >= 0 ? "+" : "−"}{formatEUR(Math.abs(diff))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
