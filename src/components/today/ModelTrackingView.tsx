import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Search, ChevronRight, StickyNote, Send, Trash2, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import TimeRangeToggle from "@/components/TimeRangeToggle";
import { buildTimeRange, type TimeRange } from "@/lib/timerange-categorize";
import {
  loadModelOverview,
  detectRelevantModelAlerts,
  fmtEur,
  type ModelOverviewRow,
  type ModelAlert,
  type TrendDirection,
} from "@/lib/model-tracking-overview";

interface Props {
  platform: string;
  onSelectModel: (name: string, chatter: string | null) => void;
}

type SubTab = "overview" | "alerts";
type SortMode = "revenue" | "trend" | "name";

const TREND_LABELS: Record<TrendDirection, { label: string; icon: typeof TrendingUp; tone: string; dot: string }> = {
  up: { label: "Wachstum", icon: TrendingUp, tone: "text-emerald-300", dot: "bg-emerald-400" },
  flat: { label: "Stabil", icon: Minus, tone: "text-white/55", dot: "bg-white/40" },
  down: { label: "Rückgang", icon: TrendingDown, tone: "text-red-300", dot: "bg-red-400" },
  none: { label: "Keine Daten", icon: Minus, tone: "text-white/30", dot: "bg-white/15" },
};

const TREND_ORDER: TrendDirection[] = ["up", "flat", "down", "none"];

