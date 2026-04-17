import { useEffect, useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Send, Plus, Tag, TrendingUp, TrendingDown, Minus, Coins, Trophy, MessageSquare, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  LineChart,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import WeekTrendCard from "@/components/WeekTrendCard";

interface HistoryRow {
  analysis_date: string;
  revenue_today: number;
  mass_dms: number;
  open_chats: number;
  response_delay_days: number;
}

interface CoachingNote {
  id: string;
  note_text: string;
  created_at: string;
}

interface ChatterLabel {
  id: string;
  label_name: string;
  color: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  chatterName: string;
  platform: string;
  inline?: boolean;
}

function toTitleCase(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getInitials(name: string): string {
  const clean = name.replace(/_/g, " ").trim();
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function SectionHeader({ children, accent = "240 5% 60%" }: { children: React.ReactNode; accent?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-3 w-[2px] rounded-full" style={{ background: `hsl(${accent} / 0.7)`, boxShadow: `0 0 8px hsl(${accent} / 0.5)` }} />
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-medium">{children}</p>
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()} — ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatCurrency(v: number) {
  return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/* Custom Tooltips */
function RevenueTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as (HistoryRow & { note?: string }) | undefined;
  if (!row) return null;
  return (
    <div className="bg-zinc-900/90 backdrop-blur-2xl border border-white/[0.08] rounded-xl px-5 py-3.5 shadow-2xl max-w-[240px]">
      <p className="text-[11px] text-white/35 font-light tracking-wider mb-2">{formatDate(row.analysis_date)}</p>
      <p className="text-lg font-light gold-text">{formatCurrency(row.revenue_today)}</p>
      <p className="text-xs text-white/40 font-light mt-1">{row.mass_dms} MassDMs</p>
      {row.note && (
        <p className="text-[11px] text-primary/80 font-light mt-2 border-t border-white/[0.06] pt-2">📝 {row.note}</p>
      )}
    </div>
  );
}

function GhostChatTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as HistoryRow | undefined;
  if (!row) return null;
  return (
    <div className="bg-zinc-900/90 backdrop-blur-2xl border border-white/[0.08] rounded-xl px-5 py-3.5 shadow-2xl">
      <p className="text-[11px] text-white/35 font-light tracking-wider mb-2">{formatDate(row.analysis_date)}</p>
      <p className="text-lg font-light text-[#E25822]">{row.open_chats} Offene Chats</p>
      <p className="text-xs text-white/40 font-light mt-1">{row.response_delay_days} Tage Verzug</p>
    </div>
  );
}

/* Sanitize delay: must be 0-30, never mirror revenue or revenue×100 */
function sanitizeDelay(raw: number, revenue: number): number {
  const val = Math.round(raw);
  if (val < 0 || val > 30 || val === Math.round(revenue) || val === Math.round(revenue * 100)) return 0;
  return val;
}

export default function ChatterSlideOver({ open, onClose, chatterName, platform, inline = false }: Props) {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<CoachingNote[]>([]);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [allLabels, setAllLabels] = useState<ChatterLabel[]>([]);
  const [assignedLabelIds, setAssignedLabelIds] = useState<Set<string>>(new Set());
  const [showNewLabel, setShowNewLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#3B82F6");
  const scrollRef = useRef<HTMLDivElement>(null);

  const LABEL_COLORS = [
    "#EF4444", "#3B82F6", "#10B981", "#F59E0B",
    "#8B5CF6", "#F97316", "#EC4899", "#06B6D4",
  ];

  // Auto-scroll to top when a new chatter is selected
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [open, chatterName]);

  useEffect(() => {
    if (!open || !chatterName) return;
    setLoading(true);
    Promise.all([
      supabase
        .from("chatter_history")
        .select("analysis_date, revenue_today, mass_dms, open_chats, response_delay_days")
        .eq("chatter_name", chatterName)
        .eq("platform", platform)
        .order("analysis_date", { ascending: true }),
      supabase
        .from("coaching_notes")
        .select("id, note_text, created_at")
        .eq("chatter_name", chatterName)
        .eq("platform", platform)
        .order("created_at", { ascending: false }),
    ]).then(([histRes, notesRes]) => {
      setHistory(
        (histRes.data || []).map((r: any) => {
          const rev = Number(r.revenue_today) || 0;
          return {
            analysis_date: r.analysis_date,
            revenue_today: rev,
            mass_dms: Number(r.mass_dms) || 0,
            open_chats: Number(r.open_chats) || 0,
            response_delay_days: sanitizeDelay(Number(r.response_delay_days) || 0, rev),
          };
        })
      );
      setNotes((notesRes.data as CoachingNote[]) || []);
      setLoading(false);
    });
  }, [open, chatterName, platform]);

  // Fetch labels
  useEffect(() => {
    if (!open) return;
    supabase
      .from("chatter_labels")
      .select("id, label_name, color")
      .eq("platform", platform)
      .order("created_at", { ascending: true })
      .then(({ data }) => setAllLabels((data as ChatterLabel[]) || []));

    if (!chatterName) return;
    supabase
      .from("chatter_label_assignments")
      .select("label_id")
      .eq("chatter_name", chatterName)
      .eq("platform", platform)
      .then(({ data }) => {
        setAssignedLabelIds(new Set((data || []).map((r: any) => r.label_id)));
      });
  }, [open, chatterName, platform]);

  const createLabel = async () => {
    if (!newLabelName.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("chatter_labels")
      .insert({ user_id: user.id, platform, label_name: newLabelName.trim(), color: newLabelColor })
      .select("id, label_name, color")
      .single();
    if (error) { toast.error("Label konnte nicht erstellt werden."); return; }
    if (data) {
      setAllLabels((prev) => [...prev, data as ChatterLabel]);
      setNewLabelName("");
      setShowNewLabel(false);
      toast.success("Label erstellt");
    }
  };

  const toggleLabel = async (labelId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const isAssigned = assignedLabelIds.has(labelId);
    if (isAssigned) {
      setAssignedLabelIds((prev) => { const next = new Set(prev); next.delete(labelId); return next; });
      await supabase.from("chatter_label_assignments").delete()
        .eq("chatter_name", chatterName).eq("platform", platform).eq("label_id", labelId);
    } else {
      setAssignedLabelIds((prev) => new Set(prev).add(labelId));
      await supabase.from("chatter_label_assignments")
        .insert({ user_id: user.id, chatter_name: chatterName, platform, label_id: labelId });
    }
  };

  const deleteLabel = async (labelId: string) => {
    await supabase.from("chatter_labels").delete().eq("id", labelId);
    setAllLabels((prev) => prev.filter((l) => l.id !== labelId));
    setAssignedLabelIds((prev) => { const next = new Set(prev); next.delete(labelId); return next; });
    toast.success("Label gelöscht");
  };

  const saveNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    const { data, error } = await supabase
      .from("coaching_notes")
      .insert({ chatter_name: chatterName, platform, note_text: noteText.trim() })
      .select("id, note_text, created_at")
      .single();
    if (error) {
      toast.error("Notiz konnte nicht gespeichert werden.");
    } else if (data) {
      setNotes((prev) => [data as CoachingNote, ...prev]);
      setNoteText("");
      toast.success("Notiz gespeichert.");
    }
    setSavingNote(false);
  };

  const noteDateMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notes) {
      const dateStr = n.created_at.split("T")[0];
      map.set(dateStr, n.note_text);
    }
    return map;
  }, [notes]);

  const enrichedHistory = useMemo(() => {
    return history.map((row) => ({
      ...row,
      note: noteDateMap.get(row.analysis_date) || undefined,
    }));
  }, [history, noteDateMap]);

  const noteDates = useMemo(() => {
    const histDates = new Set(history.map((h) => h.analysis_date));
    return Array.from(noteDateMap.keys()).filter((d) => histDates.has(d));
  }, [history, noteDateMap]);

  const avgRevenue = history.length ? history.reduce((s, r) => s + r.revenue_today, 0) / history.length : 0;
  const maxRevenue = history.length ? Math.max(...history.map((r) => r.revenue_today)) : 0;
  const avgDMs = history.length ? Math.round(history.reduce((s, r) => s + r.mass_dms, 0) / history.length) : 0;
  const avgChats = history.length ? (history.reduce((s, r) => s + r.open_chats, 0) / history.length).toFixed(1) : "0";
  
  const avgDelay = history.length
    ? (() => {
        const withDelay = history.filter((r) => r.response_delay_days > 0);
        return withDelay.length ? (withDelay.reduce((s, r) => s + r.response_delay_days, 0) / withDelay.length).toFixed(1) : "0";
      })()
    : "0";

  const last30 = useMemo(() => history.slice(-30), [history]);
  const trend30 = useMemo(() => {
    if (last30.length < 4) return { pct: 0, direction: "stable" as const };
    const half = Math.floor(last30.length / 2);
    const first = last30.slice(0, half);
    const second = last30.slice(half);
    const avgFirst = first.reduce((s, r) => s + r.revenue_today, 0) / first.length;
    const avgSecond = second.reduce((s, r) => s + r.revenue_today, 0) / second.length;
    if (avgFirst === 0) return { pct: 0, direction: "stable" as const };
    const pct = ((avgSecond - avgFirst) / avgFirst) * 100;
    const direction = pct > 5 ? "up" as const : pct < -5 ? "down" as const : "stable" as const;
    return { pct: Math.round(pct), direction };
  }, [last30]);

  const ghostSummary = useMemo(() => {
    if (history.length < 2) return null;
    const last7 = history.slice(-7);
    const avgC = last7.reduce((s, r) => s + r.open_chats, 0) / last7.length;
    const avgD = last7.filter((r) => r.response_delay_days > 0);
    const avgDel = avgD.length ? avgD.reduce((s, r) => s + r.response_delay_days, 0) / avgD.length : 0;
    const half = Math.floor(last7.length / 2);
    const firstHalf = last7.slice(0, half);
    const secondHalf = last7.slice(half);
    const avgFirst = firstHalf.length ? firstHalf.reduce((s, r) => s + r.open_chats, 0) / firstHalf.length : 0;
    const avgSecond = secondHalf.length ? secondHalf.reduce((s, r) => s + r.open_chats, 0) / secondHalf.length : 0;
    let trend = "Stabil";
    if (avgSecond > avgFirst * 1.1) trend = "Verschlechternd ↗";
    else if (avgSecond < avgFirst * 0.9) trend = "Verbessernd ↘";
    return { avgChats: avgC.toFixed(1), avgDelay: avgDel.toFixed(1), trend };
  }, [history]);

  const kpis = [
    { label: "Ø Tagesumsatz", value: formatCurrency(avgRevenue), icon: Coins, accent: "45 75% 55%", gold: true },
    { label: "Höchster Umsatz", value: formatCurrency(maxRevenue), icon: Trophy, accent: "45 75% 55%", gold: true },
    { label: "Ø MassDMs / Tag", value: String(avgDMs), icon: MessageSquare, accent: "212 90% 60%", gold: false },
    { label: "Ø Antwort-Verzug", value: `${avgDelay} Tage`, icon: Clock, accent: "0 84% 60%", gold: false },
  ];

  const displayName = toTitleCase(chatterName);
  const initials = useMemo(() => getInitials(chatterName), [chatterName]);
  const trendAccent = trend30.direction === "up" ? "152 70% 45%" : trend30.direction === "down" ? "0 84% 60%" : "240 5% 60%";

  if (inline) {
    // Inline mode: render directly without portal/overlay
    return (
      <div className="h-full flex flex-col border-l border-white/[0.06] bg-zinc-950/[0.97] backdrop-blur-3xl">
        {/* ── Hero Header ── */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-white/[0.06] bg-zinc-950 z-10 shrink-0">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-medium tracking-wide bg-white/[0.04] border border-white/[0.08] text-white/70"
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h2
              onClick={() => { navigator.clipboard.writeText(displayName); toast.success("Name kopiert"); }}
              className="text-lg font-light tracking-tight gold-text cursor-pointer hover:opacity-70 transition-opacity duration-200 truncate"
              title="Klicken zum Kopieren"
            >
              {displayName}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-[10px] text-white/30 font-light tracking-[0.15em] uppercase">{platform} · Profil</p>
              {trend30.direction !== "stable" && (
                <span className={`inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded ${
                  trend30.direction === "up" ? "text-emerald-400/80" : "text-red-400/80"
                }`}>
                  {trend30.direction === "up" ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                  {trend30.pct > 0 ? "+" : ""}{trend30.pct}%
                </span>
              )}
            </div>
          </div>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-none">
          <div className="p-6 pb-16 space-y-8">
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <span className="h-5 w-5 border border-white/20 border-t-white/60 rounded-full" style={{ animation: "spin-slow 1s linear infinite" }} />
              </div>
            ) : history.length === 0 ? (
              <p className="text-center text-white/20 font-light py-20 text-sm tracking-wide">Noch keine historischen Daten vorhanden.</p>
            ) : (
              <>
                {/* KPI Grid */}
                <div className="grid grid-cols-2 gap-3">
                  {kpis.map((kpi) => {
                    const Icon = kpi.icon;
                    return (
                      <div key={kpi.label} className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4">
                        <div className="flex items-center gap-1.5">
                          <Icon className="h-3 w-3 text-white/30" />
                          <p className="text-[10px] uppercase tracking-[0.18em] text-white/35 font-light">{kpi.label}</p>
                        </div>
                        <p className={`text-lg font-light mt-2 ${kpi.gold ? "gold-text" : "text-foreground/75"}`}>{kpi.value}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Labels */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light flex items-center gap-1.5">
                      <Tag className="h-3 w-3" /> Labels
                    </p>
                    <button onClick={() => setShowNewLabel(!showNewLabel)} className="text-[10px] text-primary/60 hover:text-primary transition-colors font-medium tracking-wide flex items-center gap-1">
                      <Plus className="h-3 w-3" /> Neu
                    </button>
                  </div>
                  {showNewLabel && (
                    <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4 space-y-3">
                      <input value={newLabelName} onChange={(e) => setNewLabelName(e.target.value)} placeholder="Label-Name" className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-foreground/80 font-light placeholder:text-white/15 focus:outline-none focus:border-primary/20 transition-colors" onKeyDown={(e) => e.key === "Enter" && createLabel()} />
                      <div className="flex gap-2">
                        {LABEL_COLORS.map((c) => (
                          <button key={c} onClick={() => setNewLabelColor(c)} className={`w-5 h-5 rounded-full border-2 transition-all ${newLabelColor === c ? "border-white/60 scale-110" : "border-transparent opacity-60 hover:opacity-100"}`} style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <button onClick={createLabel} disabled={!newLabelName.trim()} className="w-full py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-medium hover:bg-primary/15 transition-all disabled:opacity-20 disabled:cursor-not-allowed">Erstellen</button>
                    </div>
                  )}
                  {allLabels.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {allLabels.map((label) => {
                        const isAssigned = assignedLabelIds.has(label.id);
                        return (
                          <button key={label.id} onClick={() => toggleLabel(label.id)} onContextMenu={(e) => { e.preventDefault(); deleteLabel(label.id); }}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-200 border ${isAssigned ? "border-white/20 text-white shadow-sm" : "border-white/[0.06] text-white/30 hover:text-white/50"}`}
                            style={isAssigned ? { backgroundColor: label.color + "25", borderColor: label.color + "50" } : {}}
                            title="Rechtsklick zum Löschen"
                          >
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                            {label.label_name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {allLabels.length === 0 && !showNewLabel && <p className="text-[11px] text-white/15 font-light">Noch keine Labels erstellt.</p>}
                </div>

                {/* 7-Tage-Trend (Umsatz, Verzug, Mass-DMs) */}
                <WeekTrendCard history={history} compact />

                {/* 30-Tage-Trend */}
                {last30.length >= 4 && (
                  <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-5 relative">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light">30-Tage-Trend</p>
                      <span className={`text-xs font-medium px-3 py-1 rounded-full ${trend30.direction === "up" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : trend30.direction === "down" ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-white/[0.04] text-white/40 border border-white/[0.06]"}`}>
                        {trend30.direction === "up" ? "↑" : trend30.direction === "down" ? "↓" : "→"} {trend30.pct > 0 ? "+" : ""}{trend30.pct}%
                      </span>
                    </div>
                    <ResponsiveContainer width="100%" height={120}>
                      <AreaChart data={last30}>
                        <defs>
                          <linearGradient id="trend30FillInline" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={trend30.direction === "down" ? "#ef4444" : "#10b981"} stopOpacity={0.2} />
                            <stop offset="100%" stopColor={trend30.direction === "down" ? "#ef4444" : "#10b981"} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="analysis_date" tickFormatter={formatDate} axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,0.15)", fontSize: 10 }} tickFormatter={(v) => `${v}€`} width={45} />
                        <Tooltip content={<RevenueTooltip />} cursor={{ stroke: "rgba(255,255,255,0.06)" }} />
                        <Area type="monotone" dataKey="revenue_today" stroke={trend30.direction === "down" ? "#ef4444" : "#10b981"} strokeWidth={1.5} fill="url(#trend30FillInline)" dot={false} activeDot={{ r: 4, fill: trend30.direction === "down" ? "#ef4444" : "#10b981", stroke: "rgba(255,255,255,0.1)", strokeWidth: 4 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Revenue Chart */}
                <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-5">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light mb-5">Umsatzverlauf</p>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={enrichedHistory}>
                      <XAxis dataKey="analysis_date" tickFormatter={formatDate} axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,0.15)", fontSize: 10 }} tickFormatter={(v) => `${v}€`} width={45} />
                      <Tooltip content={<RevenueTooltip />} cursor={{ stroke: "rgba(212,175,55,0.15)" }} />
                      {noteDates.map((date) => <ReferenceLine key={date} x={date} stroke="rgba(212,175,55,0.3)" strokeDasharray="3 3" />)}
                      <Line type="monotone" dataKey="revenue_today" stroke="#D4AF37" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#D4AF37", stroke: "rgba(212,175,55,0.3)", strokeWidth: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Notes */}
                <div className="space-y-4">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light">Management-Logbuch</p>
                  <div className="flex gap-2">
                    <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Was wurde heute besprochen?" rows={2} className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2.5 text-sm text-foreground/80 font-light placeholder:text-white/15 resize-none focus:outline-none focus:border-primary/20 transition-colors duration-300" />
                    <button onClick={saveNote} disabled={savingNote || !noteText.trim()} className="self-end px-3 py-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-all duration-300 disabled:opacity-20 disabled:cursor-not-allowed">
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                  {notes.length > 0 && (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {notes.map((n) => (
                        <div key={n.id} className="rounded-xl bg-white/[0.015] border border-white/[0.04] px-3 py-2.5">
                          <p className="text-xs text-foreground/70 font-light leading-relaxed">{n.note_text}</p>
                          <p className="text-[10px] text-white/20 font-light mt-1.5">{formatDateTime(n.created_at)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Doppel-Tipp irgendwo im Slide-Over schließt es
  const lastTapRef = useRef<number>(0);
  const handleDoubleTapClose = (e: React.PointerEvent) => {
    // Ignoriere Tipps auf interaktive Elemente (Buttons, Inputs, Links)
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a, [role='button'], [contenteditable='true']")) {
      lastTapRef.current = 0;
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      onClose();
    } else {
      lastTapRef.current = now;
    }
  };

  const slideOverContent = (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          onPointerDown={handleDoubleTapClose}
          className="fixed inset-y-0 right-0 w-full sm:w-[520px] z-50 border-l border-white/[0.06] bg-zinc-950/[0.97] backdrop-blur-3xl shadow-[-20px_0_60px_-15px_rgba(0,0,0,0.5)] flex flex-col"
        >
          {/* ── Hero Header ── */}
          <div
            className="flex items-center gap-3 sm:gap-4 px-5 sm:px-10 pb-4 sm:py-5 border-b border-white/[0.06] bg-zinc-950 z-10 shrink-0"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
          >
            <div className="flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl text-base sm:text-lg font-medium tracking-wide bg-white/[0.04] border border-white/[0.08] text-white/70">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <h2
                onClick={() => {
                  navigator.clipboard.writeText(displayName);
                  toast.success("Name kopiert");
                }}
                className="text-xl sm:text-[26px] font-light tracking-tight gold-text cursor-pointer hover:opacity-70 transition-opacity duration-200 truncate"
                title="Klicken zum Kopieren"
              >
                {displayName}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[11px] text-white/30 font-light tracking-[0.15em] uppercase">{platform} · Profil</p>
                {trend30.direction !== "stable" && (
                  <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    trend30.direction === "up" ? "text-emerald-400/80" : "text-red-400/80"
                  }`}>
                    {trend30.direction === "up" ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                    {trend30.pct > 0 ? "+" : ""}{trend30.pct}% / 30T
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2.5 rounded-xl hover:bg-white/[0.04] text-white/25 hover:text-white/50 transition-colors duration-300 shrink-0"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/5"
          >
            <div className="p-5 sm:p-10 pb-16 space-y-8 sm:space-y-12">
              {loading ? (
                <div className="flex items-center justify-center py-24">
                  <span className="h-5 w-5 border border-white/20 border-t-white/60 rounded-full" style={{ animation: "spin-slow 1s linear infinite" }} />
                </div>
              ) : history.length === 0 ? (
                <p className="text-center text-white/20 font-light py-20 text-sm tracking-wide">Noch keine historischen Daten vorhanden.</p>
              ) : (
                <>
                  {/* ── 2. KPI Grid (2×2) ── */}
                  <div className="grid grid-cols-2 gap-4">
                    {kpis.map((kpi) => {
                      const Icon = kpi.icon;
                      return (
                        <div
                          key={kpi.label}
                          className="relative rounded-xl border p-5 overflow-hidden"
                          style={{
                            borderColor: `hsl(${kpi.accent} / 0.18)`,
                            background: `linear-gradient(135deg, hsl(${kpi.accent} / 0.10) 0%, hsl(${kpi.accent} / 0.02) 100%)`,
                            boxShadow: `0 0 28px -12px hsl(${kpi.accent} / 0.5)`,
                          }}
                        >
                          <div aria-hidden className="absolute -top-8 -right-8 h-20 w-20 rounded-full opacity-30 blur-2xl" style={{ background: `hsl(${kpi.accent} / 0.6)` }} />
                          <div className="flex items-center gap-1.5 relative z-[1]">
                            <Icon className="h-3.5 w-3.5" style={{ color: `hsl(${kpi.accent} / 0.85)` }} />
                            <p className="text-[10px] uppercase tracking-[0.18em] text-white/45 font-medium">{kpi.label}</p>
                          </div>
                          <p className={`text-xl font-light mt-2.5 relative z-[1] ${kpi.gold ? "gold-text" : "text-foreground/85"}`}>{kpi.value}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Labels ── */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light flex items-center gap-1.5">
                        <Tag className="h-3 w-3" /> Labels
                      </p>
                      <button
                        onClick={() => setShowNewLabel(!showNewLabel)}
                        className="text-[10px] text-primary/60 hover:text-primary transition-colors font-medium tracking-wide flex items-center gap-1"
                      >
                        <Plus className="h-3 w-3" /> Neu
                      </button>
                    </div>

                    {showNewLabel && (
                      <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4 space-y-3">
                        <input
                          value={newLabelName}
                          onChange={(e) => setNewLabelName(e.target.value)}
                          placeholder="Label-Name"
                          className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-foreground/80 font-light placeholder:text-white/15 focus:outline-none focus:border-primary/20 transition-colors"
                          onKeyDown={(e) => e.key === "Enter" && createLabel()}
                        />
                        <div className="flex gap-2">
                          {LABEL_COLORS.map((c) => (
                            <button
                              key={c}
                              onClick={() => setNewLabelColor(c)}
                              className={`w-6 h-6 rounded-full border-2 transition-all ${newLabelColor === c ? "border-white/60 scale-110" : "border-transparent opacity-60 hover:opacity-100"}`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                        <button
                          onClick={createLabel}
                          disabled={!newLabelName.trim()}
                          className="w-full py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-medium hover:bg-primary/15 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                        >
                          Erstellen
                        </button>
                      </div>
                    )}

                    {allLabels.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {allLabels.map((label) => {
                          const isAssigned = assignedLabelIds.has(label.id);
                          return (
                            <button
                              key={label.id}
                              onClick={() => toggleLabel(label.id)}
                              onContextMenu={(e) => { e.preventDefault(); deleteLabel(label.id); }}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-200 border ${
                                isAssigned
                                  ? "border-white/20 text-white shadow-sm"
                                  : "border-white/[0.06] text-white/30 hover:text-white/50"
                              }`}
                              style={isAssigned ? { backgroundColor: label.color + "25", borderColor: label.color + "50" } : {}}
                              title="Rechtsklick zum Löschen"
                            >
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                              {label.label_name}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {allLabels.length === 0 && !showNewLabel && (
                      <p className="text-[11px] text-white/15 font-light">Noch keine Labels erstellt.</p>
                    )}
                  </div>

                  {/* ── 7-Tage-Trend (Umsatz, Verzug, Mass-DMs) ── */}
                  <WeekTrendCard history={history} />

                  {/* ── 30-Tage-Trend ── */}
                  {last30.length >= 4 && (
                    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-7 relative">
                      <div className="flex items-center justify-between mb-5">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light">30-Tage-Trend</p>
                        <span className={`text-xs font-medium px-3 py-1 rounded-full ${
                          trend30.direction === "up"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : trend30.direction === "down"
                            ? "bg-red-500/10 text-red-400 border border-red-500/20"
                            : "bg-white/[0.04] text-white/40 border border-white/[0.06]"
                        }`}>
                          {trend30.direction === "up" ? "↑" : trend30.direction === "down" ? "↓" : "→"}{" "}
                          {trend30.pct > 0 ? "+" : ""}{trend30.pct}%
                        </span>
                      </div>
                      <ResponsiveContainer width="100%" height={140}>
                        <AreaChart data={last30}>
                          <defs>
                            <linearGradient id="trend30Fill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={trend30.direction === "down" ? "#ef4444" : "#10b981"} stopOpacity={0.2} />
                              <stop offset="100%" stopColor={trend30.direction === "down" ? "#ef4444" : "#10b981"} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="analysis_date" tickFormatter={formatDate} axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,0.15)", fontSize: 10 }} tickFormatter={(v) => `${v}€`} width={50} />
                          <Tooltip content={<RevenueTooltip />} cursor={{ stroke: "rgba(255,255,255,0.06)" }} />
                          <Area
                            type="monotone"
                            dataKey="revenue_today"
                            stroke={trend30.direction === "down" ? "#ef4444" : "#10b981"}
                            strokeWidth={1.5}
                            fill="url(#trend30Fill)"
                            dot={false}
                            activeDot={{ r: 4, fill: trend30.direction === "down" ? "#ef4444" : "#10b981", stroke: "rgba(255,255,255,0.1)", strokeWidth: 4 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* ── 3. Revenue Chart ── */}
                  <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-7">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light mb-7">Umsatzverlauf</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={enrichedHistory}>
                        <XAxis dataKey="analysis_date" tickFormatter={formatDate} axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,0.15)", fontSize: 10 }} tickFormatter={(v) => `${v}€`} width={50} />
                        <Tooltip content={<RevenueTooltip />} cursor={{ stroke: "rgba(212,175,55,0.15)" }} />
                        {noteDates.map((date) => (
                          <ReferenceLine key={date} x={date} stroke="rgba(212,175,55,0.3)" strokeDasharray="3 3" />
                        ))}
                        <Line type="monotone" dataKey="revenue_today" stroke="#D4AF37" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#D4AF37", stroke: "rgba(212,175,55,0.3)", strokeWidth: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                    {noteDates.length > 0 && (
                      <p className="text-[10px] text-white/15 font-light mt-4">Gestrichelte Linien = Coaching-Notizen</p>
                    )}
                  </div>

                  {/* ── 4. Postfach-Disziplin ── */}
                  <div className="space-y-5">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light">Postfach-Disziplin</p>
                    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-7">
                      <ResponsiveContainer width="100%" height={170}>
                        <AreaChart data={history}>
                          <defs>
                            <linearGradient id="ghostFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#E25822" stopOpacity={0.2} />
                              <stop offset="100%" stopColor="#E25822" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="analysis_date" tickFormatter={formatDate} axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,0.15)", fontSize: 10 }} width={30} />
                          <Tooltip content={<GhostChatTooltip />} cursor={{ stroke: "rgba(226,88,34,0.15)" }} />
                          <Area type="monotone" dataKey="open_chats" stroke="#E25822" strokeWidth={1.5} fill="url(#ghostFill)" dot={false} activeDot={{ r: 4, fill: "#E25822", stroke: "rgba(226,88,34,0.3)", strokeWidth: 6 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    {ghostSummary && (
                      <div className="rounded-xl bg-white/[0.015] border border-white/[0.04] p-5">
                        <p className="text-xs text-white/40 font-light leading-relaxed">
                          Letzte 7 Tage: Ø <span className="text-[#E25822] font-medium">{ghostSummary.avgChats} Chats</span> offen,{" "}
                          <span className="text-[#E25822] font-medium">{ghostSummary.avgDelay} Tage</span> Verzug.{" "}
                          Trend: <span className="font-medium text-white/60">{ghostSummary.trend}</span>
                        </p>
                      </div>
                    )}
                  </div>

                  {/* ── 5. Management-Logbuch ── */}
                  <div className="space-y-5">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light">Management-Logbuch</p>
                    <div className="flex gap-3">
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Was wurde heute besprochen?"
                        rows={2}
                        className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3 text-sm text-foreground/80 font-light placeholder:text-white/15 resize-none focus:outline-none focus:border-primary/20 transition-colors duration-300"
                      />
                      <button
                        onClick={saveNote}
                        disabled={savingNote || !noteText.trim()}
                        className="self-end px-4 py-3 rounded-xl bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-all duration-300 disabled:opacity-20 disabled:cursor-not-allowed"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                    {notes.length > 0 && (
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {notes.map((n) => (
                          <div key={n.id} className="rounded-xl bg-white/[0.015] border border-white/[0.04] px-4 py-3">
                            <p className="text-xs text-foreground/70 font-light leading-relaxed">{n.note_text}</p>
                            <p className="text-[10px] text-white/20 font-light mt-2">{formatDateTime(n.created_at)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ── 6. Verlauf-Tabelle ── */}
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light mb-5">Verlauf</p>
                    <div className="rounded-xl bg-white/[0.015] border border-white/[0.04] overflow-hidden">
                      <div className="grid grid-cols-3 sm:grid-cols-5 px-3 sm:px-5 py-3 border-b border-white/[0.05]">
                        {["Datum", "Umsatz", "DMs"].map((h) => (
                          <span key={h} className="text-[10px] uppercase tracking-[0.15em] text-white/20 font-light">{h}</span>
                        ))}
                        {["Chats", "Verzug"].map((h) => (
                          <span key={h} className="text-[10px] uppercase tracking-[0.15em] text-white/20 font-light hidden sm:block">{h}</span>
                        ))}
                      </div>
                      {[...history].reverse().map((row, i) => (
                        <div key={i} className="grid grid-cols-3 sm:grid-cols-5 px-3 sm:px-5 py-3 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.01] transition-colors duration-300">
                          <span className="text-xs text-white/40 font-light">{formatDate(row.analysis_date)}</span>
                          <span className="text-xs font-light gold-text">{formatCurrency(row.revenue_today)}</span>
                          <span className="text-xs text-white/35 font-light">{row.mass_dms}</span>
                          <span className="text-xs text-white/35 font-light hidden sm:block">{row.open_chats}</span>
                          <span className={`text-xs font-light hidden sm:block ${row.response_delay_days > 0 ? "text-[#E25822]/70" : "text-white/20"}`}>
                            {row.response_delay_days > 0 ? `${row.response_delay_days}d` : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );

  return typeof document !== "undefined" ? createPortal(slideOverContent, document.body) : slideOverContent;
}
