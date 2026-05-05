import { useEffect, useMemo, useState } from "react";
import { Search, AlertTriangle, ChevronDown, ChevronRight, Flame, Clock, Inbox, EuroIcon, Moon, TrendingDown, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { Input } from "@/components/ui/input";
import { buildProfile, computeStatus, type ChatterProfile, type ChatterStatus, type LiveRow as LiveRowLite, type HistoryDay } from "@/lib/live-activity";

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

export default function LiveTracking() {
  const { platform } = usePlatform();
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ChatterProfile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [strongOpen, setStrongOpen] = useState(true);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<{ name: string; platform: string } | null>(null);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
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
        byName.forEach((days, key) => {
          // use the original casing from first record where possible
          map.set(key, buildProfile(key, days));
        });
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

  // Display-name lookup (best casing): from live rows first, else from history (use key)
  const displayNameFor = (key: string): string => {
    const live = rows.find((r) => normName(r.chatter_name) === key);
    if (live) return live.chatter_name;
    // capitalize words
    return key
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  };

  const allStatuses: ChatterStatus[] = useMemo(() => {
    const now = new Date();
    const keys = new Set<string>();
    rows.forEach((r) => keys.add(normName(r.chatter_name)));
    profiles.forEach((p) => {
      // only include known chatters with some history
      if (p.daysObserved >= 1 && p.avgRevenue >= 5) keys.add(p.name);
    });
    const out: ChatterStatus[] = [];
    keys.forEach((key) => {
      const live = rows.find((r) => normName(r.chatter_name) === key) ?? null;
      const profile = profiles.get(key) ?? null;
      const s = computeStatus(displayNameFor(key), live, profile, now);
      out.push(s);
    });
    // Sort: weak/inactive first by potential, then strong by revenue
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
      // within same bucket: by expected revenue / today revenue desc
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

  const sumRevenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const sumUnread = rows.reduce((s, r) => s + (r.unread_chats ?? 0), 0);
  const activeTodayCount = allStatuses.filter((s) => s.isActiveToday).length;
  const inactiveCount = allStatuses.filter((s) => s.status === "inactive").length;
  const lastSync = rows.length ? Math.min(...rows.map((r) => secondsSince(r.updated_at))) : null;

  const counts: Record<FilterKey, number> = {
    all: allStatuses.length,
    active: activeTodayCount,
    weak: allStatuses.filter((s) => s.status === "active_weak").length,
    inactive: inactiveCount,
  };

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
          <Stat icon={Flame} label="Aktiv heute" value={String(activeTodayCount)} sub={`von ${allStatuses.length}`} />
          <Stat icon={Inbox} label="Σ Ungelesen" value={String(sumUnread)} />
          <Stat icon={Moon} label="Inaktiv heute" value={String(inactiveCount)} tone={inactiveCount > 0 ? "warn" : undefined} />
        </div>
      </header>

      {/* Smart banner */}
      {buckets.weak.length > 0 && filter === "all" && (
        <div className="premium-card rounded-2xl px-5 py-4 border border-amber-300/15">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-amber-300/10 border border-amber-300/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4 text-amber-200/90" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-light text-white/85">
                <span className="text-amber-100/95">{buckets.weak.length} Chatter</span> gerade unter Pacing
              </p>
              <p className="text-xs text-white/45 font-light mt-0.5 tracking-wide">
                ~{fmtEur(buckets.weak.reduce((s, n) => s + Math.max(0, -n.pacingDelta), 0))} unter erwartet · jetzt motivieren
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "active", "weak", "inactive"] as FilterKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-4 py-1.5 rounded-full text-[11px] font-light tracking-[0.12em] uppercase transition-all border ${
              filter === k
                ? "bg-gradient-to-b from-white/[0.08] to-white/[0.02] text-white/95 border-white/15 shadow-[0_2px_12px_-4px_hsl(40_45%_55%/0.15)]"
                : "text-white/40 border-white/[0.06] hover:text-white/75 hover:border-white/12"
            }`}
          >
            {k === "all"
              ? `Alle · ${counts.all}`
              : k === "active"
              ? `Aktiv heute · ${counts.active}`
              : k === "weak"
              ? `Unter Pacing · ${counts.weak}`
              : `Inaktiv heute · ${counts.inactive}`}
          </button>
        ))}
      </div>

      {/* Content */}
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
        <div className="space-y-12">
          {buckets.weak.length > 0 && (
            <Bucket label="Unter Pacing" tone="urgent" icon={TrendingDown} items={buckets.weak} onSelect={setSelected} />
          )}
          {buckets.idle.length > 0 && (
            <Bucket label="Aktiv heute · gerade Pause" tone="watch" icon={Clock} items={buckets.idle} onSelect={setSelected} />
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
                <span className="flex items-center gap-2">
                  {strongOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {buckets.strong.length} laufen sauber
                </span>
                <CheckCircle2 className="h-3 w-3 text-emerald-300/60" />
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
  icon: Icon,
  items,
  onSelect,
}: {
  label: string;
  tone: "urgent" | "watch" | "dim";
  icon: typeof Flame;
  items: ChatterStatus[];
  onSelect: (s: { name: string; platform: string }) => void;
}) {
  const labelColor =
    tone === "urgent" ? "text-rose-300/85" : tone === "watch" ? "text-amber-200/75" : "text-white/40";
  const lineGrad =
    tone === "urgent"
      ? "bg-gradient-to-r from-rose-400/25 to-transparent"
      : tone === "watch"
      ? "bg-gradient-to-r from-amber-300/20 to-transparent"
      : "bg-gradient-to-r from-white/15 to-transparent";

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Icon className={`h-3 w-3 ${labelColor}`} />
        <span className={`text-[10px] uppercase tracking-[0.28em] font-light ${labelColor}`}>{label}</span>
        <span className={`flex-1 h-px ${lineGrad}`} />
        <span className="text-[10px] tabular-nums text-white/30 tracking-wider">{items.length}</span>
      </div>
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

  const cardBase =
    "group relative w-full flex items-center gap-4 rounded-2xl px-5 py-4 text-left transition-all duration-300 border backdrop-blur-xl hover:translate-y-[-1px]";
  const cardTone =
    tone === "urgent"
      ? "premium-card border-rose-400/12 hover:border-rose-400/25"
      : tone === "watch"
      ? "premium-card border-amber-300/10 hover:border-amber-300/22"
      : tone === "dim"
      ? "border-white/[0.04] bg-white/[0.012] hover:bg-white/[0.025] hover:border-white/[0.08] opacity-80"
      : "border-white/[0.04] bg-white/[0.012] hover:bg-white/[0.025] hover:border-white/[0.08]";

  const reasonColor =
    tone === "urgent"
      ? "text-rose-200/90"
      : tone === "watch"
      ? "text-amber-100/85"
      : tone === "dim"
      ? "text-white/45"
      : "text-white/55";

  const dotColor = !item.isActiveToday
    ? "bg-white/15"
    : online
    ? "bg-emerald-400"
    : recently
    ? "bg-amber-300/70"
    : "bg-white/25";

  return (
    <button
      onClick={() => onSelect({ name: item.name, platform: (item.live as any)?.platform ?? "" })}
      className={`${cardBase} ${cardTone}`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {online && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/50 opacity-75 animate-ping" />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dotColor}`} />
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[15px] text-white/95 font-light tracking-wide truncate">
              {item.name}
            </span>
            {sec !== null && (
              <span className="text-[10px] text-white/25 tracking-wider shrink-0">
                · vor {relTime(sec)}
              </span>
            )}
          </div>
          {item.live && (
            <div className="flex items-center gap-3 text-[11px] tabular-nums shrink-0">
              <span className="text-white/80 font-light">{fmtEur(Number(item.live.revenue))}</span>
              <span className="text-white/15">·</span>
              <span
                className={`font-light ${
                  (item.live.unread_chats ?? 0) >= 10 ? "text-rose-200/90" : "text-white/55"
                }`}
              >
                {item.live.unread_chats}{" "}
                <span className="text-white/30 text-[10px] uppercase tracking-wider">ungel.</span>
              </span>
              <span className="text-white/15">·</span>
              <span className="text-white/55 font-light">
                {item.live.mass_dms}{" "}
                <span className="text-white/30 text-[10px] uppercase tracking-wider">dm</span>
              </span>
            </div>
          )}
        </div>

        {item.reason && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`text-[11px] font-light tracking-wide ${reasonColor}`}>
              {item.reason}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}