export default function ModelTrackingView({ platform, onSelectModel }: Props) {
  const [subtab, setSubtab] = useState<SubTab>("overview");
  const [range, setRange] = useState<TimeRange>(() => buildTimeRange("30d"));
  const [rows, setRows] = useState<ModelOverviewRow[]>([]);
  const [alerts, setAlerts] = useState<ModelAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [trendFilter, setTrendFilter] = useState<Set<TrendDirection>>(new Set());
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("revenue");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    loadModelOverview(platform, range)
      .then((r) => { if (!cancel) setRows(r); })
      .catch((e) => console.error("[ModelTracking] overview", e))
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [platform, range.from, range.to]);

  useEffect(() => {
    let cancel = false;
    setAlertsLoading(true);
    detectRelevantModelAlerts(platform)
      .then((a) => { if (!cancel) setAlerts(a); })
      .catch((e) => console.error("[ModelTracking] alerts", e))
      .finally(() => { if (!cancel) setAlertsLoading(false); });
    return () => { cancel = true; };
  }, [platform]);

  const filtered = useMemo(() => {
    let list = rows;
    if (trendFilter.size > 0) list = list.filter((r) => trendFilter.has(r.trend));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => r.modelName.toLowerCase().includes(q));
    const sorted = [...list];
    if (sort === "revenue") sorted.sort((a, b) => b.totalRevenue - a.totalRevenue);
    else if (sort === "trend") sorted.sort((a, b) => (b.trendPct ?? -9999) - (a.trendPct ?? -9999));
    else sorted.sort((a, b) => a.modelName.localeCompare(b.modelName));
    return sorted;
  }, [rows, trendFilter, search, sort]);

  const toggleTrend = (d: TrendDirection) => {
    setTrendFilter((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      {/* Subtabs */}
      <div className="flex items-center gap-1.5">
        {[
          { id: "overview" as const, label: "Übersicht", count: rows.length },
          { id: "alerts" as const, label: "Alerts", count: alerts.length },
        ].map((t) => {
          const active = subtab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubtab(t.id)}
              className={cn(
                "px-3 py-1 rounded-full text-[10.5px] font-semibold uppercase tracking-wider transition-all border flex items-center gap-1.5",
                active
                  ? "bg-white/[0.07] border-white/15 text-foreground/90"
                  : "bg-transparent border-white/[0.06] text-white/35 hover:text-white/65",
              )}
            >
              {t.label}
              <span className={cn("tabular-nums text-[10px]", active ? "text-white/55" : "text-white/25")}>
                {t.count}
              </span>
              {t.id === "alerts" && t.count > 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
              )}
            </button>
          );
        })}
      </div>

      {subtab === "overview" ? (
        <>
          {/* Filter bar */}
          <div className="space-y-3">
            <TimeRangeToggle value={range} onChange={setRange} />
            <div className="flex flex-wrap items-center gap-1.5">
              {TREND_ORDER.map((d) => {
                const cfg = TREND_LABELS[d];
                const Icon = cfg.icon;
                const active = trendFilter.has(d);
                return (
                  <button
                    key={d}
                    onClick={() => toggleTrend(d)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[11px] font-light tracking-wide transition-all border flex items-center gap-1.5",
                      active
                        ? "bg-white/[0.08] border-white/20 text-foreground/90"
                        : "bg-white/[0.02] border-white/[0.07] text-white/45 hover:text-white/75",
                    )}
                  >
                    <Icon className={cn("h-3 w-3", active ? cfg.tone : "text-white/40")} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Model suchen …"
                  className="w-full bg-white/[0.025] border border-white/[0.07] rounded-md pl-8 pr-3 py-1.5 text-[12px] text-foreground/90 placeholder:text-white/25 focus:outline-none focus:border-white/15"
                />
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortMode)}
                className="bg-white/[0.025] border border-white/[0.07] rounded-md px-2 py-1.5 text-[11px] text-white/75 focus:outline-none focus:border-white/15"
              >
                <option value="revenue">Umsatz ↓</option>
                <option value="trend">Trend ↓</option>
                <option value="name">Name A-Z</option>
              </select>
            </div>
          </div>

          {/* List */}
          {loading ? (
            <div className="text-center py-12 text-white/25 text-xs font-light">Lade Models …</div>
          ) : filtered.length === 0 ? (
            <div className="premium-card rounded-2xl p-8 text-center text-white/40 text-[12px] font-light">
              Keine Models entsprechen den Filtern.
            </div>
          ) : (
            <div className="premium-card rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
              <AnimatePresence initial={false}>
                {filtered.map((r) => (
                  <ModelRow
                    key={r.modelName}
                    row={r}
                    platform={platform}
                    onOpenDetails={() => onSelectModel(r.modelName, r.currentChatter)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      ) : (
        <AlertsList loading={alertsLoading} alerts={alerts} onSelectModel={onSelectModel} />
      )}
    </div>
  );
}

interface ModelNote {
  id: string;
  note_text: string;
  created_at: string;
}

function ModelRow({ row, platform, onOpenDetails }: { row: ModelOverviewRow; platform: string; onOpenDetails: () => void }) {
  const cfg = TREND_LABELS[row.trend];
  const Icon = cfg.icon;
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState<ModelNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const loadNotes = async () => {
    setLoadingNotes(true);
    const { data, error } = await supabase
      .from("model_notes")
      .select("id, note_text, created_at")
      .eq("platform", platform)
      .eq("model_name", row.modelName)
      .order("created_at", { ascending: false });
    if (!error && data) setNotes(data as ModelNote[]);
    setLoadingNotes(false);
  };

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && notes.length === 0) loadNotes();
  };

  const handleSave = async () => {
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const { data, error } = await supabase
      .from("model_notes")
      .insert({ user_id: user.id, platform, model_name: row.modelName, note_text: text })
      .select("id, note_text, created_at")
      .single();
    if (error) {
      toast.error("Notiz konnte nicht gespeichert werden");
    } else if (data) {
      setNotes((prev) => [data as ModelNote, ...prev]);
      setDraft("");
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const prev = notes;
    setNotes(notes.filter((n) => n.id !== id));
    const { error } = await supabase.from("model_notes").delete().eq("id", id);
    if (error) {
      toast.error("Löschen fehlgeschlagen");
      setNotes(prev);
    }
  };

  return (
    <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button
        onClick={handleToggle}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/[0.025] transition-colors text-left"
      >
        <span className={cn("h-2 w-2 rounded-full shrink-0", cfg.dot)} />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-foreground/90 font-light truncate">{row.modelName}</div>
          <div className="text-[10.5px] text-white/35 font-light mt-0.5 truncate">
            {row.currentChatter ?? "kein Chatter"} · {row.pointCount} Tage
          </div>
        </div>
        <Sparkline points={row.daily.map((p) => p.revenue)} trend={row.trend} />
        <div className="text-right shrink-0 min-w-[70px]">
          <div className="text-[12.5px] text-foreground/90 font-light tabular-nums">{fmtEur(row.totalRevenue)}</div>
          <div className={cn("text-[10.5px] font-light tabular-nums flex items-center gap-1 justify-end", cfg.tone)}>
            <Icon className="h-2.5 w-2.5" />
            {row.trendPct != null ? `${row.trendPct > 0 ? "+" : ""}${row.trendPct}%` : "—"}
          </div>
        </div>
        <ChevronRight className={cn("h-3.5 w-3.5 text-white/20 shrink-0 transition-transform", expanded && "rotate-90")} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden bg-white/[0.015]"
          >
            <div className="px-4 py-3 space-y-3 border-t border-white/[0.04]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-white/45 font-semibold">
                  <StickyNote className="h-3 w-3" />
                  Notizen
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenDetails(); }}
                  className="flex items-center gap-1 text-[10.5px] text-white/45 hover:text-white/80 transition-colors"
                >
                  Details
                  <ExternalLink className="h-2.5 w-2.5" />
                </button>
              </div>

              <div className="flex gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSave(); }
                  }}
                  placeholder="Notiz zu diesem Model … (⌘+Enter)"
                  rows={2}
                  className="flex-1 bg-white/[0.025] border border-white/[0.07] rounded-md px-2.5 py-1.5 text-[12px] text-foreground/90 placeholder:text-white/25 focus:outline-none focus:border-white/15 resize-none"
                />
                <button
                  onClick={handleSave}
                  disabled={!draft.trim() || saving}
                  className="self-start px-3 py-1.5 rounded-md bg-white/[0.08] border border-white/15 text-[11px] text-foreground/90 hover:bg-white/[0.12] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <Send className="h-3 w-3" />
                  Speichern
                </button>
              </div>

              {loadingNotes ? (
                <div className="text-[11px] text-white/30 font-light">Lade Notizen …</div>
              ) : notes.length === 0 ? (
                <div className="text-[11px] text-white/30 font-light italic">Noch keine Notizen.</div>
              ) : (
                <ul className="space-y-1.5">
                  {notes.map((n) => (
                    <li key={n.id} className="group flex items-start gap-2 bg-white/[0.02] border border-white/[0.05] rounded-md px-2.5 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-foreground/85 font-light whitespace-pre-wrap break-words">{n.note_text}</p>
                        <p className="text-[10px] text-white/30 font-light mt-1 tabular-nums">
                          {new Date(n.created_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDelete(n.id)}
                        className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-300 transition-all p-1"
                        aria-label="Notiz löschen"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Sparkline({ points, trend }: { points: number[]; trend: TrendDirection }) {
  if (points.length < 2) {
    return <div className="w-16 h-6 shrink-0" />;
  }
  const w = 64;
  const h = 24;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const color =
    trend === "up" ? "rgb(110,231,183)" :
    trend === "down" ? "rgb(252,165,165)" :
    "rgba(255,255,255,0.45)";
  return (
    <svg width={w} height={h} className="shrink-0 opacity-90">
      <path d={path} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertsList({
  loading,
  alerts,
  onSelectModel,
}: {
  loading: boolean;
  alerts: ModelAlert[];
  onSelectModel: (name: string, chatter: string | null) => void;
}) {
  if (loading) {
    return <div className="text-center py-12 text-white/25 text-xs font-light">Suche Alerts …</div>;
  }
  if (alerts.length === 0) {
    return (
      <div className="premium-card rounded-2xl p-8 text-center">
        <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-3">
          <TrendingUp className="h-4 w-4 text-emerald-300" />
        </div>
        <p className="text-[13px] text-foreground/70 font-light">Keine relevanten Models im Rückgang 🏻</p>
        <p className="text-[11px] text-white/30 font-light mt-1">Alle umsatzstarken Models laufen stabil.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => (
        <button
          key={`${a.modelName}-${i}`}
          onClick={() => onSelectModel(a.modelName, a.currentChatter)}
          className="w-full premium-card rounded-2xl p-4 flex items-center gap-3 hover:bg-white/[0.025] transition-colors text-left"
        >
          <span className={cn(
            "h-2 w-2 rounded-full shrink-0",
            a.severity === "high" ? "bg-red-500" : "bg-amber-400"
          )} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-foreground/90 font-light truncate">{a.modelName}</span>
              {a.currentChatter && (
                <span className="text-[10.5px] text-white/40 font-light truncate">· {a.currentChatter}</span>
              )}
            </div>
            <p className="text-[11px] text-white/55 font-light mt-0.5 truncate">{a.reason}</p>
            <p className="text-[10px] text-white/30 font-light mt-0.5 tabular-nums">
              30T-Umsatz: {fmtEur(a.totalRevenue30d)}
            </p>
          </div>
          {a.deltaPct != null && (
            <div className="text-[12px] font-light text-red-300 tabular-nums shrink-0">
              {a.deltaPct}%
            </div>
          )}
          <ChevronRight className="h-3.5 w-3.5 text-white/20 shrink-0" />
        </button>
      ))}
    </div>
  );
}
