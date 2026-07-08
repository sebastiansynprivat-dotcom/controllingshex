import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Inbox, RefreshCw, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import { useAuth } from "@/contexts/AuthContext";
import { shiftDate } from "@/lib/live-activity";
import {
  loadActiveChatterNames,
  loadActiveChatterModels,
  normalizeChatterName,
  normalizeAccountName,
} from "@/lib/active-chatters";
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
type FitBucket = "overloaded" | "underused" | "fit" | null;

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

interface ModelSplitRow {
  account: string;
  revenue: number;
  messages: number;
  days: number;
}

interface WasteRow {
  chatter_name: string;
  account: string;
  messages: number;
  revenue: number;
  eff: number;
  latestDate: string;
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

// Simple SVG sparkline
function Sparkline({ points, tone }: { points: number[]; tone: string }) {
  if (points.length < 2) return <div className="w-[60px] h-5" />;
  const max = Math.max(...points, 0.0001);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const w = 60, h = 20;
  const step = w / (points.length - 1);
  const path = points
    .map((v, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="opacity-80">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className={tone} />
    </svg>
  );
}

export default function Messages() {
  const { platform } = usePlatform();
  const { user } = useAuth();
  const [range, setRange] = useState<RangeKey>("today");
  const [sort, setSort] = useState<SortKey>("incoming");
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const [rows, setRows] = useState<Row[]>([]);
  const [live, setLive] = useState<Record<string, LiveRow>>({});
  const [sparkData, setSparkData] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [lastPushAgo, setLastPushAgo] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [modelSplits, setModelSplits] = useState<Record<string, ModelSplitRow[]>>({});
  const [loadingSplit, setLoadingSplit] = useState<Set<string>>(new Set());
  const [wasted, setWasted] = useState<WasteRow[]>([]);
  const [wasteDismissals, setWasteDismissals] = useState<Record<string, string>>({});




  useEffect(() => {
    document.title = "Nachrichten – Live-Tracking";
  }, []);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { from, to } = dateRange(range);

    // Active-Chatter-Filter (Chatter aus letztem Report) + aktuelle Chatter×Model-Zuordnung.
    // Wenn noch kein Report existiert → null → nicht filtern (Nutzer sieht sonst leere Listen).
    const [activeNames, activeChatterModels] = await Promise.all([
      loadActiveChatterNames(platform),
      loadActiveChatterModels(platform),
    ]);
    const isActiveChatter = (name: string) =>
      activeNames === null || activeNames.has(normalizeChatterName(name));
    const isActivePair = (name: string, account: string) => {
      if (activeChatterModels === null) return true;
      const set = activeChatterModels.get(normalizeChatterName(name));
      if (!set) return false;
      return set.has(normalizeAccountName(account));
    };

    const { data, error } = await supabase
      .from("chatter_incoming_stats")
      .select("chatter_name, incoming_count, last_revenue, last_unread, updated_at, date")
      .eq("user_id", user.id)
      .eq("platform", platform)
      .gte("date", from)
      .lte("date", to);
    if (error) {
      toast({ title: "Fehler beim Laden", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const agg = new Map<string, Row>();
    for (const r of (data ?? []) as any[]) {
      const key = r.chatter_name as string;
      if (!isActiveChatter(key)) continue;
      const cur = agg.get(key);
      const readsPlusUnread =
        (Number(r.incoming_count) || 0) + Math.max(0, Number(r.last_unread) || 0);
      if (cur) {
        cur.incoming_count += readsPlusUnread;
        cur.last_revenue += Number(r.last_revenue) || 0;
        if (new Date(r.updated_at) > new Date(cur.updated_at)) cur.updated_at = r.updated_at;
      } else {
        agg.set(key, {
          chatter_name: key,
          incoming_count: readsPlusUnread,
          last_revenue: Number(r.last_revenue) || 0,
          last_unread: Number(r.last_unread) || 0,
          updated_at: r.updated_at,
        });
      }
    }

    const today = shiftDate();
    const { data: liveData } = await supabase
      .from("chatter_history_live")
      .select("chatter_name, revenue, unread_chats, updated_at")
      .eq("platform", platform)
      .eq("date", today);
    const liveMap: Record<string, LiveRow> = {};
    let newest: number | null = null;
    for (const r of (liveData ?? []) as any[]) {
      const prev = liveMap[r.chatter_name];
      const t = new Date(r.updated_at).getTime();
      if (!prev || new Date(prev.updated_at).getTime() < t) {
        liveMap[r.chatter_name] = {
          chatter_name: r.chatter_name,
          revenue: Number(r.revenue) || 0,
          unread_chats: Number(r.unread_chats) || 0,
          updated_at: r.updated_at,
        };
      }
      if (newest === null || t > newest) newest = t;
    }

    if (range === "today") {
      for (const [name, row] of agg) {
        const liveUnread = liveMap[name]?.unread_chats ?? 0;
        row.incoming_count = row.incoming_count - row.last_unread + liveUnread;
        row.last_unread = liveUnread;
      }
    }

    setRows(Array.from(agg.values()));
    setLive(liveMap);
    setLastPushAgo(newest ? new Date(newest).toISOString() : null);

    // Sparkline data — always last 7 days regardless of range
    const sparkFrom = new Date(today);
    sparkFrom.setDate(sparkFrom.getDate() - 6);
    const sparkFromStr = sparkFrom.toISOString().slice(0, 10);
    const { data: sparkRaw } = await supabase
      .from("chatter_incoming_stats")
      .select("chatter_name, date, incoming_count, last_unread, last_revenue")
      .eq("user_id", user.id)
      .eq("platform", platform)
      .gte("date", sparkFromStr)
      .lte("date", today);
    const perChatterDay = new Map<string, Map<string, { msg: number; rev: number }>>();
    for (const r of (sparkRaw ?? []) as any[]) {
      const name = r.chatter_name as string;
      const d = r.date as string;
      const msg = (Number(r.incoming_count) || 0) + Math.max(0, Number(r.last_unread) || 0);
      const rev = Number(r.last_revenue) || 0;
      if (!perChatterDay.has(name)) perChatterDay.set(name, new Map());
      const dayMap = perChatterDay.get(name)!;
      const cur = dayMap.get(d) ?? { msg: 0, rev: 0 };
      cur.msg += msg;
      cur.rev += rev;
      dayMap.set(d, cur);
    }
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    const sparks: Record<string, number[]> = {};
    for (const [name, dayMap] of perChatterDay) {
      sparks[name] = days.map((d) => {
        const c = dayMap.get(d);
        if (!c || c.msg <= 0) return 0;
        return c.rev / c.msg;
      });
    }
    setSparkData(sparks);

    // Bulk-load model split for every chatter in range (always expanded)
    const names = Array.from(agg.keys());
    if (names.length > 0) {
      const { data: splitRaw } = await supabase
        .from("chatter_history")
        .select("chatter_name, account, revenue_today, open_chats")
        .eq("user_id", user.id)
        .eq("platform", platform)
        .in("chatter_name", names)
        .gte("analysis_date", from)
        .lte("analysis_date", to);
      const perChatter = new Map<string, Map<string, ModelSplitRow>>();
      for (const r of (splitRaw ?? []) as any[]) {
        const name = r.chatter_name as string;
        const acc = (r.account as string) || "—";
        // Nur (Chatter × Model)-Paare zeigen, die im letzten Report noch bestehen.
        if (acc !== "—" && !isActivePair(name, acc)) continue;
        if (!perChatter.has(name)) perChatter.set(name, new Map());
        const m = perChatter.get(name)!;
        const cur = m.get(acc) ?? { account: acc, revenue: 0, messages: 0, days: 0 };
        cur.revenue += Number(r.revenue_today) || 0;
        cur.messages += Number(r.open_chats) || 0;
        cur.days += 1;
        m.set(acc, cur);
      }
      const splits: Record<string, ModelSplitRow[]> = {};
      for (const [name, m] of perChatter) {
        splits[name] = Array.from(m.values()).sort(
          (a, b) => (b.messages - a.messages) || (b.revenue - a.revenue),
        );
      }
      setModelSplits(splits);
    }

    // Potenzial verschenkt: last 30 days, chatter × account combinations
    const wasteFrom = new Date(today);
    wasteFrom.setDate(wasteFrom.getDate() - 29);
    const wasteFromStr = wasteFrom.toISOString().slice(0, 10);
    const { data: wasteRaw } = await supabase
      .from("chatter_history")
      .select("chatter_name, account, revenue_today, open_chats, analysis_date")
      .eq("user_id", user.id)
      .eq("platform", platform)
      .gte("analysis_date", wasteFromStr)
      .lte("analysis_date", today);
    const combos = new Map<string, WasteRow>();
    for (const r of (wasteRaw ?? []) as any[]) {
      const name = (r.chatter_name as string) || "";
      const acc = (r.account as string) || "";
      if (!name || !acc) continue;
      // Nur aktuelle Chatter×Model-Paare (aus letztem Report) berücksichtigen —
      // ehemalige Zuweisungen sind für "Potenzial verschenkt" nicht mehr relevant.
      if (!isActivePair(name, acc)) continue;
      const key = `${name}||${acc}`;
      const d = (r.analysis_date as string) || "";
      const cur = combos.get(key) ?? { chatter_name: name, account: acc, messages: 0, revenue: 0, eff: 0, latestDate: d };
      cur.messages += Number(r.open_chats) || 0;
      cur.revenue += Number(r.revenue_today) || 0;
      if (d > cur.latestDate) cur.latestDate = d;
      combos.set(key, cur);
    }
    const comboArr = Array.from(combos.values())
      .filter((c) => c.messages >= 30)
      .map((c) => ({ ...c, eff: c.messages > 0 ? c.revenue / c.messages : 0 }));
    if (comboArr.length >= 3) {
      const vols = [...comboArr].map((c) => c.messages).sort((a, b) => a - b);
      const effs = [...comboArr].map((c) => c.eff).sort((a, b) => a - b);
      const q = (arr: number[], p: number) => arr[Math.floor(arr.length * p)];
      const volHi = q(vols, 0.66);
      const effLo = q(effs, 0.33);
      const w = comboArr
        .filter((c) => c.messages >= volHi && c.eff <= effLo)
        .sort((a, b) => b.messages - a.messages);
      setWasted(w);
    } else {
      setWasted([]);
    }

    // Load dismissals
    const { data: dismRaw } = await supabase
      .from("waste_dismissals")
      .select("chatter_name, account, dismissed_at_analysis_date")
      .eq("user_id", user.id)
      .eq("platform", platform);
    const dism: Record<string, string> = {};
    for (const r of (dismRaw ?? []) as any[]) {
      dism[`${r.chatter_name}||${r.account}`] = r.dismissed_at_analysis_date as string;
    }
    setWasteDismissals(dism);


    setLoading(false);
  }



  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, range, user?.id]);

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

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => r.chatter_name.toLowerCase().includes(q));
  }, [rows, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
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
  }, [filtered, sort, dir]);

  const maxRevenue = Math.max(1, ...rows.map((r) => r.last_revenue));
  const avgEff = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.last_revenue, 0);
    const msgs = rows.reduce((s, r) => s + r.incoming_count, 0);
    return msgs > 0 ? total / msgs : 0;
  }, [rows]);

  // Fit-Buckets: Perzentile (33/66) über alle Chatter mit ≥10 msgs
  const fitBuckets = useMemo(() => {
    const eligible = rows.filter((r) => r.incoming_count >= 10);
    if (eligible.length < 3) return new Map<string, FitBucket>();
    const vols = [...eligible].map((r) => r.incoming_count).sort((a, b) => a - b);
    const effs = [...eligible]
      .map((r) => (r.incoming_count > 0 ? r.last_revenue / r.incoming_count : 0))
      .sort((a, b) => a - b);
    const q = (arr: number[], p: number) => arr[Math.floor(arr.length * p)];
    const volLo = q(vols, 0.33), volHi = q(vols, 0.66);
    const effLo = q(effs, 0.33), effHi = q(effs, 0.66);
    const m = new Map<string, FitBucket>();
    for (const r of rows) {
      if (r.incoming_count < 10) {
        m.set(r.chatter_name, null);
        continue;
      }
      const vol = r.incoming_count;
      const eff = r.last_revenue / r.incoming_count;
      if (vol >= volHi && eff <= effLo) m.set(r.chatter_name, "overloaded");
      else if (vol <= volLo && eff >= effHi) m.set(r.chatter_name, "underused");
      else if (eff >= effLo && vol >= volLo) m.set(r.chatter_name, "fit");
      else m.set(r.chatter_name, null);
    }
    return m;
  }, [rows]);

  function toggleCollapse(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    // ensure data loaded when opening
    if (collapsed.has(name)) loadSplit(name);
  }

  async function loadSplit(name: string) {
    if (modelSplits[name] || !user) return;
    setLoadingSplit((prev) => new Set(prev).add(name));
    const { from, to } = dateRange(range);
    const { data } = await supabase
      .from("chatter_history")
      .select("account, revenue_today, open_chats, analysis_date")
      .eq("user_id", user.id)
      .eq("platform", platform)
      .eq("chatter_name", name)
      .gte("analysis_date", from)
      .lte("analysis_date", to);
    const agg = new Map<string, ModelSplitRow>();
    for (const r of (data ?? []) as any[]) {
      const acc = (r.account as string) || "—";
      const cur = agg.get(acc) ?? { account: acc, revenue: 0, messages: 0, days: 0 };
      cur.revenue += Number(r.revenue_today) || 0;
      cur.messages += Number(r.open_chats) || 0;
      cur.days += 1;
      agg.set(acc, cur);
    }
    setModelSplits((prev) => ({
      ...prev,
      [name]: Array.from(agg.values()).sort((a, b) => (b.revenue - a.revenue) || (b.messages - a.messages)),
    }));
    setLoadingSplit((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }


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


      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Chatter suchen…"
          className="w-full h-9 pl-9 pr-9 rounded-md bg-white/[0.02] border border-white/[0.06] text-xs font-light text-white/90 placeholder:text-white/30 outline-none focus:border-white/20 transition"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded text-white/40 hover:text-white/80"
            aria-label="Suche löschen"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
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

        <div className="ml-auto flex items-center gap-3 text-[11px] text-white/40 font-light">
          {search && (
            <span className="tabular-nums">{sorted.length} von {rows.length}</span>
          )}
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping bg-emerald-400" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            {lastPushAgo ? `Push vor ${since(lastPushAgo)}` : "wartend"}
          </div>
        </div>
      </div>

      {/* Potenzial verschenkt — 30 Tage */}
      {(() => {
        const visible = wasted.filter((w) => {
          const key = `${w.chatter_name}||${w.account}`;
          const dismissedAt = wasteDismissals[key];
          if (!dismissedAt) return true;
          // reappear when a newer report exists
          return w.latestDate > dismissedAt;
        });
        if (visible.length === 0) return null;
        return (
          <div className="mb-6 rounded-2xl border border-rose-400/20 bg-gradient-to-b from-rose-500/[0.06] to-rose-500/[0.02] p-4">
            <div className="flex items-baseline justify-between mb-3">
              <div className="text-[10px] uppercase tracking-[0.22em] text-rose-300/80 font-light">
                Potenzial verschenkt
              </div>
              <div className="text-[9px] uppercase tracking-[0.18em] text-white/30 font-light">
                {visible.length} · 30 Tage
              </div>
            </div>
            <div className="space-y-1.5">
              {visible.map((w) => {
                const key = `${w.chatter_name}||${w.account}`;
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 text-xs font-light py-1.5 px-2 rounded hover:bg-white/[0.03] transition"
                  >
                    <button
                      onClick={async () => {
                        if (!user) return;
                        setWasteDismissals((prev) => ({ ...prev, [key]: w.latestDate }));
                        const { error } = await supabase
                          .from("waste_dismissals")
                          .upsert(
                            {
                              user_id: user.id,
                              platform,
                              chatter_name: w.chatter_name,
                              account: w.account,
                              dismissed_at_analysis_date: w.latestDate,
                            },
                            { onConflict: "user_id,platform,chatter_name,account" },
                          );
                        if (error) {
                          toast({ title: "Konnte nicht abhaken", description: error.message, variant: "destructive" });
                        }
                      }}
                      className="h-4 w-4 rounded border border-white/20 bg-white/[0.02] flex items-center justify-center hover:border-emerald-400/60 hover:bg-emerald-500/10 transition shrink-0"
                      aria-label="Erledigt"
                    >
                      <Check className="h-3 w-3 text-white/0 hover:text-emerald-300" />
                    </button>
                    <button
                      onClick={() => {
                        const el = document.getElementById(`chatter-${w.chatter_name}`);
                        if (el) {
                          el.scrollIntoView({ behavior: "smooth", block: "center" });
                          setCollapsed((prev) => {
                            const next = new Set(prev);
                            next.delete(w.chatter_name);
                            return next;
                          });
                        }
                      }}
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-400/70 shrink-0" />
                      <span className="text-white/90 uppercase tracking-[0.14em] truncate">
                        {w.chatter_name}
                      </span>
                      <span className="text-white/30">auf</span>
                      <span className="text-white/80 truncate flex-1">{w.account}</span>
                      <span className="text-white/50 tabular-nums shrink-0">{fmtInt(w.messages)} Msg</span>
                      <span className="text-white/25">·</span>
                      <span className="text-white/50 tabular-nums shrink-0">{fmtEur(w.revenue)}</span>
                      <span className="text-white/25">·</span>
                      <span className="text-rose-300 tabular-nums shrink-0">{fmtEurDec(w.eff)}/Msg</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}



      {/* Empty state */}
      {!loading && sorted.length === 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <p className="text-sm text-white/60 font-light mb-4">
            {search ? "Kein Chatter gefunden." : "Noch keine Nachrichten-Daten für diesen Zeitraum."}
          </p>
          {range !== "today" && !search && (
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
          const bucket = fitBuckets.get(r.chatter_name) ?? null;
          const bucketMeta =
            bucket === "overloaded"
              ? { label: "ÜBERLASTET", cls: "border-rose-400/30 text-rose-300 bg-rose-500/[0.06]", sparkTone: "text-rose-300" }
              : bucket === "underused"
                ? { label: "UNTERAUSGELASTET", cls: "border-amber-300/30 text-amber-200 bg-amber-500/[0.06]", sparkTone: "text-amber-300" }
                : bucket === "fit"
                  ? { label: "PASST", cls: "border-emerald-400/25 text-emerald-300 bg-emerald-500/[0.05]", sparkTone: "text-emerald-300" }
                  : { label: "", cls: "", sparkTone: "text-white/40" };
          const spark = sparkData[r.chatter_name] ?? [];
          const isOpen = !collapsed.has(r.chatter_name);
          const split = modelSplits[r.chatter_name];
          const isSplitLoading = loadingSplit.has(r.chatter_name);

          return (
            <div
              key={r.chatter_name}
              id={`chatter-${r.chatter_name}`}
              className="group relative rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-white/[0.01] hover:border-white/[0.12] hover:from-white/[0.05] transition-all duration-300"
            >
              <button
                onClick={() => toggleCollapse(r.chatter_name)}
                className="w-full text-left p-5"
              >
                <div className="flex items-baseline justify-between mb-2 gap-3">
                  <div className="flex items-baseline gap-3 min-w-0">
                    <span className={`text-2xl font-extralight tabular-nums ${rankTone}`}>
                      #{rank}
                    </span>
                    <span className="text-sm uppercase tracking-[0.22em] font-light text-white/85 truncate">
                      {r.chatter_name}
                    </span>
                    {bucket && (
                      <span className={`shrink-0 text-[9px] tracking-[0.18em] font-light px-1.5 py-0.5 rounded border ${bucketMeta.cls}`}>
                        {bucketMeta.label}
                      </span>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-light text-white/90 tabular-nums">
                      ~{fmtInt(r.incoming_count)} <span className="text-[10px] text-white/40 uppercase tracking-widest">msg</span>
                    </div>
                  </div>
                </div>

                {/* Progress bar + sparkline */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="relative h-1.5 rounded-full bg-white/[0.04] overflow-hidden flex-1">
                    <div
                      className={`absolute inset-y-0 left-0 bg-gradient-to-r ${efficiencyTone} rounded-full transition-all duration-700`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  <Sparkline points={spark} tone={bucketMeta.sparkTone} />
                </div>

                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3 font-light">
                    <span className={`${effText} tabular-nums`}>{fmtEurDec(eff)}/msg</span>
                    <span className="text-white/25">·</span>
                    <span className="text-white/50 tabular-nums">{fmtEur(r.last_revenue)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-white/40 font-light">
                    {liveAgo ? (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                        <span>aktiv vor {liveAgo}</span>
                      </>
                    ) : (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
                        <span>offline</span>
                      </>
                    )}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </div>
                </div>
              </button>

              {/* Model split — expanded by default */}
              {isOpen && (
                <div className="border-t border-white/[0.05] px-5 py-4">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-white/40 font-light mb-3">
                    Modell-Aufteilung
                  </div>
                  {isSplitLoading && !split && (
                    <div className="text-xs text-white/40 font-light">Lade…</div>
                  )}
                  {split && split.length === 0 && (
                    <div className="text-xs text-white/40 font-light">Keine Modell-Daten im Zeitraum.</div>
                  )}
                  {split && split.length > 0 && (() => {
                    const totalMsg = split.reduce((s, x) => s + x.messages, 0);
                    return (
                      <div className="space-y-3">
                        {split.map((m) => {
                          const share = totalMsg > 0 ? (m.messages / totalMsg) * 100 : 0;
                          return (
                            <div key={m.account} className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span className="h-1.5 w-1.5 rounded-full bg-white/40 shrink-0" />
                                  <span className="text-white/80 font-light truncate">{m.account}</span>
                                </div>
                                <span className="text-white/70 tabular-nums font-light shrink-0 pl-3">
                                  {fmtEur(m.revenue)}
                                </span>
                              </div>
                              <div className="flex items-center gap-2.5">
                                <div className="relative h-1.5 rounded-full bg-white/[0.04] overflow-hidden flex-1">
                                  <div
                                    className="absolute inset-y-0 left-0 rounded-full bg-primary/40 transition-all duration-700"
                                    style={{ width: `${share}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-white/40 tabular-nums font-light w-9 text-right shrink-0">
                                  {share.toFixed(0)}%
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}
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
