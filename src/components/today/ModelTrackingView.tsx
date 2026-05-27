import { useEffect, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, Search, ChevronRight, StickyNote, Send, Trash2, ExternalLink, Tag, Plus, X, Settings2 } from "lucide-react";
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
import TrendCategoryDetailSheet from "@/components/today/TrendCategoryDetailSheet";


interface Props {
  platform: string;
  onSelectModel: (name: string, chatter: string | null) => void;
}

type SubTab = "overview" | "alerts";
type SortMode = "revenue" | "trend" | "name";

interface ModelLabel {
  id: string;
  label_name: string;
  color: string;
}

interface LabelAssignment {
  id: string;
  model_name: string;
  label_id: string;
}

interface ModelNote {
  id: string;
  model_name: string;
  note_text: string;
  created_at: string;
}


const LABEL_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#14B8A6", "#F97316", "#6366F1", "#84CC16",
];

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

  const [labels, setLabels] = useState<ModelLabel[]>([]);
  const [assignments, setAssignments] = useState<LabelAssignment[]>([]);
  const [notes, setNotes] = useState<ModelNote[]>([]);
  const [labelFilter, setLabelFilter] = useState<Set<string>>(new Set());
  const [showLabelManager, setShowLabelManager] = useState(false);
  const [detailDirection, setDetailDirection] = useState<TrendDirection | null>(null);


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

  const reloadLabels = useCallback(async () => {
    const [labelsRes, assignRes, notesRes] = await Promise.all([
      supabase.from("model_labels").select("id, label_name, color").eq("platform", platform).order("label_name"),
      supabase.from("model_label_assignments").select("id, model_name, label_id").eq("platform", platform),
      supabase.from("model_notes").select("id, model_name, note_text, created_at").eq("platform", platform).order("created_at", { ascending: false }),
    ]);
    if (!labelsRes.error && labelsRes.data) setLabels(labelsRes.data as ModelLabel[]);
    if (!assignRes.error && assignRes.data) setAssignments(assignRes.data as LabelAssignment[]);
    if (!notesRes.error && notesRes.data) setNotes(notesRes.data as ModelNote[]);
  }, [platform]);

  useEffect(() => {
    reloadLabels();
    setLabelFilter(new Set());
  }, [reloadLabels]);

  // Refresh when window regains focus (catches changes made in slide-over)
  useEffect(() => {
    const onFocus = () => { reloadLabels(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reloadLabels]);

  const assignmentsByModel = useMemo(() => {
    const map = new Map<string, LabelAssignment[]>();
    for (const a of assignments) {
      const list = map.get(a.model_name) ?? [];
      list.push(a);
      map.set(a.model_name, list);
    }
    return map;
  }, [assignments]);

  const notesByModel = useMemo(() => {
    const map = new Map<string, ModelNote[]>();
    for (const n of notes) {
      const list = map.get(n.model_name) ?? [];
      list.push(n);
      map.set(n.model_name, list);
    }
    return map;
  }, [notes]);

  const labelsById = useMemo(() => {
    const map = new Map<string, ModelLabel>();
    for (const l of labels) map.set(l.id, l);
    return map;
  }, [labels]);

  const filtered = useMemo(() => {
    let list = rows;
    if (trendFilter.size > 0) list = list.filter((r) => trendFilter.has(r.trend));
    if (labelFilter.size > 0) {
      list = list.filter((r) => {
        const ass = assignmentsByModel.get(r.modelName) ?? [];
        return ass.some((a) => labelFilter.has(a.label_id));
      });
    }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => r.modelName.toLowerCase().includes(q));
    const sorted = [...list];
    if (sort === "revenue") sorted.sort((a, b) => b.totalRevenue - a.totalRevenue);
    else if (sort === "trend") sorted.sort((a, b) => (b.trendPct ?? -9999) - (a.trendPct ?? -9999));
    else sorted.sort((a, b) => a.modelName.localeCompare(b.modelName));
    return sorted;
  }, [rows, trendFilter, labelFilter, assignmentsByModel, search, sort]);

  const toggleTrend = (d: TrendDirection) => {
    setTrendFilter((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  };

  const toggleLabelFilter = (id: string) => {
    setLabelFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAssign = async (modelName: string, labelId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("model_label_assignments")
      .insert({ user_id: user.id, platform, model_name: modelName, label_id: labelId })
      .select("id, model_name, label_id")
      .single();
    if (error) {
      toast.error("Label konnte nicht zugewiesen werden");
    } else if (data) {
      setAssignments((prev) => [...prev, data as LabelAssignment]);
    }
  };

  const handleUnassign = async (assignmentId: string) => {
    const prev = assignments;
    setAssignments(assignments.filter((a) => a.id !== assignmentId));
    const { error } = await supabase.from("model_label_assignments").delete().eq("id", assignmentId);
    if (error) {
      toast.error("Entfernen fehlgeschlagen");
      setAssignments(prev);
    }
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
          {/* Trend summary */}
          <TrendSummary rows={rows} loading={loading} onSelect={setDetailDirection} />

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

            {/* Label filter chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-white/35 font-semibold mr-1">
                <Tag className="h-3 w-3" />
                Labels
              </div>
              {labels.length === 0 ? (
                <span className="text-[10.5px] text-white/30 font-light italic">Noch keine Labels</span>
              ) : (
                labels.map((l) => {
                  const active = labelFilter.has(l.id);
                  return (
                    <button
                      key={l.id}
                      onClick={() => toggleLabelFilter(l.id)}
                      className={cn(
                        "px-2 py-0.5 rounded-full text-[10.5px] font-light transition-all border flex items-center gap-1",
                        active ? "text-foreground/95 border-white/30" : "text-white/55 border-white/[0.08] hover:text-white/85",
                      )}
                      style={{
                        backgroundColor: active ? `${l.color}33` : `${l.color}14`,
                        borderColor: active ? `${l.color}90` : undefined,
                      }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: l.color }} />
                      {l.label_name}
                    </button>
                  );
                })
              )}
              <button
                onClick={() => setShowLabelManager((v) => !v)}
                className="ml-auto px-2 py-0.5 rounded-md text-[10.5px] text-white/45 hover:text-white/85 border border-white/[0.08] hover:border-white/20 flex items-center gap-1 transition-all"
              >
                <Settings2 className="h-3 w-3" />
                Verwalten
              </button>
            </div>

            <AnimatePresence initial={false}>
              {showLabelManager && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <LabelManager
                    platform={platform}
                    labels={labels}
                    onChanged={reloadLabels}
                    onClose={() => setShowLabelManager(false)}
                  />
                </motion.div>
              )}
            </AnimatePresence>

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
                {filtered.map((r) => {
                  const rowAssignments = assignmentsByModel.get(r.modelName) ?? [];
                  const rowNotes = notesByModel.get(r.modelName) ?? [];
                  return (
                    <ModelRow
                      key={r.modelName}
                      row={r}
                      labelsById={labelsById}
                      assignments={rowAssignments}
                      notes={rowNotes}
                      onOpenDetails={() => onSelectModel(r.modelName, r.currentChatter)}
                    />
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </>
      ) : (
        <AlertsList loading={alertsLoading} alerts={alerts} onSelectModel={onSelectModel} />
      )}

      <TrendCategoryDetailSheet
        open={detailDirection !== null}
        onClose={() => setDetailDirection(null)}
        direction={detailDirection}
        rows={rows}
        onSelectModel={(name, chatter) => {
          setDetailDirection(null);
          onSelectModel(name, chatter);
        }}
      />
    </div>
  );
}


function ModelRow({
  row,
  labelsById,
  assignments,
  notes,
  onOpenDetails,
}: {
  row: ModelOverviewRow;
  labelsById: Map<string, ModelLabel>;
  assignments: LabelAssignment[];
  notes: ModelNote[];
  onOpenDetails: () => void;
}) {
  const cfg = TREND_LABELS[row.trend];
  const Icon = cfg.icon;
  const latestNote = notes[0];

  return (
    <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button
        onClick={onOpenDetails}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/[0.025] transition-colors text-left"
      >
        <span className={cn("h-2 w-2 rounded-full shrink-0", cfg.dot)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13px] text-foreground/90 font-light truncate">{row.modelName}</span>
            {assignments.slice(0, 3).map((a) => {
              const l = labelsById.get(a.label_id);
              if (!l) return null;
              return (
                <span
                  key={a.id}
                  className="px-1.5 py-0.5 rounded text-[9.5px] font-medium tabular-nums"
                  style={{ backgroundColor: `${l.color}22`, color: l.color, border: `1px solid ${l.color}55` }}
                >
                  {l.label_name}
                </span>
              );
            })}
            {assignments.length > 3 && (
              <span className="text-[9.5px] text-white/40">+{assignments.length - 3}</span>
            )}
          </div>
          <div className="text-[10.5px] text-white/35 font-light mt-0.5 truncate">
            {row.currentChatter ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(row.currentChatter!);
                  toast.success(`Chatter "${row.currentChatter}" kopiert`);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    navigator.clipboard.writeText(row.currentChatter!);
                    toast.success(`Chatter "${row.currentChatter}" kopiert`);
                  }
                }}
                className="hover:text-white/80 hover:underline underline-offset-2 cursor-pointer transition-colors"
                title="Klick zum Kopieren"
              >
                {row.currentChatter}
              </span>
            ) : (
              "kein Chatter"
            )}
            {" · "}{row.pointCount} Tage
          </div>
          {(row.baselineAvg != null || row.currentAvg != null) && (
            <div className="text-[10.5px] text-white/40 font-light mt-0.5 tabular-nums flex items-center gap-1.5 flex-wrap">
              <span>
                Ø sonst: <span className="text-white/65">{row.baselineAvg != null ? fmtEur(row.baselineAvg) : "—"}</span>
              </span>
              <span className="text-white/20">→</span>
              <span>
                jetzt: <span className={cn("font-medium", cfg.tone)}>{row.currentAvg != null ? fmtEur(row.currentAvg) : "—"}</span>
              </span>
            </div>
          )}
        </div>
        <Sparkline points={row.daily.map((p) => p.revenue)} trend={row.trend} />
        <div className="text-right shrink-0 min-w-[70px]">
          <div className="text-[12.5px] text-foreground/90 font-light tabular-nums">{fmtEur(row.totalRevenue)}</div>
          <div className={cn("text-[10.5px] font-light tabular-nums flex items-center gap-1 justify-end", cfg.tone)}>
            <Icon className="h-2.5 w-2.5" />
            {row.trendPct != null ? `${row.trendPct > 0 ? "+" : ""}${row.trendPct}%` : "—"}
          </div>
        </div>
        <ChevronRight className="h-3.5 w-3.5 text-white/20 shrink-0" />
      </button>

      {latestNote && (
        <div className="px-4 pb-3 -mt-1">
          <div className="flex items-start gap-2 bg-white/[0.02] border-l-2 border-white/15 rounded-r-md px-2.5 py-1.5">
            <StickyNote className="h-3 w-3 text-white/35 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[11.5px] text-foreground/75 font-light line-clamp-2 whitespace-pre-wrap break-words">
                {latestNote.note_text}
              </p>
              {notes.length > 1 && (
                <p className="text-[9.5px] text-white/30 font-light mt-0.5">
                  +{notes.length - 1} weitere {notes.length - 1 === 1 ? "Notiz" : "Notizen"}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}



function LabelManager({
  platform,
  labels,
  onChanged,
  onClose,
}: {
  platform: string;
  labels: ModelLabel[];
  onChanged: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBusy(false); return; }
    const { error } = await supabase
      .from("model_labels")
      .insert({ user_id: user.id, platform, label_name: trimmed, color });
    if (error) {
      toast.error(error.message.includes("duplicate") ? "Label existiert bereits" : "Label konnte nicht angelegt werden");
    } else {
      setName("");
      setColor(LABEL_COLORS[(LABEL_COLORS.indexOf(color) + 1) % LABEL_COLORS.length]);
      await onChanged();
    }
    setBusy(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Label löschen? Alle Zuweisungen werden ebenfalls entfernt.")) return;
    const { error } = await supabase.from("model_labels").delete().eq("id", id);
    if (error) {
      toast.error("Löschen fehlgeschlagen");
    } else {
      await onChanged();
    }
  };

  return (
    <div className="bg-white/[0.02] border border-white/[0.07] rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] uppercase tracking-wider text-white/55 font-semibold">Labels verwalten</span>
        <button onClick={onClose} className="text-white/40 hover:text-white/80">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }}
          placeholder="Neuer Label-Name …"
          className="flex-1 min-w-[160px] bg-white/[0.025] border border-white/[0.07] rounded-md px-2.5 py-1.5 text-[12px] text-foreground/90 placeholder:text-white/25 focus:outline-none focus:border-white/15"
        />
        <div className="flex items-center gap-1">
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cn(
                "h-5 w-5 rounded-full transition-all",
                color === c ? "ring-2 ring-white/60 ring-offset-1 ring-offset-[#0a0a0a]" : "opacity-70 hover:opacity-100",
              )}
              style={{ backgroundColor: c }}
              aria-label={`Farbe ${c}`}
            />
          ))}
        </div>
        <button
          onClick={handleCreate}
          disabled={!name.trim() || busy}
          className="px-3 py-1.5 rounded-md bg-white/[0.08] border border-white/15 text-[11px] text-foreground/90 hover:bg-white/[0.12] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          <Plus className="h-3 w-3" />
          Anlegen
        </button>
      </div>

      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {labels.map((l) => (
            <span
              key={l.id}
              className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-medium"
              style={{ backgroundColor: `${l.color}22`, color: l.color, border: `1px solid ${l.color}55` }}
            >
              {l.label_name}
              <button
                onClick={() => handleDelete(l.id)}
                className="opacity-60 hover:opacity-100"
                aria-label="Label löschen"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TrendSummary({
  rows,
  loading,
  onSelect,
}: {
  rows: ModelOverviewRow[];
  loading: boolean;
  onSelect: (d: TrendDirection) => void;
}) {
  const counts = useMemo(() => {
    const c = { up: 0, flat: 0, down: 0, none: 0 } as Record<TrendDirection, number>;
    for (const r of rows) c[r.trend]++;
    return c;
  }, [rows]);
  const total = rows.length;
  const items: { key: TrendDirection; label: string; value: number; icon: typeof TrendingUp; tone: string; bar: string }[] = [
    { key: "up", label: "Wachstum", value: counts.up, icon: TrendingUp, tone: "text-emerald-300", bar: "bg-emerald-400/70" },
    { key: "flat", label: "Stabil", value: counts.flat, icon: Minus, tone: "text-white/65", bar: "bg-white/40" },
    { key: "down", label: "Rückgang", value: counts.down, icon: TrendingDown, tone: "text-red-300", bar: "bg-red-400/70" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((it) => {
        const Icon = it.icon;
        const pct = total > 0 ? Math.round((it.value / total) * 100) : 0;
        const disabled = loading || it.value === 0;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => !disabled && onSelect(it.key)}
            disabled={disabled}
            className={cn(
              "premium-card rounded-xl p-3 flex flex-col gap-2 text-left transition-all",
              !disabled && "hover:bg-white/[0.04] hover:border-white/15 cursor-pointer",
              disabled && "opacity-70 cursor-default",
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/45 font-semibold">
                <Icon className={cn("h-3 w-3", it.tone)} />
                {it.label}
              </div>
              <span className="text-[10px] text-white/35 tabular-nums font-light">{loading ? "—" : `${pct}%`}</span>
            </div>
            <div className="text-2xl font-extralight tabular-nums text-foreground/90">
              {loading ? "—" : it.value}
            </div>
            <div className="h-0.5 rounded-full bg-white/[0.05] overflow-hidden">
              <div className={cn("h-full transition-all", it.bar)} style={{ width: `${pct}%` }} />
            </div>
          </button>
        );
      })}
    </div>
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
