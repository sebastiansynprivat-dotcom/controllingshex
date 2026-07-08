import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Inbox, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import { useAuth } from "@/contexts/AuthContext";
import { shiftDate } from "@/lib/live-activity";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

type RangeKey = "today" | "7d" | "30d";
type SortKey = "incoming" | "revenue" | "efficiency";

interface Row {
  chatter_name: string;
  incoming_count: number;
  last_revenue: number;
  last_unread: number;
  updated_at: string;
}

interface LiveRow {
  chatter_name: string;
  revenue: number;
  unread_chats: number;
  updated_at: string;
}

function fmtInt(n: number) {
  return new Intl.NumberFormat("de-DE").format(Math.round(n));
}
function fmtEur(n: number) {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Math.round(n)) + " €";
}
function fmtEurDec(n: number) {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n) + " €";
}
function since(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function dateRange(range: RangeKey): { from: string; to: string } {
  const today = shiftDate();
  if (range === "today") return { from: today, to: today };
  const days = range === "7d" ? 6 : 29;
  const d = new Date(today);
  d.setDate(d.getDate() - days);
  const from = d.toISOString().slice(0, 10);
  return { from, to: today };
}

export default function Messages() {
  const { platform } = usePlatform();
  const { user } = useAuth();
  const [range, setRange] = useState<RangeKey>("today");
  const [sort, setSort] = useState<SortKey>("incoming");
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const [rows, setRows] = useState<Row[]>([]);
  const [live, setLive] = useState<Record<string, LiveRow>>({});
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [lastPushAgo, setLastPushAgo] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Nachrichten – Live-Tracking";
  }, []);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { from, to } = dateRange(range);
    const { data, error } = await supabase
      .from("chatter_incoming_stats")
      .select("chatter_name, incoming_count, last_revenue, updated_at, date")
      .eq("user_id", user.id)
      .eq("platform", platform)
      .gte("date", from)
      .lte("date", to);
    if (error) {
      toast({ title: "Fehler beim Laden", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    // Aggregate across date range per chatter
    const agg = new Map<string, Row>();
    for (const r of (data ?? []) as any[]) {
      const key = r.chatter_name as string;
      const cur = agg.get(key);
      if (cur) {
        cur.incoming_count += Number(r.incoming_count) || 0;
        cur.last_revenue += Number(r.last_revenue) || 0;
        if (new Date(r.updated_at) > new Date(cur.updated_at)) cur.updated_at = r.updated_at;
      } else {
        agg.set(key, {
          chatter_name: key,
          incoming_count: Number(r.incoming_count) || 0,
          last_revenue: Number(r.last_revenue) || 0,
          updated_at: r.updated_at,
        });
      }
    }
    setRows(Array.from(agg.values()));

    // Live snapshot (for "aktiv vor" badge)
    const today = shiftDate();
    const { data: liveData } = await supabase
      .from("chatter_history_live")
      .select("chatter_name, revenue, updated_at")
      .eq("platform", platform)
      .eq("date", today);
    const liveMap: Record<string, LiveRow> = {};
    let newest: number | null = null;
    for (const r of (liveData ?? []) as any[]) {
      const prev = liveMap[r.chatter_name];
      const t = new Date(r.updated_at).getTime();
      if (!prev || new Date(prev.updated_at).getTime() < t) {
        liveMap[r.chatter_name] = { chatter_name: r.chatter_name, revenue: Number(r.revenue) || 0, updated_at: r.updated_at };
      }
      if (newest === null || t > newest) newest = t;
    }
    setLive(liveMap);
    setLastPushAgo(newest ? new Date(newest).toISOString() : null);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Refresh every 30s
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, range, user?.id]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`incoming-stats-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chatter_incoming_stats",
          filter: `user_id=eq.${user.id}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    const cmp = (a: Row, b: Row) => {
      let va = 0, vb = 0;
      if (sort === "incoming") {
        va = a.incoming_count; vb = b.incoming_count;
      } else if (sort === "revenue") {
        va = a.last_revenue; vb = b.last_revenue;
      } else {
        va = a.incoming_count > 0 ? a.last_revenue / a.incoming_count : 0;
        vb = b.incoming_count > 0 ? b.last_revenue / b.incoming_count : 0;
      }
      return dir === "desc" ? vb - va : va - vb;
    };
    return arr.sort(cmp);
  }, [rows, sort, dir]);

  const maxRevenue = Math.max(1, ...rows.map((r) => r.last_revenue));
  const avgEff = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.last_revenue, 0);
    const msgs = rows.reduce((s, r) => s + r.incoming_count, 0);
    return msgs > 0 ? total / msgs : 0;
  }, [rows]);

  async function runBackfill() {
    setBackfilling(true);
    try {
      const { data, error } = await supabase.functions.invoke("backfill-incoming-stats");
      if (error) throw error;
      toast({ title: "Backfill fertig", description: `${(data as any)?.written ?? 0} Tage aktualisiert` });
      load();
    } catch (e: any) {
      toast({ title: "Backfill fehlgeschlagen", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <div className="min-h-screen px-4 pt-6 pb-16 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-white/[0.01] flex items-center justify-center">
            <Inbox className="h-5 w-5 text-white/60" />
          </div>
          <div>
            <h1 className="text-xs uppercase tracking-[0.28em] text-white/50 font-light">Nachrichten</h1>
          </div>
        </div>
        <p className="text-lg font-light text-white/80 leading-snug">
          Wer bekommt wie viel — und macht was daraus.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
          <SelectTrigger className="w-[130px] h-9 bg-white/[0.02] border-white/[0.06] text-xs font-light">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Heute</SelectItem>
            <SelectItem value="7d">Letzte 7 Tage</SelectItem>
            <SelectItem value="30d">Letzte 30 Tage</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-[160px] h-9 bg-white/[0.02] border-white/[0.06] text-xs font-light">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="incoming">Nachrichten</SelectItem>
            <SelectItem value="revenue">Umsatz</SelectItem>
            <SelectItem value="efficiency">€ / Nachricht</SelectItem>
          </SelectContent>
        </Select>

        <button
          onClick={() => setDir(dir === "desc" ? "asc" : "desc")}
          className="h-9 w-9 flex items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.02] text-white/70 hover:text-white hover:bg-white/[0.04] transition"
          aria-label="Sortierrichtung umkehren"
        >
          {dir === "desc" ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
        </button>

        <div className="ml-auto flex items-center gap-2 text-[11px] text-white/40 font-light">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping bg-emerald-400" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          {lastPushAgo ? `Push vor ${since(lastPushAgo)}` : "wartend"}
        </div>
      </div>

      {/* Empty state */}
      {!loading && sorted.length === 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <p className="text-sm text-white/60 font-light mb-4">
            Noch keine Nachrichten-Daten für diesen Zeitraum.
          </p>
          {range !== "today" && (
            <Button
              variant="outline"
              size="sm"
              onClick={runBackfill}
              disabled={backfilling}
              className="border-white/10 bg-white/[0.02] text-xs"
            >
              <RefreshCw className={`h-3 w-3 mr-2 ${backfilling ? "animate-spin" : ""}`} />
              Historie berechnen
            </Button>
          )}
        </div>
      )}

      {/* Rows */}
      <div className="space-y-3">
        {sorted.map((r, idx) => {
          const eff = r.incoming_count > 0 ? r.last_revenue / r.incoming_count : 0;
          const barPct = Math.round((r.last_revenue / maxRevenue) * 100);
          const efficiencyTone =
            eff >= avgEff * 1.15
              ? "from-emerald-400/70 to-emerald-500/40"
              : eff >= avgEff * 0.7
                ? "from-amber-300/60 to-amber-500/30"
                : "from-rose-400/60 to-rose-500/30";
          const effText =
            eff >= avgEff * 1.15
              ? "text-emerald-300"
              : eff >= avgEff * 0.7
                ? "text-amber-300"
                : "text-rose-300";
          const liveRow = live[r.chatter_name];
          const liveAgo = liveRow ? since(liveRow.updated_at) : null;
          const rank = idx + 1;
          const rankTone = rank <= 3 ? "gold-text" : "text-white/30";

          return (
            <div
              key={r.chatter_name}
              className="group relative rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-white/[0.01] p-5 hover:border-white/[0.12] hover:from-white/[0.05] transition-all duration-300"
            >
              <div className="flex items-baseline justify-between mb-2">
                <div className="flex items-baseline gap-3">
                  <span className={`text-2xl font-extralight tabular-nums ${rankTone}`}>
                    #{rank}
                  </span>
                  <span className="text-sm uppercase tracking-[0.22em] font-light text-white/85">
                    {r.chatter_name}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-lg font-light text-white/90 tabular-nums">
                    ~{fmtInt(r.incoming_count)} <span className="text-[10px] text-white/40 uppercase tracking-widest">msg</span>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="relative h-1.5 rounded-full bg-white/[0.04] overflow-hidden mb-3">
                <div
                  className={`absolute inset-y-0 left-0 bg-gradient-to-r ${efficiencyTone} rounded-full transition-all duration-700`}
                  style={{ width: `${barPct}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 font-light">
                  <span className={`${effText} tabular-nums`}>{fmtEurDec(eff)}/msg</span>
                  <span className="text-white/25">·</span>
                  <span className="text-white/50 tabular-nums">{fmtEur(r.last_revenue)}</span>
                </div>
                <div className="flex items-center gap-1.5 text-white/40 font-light">
                  {liveAgo ? (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                      aktiv vor {liveAgo}
                    </>
                  ) : (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
                      offline
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Backfill hint at the bottom */}
      {sorted.length > 0 && range !== "today" && (
        <div className="mt-8 flex items-center justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={runBackfill}
            disabled={backfilling}
            className="text-[11px] text-white/40 hover:text-white/70 font-light"
          >
            <RefreshCw className={`h-3 w-3 mr-2 ${backfilling ? "animate-spin" : ""}`} />
            Historie neu berechnen
          </Button>
        </div>
      )}
    </div>
  );
}
