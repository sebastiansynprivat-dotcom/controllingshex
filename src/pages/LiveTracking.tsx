import { useEffect, useMemo, useRef, useState } from "react";
import { Search, AlertTriangle, ChevronDown, ChevronRight, TrendingDown, TrendingUp, Clock, Moon, Sparkles, MessageCircle, Send, Inbox, Megaphone, Hourglass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { Input } from "@/components/ui/input";
import { buildProfile, computeStatus, shiftDate, type ChatterProfile, type ChatterStatus, type LiveRow as LiveRowLite, type HistoryDay } from "@/lib/live-activity";

interface LiveRow extends LiveRowLite {
  id: string;
  platform: string;
  date: string;
}

type FilterKey = "all" | "active" | "weak" | "inactive";
type SortKey = "smart" | "priority" | "revenue" | "pacing" | "activity";

function secondsSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

function relTime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h`;
  return `${Math.floor(sec / 86400)} d`;
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(n) + " €";
}

function normName(s: string): string {
  return s.trim().toLowerCase();
}

const LIVE_NOW_WINDOW_MS = 15 * 60 * 1000;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function LiveTracking() {
  const { platform } = usePlatform();
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ChatterProfile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortKey, setSortKey] = useState<SortKey>("smart");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [strongOpen, setStrongOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<{ name: string; platform: string } | null>(null);
  const [hourlyByHour, setHourlyByHour] = useState<Map<number, number>>(new Map());
  const [liveActivityAt, setLiveActivityAt] = useState<Map<string, number>>(new Map());
  const [serverLiveNow, setServerLiveNow] = useState<{ count: number; names: string[]; computedAt: string } | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  type LiveEvent = { id: string; ts: number; name: string; type: "sale" | "dm" | "unread" | "expire" | "seed"; detail: string; expiresAt?: number };
  const [liveLog, setLiveLog] = useState<LiveEvent[]>([]);
  const pushEvent = (ev: Omit<LiveEvent, "id" | "ts"> & { ts?: number }) => {
    setLiveLog((prev) => [{ id: Math.random().toString(36).slice(2), ts: ev.ts ?? Date.now(), ...ev }, ...prev].slice(0, 80));
  };

  useEffect(() => {
    const today = shiftDate();
    supabase
      .from("chatter_hourly_stats")
      .select("hour, updates_seen, chatter_name, revenue, mass_dms, unread_delta, updated_at")
      .eq("date", today)
      .ilike("platform", platform)
      .then(({ data }) => {
        const map = new Map<number, Set<string>>();
        (data ?? []).forEach((r: any) => {
          const h = Number(r.hour);
          if (!map.has(h)) map.set(h, new Set());
          map.get(h)!.add(String(r.chatter_name).toLowerCase());
        });
        const out = new Map<number, number>();
        map.forEach((set, h) => out.set(h, set.size));
        setHourlyByHour(out);

        // Jetzt online: rollierende echte Aktivität aus den letzten ~70 Minuten.
        // Wichtig: hourly_stats wird in UTC geschrieben – deshalb nicht nach Berlin-Stunde filtern.
        const liveCutoff = Date.now() - LIVE_NOW_WINDOW_MS;
        const live = new Map<string, number>();
        (data ?? []).forEach((r: any) => {
          const updatedAt = new Date(r.updated_at ?? 0).getTime();
          if (!Number.isFinite(updatedAt) || updatedAt < liveCutoff) return;
          const rev = Number(r.revenue) || 0;
          const dms = Number(r.mass_dms) || 0;
          const unreadDelta = Number(r.unread_delta) || 0;
          if (rev > 0 || dms > 0 || unreadDelta < 0) {
            const key = normName(String(r.chatter_name ?? ""));
            if (key) live.set(key, updatedAt);
          }
        });
        setLiveActivityAt((prev) => {
          const merged = new Map<string, number>();
          prev.forEach((ts, key) => {
            if (ts >= liveCutoff) merged.set(key, ts);
          });
          live.forEach((ts, key) => merged.set(key, Math.max(merged.get(key) ?? 0, ts)));
          return merged;
        });
      });
  }, [platform, tick]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const today = shiftDate();
    setLoading(true);
    supabase
      .from("chatter_history_live")
      .select("*")
      .eq("date", today)
      .ilike("platform", platform)
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        setRows((data as LiveRow[]) ?? []);
        setLoading(false);
      });
  }, [platform]);

  useEffect(() => {
    const since = new Date();
    since.setDate(since.getDate() - 14);
    const sinceIso = since.toISOString().slice(0, 10);
    supabase
      .from("chatter_history")
      .select("chatter_name, revenue_today, mass_dms, open_chats, analysis_date")
      .ilike("platform", platform)
      .gte("analysis_date", sinceIso)
      .then(({ data }) => {
        const byName = new Map<string, HistoryDay[]>();
        (data ?? []).forEach((r: any) => {
          const name = normName(r.chatter_name ?? "");
          if (!name) return;
          if (!byName.has(name)) byName.set(name, []);
          byName.get(name)!.push({
            revenue_today: Number(r.revenue_today) || 0,
            mass_dms: Number(r.mass_dms) || 0,
            open_chats: Number(r.open_chats) || 0,
            analysis_date: r.analysis_date,
          });
        });
        const map = new Map<string, ChatterProfile>();
        byName.forEach((days, key) => map.set(key, buildProfile(key, days)));
        setProfiles(map);
      });
  }, [platform]);

  useEffect(() => {
    const channel = supabase
      .channel(`live-${platform}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chatter_history_live" },
        (payload) => {
          const today = shiftDate();
          const next = payload.new as LiveRow | undefined;
          const old = payload.old as LiveRow | undefined;

          // Echtzeit-Detektion: hat sich etwas getan, das auf einen aktiven Chatter hinweist?
          if (next && old && payload.eventType === "UPDATE") {
            const revDelta = (Number(next.revenue) || 0) - (Number(old.revenue) || 0);
            const dmsDelta = (Number(next.mass_dms) || 0) - (Number(old.mass_dms) || 0);
            const unreadDelta = (next.unread_chats ?? 0) - (old.unread_chats ?? 0);
            const revUp = revDelta > 0;
            const dmsUp = dmsDelta > 0;
            const unreadDown = unreadDelta < 0;
            if (revUp || dmsUp || unreadDown) {
              const key = normName(next.chatter_name ?? "");
              const displayName = next.chatter_name ?? key;
              if (key) {
                const now = Date.now();
                setLiveActivityAt((prev) => {
                  const copy = new Map(prev);
                  copy.set(key, now);
                  return copy;
                });
                if (revUp) pushEvent({ name: displayName, type: "sale", detail: `+${fmtEur(revDelta)}`, expiresAt: now + LIVE_NOW_WINDOW_MS });
                if (dmsUp) pushEvent({ name: displayName, type: "dm", detail: `+${dmsDelta} Mass-DM`, expiresAt: now + LIVE_NOW_WINDOW_MS });
                if (unreadDown) pushEvent({ name: displayName, type: "unread", detail: `${unreadDelta} ungelesen`, expiresAt: now + LIVE_NOW_WINDOW_MS });
              }
            }
          }

          setRows((prev) => {
            if (payload.eventType === "DELETE" && old) {
              return prev.filter((r) => r.id !== old.id);
            }
            if (!next) return prev;
            if (next.date !== today) return prev;
            if ((next.platform ?? "").toLowerCase() !== platform.toLowerCase()) return prev;
            const idx = prev.findIndex((r) => r.id === next.id);
            if (idx === -1) return [next, ...prev];
            const copy = [...prev];
            copy[idx] = next;
            return copy;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [platform]);

  // Ablauf-Erkennung: prune & log Einträge, die das 15-Min-Fenster verlassen
  const prevLiveRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const cutoff = Date.now() - LIVE_NOW_WINDOW_MS;
    const prev = prevLiveRef.current;
    prev.forEach((ts, key) => {
      const cur = liveActivityAt.get(key);
      if ((!cur || cur < cutoff) && ts >= cutoff - 60_000) {
        // war noch aktiv, jetzt nicht mehr
        const display = displayNameFor(key);
        pushEvent({ name: display, type: "expire", detail: "15 min Fenster abgelaufen" });
      }
    });
    prevLiveRef.current = new Map(liveActivityAt);
  }, [liveActivityAt, tick]);

  const displayNameFor = (key: string): string => {
    const live = rows.find((r) => normName(r.chatter_name) === key);
    if (live) return live.chatter_name;
    return key.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  };

  const allStatuses: ChatterStatus[] = useMemo(() => {
    const now = new Date();
    const keys = new Set<string>();
    rows.forEach((r) => keys.add(normName(r.chatter_name)));
    profiles.forEach((p) => {
      if (p.daysObserved >= 1 && p.avgRevenue >= 5) keys.add(p.name);
    });
    const out: ChatterStatus[] = [];
    keys.forEach((key) => {
      const live = rows.find((r) => normName(r.chatter_name) === key) ?? null;
      const profile = profiles.get(key) ?? null;
      out.push(computeStatus(displayNameFor(key), live, profile, now));
    });
    out.sort((a, b) => {
      const order: Record<ChatterStatus["status"], number> = {
        active_weak: 0,
        active_idle: 1,
        inactive: 2,
        active_strong: 3,
      };
      const oa = order[a.status];
      const ob = order[b.status];
      if (oa !== ob) return oa - ob;
      return b.priorityScore - a.priorityScore;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, profiles, tick]);

  const visible = useMemo(() => {
    const filtered = allStatuses.filter((s) => {
      if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === "active" && !s.isActiveToday) return false;
      if (filter === "weak" && s.status !== "active_weak") return false;
      if (filter === "inactive" && s.status !== "inactive") return false;
      return true;
    });
    if (sortKey === "smart") {
      return [...filtered].sort((a, b) => b.priorityScore - a.priorityScore);
    }
    const sorted = [...filtered];
    if (sortKey === "priority") {
      // Top earners first (avg/day = wirtschaftlicher Impact)
      sorted.sort((a, b) => (b.profile?.avgRevenue ?? 0) - (a.profile?.avgRevenue ?? 0));
    } else if (sortKey === "revenue") {
      sorted.sort((a, b) => (Number(b.live?.revenue ?? 0)) - (Number(a.live?.revenue ?? 0)));
    } else if (sortKey === "pacing") {
      const delta = (s: ChatterStatus) => {
        const today = Number(s.live?.revenue ?? 0);
        const exp = s.expectedRevenueByNow;
        if (exp <= 0) return Number.POSITIVE_INFINITY;
        return today - exp;
      };
      sorted.sort((a, b) => delta(a) - delta(b));
    } else if (sortKey === "activity") {
      sorted.sort((a, b) => {
        const sa = a.lastSeenSec ?? Number.POSITIVE_INFINITY;
        const sb = b.lastSeenSec ?? Number.POSITIVE_INFINITY;
        return sa - sb;
      });
    }
    return sorted;
  }, [allStatuses, search, filter, sortKey]);

  const buckets = useMemo(
    () => ({
      weak: visible.filter((s) => s.status === "active_weak"),
      idle: visible.filter((s) => s.status === "active_idle"),
      inactive: visible.filter((s) => s.status === "inactive"),
      strong: visible.filter((s) => s.status === "active_strong"),
    }),
    [visible],
  );

  const activeTodayCount = allStatuses.filter((s) => s.isActiveToday).length;
  const inactiveCount = allStatuses.filter((s) => s.status === "inactive").length;
  // Jetzt online = echte Aktivität in der aktuellen Stunde (Revenue, DMs oder Chats abgearbeitet)
  const liveNowCutoff = Date.now() - LIVE_NOW_WINDOW_MS;
  const liveNowCount = allStatuses.filter((s) => (liveActivityAt.get(normName(s.name)) ?? 0) >= liveNowCutoff).length;
  const lastSync = rows.length ? Math.min(...rows.map((r) => secondsSince(r.updated_at))) : null;
  const totalCount = allStatuses.length;
  const activePct = totalCount > 0 ? Math.round((activeTodayCount / totalCount) * 100) : 0;
  const sumUnread = rows.reduce((s, r) => s + (r.unread_chats ?? 0), 0);
  const sumDms = rows.reduce((s, r) => s + (r.mass_dms ?? 0), 0);
  const totalLost = Math.round(allStatuses.reduce((s, x) => s + x.lostRevenue, 0));
  const criticalCount = allStatuses.filter((s) => s.lostRevenue >= 100).length;
  const topToday = useMemo(() => {
    let best: ChatterStatus | null = null;
    allStatuses.forEach((s) => {
      if (s.surplusRevenue > 0 && (!best || s.surplusRevenue > best.surplusRevenue)) {
        best = s;
      }
    });
    return best;
  }, [allStatuses]);

  const counts: Record<FilterKey, number> = {
    all: allStatuses.length,
    active: activeTodayCount,
    weak: allStatuses.filter((s) => s.status === "active_weak").length,
    inactive: inactiveCount,
  };

  return (
    <div className="mx-auto w-full max-w-[860px] space-y-8 pb-24">
      {/* ─── HERO ─────────────────────────────────────── */}
      <header className="space-y-6 pt-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/70 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[10px] tracking-[0.32em] uppercase text-white/35 font-light">
              Live · {platform}
            </span>
            <span className="text-[10px] text-white/20">
              {lastSync !== null ? `· ${relTime(lastSync)} ago` : ""}
            </span>
          </div>
          {searchOpen ? (
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => !search && setSearchOpen(false)}
              placeholder="Suchen…"
              className="h-8 w-44 text-xs bg-white/[0.03] border-white/[0.08]"
            />
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="text-white/30 hover:text-white/80 p-2 rounded-full hover:bg-white/[0.04] transition-colors"
              aria-label="Suchen"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Mega-KPI Card — Aktivitäts-Fokus */}
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-white/[0.04] via-white/[0.015] to-transparent p-6 shadow-[0_20px_60px_-20px_hsl(40_45%_45%/0.18),inset_0_1px_0_hsl(0_0%_100%/0.06)]">
          <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[hsl(40_50%_55%/0.12)] blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -left-20 h-72 w-72 rounded-full bg-[hsl(40_40%_50%/0.06)] blur-3xl" />

          <div className="relative">
            <div className="flex items-baseline gap-2">
              <span className="font-serif italic text-[13px] text-white/55 font-light tracking-wide">Heute</span>
              <span className="text-[9px] tracking-[0.34em] uppercase text-white/30 font-light">Live-Pulse</span>
            </div>

            {/* 2-Spalten Hero: Aktiv insgesamt · Jetzt online */}
            <div className="mt-5 grid grid-cols-2 gap-3">
              {/* Aktiv insgesamt */}
              <button
                onClick={() => setFilter("active")}
                className="group relative text-left rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.04] to-white/[0.01] p-4 transition-all hover:border-white/[0.1] hover:from-white/[0.06]"
              >
                <div className="flex items-center gap-1.5 text-[9px] tracking-[0.24em] uppercase text-white/35 font-light">
                  <span className="h-1 w-1 rounded-full bg-white/40" />
                  Aktiv heute
                </div>
                <div
                  className={`mt-2 font-extralight tabular-nums leading-none text-[44px] sm:text-[52px] ${
                    activePct >= 80 ? "text-emerald-200" : activePct >= 50 ? "text-amber-100" : "text-rose-200"
                  }`}
                  style={{ letterSpacing: "-0.05em" }}
                >
                  <AnimatedNumber value={activeTodayCount} />
                  <span className="text-[16px] font-light text-white/30 ml-1.5">/ {totalCount}</span>
                </div>
                <div className="mt-3 relative h-[3px] rounded-full bg-white/[0.05] overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ${
                      activePct >= 80
                        ? "bg-gradient-to-r from-emerald-400/70 to-emerald-300/90"
                        : activePct >= 50
                        ? "bg-gradient-to-r from-amber-400/70 to-amber-200/90"
                        : "bg-gradient-to-r from-rose-500/70 to-rose-300/90"
                    }`}
                    style={{ width: `${Math.max(3, activePct)}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] font-light">
                  <span className="text-white/30">seit 04:00</span>
                  <span className={`tabular-nums ${
                    activePct >= 80 ? "text-emerald-300/90" : activePct >= 50 ? "text-amber-200/90" : "text-rose-300/90"
                  }`}>
                    <AnimatedNumber value={activePct} />%
                  </span>
                </div>
              </button>

              {/* Jetzt online */}
              <div className="relative rounded-2xl border border-white/[0.06] bg-gradient-to-br from-emerald-500/[0.04] to-white/[0.01] p-4 overflow-hidden">
                {liveNowCount > 0 && (
                  <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-emerald-400/[0.08] blur-3xl" />
                )}
                <div className="flex items-center gap-1.5 text-[9px] tracking-[0.24em] uppercase text-white/35 font-light">
                  <span className="relative flex h-1.5 w-1.5">
                    {liveNowCount > 0 && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
                    )}
                    <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${liveNowCount > 0 ? "bg-emerald-400" : "bg-white/20"}`} />
                  </span>
                  Jetzt online
                </div>
                <div
                  className={`mt-2 font-extralight tabular-nums leading-none text-[44px] sm:text-[52px] ${
                    liveNowCount > 0 ? "text-emerald-200" : "text-white/40"
                  }`}
                  style={{ letterSpacing: "-0.05em" }}
                >
                  <AnimatedNumber value={liveNowCount} />
                  <span className="text-[16px] font-light text-white/30 ml-1.5">/ {totalCount}</span>
                </div>
                <div className="mt-3 h-[3px] rounded-full bg-white/[0.05] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400/70 to-emerald-300/90 transition-all duration-1000"
                    style={{ width: `${Math.max(liveNowCount > 0 ? 6 : 0, totalCount > 0 ? Math.round((liveNowCount / totalCount) * 100) : 0)}%` }}
                  />
                </div>
                <div className="mt-2 text-[10px] text-white/30 font-light">echte Aktivität · diese Stunde</div>
              </div>
            </div>

            {/* Mini stats row */}
            <div className="mt-5 grid grid-cols-3 gap-3 pt-4 border-t border-white/[0.05]">
              <MiniStat label="Mass-DMs" value={sumDms} />
              <MiniStat label="Σ Ungelesen" value={sumUnread} tone={sumUnread > 100 ? "warn" : undefined} />
              <MiniStat label="Inaktiv" value={inactiveCount} tone={inactiveCount > 0 ? "dim" : undefined} />
            </div>
          </div>
        </div>

        {/* Live Debug-Log */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <button
            onClick={() => setDebugOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-[10px] tracking-[0.24em] uppercase text-white/40 hover:text-white/70 transition-colors"
          >
            <span className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-emerald-400/60" />
              Live-Log · {liveLog.length} Events
            </span>
            <span className="text-white/30">{debugOpen ? "▾" : "▸"}</span>
          </button>
          {debugOpen && (
            <div className="max-h-72 overflow-y-auto border-t border-white/[0.05] divide-y divide-white/[0.04]">
              {liveLog.length === 0 ? (
                <div className="px-4 py-6 text-center text-[11px] text-white/30 font-light">Noch keine Events. Warte auf Live-Aktivität…</div>
              ) : (
                liveLog.map((ev) => {
                  const ageS = Math.max(0, Math.floor((Date.now() - ev.ts) / 1000));
                  const remainS = ev.expiresAt ? Math.max(0, Math.floor((ev.expiresAt - Date.now()) / 1000)) : null;
                  const tone =
                    ev.type === "sale" ? "text-emerald-300 bg-emerald-400/10" :
                    ev.type === "dm" ? "text-sky-300 bg-sky-400/10" :
                    ev.type === "unread" ? "text-amber-200 bg-amber-400/10" :
                    ev.type === "expire" ? "text-rose-300 bg-rose-400/10" :
                    "text-white/50 bg-white/[0.05]";
                  const icon =
                    ev.type === "sale" ? "💰" :
                    ev.type === "dm" ? "📤" :
                    ev.type === "unread" ? "📥" :
                    ev.type === "expire" ? "⌛" : "·";
                  return (
                    <div key={ev.id} className="flex items-center gap-3 px-4 py-2 text-[11px]">
                      <span className={`shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-md text-[11px] ${tone}`}>{icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-white/90 font-medium truncate">{ev.name}</span>
                          <span className="text-white/40">{ev.detail}</span>
                        </div>
                        <div className="text-[9px] text-white/30 mt-0.5 tabular-nums">
                          vor {relTime(ageS)}{remainS !== null && ev.type !== "expire" ? ` · läuft ab in ${relTime(remainS)}` : ""}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Insight chips */}
        {(buckets.weak.length > 0 || inactiveCount > 0) && (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {buckets.weak.length > 0 && (
              <InsightCard
                icon={TrendingDown}
                tone="rose"
                label="Unter Pacing"
                title={`${buckets.weak.length} ${buckets.weak.length === 1 ? "Chatter" : "Chatter"}`}
                detail="jetzt eingreifen · motivieren"
                onClick={() => setFilter("weak")}
              />
            )}
            {inactiveCount > 0 && (
              <InsightCard
                icon={Moon}
                tone="gold"
                label="Heute noch nicht aktiv"
                title={`${inactiveCount} ${inactiveCount === 1 ? "Chatter" : "Chatter"}`}
                detail="check ob alles ok ist"
                onClick={() => setFilter("inactive")}
              />
            )}
          </div>
        )}
      </header>

      {/* ─── FILTER ──────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap -mx-1 px-1">
          {(["all", "active", "weak", "inactive"] as FilterKey[]).map((k) => {
            const isActive = filter === k;
            const labelMap = {
              all: "Alle",
              active: "Aktiv",
              weak: "Unter Pacing",
              inactive: "Inaktiv",
            } as const;
            return (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`group inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[11px] tracking-wide transition-all border ${
                  isActive
                    ? "bg-white/[0.06] text-white/95 border-white/15 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.08),0_4px_14px_-6px_hsl(40_45%_55%/0.25)]"
                    : "text-white/45 border-white/[0.05] hover:text-white/80 hover:border-white/[0.12] hover:bg-white/[0.02]"
                }`}
              >
                <span className="font-light">{labelMap[k]}</span>
                <span className={`tabular-nums text-[10px] ${isActive ? "text-white/55" : "text-white/30"}`}>
                  {counts[k]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Sort row */}
        <div className="flex items-center gap-1.5 flex-wrap -mx-1 px-1">
          <span className="text-[9px] tracking-[0.28em] uppercase text-white/30 font-light px-1.5">Sortieren</span>
          {(["smart", "priority", "revenue", "pacing", "activity"] as SortKey[]).map((k) => {
            const isActive = sortKey === k;
            const labelMap = {
              smart: "Smart",
              priority: "Prio (Ø/Tag)",
              revenue: "Umsatz",
              pacing: "Pacing-Δ",
              activity: "Aktivität",
            } as const;
            return (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] tracking-wide transition-all border ${
                  isActive
                    ? "bg-white/[0.05] text-white/90 border-white/12"
                    : "text-white/40 border-white/[0.04] hover:text-white/75 hover:border-white/[0.10]"
                }`}
              >
                <span className="font-light">{labelMap[k]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── CONTENT ─────────────────────────────────── */}
      {loading ? (
        <p className="text-center text-sm text-white/30 py-16 font-light tracking-wide">Lade Live-Daten…</p>
      ) : visible.length === 0 ? (
        <p className="text-center text-sm text-white/30 py-16 font-light tracking-wide">Keine Chatter passen zum Filter.</p>
      ) : filter !== "all" || sortKey !== "smart" ? (
        <div className="space-y-2">
          {visible.map((s) => (
            <Row key={s.name} item={s} onSelect={setSelected} />
          ))}
        </div>
      ) : (
        <div className="space-y-10">
          {buckets.weak.length > 0 && (
            <Bucket label="Unter Pacing" tone="urgent" icon={TrendingDown} items={buckets.weak} onSelect={setSelected} />
          )}
          {buckets.idle.length > 0 && (
            <Bucket label="Pause" sub="heute schon aktiv gewesen" tone="watch" icon={Clock} items={buckets.idle} onSelect={setSelected} />
          )}
          {buckets.inactive.length > 0 && (
            <Bucket label="Heute noch nicht aktiv" tone="dim" icon={Moon} items={buckets.inactive} onSelect={setSelected} />
          )}
          {buckets.strong.length > 0 && (
            <div>
              <button
                onClick={() => setStrongOpen((o) => !o)}
                className="w-full flex items-center justify-between text-[10px] uppercase tracking-[0.28em] text-white/30 hover:text-white/55 transition-colors py-3 border-t border-white/[0.04]"
              >
                <span className="flex items-center gap-2 font-light">
                  {strongOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Läuft sauber
                </span>
                <span className="flex items-center gap-2 normal-case tracking-normal">
                  <TrendingUp className="h-3 w-3 text-emerald-300/60" />
                  <span className="tabular-nums text-white/40">{buckets.strong.length}</span>
                </span>
              </button>
              {strongOpen && (
                <div className="mt-4 space-y-2">
                  {buckets.strong.map((s) => (
                    <Row key={s.name} item={s} onSelect={setSelected} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ChatterSlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        chatterName={selected?.name ?? ""}
        platform={(selected?.platform as any) ?? platform}
      />
    </div>
  );
}

function MiniStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: "ok" | "warn" | "dim";
}) {
  const valueColor =
    tone === "warn" ? "text-rose-200/95" : tone === "dim" ? "text-white/55" : "text-white/95";
  return (
    <div>
      <div className="text-[9px] tracking-[0.22em] uppercase text-white/35 font-light">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-xl font-extralight tabular-nums ${valueColor}`}>
          {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
        </span>
        {sub && <span className="text-[10px] text-white/30 tabular-nums">{sub}</span>}
      </div>
    </div>
  );
}

function InsightCard({
  icon: Icon,
  tone,
  label,
  title,
  detail,
  onClick,
}: {
  icon: typeof Sparkles;
  tone: "gold" | "rose";
  label: string;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  const accent =
    tone === "gold"
      ? {
          ring: "border-[hsl(40_45%_55%/0.18)] hover:border-[hsl(40_45%_55%/0.32)]",
          icon: "text-[hsl(40_60%_70%)] bg-[hsl(40_50%_55%/0.10)] border-[hsl(40_50%_55%/0.22)]",
          glow: "from-[hsl(40_50%_55%/0.10)] to-transparent",
          title: "gold-text",
        }
      : {
          ring: "border-rose-400/12 hover:border-rose-400/25",
          icon: "text-rose-200 bg-rose-500/10 border-rose-400/20",
          glow: "from-rose-500/10 to-transparent",
          title: "text-rose-100/95",
        };

  return (
    <button
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition-all hover:translate-y-[-1px] ${accent.ring} bg-white/[0.012] backdrop-blur-xl`}
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accent.glow} opacity-50 group-hover:opacity-80 transition-opacity`} />
      <div className="relative flex items-start gap-3">
        <div className={`h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 ${accent.icon}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] tracking-[0.24em] uppercase text-white/40 font-light">{label}</div>
          <div className={`mt-0.5 text-[15px] font-light truncate ${accent.title}`}>{title}</div>
          <div className="text-[11px] text-white/50 font-light mt-0.5 truncate">{detail}</div>
        </div>
      </div>
    </button>
  );
}

function Bucket({
  label,
  sub,
  tone,
  icon: Icon,
  items,
  onSelect,
}: {
  label: string;
  sub?: string;
  tone: "urgent" | "watch" | "dim";
  icon: typeof Sparkles;
  items: ChatterStatus[];
  onSelect: (s: { name: string; platform: string }) => void;
}) {
  const colors = {
    urgent: { text: "text-rose-300/90", line: "from-rose-400/30", iconBg: "bg-rose-500/10 border-rose-400/20 text-rose-200" },
    watch: { text: "text-amber-200/85", line: "from-amber-300/25", iconBg: "bg-amber-400/10 border-amber-300/20 text-amber-200" },
    dim: { text: "text-white/45", line: "from-white/15", iconBg: "bg-white/[0.04] border-white/[0.08] text-white/50" },
  }[tone];

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className={`h-7 w-7 rounded-lg border flex items-center justify-center ${colors.iconBg}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1">
          <div className={`text-[11px] uppercase tracking-[0.24em] font-light ${colors.text}`}>{label}</div>
          {sub && <div className="text-[10px] text-white/30 font-light tracking-wide mt-0.5">{sub}</div>}
        </div>
        <span className={`text-[11px] tabular-nums font-light ${colors.text}`}>{items.length}</span>
      </div>
      <div className={`h-px w-full bg-gradient-to-r ${colors.line} to-transparent mb-3`} />
      <div className="space-y-2">
        {items.map((s) => (
          <Row key={s.name} item={s} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function Row({
  item,
  onSelect,
}: {
  item: ChatterStatus;
  onSelect: (s: { name: string; platform: string }) => void;
}) {
  const sec = item.lastSeenSec;
  const online = sec !== null && sec < 5 * 60;
  const recently = sec !== null && sec < 30 * 60;

  const tone =
    item.status === "active_weak"
      ? "urgent"
      : item.status === "active_idle"
      ? "watch"
      : item.status === "inactive"
      ? "dim"
      : "running";

  // Pacing bar percentage
  const expected = item.expectedRevenueByNow;
  const today = item.live ? Number(item.live.revenue) : 0;
  const pacingPct = expected > 0 ? Math.min(100, Math.max(0, (today / expected) * 100)) : null;

  const cardTone =
    tone === "urgent"
      ? "border-rose-400/15 hover:border-rose-400/30 bg-gradient-to-br from-rose-500/[0.04] to-transparent"
      : tone === "watch"
      ? "border-amber-300/12 hover:border-amber-300/25 bg-gradient-to-br from-amber-400/[0.03] to-transparent"
      : tone === "dim"
      ? "border-white/[0.04] hover:border-white/[0.10] bg-white/[0.012] opacity-85"
      : "border-white/[0.05] hover:border-white/[0.12] bg-white/[0.012]";

  const avatarRing =
    tone === "urgent"
      ? "border-rose-400/30"
      : tone === "watch"
      ? "border-amber-300/25"
      : tone === "dim"
      ? "border-white/[0.08]"
      : "border-white/[0.10]";

  const dotColor = !item.isActiveToday
    ? "bg-white/20"
    : online
    ? "bg-emerald-400"
    : recently
    ? "bg-amber-300/80"
    : "bg-white/30";

  const reasonColor =
    tone === "urgent"
      ? "text-rose-200/95"
      : tone === "watch"
      ? "text-amber-100/85"
      : tone === "dim"
      ? "text-white/50"
      : "text-white/55";

  const oldestDays = item.live?.oldest_chat != null ? Number(item.live.oldest_chat) : null;
  const showOldest = oldestDays != null && oldestDays > 0;
  const oldestTone =
    oldestDays == null
      ? "muted"
      : oldestDays >= 7
      ? "danger"
      : oldestDays >= 3
      ? "warn"
      : oldestDays >= 1
      ? "info"
      : "muted";
  const oldestLabel =
    oldestDays == null
      ? "—"
      : `${Math.max(1, Math.round(oldestDays * 24))}h offen`;

  const avgRev = item.profile?.avgRevenue ?? 0;
  const sparkPoints = item.profile?.recentRevenues ?? [];

  // Pacing-bar mit Soll-Marker: heute / max(today, expected, avg)
  const scaleMax = Math.max(today, expected, avgRev * 1.05, 1);
  const todayPct = Math.min(100, (today / scaleMax) * 100);
  const expectedPct = Math.min(100, (expected / scaleMax) * 100);

  const actionColor =
    item.lostRevenue >= 100
      ? "text-rose-200"
      : item.lostRevenue >= 30
      ? "text-rose-300/90"
      : item.surplusRevenue >= 30
      ? "text-[hsl(40_70%_75%)]"
      : tone === "watch"
      ? "text-amber-100/90"
      : tone === "dim"
      ? "text-white/65"
      : "text-white/85";

  return (
    <button
      onClick={() => onSelect({ name: item.name, platform: (item.live as any)?.platform ?? "" })}
      className={`group relative w-full rounded-2xl border px-4 py-3.5 text-left transition-all duration-300 hover:translate-y-[-1px] backdrop-blur-xl ${cardTone}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3.5">
        <div className="relative shrink-0">
          <div className={`h-11 w-11 rounded-full border flex items-center justify-center text-[11px] font-light tracking-wider text-white/80 bg-gradient-to-br from-white/[0.07] to-white/[0.01] ${avatarRing}`}>
            {initials(item.name)}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
            {online && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/50 opacity-75 animate-ping" />
            )}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ring-2 ring-[hsl(240_6%_4%)] ${dotColor}`} />
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2.5 min-w-0">
              <span className="text-[14.5px] text-white/95 font-light tracking-wide truncate">
                {item.name}
              </span>
              {sparkPoints.length >= 3 && (
                <Sparkline points={sparkPoints} tone={tone} />
              )}
            </div>
            {sec !== null && (
              <span className="text-[10px] text-white/35 tracking-wider tabular-nums shrink-0">
                {relTime(sec)}
              </span>
            )}
          </div>
          <div className={`mt-1 text-[12.5px] font-light tracking-wide truncate ${actionColor}`}>
            {item.actionText}
          </div>
        </div>
      </div>

      {/* Heute / Schnitt */}
      {(avgRev >= 5 || today > 0) && (
        <div className="mt-3 flex items-baseline justify-between gap-3 text-[11px] tabular-nums">
          <div className="font-light text-white/75">
            <span className={`${today > 0 ? "text-white/90" : "text-white/45"} text-[13px]`}>
              {Math.round(today)} €
            </span>
            <span className="text-white/30"> heute</span>
          </div>
          <div className="font-light text-white/35">
            Ø {Math.round(avgRev)} €/Tag
          </div>
        </div>
      )}

      {/* Pacing-Bar mit Soll-Marker */}
      {expected >= 5 && (
        <div className="mt-2 relative h-[4px] rounded-full bg-white/[0.04] overflow-visible">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${
              today >= expected
                ? "bg-gradient-to-r from-emerald-400/60 to-emerald-300/80"
                : today >= expected * 0.6
                ? "bg-gradient-to-r from-amber-300/60 to-amber-200/80"
                : "bg-gradient-to-r from-rose-500/70 to-rose-300/85"
            }`}
            style={{ width: `${Math.max(2, todayPct)}%` }}
          />
          {/* Soll-Marker */}
          <div
            className="absolute -top-1 h-[10px] w-[2px] rounded-sm bg-white/55"
            style={{ left: `calc(${expectedPct}% - 1px)` }}
            title={`Soll jetzt: ${Math.round(expected)} €`}
          />
        </div>
      )}

      {/* Metric Chips */}
      {item.live && (
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          <MetricChip
            icon={Inbox}
            value={item.live.unread_chats ?? 0}
            tone={
              (item.live.unread_chats ?? 0) >= 20
                ? "danger"
                : (item.live.unread_chats ?? 0) >= 10
                ? "warn"
                : (item.live.unread_chats ?? 0) > 0
                ? "info"
                : "muted"
            }
            title="Ungelesene Chats"
          />
          {showOldest && (
            <MetricChip
              icon={Hourglass}
              value={oldestLabel}
              tone={oldestTone}
              title="Ältester ungelesener Chat"
            />
          )}
          <MetricChip
            icon={Megaphone}
            value={item.live.mass_dms ?? 0}
            tone={(item.live.mass_dms ?? 0) > 0 ? "gold" : "muted"}
            title="Mass-DMs heute"
          />
        </div>
      )}
    </button>
  );
}

