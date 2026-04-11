import { useEffect, useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Send } from "lucide-react";
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

interface Props {
  open: boolean;
  onClose: () => void;
  chatterName: string;
  platform: string;
}

function toTitleCase(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

export default function ChatterSlideOver({ open, onClose, chatterName, platform }: Props) {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<CoachingNote[]>([]);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
  
  // Only compute delay average from rows that actually have delay > 0
  const avgDelay = history.length
    ? (() => {
        const withDelay = history.filter((r) => r.response_delay_days > 0);
        return withDelay.length ? (withDelay.reduce((s, r) => s + r.response_delay_days, 0) / withDelay.length).toFixed(1) : "0";
      })()
    : "0";

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
    { label: "Ø Tagesumsatz", value: formatCurrency(avgRevenue), gold: true },
    { label: "Höchster Umsatz", value: formatCurrency(maxRevenue), gold: true },
    { label: "Ø MassDMs / Tag", value: String(avgDMs), gold: false },
    { label: "Ø Antwort-Verzug", value: `${avgDelay} Tage`, gold: false },
  ];

  const displayName = toTitleCase(chatterName);

  const slideOverContent = (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          className="fixed inset-y-0 right-0 w-full sm:w-[520px] z-50 border-l border-white/[0.06] bg-zinc-950/[0.97] backdrop-blur-3xl shadow-[-20px_0_60px_-15px_rgba(0,0,0,0.5)] flex flex-col"
        >
          {/* ── Sticky Header ── */}
          <div
            className="flex items-center justify-between px-5 sm:px-10 pb-4 sm:py-5 border-b border-white/[0.06] bg-zinc-950 z-10 shrink-0"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
          >
            <div className="min-w-0">
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
              <p className="text-[11px] text-white/20 mt-1 font-light tracking-[0.15em] uppercase">{platform} · Performance-Profil</p>
            </div>
            <button
              onClick={onClose}
              className="p-2.5 rounded-xl hover:bg-white/[0.04] text-white/25 hover:text-white/50 transition-colors duration-300 shrink-0 ml-4"
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
                    {kpis.map((kpi) => (
                      <div key={kpi.label} className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-5">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light">{kpi.label}</p>
                        <p className={`text-xl font-light mt-2.5 ${kpi.gold ? "gold-text" : "text-foreground/70"}`}>{kpi.value}</p>
                      </div>
                    ))}
                  </div>

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
