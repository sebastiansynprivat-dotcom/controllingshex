import { useEffect, useMemo, useState } from "react";
import { Search, AlertTriangle, ChevronDown, ChevronRight, TrendingDown, TrendingUp, Clock, Moon, Sparkles } from "lucide-react";
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
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [strongOpen, setStrongOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<{ name: string; platform: string } | null>(null);

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
      const av = a.expectedRevenueByNow + (a.live ? Number(a.live.revenue) : 0);
      const bv = b.expectedRevenueByNow + (b.live ? Number(b.live.revenue) : 0);
      return bv - av;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, profiles, tick]);

  const visible = useMemo(() => {
    return allStatuses.filter((s) => {
      if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === "active" && !s.isActiveToday) return false;
      if (filter === "weak" && s.status !== "active_weak") return false;
      if (filter === "inactive" && s.status !== "inactive") return false;
      return true;
    });
  }, [allStatuses, search, filter]);

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
  const lastSync = rows.length ? Math.min(...rows.map((r) => secondsSince(r.updated_at))) : null;
  const totalCount = allStatuses.length;
  const activePct = totalCount > 0 ? Math.round((activeTodayCount / totalCount) * 100) : 0;
  const sumUnread = rows.reduce((s, r) => s + (r.unread_chats ?? 0), 0);
  const sumDms = rows.reduce((s, r) => s + (r.mass_dms ?? 0), 0);

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

        {/* Mega-KPI Card */}
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-white/[0.04] via-white/[0.015] to-transparent p-6 shadow-[0_20px_60px_-20px_hsl(40_45%_45%/0.18),inset_0_1px_0_hsl(0_0%_100%/0.06)]">
          {/* gold glow */}
          <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[hsl(40_50%_55%/0.12)] blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -left-20 h-72 w-72 rounded-full bg-[hsl(40_40%_50%/0.06)] blur-3xl" />

          <div className="relative">
            <div className="text-[10px] tracking-[0.32em] uppercase text-white/40 font-light">
              Revenue heute
            </div>
            <div className="mt-2 flex items-end gap-3">
              <div className="font-extralight tabular-nums leading-none gold-text text-[56px] sm:text-[64px] tracking-tight">
                {new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(sumRevenue)}
                <span className="text-2xl font-light text-white/40 ml-1">€</span>
              </div>
            </div>

            {/* Pacing bar */}
            <div className="mt-5 space-y-2">
              <div className="flex items-center justify-between text-[10px] tracking-[0.18em] uppercase">
                <span className="text-white/40 font-light">Pacing vs. Erwartung</span>
                <span className={`tabular-nums font-light ${
                  sumDelta >= 0 ? "text-emerald-300/90" : "text-rose-300/90"
                }`}>
                  {sumDelta >= 0 ? "+" : ""}{fmtEur(sumDelta)} · {pacingPct}%
                </span>
              </div>
              <div className="relative h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${
                    sumDelta >= 0
                      ? "bg-gradient-to-r from-emerald-400/60 to-emerald-300/80"
                      : "bg-gradient-to-r from-rose-500/50 to-amber-300/70"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(4, pacingPct))}%` }}
                />
                {/* 100% marker */}
                <div className="absolute inset-y-0 left-full w-px -translate-x-px bg-white/30" />
              </div>
              <div className="flex items-center justify-between text-[10px] text-white/30 tabular-nums">
                <span>0</span>
                <span>Erwartet jetzt: {fmtEur(expectedSum)}</span>
              </div>
            </div>

            {/* Mini stats row */}
            <div className="mt-6 grid grid-cols-3 gap-3 pt-5 border-t border-white/[0.05]">
              <MiniStat label="Aktiv" value={String(activeTodayCount)} sub={`/${allStatuses.length}`} tone="ok" />
              <MiniStat label="Unter Pacing" value={String(buckets.weak.length)} tone={buckets.weak.length > 0 ? "warn" : undefined} />
              <MiniStat label="Inaktiv" value={String(inactiveCount)} tone={inactiveCount > 0 ? "dim" : undefined} />
            </div>
          </div>
        </div>

        {/* Insight chips: what matters now */}
        <div className="grid gap-2.5 sm:grid-cols-2">
          {topPerformer && (
            <InsightCard
              icon={Sparkles}
              tone="gold"
              label="Top heute"
              title={topPerformer.name}
              detail={`${fmtEur(Number(topPerformer.live!.revenue))} · ${topPerformer.reason}`}
              onClick={() => setSelected({ name: topPerformer.name, platform: (topPerformer.live as any)?.platform ?? platform })}
            />
          )}
          {lostPotential >= 20 && (
            <InsightCard
              icon={TrendingDown}
              tone="rose"
              label="Lost Potential"
              title={`−${fmtEur(lostPotential)}`}
              detail={`${buckets.weak.length} Chatter unter Pacing · jetzt eingreifen`}
              onClick={() => setFilter("weak")}
            />
          )}
        </div>
      </header>

      {/* ─── FILTER ──────────────────────────────────── */}
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

      {/* ─── CONTENT ─────────────────────────────────── */}
      {loading ? (
        <p className="text-center text-sm text-white/30 py-16 font-light tracking-wide">Lade Live-Daten…</p>
      ) : visible.length === 0 ? (
        <p className="text-center text-sm text-white/30 py-16 font-light tracking-wide">Keine Chatter passen zum Filter.</p>
      ) : filter !== "all" ? (
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
  value: string;
  sub?: string;
  tone?: "ok" | "warn" | "dim";
}) {
  const valueColor =
    tone === "warn" ? "text-rose-200/95" : tone === "dim" ? "text-white/55" : "text-white/95";
  return (
    <div>
      <div className="text-[9px] tracking-[0.22em] uppercase text-white/35 font-light">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-xl font-extralight tabular-nums ${valueColor}`}>{value}</span>
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

  return (
    <button
      onClick={() => onSelect({ name: item.name, platform: (item.live as any)?.platform ?? "" })}
      className={`group relative w-full rounded-2xl border px-4 py-3.5 text-left transition-all duration-300 hover:translate-y-[-1px] backdrop-blur-xl ${cardTone}`}
    >
      <div className="flex items-center gap-3.5">
        {/* Avatar w/ status dot */}
        <div className="relative shrink-0">
          <div className={`h-10 w-10 rounded-full border flex items-center justify-center text-[11px] font-light tracking-wider text-white/75 bg-gradient-to-br from-white/[0.06] to-white/[0.01] ${avatarRing}`}>
            {initials(item.name)}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
            {online && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/50 opacity-75 animate-ping" />
            )}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ring-2 ring-[hsl(240_6%_4%)] ${dotColor}`} />
          </span>
        </div>

        {/* Main */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[14px] text-white/95 font-light tracking-wide truncate">
                {item.name}
              </span>
              {sec !== null && (
                <span className="text-[10px] text-white/25 tracking-wider shrink-0">
                  · {relTime(sec)}
                </span>
              )}
            </div>
            {item.live && (
              <span className="text-[14px] tabular-nums text-white/95 font-light shrink-0">
                {fmtEur(Number(item.live.revenue))}
              </span>
            )}
          </div>

          {/* Pacing bar (only if we have expectation and chatter is active) */}
          {pacingPct !== null && expected >= 20 && item.isActiveToday && (
            <div className="mt-2 relative h-[3px] rounded-full bg-white/[0.05] overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${
                  pacingPct >= 95
                    ? "bg-gradient-to-r from-emerald-400/60 to-emerald-300/80"
                    : pacingPct >= 60
                    ? "bg-gradient-to-r from-amber-300/60 to-amber-200/80"
                    : "bg-gradient-to-r from-rose-500/60 to-rose-300/80"
                }`}
                style={{ width: `${Math.max(3, pacingPct)}%` }}
              />
            </div>
          )}

          {/* Bottom meta row */}
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <span className={`text-[11px] font-light tracking-wide truncate ${reasonColor}`}>
              {item.reason}
            </span>
            {item.live && (
              <div className="flex items-center gap-2.5 text-[10px] tabular-nums text-white/40 shrink-0">
                <span className={(item.live.unread_chats ?? 0) >= 10 ? "text-rose-200/90" : ""}>
                  {item.live.unread_chats}<span className="text-white/25 ml-0.5">u</span>
                </span>
                <span className="text-white/15">·</span>
                <span>
                  {item.live.mass_dms}<span className="text-white/25 ml-0.5">dm</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