function Sparkline({ points, tone }: { points: number[]; tone: "urgent" | "watch" | "dim" | "running" }) {
  const W = 56;
  const H = 16;
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = Math.max(1, max - min);
  const step = W / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = i * step;
      const y = H - ((v - min) / range) * H;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const stroke =
    tone === "urgent"
      ? "hsl(0 80% 75% / 0.85)"
      : tone === "watch"
      ? "hsl(40 80% 70% / 0.85)"
      : tone === "dim"
      ? "hsl(0 0% 100% / 0.35)"
      : "hsl(150 50% 70% / 0.7)";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0 opacity-90">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function MetricChip({
  icon: Icon,
  value,
  tone,
  title,
}: {
  icon: typeof Sparkles;
  value: number | string;
  tone: "danger" | "warn" | "info" | "gold" | "muted";
  title?: string;
}) {
  const styles = {
    danger:
      "border-rose-400/30 bg-rose-500/12 text-rose-100 shadow-[inset_0_1px_0_hsl(0_90%_80%/0.10)]",
    warn:
      "border-amber-300/25 bg-amber-400/10 text-amber-100",
    info:
      "border-white/[0.10] bg-white/[0.05] text-white/85",
    gold:
      "border-[hsl(40_45%_55%/0.28)] bg-[hsl(40_50%_55%/0.10)] text-[hsl(40_75%_82%)]",
    muted:
      "border-white/[0.05] bg-white/[0.02] text-white/30",
  }[tone];
  const iconOpacity = tone === "muted" ? "opacity-50" : "opacity-90";
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-1.5 h-5 rounded-md border text-[10px] font-light tabular-nums tracking-wide transition-colors ${styles}`}
    >
      <Icon className={`h-2.5 w-2.5 ${iconOpacity}`} />
      {value}
    </span>
  );
}

function AnimatedNumber({ value, duration = 600 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = display;
    startRef.current = null;
    const target = value;
    const from = display;
    const diff = target - from;
    if (diff === 0) return;

    const step = (ts: number) => {
      if (startRef.current == null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + diff * eased;
      setDisplay(diff > 0 ? Math.min(target, next) : Math.max(target, next));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <>{Math.round(display).toLocaleString("de-DE")}</>;
}

function HeatmapStrip({ data }: { data: Map<number, number> }) {
  const nowH = new Date().getHours();
  const max = Math.max(1, ...Array.from(data.values()));
  const cells = Array.from({ length: 24 }, (_, h) => {
    const v = data.get(h) ?? 0;
    const intensity = v / max;
    return { h, v, intensity };
  });
  return (
    <div className="mt-6 pt-5 border-t border-white/[0.05]">
      <div className="flex items-center justify-between text-[9px] tracking-[0.24em] uppercase text-white/35 font-light mb-2">
        <span>24h Aktivität</span>
        <span className="tabular-nums text-white/25 normal-case tracking-normal">jetzt {String(nowH).padStart(2, "0")}:00</span>
      </div>
      <div className="flex items-end gap-[3px] h-9">
        {cells.map(({ h, v, intensity }) => {
          const isNow = h === nowH;
          const height = Math.max(8, intensity * 100);
          const opacity = v === 0 ? 0.08 : 0.25 + intensity * 0.75;
          return (
            <div
              key={h}
              title={`${String(h).padStart(2, "0")}:00 · ${v} aktiv`}
              className="flex-1 relative group"
            >
              <div
                className={`w-full rounded-[2px] transition-all ${
                  isNow
                    ? "bg-gradient-to-t from-[hsl(40_60%_55%)] to-[hsl(40_75%_72%)]"
                    : "bg-gradient-to-t from-white/40 to-white/70"
                }`}
                style={{
                  height: `${height}%`,
                  opacity: isNow ? 1 : opacity,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[8px] text-white/20 tabular-nums">
        <span>04</span>
        <span>10</span>
        <span>16</span>
        <span>22</span>
      </div>
    </div>
  );
}
