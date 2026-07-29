import { useEffect, useMemo, useState } from "react";
import { Loader2, Check, X, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatEUR } from "@/lib/monthly-goals";
import { classifyChannel, type ChatterChannel } from "@/lib/chatter-channel";
import { loadActiveChatterNames, normalizeChatterName } from "@/lib/active-chatters";

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
  last: MergedResult | null;
}

const CHANNEL_KEY = "pastWeeklyGoals.channelFilter";
const STATUS_KEY = "pastWeeklyGoals.statusFilter";
type ChannelFilter = "all" | "whatsapp" | "platform";
type StatusFilter = "all" | "achieved" | "missed";

function weekRangeLabel(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sStr = s.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  const eStr = e.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  return `${sStr}–${eStr}`;
}

export default function PastWeeklyGoalsTab({ platform, onOpenChatter }: Props) {
  const [rows, setRows] = useState<RawResultRow[]>([]);
  const [roster, setRoster] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>(() => {
    try {
      const v = localStorage.getItem(CHANNEL_KEY);
      return v === "whatsapp" || v === "platform" ? v : "all";
    } catch { return "all"; }
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    try {
      const v = localStorage.getItem(STATUS_KEY);
      return v === "achieved" || v === "missed" ? v : "all";
    } catch { return "all"; }
  });

  useEffect(() => {
    try { localStorage.setItem(CHANNEL_KEY, channelFilter); } catch {}
  }, [channelFilter]);
  useEffect(() => {
    try { localStorage.setItem(STATUS_KEY, statusFilter); } catch {}
  }, [statusFilter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Nur Ergebnisse der aktuellen Plattform – Workspaces werden strikt getrennt.
        const [{ data, error }, activeNames] = await Promise.all([
          supabase
            .from("weekly_goal_results")
            .select("chatter_name, platform, week_key, week_start, week_end, goal_eur, actual_eur, achieved")
            .eq("platform", platform)
            .order("week_start", { ascending: false }),
          loadActiveChatterNames(platform).catch(() => null),
        ]);
        if (error) throw error;
        if (!cancelled) {
          setRows((data ?? []) as RawResultRow[]);
          setRoster(activeNames && activeNames.size > 0 ? activeNames : null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Fehler beim Laden");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [platform]);

  const groups: ChatterGroup[] = useMemo(() => {
    // 1) pro (chatter, week_key) zusammenführen.
    //    Jede Zeile aggregiert bereits ALLE Accounts eines Chatters (Snapshot),
    //    Duplikate entstehen nur durch mehrere User im selben Workspace.
    //    Deshalb MAX statt Summe — sonst zählen Multi-Account-Chatter doppelt.
    const merged = new Map<string, MergedResult>();
    for (const r of rows) {
      const key = `${normalizeChatterName(r.chatter_name)}|${r.week_key}`;
      const goal = Number(r.goal_eur ?? 0);
      const actual = Number(r.actual_eur ?? 0);
      const prev = merged.get(key);
      if (prev) {
        prev.goal_eur = Math.max(prev.goal_eur, goal);
        prev.actual_eur = Math.max(prev.actual_eur, actual);
        if (!prev.platforms.includes(r.platform)) prev.platforms.push(r.platform);
        prev.achieved = prev.actual_eur >= prev.goal_eur;
      } else {
        merged.set(key, {
          chatter_name: r.chatter_name,
          week_key: r.week_key,
          week_start: r.week_start,
          week_end: r.week_end,
          goal_eur: goal,
          actual_eur: actual,
          achieved: actual >= goal,
          platforms: [r.platform],
        });
      }
    }
    // 2) nach Chatter gruppieren (normalisiert – Emoji-/Case-Varianten zusammen)
    const map = new Map<string, MergedResult[]>();
    for (const m of merged.values()) {
      const k = normalizeChatterName(m.chatter_name);
      const arr = map.get(k) ?? [];
      arr.push(m);
      map.set(k, arr);
    }
    const out: ChatterGroup[] = [];
    for (const [, results] of map) {
      results.sort((a, b) => b.week_start.localeCompare(a.week_start));
      const chatter = results[0]?.chatter_name ?? "";
      // Gekündigte / nicht mehr im aktuellen Report vorkommende Chatter raus
      if (roster && !roster.has(normalizeChatterName(chatter))) continue;
      const achievedCount = results.filter((r) => r.achieved).length;
      out.push({
        chatter,
        channel: classifyChannel(chatter),
        results,
        achievedCount,
        totalCount: results.length,
        lastWeekStart: results[0]?.week_start ?? "",
        last: results[0] ?? null,
      });
    }
    out.sort((a, b) => b.lastWeekStart.localeCompare(a.lastWeekStart) || a.chatter.localeCompare(b.chatter, "de"));
    return out;
  }, [rows, roster]);

  const channelGroups = useMemo(
    () => (channelFilter === "all" ? groups : groups.filter((g) => g.channel === channelFilter)),
    [groups, channelFilter],
  );

  const filteredGroups = useMemo(() => {
    if (statusFilter === "all") return channelGroups;
    return channelGroups.filter((g) =>
      statusFilter === "achieved" ? g.last?.achieved === true : g.last?.achieved === false,
    );
  }, [channelGroups, statusFilter]);

  const waCount = useMemo(() => groups.filter((g) => g.channel === "whatsapp").length, [groups]);
  const platformCount = groups.length - waCount;
  // Status-Zähler hängen am Kanal-Filter (hierarchisch: Plattform → Status)
  const achievedCount = useMemo(() => channelGroups.filter((g) => g.last?.achieved).length, [channelGroups]);
  const missedCount = channelGroups.length - achievedCount;

  const chip = (active: boolean, label: string, count: number, onClick: () => void, tone?: "ok" | "bad") => (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors font-light ${
        active
          ? tone === "ok"
            ? "bg-emerald-400/15 border-emerald-300/30 text-emerald-100"
            : tone === "bad"
              ? "bg-red-400/12 border-red-300/30 text-red-100"
              : "bg-white/10 border-white/20 text-white"
          : "bg-white/[0.02] border-white/[0.06] text-white/55 hover:text-white/85 hover:bg-white/[0.05]"
      }`}
    >
      {label} <span className="text-white/40">· {count}</span>
    </button>
  );

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
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        {chip(channelFilter === "all", "Alle", groups.length, () => setChannelFilter("all"))}
        {chip(channelFilter === "whatsapp", "WhatsApp", waCount, () => setChannelFilter("whatsapp"))}
        {chip(channelFilter === "platform", "Plattform", platformCount, () => setChannelFilter("platform"))}
        <span className="w-px h-4 bg-white/10 mx-1" />
        {chip(statusFilter === "all", "Status: alle", channelGroups.length, () => setStatusFilter("all"))}
        {chip(statusFilter === "achieved", "Ziel erreicht", achievedCount, () => setStatusFilter("achieved"), "ok")}
        {chip(statusFilter === "missed", "Nicht erreicht", missedCount, () => setStatusFilter("missed"), "bad")}
        <span className="text-[10px] text-white/30 font-light ml-1">nur {platform}</span>
      </div>

      {filteredGroups.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-6 text-center text-[12px] text-white/45 font-light">
          Keine Chatter im aktuellen Filter.
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05] overflow-hidden">
          {filteredGroups.map((g) => {
            const rate = g.totalCount > 0 ? Math.round((g.achievedCount / g.totalCount) * 100) : 0;
            const rateCls =
              rate >= 75 ? "text-emerald-200 border-emerald-300/30 bg-emerald-400/10"
              : rate >= 40 ? "text-amber-200 border-amber-300/30 bg-amber-400/10"
              : "text-red-200 border-red-300/30 bg-red-400/10";
            const channelBadge = g.channel === "whatsapp"
              ? "text-emerald-200/85 border-emerald-500/20 bg-emerald-500/[0.08]"
              : "text-sky-200/85 border-sky-500/20 bg-sky-500/[0.08]";
            const last = g.last;
            const lastPct = last && last.goal_eur > 0
              ? Math.round((last.actual_eur / last.goal_eur) * 100)
              : 0;
            const diff = last ? last.actual_eur - last.goal_eur : 0;
            return (
              <div
                key={g.chatter}
                className="px-3 sm:px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.03] transition-colors"
              >
                <div className="shrink-0">
                  {last?.achieved ? (
                    <div className="h-6 w-6 rounded-full bg-emerald-400/15 border border-emerald-300/30 flex items-center justify-center">
                      <Check className="h-3 w-3 text-emerald-200" />
                    </div>
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-red-400/10 border border-red-300/20 flex items-center justify-center">
                      <X className="h-3 w-3 text-red-200" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => onOpenChatter?.(g.chatter)}
                      className="text-[13px] sm:text-sm font-medium text-white/90 truncate hover:underline decoration-white/30 underline-offset-4"
                      title="Profil öffnen"
                    >
                      {g.chatter}
                    </button>
                    <span className={`text-[9px] uppercase tracking-[0.16em] font-light px-1.5 py-0.5 rounded border ${channelBadge}`}>
                      {g.channel === "whatsapp" ? "WhatsApp" : "Plattform"}
                    </span>
                  </div>
                  {last && (
                    <div className="text-[11px] text-white/45 font-light tabular-nums truncate">
                      {weekRangeLabel(last.week_start, last.week_end)}
                      {" · Ziel "}
                      <span className="text-white/70">{formatEUR(last.goal_eur)}</span>
                      {" · Ist "}
                      <span className="text-white/70">{formatEUR(last.actual_eur)}</span>
                      {" · "}
                      <span className={last.achieved ? "text-emerald-200" : "text-red-200"}>{lastPct}%</span>
                    </div>
                  )}
                </div>

                {/* Kompakter Verlauf: letzte 8 Wochen als Punkte (neu → alt) */}
                <div className="hidden sm:flex items-center gap-1 shrink-0">
                  {g.results.slice(0, 8).map((r) => (
                    <span
                      key={r.week_key}
                      title={`${weekRangeLabel(r.week_start, r.week_end)} · ${formatEUR(r.actual_eur)} / ${formatEUR(r.goal_eur)}`}
                      className={`h-2 w-2 rounded-full ${r.achieved ? "bg-emerald-300/70" : "bg-red-300/50"}`}
                    />
                  ))}
                </div>

                <div className={`shrink-0 w-20 text-right text-[12px] tabular-nums font-medium ${
                  diff >= 0 ? "text-emerald-200" : "text-red-200"
                }`}>
                  {diff >= 0 ? "+" : "−"}{formatEUR(Math.abs(diff))}
                </div>

                <span className={`shrink-0 text-[11px] tabular-nums px-2 py-0.5 rounded-full border font-light ${rateCls}`}>
                  {g.achievedCount}/{g.totalCount} · {rate}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
