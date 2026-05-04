import { useEffect, useMemo, useState } from "react";
import { Search, AlertTriangle, ChevronDown, ChevronRight, ArrowUpRight, Flame, Clock, Inbox, EuroIcon } from "lucide-react";
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

type FilterKey = "all" | "escalation" | "lost" | "inactive";

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

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

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

  const scored: ScoredChatter[] = useMemo(() => {
    const now = new Date();
    return rows
      .map((r) => computeScore(r, avgs.get(r.chatter_name.trim().toLowerCase()), now))
      .sort((a, b) => b.score - a.score);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, avgs, tick]);

  const visible = useMemo(() => {
    return scored.filter((s) => {
      if (search && !s.row.chatter_name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === "escalation" && (s.row.oldest_chat ?? 0) < 1) return false;
      if (filter === "lost" && s.potentialLoss < 20) return false;
      return true;
    });
  }, [scored, search, filter]);

  const buckets = useMemo(
    () => ({
      now: visible.filter((s) => s.bucket === "now"),
      watch: visible.filter((s) => s.bucket === "watch"),
      running: visible.filter((s) => s.bucket === "running"),
    }),
    [visible],
  );

  const sumRevenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const sumUnread = rows.reduce((s, r) => s + (r.unread_chats ?? 0), 0);
  const activeCount = rows.filter((r) => secondsSince(r.updated_at) < 15 * 60).length;
  const lastSync = rows.length ? Math.min(...rows.map((r) => secondsSince(r.updated_at))) : null;

  const notStarted = useMemo(() => {
    const out: { name: string; expected: number }[] = [];
    avgs.forEach((avg, name) => {
      if (avg.avgRevenue < 30) return;
      const liveRow = rows.find((r) => r.chatter_name.trim().toLowerCase() === name);
      const todayRev = liveRow ? Number(liveRow.revenue) || 0 : 0;
      const hour = new Date().getHours() + new Date().getMinutes() / 60;
      const dayProgress = Math.max(0, Math.min(1, (hour - 6) / 18));
      const expected = avg.avgRevenue * dayProgress;
      if (!liveRow || todayRev < expected * 0.2) {
        if (expected >= 30) out.push({ name, expected });
      }
    });
    return out.sort((a, b) => b.expected - a.expected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, avgs, tick]);

  const hotStreakCount = scored.filter((s) => s.hotStreak).length;

  return (
    <div className="mx-auto w-full max-w-[860px] space-y-10 pb-20">
      {/* Hero header */}
      <header className="space-y-6 pt-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/70 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_hsl(var(--primary)/0.5)]" />
            </span>
            <div>
              <h1 className="text-xs font-light tracking-[0.28em] uppercase gold-text-subtle">
                Live Tracking
              </h1>
              <p className="text-[10px] text-white/30 tracking-[0.2em] uppercase mt-0.5">
                {platform} · {lastSync !== null ? `Sync vor ${relTime(lastSync)}` : "—"}
              </p>
            </div>
          </div>
          <div className="flex items-center">
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
                className="text-white/40 hover:text-white/80 p-2 rounded-full hover:bg-white/[0.04] transition-colors"
                aria-label="Suchen"
              >
                <Search className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat icon={EuroIcon} label="Revenue heute" value={fmtEur(sumRevenue)} accent />
          <Stat icon={Flame} label="Aktiv jetzt" value={String(activeCount)} sub={`von ${rows.length}`} />
          <Stat icon={Inbox} label="Σ Ungelesen" value={String(sumUnread)} />
          <Stat icon={Clock} label="Sofort handeln" value={String(buckets.now.length)} tone={buckets.now.length > 0 ? "warn" : undefined} />
        </div>
      </header>

      {/* Smart banner */}
      {notStarted.length > 0 && (
        <div className="premium-card rounded-2xl px-5 py-4 border border-amber-300/15">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-amber-300/10 border border-amber-300/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4 text-amber-200/90" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-light text-white/85">
                <span className="text-amber-100/95">{notStarted.length} Top-Chatter</span> heute noch nicht am Start
              </p>
              <p className="text-xs text-white/45 font-light mt-0.5 tracking-wide">
                ~{fmtEur(notStarted.reduce((s, n) => s + n.expected, 0))} erwartetes Potenzial offen
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Filter pills */}
      <div className="flex items-center gap-2">
        {(["all", "escalation", "lost"] as FilterKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-4 py-1.5 rounded-full text-[11px] font-light tracking-[0.12em] uppercase transition-all border ${
              filter === k
                ? "bg-gradient-to-b from-white/[0.08] to-white/[0.02] text-white/95 border-white/15 shadow-[0_2px_12px_-4px_hsl(40_45%_55%/0.15)]"
                : "text-white/40 border-white/[0.06] hover:text-white/75 hover:border-white/12"
            }`}
          >
            {k === "all" ? "Alle" : k === "escalation" ? "Eskalation" : "Lost Potential"}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <p className="text-center text-sm text-white/30 py-16 font-light tracking-wide">Lade Live-Daten…</p>
      ) : visible.length === 0 ? (
        <p className="text-center text-sm text-white/30 py-16 font-light tracking-wide">Keine Chatter heute aktiv.</p>
      ) : (
        <div className="space-y-12">
          {buckets.now.length > 0 && <Bucket label="Sofort handeln" tone="urgent" items={buckets.now} onSelect={setSelected} />}
          {buckets.watch.length > 0 && <Bucket label="Beobachten" tone="watch" items={buckets.watch} onSelect={setSelected} />}
          {buckets.running.length > 0 && (
            <div>
              <button
                onClick={() => setRunningOpen((o) => !o)}
                className="w-full flex items-center justify-between text-[10px] uppercase tracking-[0.28em] text-white/30 hover:text-white/55 transition-colors py-3 border-t border-white/[0.04]"
              >
                <span className="flex items-center gap-2">
                  {runningOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {buckets.running.length} laufen sauber
                </span>
                {hotStreakCount > 0 && (
                  <span className="flex items-center gap-1.5 text-emerald-300/70 normal-case tracking-normal text-[11px]">
                    <ArrowUpRight className="h-3 w-3" /> {hotStreakCount} hot
                  </span>
                )}
              </button>
              {runningOpen && (
                <div className="mt-4">
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

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  tone,
}: {
  icon: typeof Flame;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  tone?: "warn";
}) {
  return (
    <div className="premium-stat rounded-xl px-4 py-3.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/35 font-light">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={`text-2xl font-extralight tabular-nums ${
            tone === "warn"
              ? "text-rose-200"
              : accent
              ? "gold-text"
              : "text-white/95"
          }`}
        >
          {value}
        </span>
        {sub && <span className="text-[10px] text-white/35 tracking-wide">{sub}</span>}
      </div>
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
        <div className="flex items-center gap-3 mb-4">
          <span
            className={`text-[10px] uppercase tracking-[0.28em] font-light ${
              tone === "urgent" ? "text-rose-300/85" : "text-amber-200/75"
            }`}
          >
            {label}
          </span>
          <span className={`flex-1 h-px ${tone === "urgent" ? "bg-gradient-to-r from-rose-400/25 to-transparent" : "bg-gradient-to-r from-amber-300/20 to-transparent"}`} />
          <span className="text-[10px] tabular-nums text-white/30 tracking-wider">{items.length}</span>
        </div>
      )}
      <div className="space-y-2">
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

  // Score visual: ring-style number with tone-based color
  const scoreColor =
    tone === "urgent"
      ? "text-rose-200"
      : tone === "watch"
      ? "text-amber-100"
      : "text-white/55";
  const scoreRing =
    tone === "urgent"
      ? "border-rose-400/30 bg-gradient-to-b from-rose-500/[0.08] to-rose-500/[0.02] shadow-[0_0_24px_-8px_hsl(0_70%_60%/0.35)]"
      : tone === "watch"
      ? "border-amber-300/25 bg-gradient-to-b from-amber-400/[0.06] to-amber-400/[0.01]"
      : "border-white/[0.08] bg-white/[0.02]";

  const cardBase = "group relative w-full flex items-center gap-4 rounded-2xl px-5 py-4 text-left transition-all duration-300 border backdrop-blur-xl";
  const cardTone =
    tone === "urgent"
      ? "premium-card border-rose-400/12 hover:border-rose-400/25"
      : tone === "watch"
      ? "premium-card border-amber-300/10 hover:border-amber-300/22"
      : "border-white/[0.04] bg-white/[0.012] hover:bg-white/[0.025] hover:border-white/[0.08]";

  return (
    <button
      onClick={() => onSelect({ name: item.row.chatter_name, platform: (item.row as any).platform })}
      className={`${cardBase} ${cardTone} hover:translate-y-[-1px]`}
    >
      {/* Status dot */}
      <span className="relative flex h-2 w-2 shrink-0">
        {online && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/50 opacity-75 animate-ping" />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${
            online ? "bg-emerald-400" : offline ? "bg-white/15" : "bg-amber-300/70"
          }`}
        />
      </span>

      {/* Name + reasons */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[15px] text-white/95 font-light tracking-wide truncate">
            {item.row.chatter_name}
          </span>
          {item.hotStreak && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-300/85 bg-emerald-400/10 border border-emerald-400/20 rounded-full px-2 py-0.5 tracking-wider uppercase">
              <ArrowUpRight className="h-2.5 w-2.5" /> Hot
            </span>
          )}
          <span className="text-[10px] text-white/25 tracking-wider">
            · vor {relTime(sec)}
          </span>
        </div>
        {item.reasons.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {item.reasons.map((r, i) => (
              <span
                key={i}
                className={`text-[11px] font-light tracking-wide ${
                  i === 0
                    ? tone === "urgent"
                      ? "text-rose-200/90"
                      : tone === "watch"
                      ? "text-amber-100/85"
                      : "text-white/55"
                    : "text-white/40"
                }`}
              >
                {i > 0 && <span className="text-white/15 mr-2">·</span>}
                {r}
              </span>
            ))}
          </div>
        )}
        {/* Live mini-metrics */}
        <div className="mt-2 flex items-center gap-4 text-[10px] text-white/30 tracking-wider uppercase font-light">
          <span><span className="text-white/50 tabular-nums">{fmtEur(Number(item.row.revenue))}</span> heute</span>
          <span><span className="text-white/50 tabular-nums">{item.row.unread_chats}</span> ungelesen</span>
          <span><span className="text-white/50 tabular-nums">{item.row.mass_dms}</span> mass-dms</span>
        </div>
      </div>

      {/* Score badge */}
      <div className={`flex flex-col items-center justify-center h-14 w-14 rounded-2xl border shrink-0 ${scoreRing}`}>
        <span className={`text-xl font-extralight tabular-nums leading-none ${scoreColor}`}>
          {item.score}
        </span>
        <span className="text-[8px] uppercase tracking-[0.2em] text-white/30 mt-1">Score</span>
      </div>
    </button>
  );
}
