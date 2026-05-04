import { useEffect, useMemo, useState } from "react";
import { Search, AlertTriangle, TrendingDown, ChevronDown, ChevronRight, ArrowUpRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { Input } from "@/components/ui/input";
import { computeScore, type ChatterAvg, type LiveRowLite, type ScoredChatter } from "@/lib/live-priority";

interface LiveRow extends LiveRowLite {
  id: string;
  platform: string;
  date: string;
}

type FilterKey = "all" | "escalation" | "lost";

function secondsSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

function relTime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(n) + "€";
}

export default function LiveTracking() {
  const { platform } = usePlatform();
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [avgs, setAvgs] = useState<Map<string, ChatterAvg>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [runningOpen, setRunningOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<{ name: string; platform: string } | null>(null);

  // 1s tick for relative time + score recompute
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch live rows for today + platform
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

  // Fetch 14d averages from chatter_history
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
        const byName = new Map<string, { rev: number[]; dms: number[]; unread: number[] }>();
        (data ?? []).forEach((r: any) => {
          const name = (r.chatter_name ?? "").trim().toLowerCase();
          if (!name) return;
          if (!byName.has(name)) byName.set(name, { rev: [], dms: [], unread: [] });
          const e = byName.get(name)!;
          e.rev.push(Number(r.revenue_today) || 0);
          e.dms.push(Number(r.mass_dms) || 0);
          e.unread.push(Number(r.open_chats) || 0);
        });
        const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
        const map = new Map<string, ChatterAvg>();
        byName.forEach((v, k) =>
          map.set(k, {
            avgRevenue: avg(v.rev),
            avgMassDms: avg(v.dms),
            avgUnread: avg(v.unread),
          }),
        );
        setAvgs(map);
      });
  }, [platform]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`live-${platform}`)
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

  // Score everything
  const scored: ScoredChatter[] = useMemo(() => {
    const now = new Date();
    return rows
      .map((r) => computeScore(r, avgs.get(r.chatter_name.trim().toLowerCase()), now))
      .sort((a, b) => b.score - a.score);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, avgs, tick]);

  // Filter (search + filter pill)
  const visible = useMemo(() => {
    return scored.filter((s) => {
      if (search && !s.row.chatter_name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === "escalation" && (s.row.oldest_chat ?? 0) < 1) return false;
      if (filter === "lost" && s.potentialLoss < 20) return false;
      return true;
    });
  }, [scored, search, filter]);

  const buckets = useMemo(() => {
    return {
      now: visible.filter((s) => s.bucket === "now"),
      watch: visible.filter((s) => s.bucket === "watch"),
      running: visible.filter((s) => s.bucket === "running"),
    };
  }, [visible]);

  // Header KPIs
  const sumRevenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const activeCount = rows.filter((r) => secondsSince(r.updated_at) < 15 * 60).length;
  const lastSync = rows.length ? Math.min(...rows.map((r) => secondsSince(r.updated_at))) : null;

  // Smart banner: high-avg chatters not started yet
  const notStarted = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const liveToday = new Set(rows.filter((r) => r.date === today).map((r) => r.chatter_name.trim().toLowerCase()));
    const out: { name: string; expected: number }[] = [];
    avgs.forEach((avg, name) => {
      if (avg.avgRevenue < 30) return;
      const liveRow = rows.find((r) => r.chatter_name.trim().toLowerCase() === name);
      const todayRev = liveRow ? Number(liveRow.revenue) || 0 : 0;
      const hour = new Date().getHours() + new Date().getMinutes() / 60;
      const dayProgress = Math.max(0, Math.min(1, (hour - 6) / 18));
      const expected = avg.avgRevenue * dayProgress;
      if (!liveToday.has(name) || todayRev < expected * 0.2) {
        if (expected >= 30) out.push({ name, expected });
      }
    });
    return out.sort((a, b) => b.expected - a.expected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, avgs, tick]);

  const hotStreakCount = scored.filter((s) => s.hotStreak).length;

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-8 pb-16">
      {/* Header */}
      <header className="text-center space-y-2 pt-2">
        <div className="flex items-center justify-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/70 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <h1 className="text-base font-light tracking-[0.18em] uppercase text-white/80">
            Live · {platform}
          </h1>
        </div>
        <p className="text-xs text-white/35 font-light tracking-wide">
          {lastSync !== null ? `vor ${relTime(lastSync)}` : "keine Daten"} · {activeCount} aktiv · {fmtEur(sumRevenue)} heute
        </p>
      </header>

      {/* Smart banner */}
      {notStarted.length > 0 && (
        <div className="border-y border-amber-400/15 bg-amber-400/[0.03] px-4 py-3 -mx-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-300/80 mt-0.5 shrink-0" />
            <div className="text-sm text-white/70 font-light">
              <span className="text-amber-200/90">{notStarted.length} Top-Chatter</span> heute noch nicht am Start ·{" "}
              <span className="text-white/45">~{fmtEur(notStarted.reduce((s, n) => s + n.expected, 0))} erwartetes Potential offen</span>
            </div>
          </div>
        </div>
      )}

      {/* Filter row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {(["all", "escalation", "lost"] as FilterKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1 rounded-full text-[11px] font-light tracking-wide transition-colors ${
                filter === k ? "bg-white/10 text-white/90" : "text-white/40 hover:text-white/70"
              }`}
            >
              {k === "all" ? "Alle" : k === "escalation" ? "Eskalation" : "Lost Potential"}
            </button>
          ))}
        </div>
        <div className="flex items-center">
          {searchOpen ? (
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => !search && setSearchOpen(false)}
              placeholder="Suchen…"
              className="h-7 w-40 text-xs bg-white/[0.03] border-white/[0.06]"
            />
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="text-white/40 hover:text-white/70 p-1.5"
              aria-label="Suchen"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <p className="text-center text-sm text-white/30 py-12">Lade Live-Daten…</p>
      ) : visible.length === 0 ? (
        <p className="text-center text-sm text-white/30 py-12">Keine Chatter heute aktiv.</p>
      ) : (
        <div className="space-y-10">
          {buckets.now.length > 0 && <Bucket label="Sofort" tone="urgent" items={buckets.now} onSelect={setSelected} />}
          {buckets.watch.length > 0 && <Bucket label="Beobachten" tone="watch" items={buckets.watch} onSelect={setSelected} />}
          {buckets.running.length > 0 && (
            <div>
              <button
                onClick={() => setRunningOpen((o) => !o)}
                className="w-full flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-white/35 hover:text-white/60 transition-colors py-2"
              >
                <span className="flex items-center gap-1.5">
                  {runningOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {buckets.running.length} laufen sauber
                </span>
                {hotStreakCount > 0 && (
                  <span className="flex items-center gap-1 text-emerald-300/70 normal-case tracking-normal text-xs">
                    <ArrowUpRight className="h-3 w-3" /> {hotStreakCount} hot
                  </span>
                )}
              </button>
              {runningOpen && (
                <div className="mt-3">
                  <Bucket label="" tone="running" items={buckets.running} onSelect={setSelected} />
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

function Bucket({
  label,
  tone,
  items,
  onSelect,
}: {
  label: string;
  tone: "urgent" | "watch" | "running";
  items: ScoredChatter[];
  onSelect: (s: { name: string; platform: string }) => void;
}) {
  return (
    <div>
      {label && (
        <div className="flex items-center gap-3 mb-3">
          <span
            className={`text-[10px] uppercase tracking-[0.25em] font-light ${
              tone === "urgent" ? "text-rose-300/80" : tone === "watch" ? "text-amber-200/70" : "text-white/30"
            }`}
          >
            {label}
          </span>
          <span className="flex-1 h-px bg-white/[0.05]" />
        </div>
      )}
      <div className="divide-y divide-white/[0.04]">
        {items.map((s) => (
          <Row key={s.row.chatter_name} item={s} tone={tone} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function Row({
  item,
  tone,
  onSelect,
}: {
  item: ScoredChatter;
  tone: "urgent" | "watch" | "running";
  onSelect: (s: { name: string; platform: string }) => void;
}) {
  const sec = secondsSince(item.row.updated_at);
  const online = sec < 5 * 60;
  const offline = sec >= 30 * 60;
  const scoreColor =
    tone === "urgent" ? "text-rose-200" : tone === "watch" ? "text-amber-100/90" : "text-white/40";

  return (
    <button
      onClick={() => onSelect({ name: item.row.chatter_name, platform: (item.row as any).platform })}
      className="w-full flex items-center gap-4 py-3 group text-left hover:bg-white/[0.015] transition-colors px-2 -mx-2 rounded"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
          online ? "bg-emerald-400" : offline ? "bg-white/15" : "bg-amber-300/60"
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-white/85 font-light truncate">{item.row.chatter_name}</span>
          {item.hotStreak && <ArrowUpRight className="h-3 w-3 text-emerald-300/70 shrink-0" />}
        </div>
        {item.reasons.length > 0 && (
          <p className="text-[11px] text-white/40 font-light truncate mt-0.5">
            {item.reasons.join(" · ")}
          </p>
        )}
      </div>
      <span className={`text-lg font-light tabular-nums ${scoreColor} shrink-0`}>
        {item.score}
      </span>
    </button>
  );
}
