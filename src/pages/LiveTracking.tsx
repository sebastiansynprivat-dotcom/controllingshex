import { useEffect, useMemo, useState } from "react";
import { Radio, Search, Flame, AlertTriangle, MoonStar, Trophy, MailX, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform, type Platform } from "@/contexts/PlatformContext";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { Input } from "@/components/ui/input";

interface LiveRow {
  id: string;
  platform: string;
  chatter_name: string;
  revenue: number;
  mass_dms: number;
  unread_chats: number;
  oldest_chat: number | null;
  date: string;
  updated_at: string;
}

type FilterKey = "online" | "escalation" | "overload" | "inactive" | "top" | "noDms" | "silent";
type SortKey = "revenue" | "unread" | "oldest" | "updated";

const FILTERS: { key: FilterKey; label: string; icon: typeof Flame; hint: string }[] = [
  { key: "online", label: "Online jetzt", icon: Radio, hint: "Update < 5min" },
  { key: "escalation", label: "Eskalation", icon: AlertTriangle, hint: "Oldest ≥ 2" },
  { key: "overload", label: "Überlastet", icon: Flame, hint: "Unread ≥ 10" },
  { key: "inactive", label: "Inaktiv", icon: MoonStar, hint: "kein Update > 30min" },
  { key: "top", label: "Top Performer", icon: Trophy, hint: "Top 5 Revenue" },
  { key: "noDms", label: "Keine Mass-DMs", icon: MailX, hint: "0 Mass-DMs" },
  { key: "silent", label: "Stille Goldgruben", icon: Sparkles, hint: "viel Revenue, 0 Unread" },
];

function secondsSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

function statusOf(sec: number): "online" | "idle" | "offline" {
  if (sec < 5 * 60) return "online";
  if (sec < 30 * 60) return "idle";
  return "offline";
}

function relTime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(n) + " €";
}

export default function LiveTracking() {
  const { platform } = usePlatform();
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Set<FilterKey>>(new Set());
  const [sort, setSort] = useState<SortKey>("updated");
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<{ name: string; platform: string } | null>(null);

  // Tick every second for relative times
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Initial fetch (today, current platform)
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
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

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("chatter-history-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chatter_history_live" },
        (payload) => {
          const today = new Date().toISOString().slice(0, 10);
          setRows((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((r) => r.id !== (payload.old as LiveRow).id);
            }
            const next = payload.new as LiveRow;
            if (next.date !== today) return prev;
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
  }, []);

  const toggleFilter = (k: FilterKey) =>
    setFilters((s) => {
      const next = new Set(s);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const filteredSorted = useMemo(() => {
    const medianRev = (() => {
      const arr = rows.map((r) => Number(r.revenue) || 0).sort((a, b) => a - b);
      if (!arr.length) return 0;
      return arr[Math.floor(arr.length / 2)];
    })();
    const topIds = new Set(
      [...rows].sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 5).map((r) => r.id),
    );

    let out = rows.filter((r) => {
      if (platformFilter !== "all" && r.platform !== platformFilter) return false;
      if (search && !r.chatter_name.toLowerCase().includes(search.toLowerCase())) return false;
      const sec = secondsSince(r.updated_at);
      if (filters.has("online") && sec >= 5 * 60) return false;
      if (filters.has("inactive") && sec <= 30 * 60) return false;
      if (filters.has("escalation") && (r.oldest_chat ?? 0) < 2) return false;
      if (filters.has("overload") && (r.unread_chats ?? 0) < 10) return false;
      if (filters.has("top") && !topIds.has(r.id)) return false;
      if (filters.has("noDms") && (r.mass_dms ?? 0) !== 0) return false;
      if (filters.has("silent") && !((r.unread_chats ?? 0) === 0 && Number(r.revenue) > medianRev)) return false;
      return true;
    });

    out = [...out].sort((a, b) => {
      switch (sort) {
        case "revenue": return Number(b.revenue) - Number(a.revenue);
        case "unread": return (b.unread_chats ?? 0) - (a.unread_chats ?? 0);
        case "oldest": return (b.oldest_chat ?? 0) - (a.oldest_chat ?? 0);
        case "updated":
        default:
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }
    });
    return out;
    // tick included to refresh time-based filters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filters, sort, search, platformFilter, tick]);

  const stats = useMemo(() => {
    const sumRev = filteredSorted.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
    const sumDms = filteredSorted.reduce((s, r) => s + (r.mass_dms ?? 0), 0);
    const sumUnread = filteredSorted.reduce((s, r) => s + (r.unread_chats ?? 0), 0);
    const oldestArr = filteredSorted.map((r) => r.oldest_chat ?? 0);
    const avgOldest = oldestArr.length ? oldestArr.reduce((a, b) => a + b, 0) / oldestArr.length : 0;
    const onlineCount = filteredSorted.filter((r) => secondsSince(r.updated_at) < 15 * 60).length;
    return { sumRev, sumDms, sumUnread, avgOldest, onlineCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSorted, tick]);

  const lastSync = rows.length
    ? Math.min(...rows.map((r) => secondsSince(r.updated_at)))
    : null;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-light tracking-tight text-foreground flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/70 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </span>
            Live-Tracking
          </h1>
          <p className="text-sm text-white/40 mt-1 font-light">
            {filteredSorted.length} Chatter ·{" "}
            {lastSync !== null ? `letzte Sync vor ${relTime(lastSync)}` : "keine Daten heute"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(["all", "Maloum", "Brezzels", "4Based"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p as Platform | "all")}
              className={`px-3 py-1.5 rounded-full text-xs font-light tracking-wide transition-all border ${
                platformFilter === p
                  ? "bg-white/10 text-white border-white/20"
                  : "bg-transparent text-white/50 border-white/[0.06] hover:text-white/80 hover:border-white/15"
              }`}
            >
              {p === "all" ? "Alle" : p}
            </button>
          ))}
        </div>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Σ Revenue" value={fmtEur(stats.sumRev)} />
        <Kpi label="Σ Mass-DMs" value={String(stats.sumDms)} />
        <Kpi label="Σ Unread" value={String(stats.sumUnread)} />
        <Kpi label="Ø Oldest" value={stats.avgOldest.toFixed(1)} />
        <Kpi label="Aktiv (<15min)" value={String(stats.onlineCount)} accent />
      </div>

      {/* Search + filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Chatter suchen…"
            className="pl-9 bg-white/[0.02] border-white/[0.06] text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filters.has(f.key);
            const Icon = f.icon;
            return (
              <button
                key={f.key}
                onClick={() => toggleFilter(f.key)}
                title={f.hint}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-light tracking-wide transition-all border ${
                  active
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "bg-white/[0.02] text-white/55 border-white/[0.06] hover:text-white/85 hover:border-white/15"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {f.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 text-xs text-white/40">
          <span>Sortieren:</span>
          {(["updated", "revenue", "unread", "oldest"] as SortKey[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-2 py-1 rounded transition-colors ${
                sort === s ? "text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              {s === "updated" ? "Letzte Sync" : s === "revenue" ? "Revenue" : s === "unread" ? "Unread" : "Oldest"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
        <div className="grid grid-cols-[auto_1.5fr_0.8fr_0.8fr_0.7fr_0.7fr_0.7fr_0.9fr] gap-3 px-4 py-3 text-[11px] uppercase tracking-wider text-white/35 border-b border-white/[0.04]">
          <span></span>
          <span>Chatter</span>
          <span>Plattform</span>
          <span className="text-right">Revenue</span>
          <span className="text-right">Mass-DMs</span>
          <span className="text-right">Unread</span>
          <span className="text-right">Oldest</span>
          <span className="text-right">Letzte Sync</span>
        </div>
        {loading ? (
          <div className="px-4 py-12 text-center text-sm text-white/30">Lade Live-Daten…</div>
        ) : filteredSorted.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-white/30">Keine Chatter mit diesen Filtern.</div>
        ) : (
          filteredSorted.map((r) => {
            const sec = secondsSince(r.updated_at);
            const status = statusOf(sec);
            const escalated = (r.oldest_chat ?? 0) >= 2;
            const overloaded = (r.unread_chats ?? 0) >= 10;
            return (
              <button
                key={r.id}
                onClick={() => setSelected({ name: r.chatter_name, platform: r.platform })}
                className="w-full grid grid-cols-[auto_1.5fr_0.8fr_0.8fr_0.7fr_0.7fr_0.7fr_0.9fr] gap-3 px-4 py-3 items-center text-sm border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.025] transition-colors text-left"
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    status === "online"
                      ? "bg-emerald-400"
                      : status === "idle"
                      ? "bg-amber-400/70"
                      : "bg-white/15"
                  }`}
                />
                <span className="text-white/90 font-light truncate">{r.chatter_name}</span>
                <span className="text-white/50 text-xs font-light">{r.platform}</span>
                <span className="text-right text-white/85 font-light tabular-nums">{fmtEur(Number(r.revenue))}</span>
                <span className="text-right text-white/60 tabular-nums">{r.mass_dms}</span>
                <span
                  className={`text-right tabular-nums ${
                    overloaded ? "text-rose-300" : "text-white/60"
                  }`}
                >
                  {r.unread_chats}
                </span>
                <span
                  className={`text-right tabular-nums ${
                    escalated ? "text-rose-300" : "text-white/60"
                  }`}
                >
                  {r.oldest_chat ?? 0}
                </span>
                <span className="text-right text-white/40 text-xs">vor {relTime(sec)}</span>
              </button>
            );
          })
        )}
      </div>

      <ChatterSlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        chatterName={selected?.name ?? ""}
        platform={(selected?.platform as Platform) ?? platform}
      />
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${accent ? "border-primary/20 bg-primary/[0.04]" : "border-white/[0.06] bg-white/[0.02]"}`}>
      <p className="text-[11px] uppercase tracking-wider text-white/35 font-light">{label}</p>
      <p className={`mt-1 text-xl font-light tabular-nums ${accent ? "text-primary" : "text-white/90"}`}>{value}</p>
    </div>
  );
}
