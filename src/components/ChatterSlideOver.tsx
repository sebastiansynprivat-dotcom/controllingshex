import { useEffect, useState, useMemo } from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import {
  ResponsiveContainer,
  LineChart,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

interface HistoryRow {
  analysis_date: string;
  revenue_today: number;
  mass_dms: number;
  open_chats: number;
  response_delay_days: number;
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

function formatCurrency(v: number) {
  return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/* Custom Tooltips */
function RevenueTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as HistoryRow | undefined;
  if (!row) return null;
  return (
    <div className="bg-zinc-900/90 backdrop-blur-2xl border border-white/[0.08] rounded-xl px-5 py-3.5 shadow-2xl">
      <p className="text-[11px] text-white/35 font-light tracking-wider mb-2">{formatDate(row.analysis_date)}</p>
      <p className="text-lg font-light gold-text">{formatCurrency(row.revenue_today)}</p>
      <p className="text-xs text-white/40 font-light mt-1">{row.mass_dms} MassDMs</p>
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

export default function ChatterSlideOver({ open, onClose, chatterName, platform }: Props) {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !chatterName) return;
    setLoading(true);
    supabase
      .from("chatter_history")
      .select("analysis_date, revenue_today, mass_dms, open_chats, response_delay_days")
      .eq("chatter_name", chatterName)
      .eq("platform", platform)
      .order("analysis_date", { ascending: true })
      .then(({ data }) => {
        setHistory(
          (data || []).map((r: any) => ({
            analysis_date: r.analysis_date,
            revenue_today: Number(r.revenue_today) || 0,
            mass_dms: Number(r.mass_dms) || 0,
            open_chats: Number(r.open_chats) || 0,
            response_delay_days: Number(r.response_delay_days) || 0,
          }))
        );
        setLoading(false);
      });
  }, [open, chatterName, platform]);

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

  // Ghost-chat trend analysis (last 7 days)
  const ghostSummary = useMemo(() => {
    if (history.length < 2) return null;
    const last7 = history.slice(-7);
    const avgC = last7.reduce((s, r) => s + r.open_chats, 0) / last7.length;
    const avgD = last7.filter((r) => r.response_delay_days > 0);
    const avgDel = avgD.length ? avgD.reduce((s, r) => s + r.response_delay_days, 0) / avgD.length : 0;
    // Trend: compare first half vs second half
    const half = Math.floor(last7.length / 2);
    const firstHalf = last7.slice(0, half);
    const secondHalf = last7.slice(half);
    const avgFirst = firstHalf.length ? firstHalf.reduce((s, r) => s + r.open_chats, 0) / firstHalf.length : 0;
    const avgSecond = secondHalf.length ? secondHalf.reduce((s, r) => s + r.open_chats, 0) / secondHalf.length : 0;
    let trend = "Stabil";
    if (avgSecond > avgFirst * 1.1) trend = "Verschlechternd ↗";
    else if (avgSecond < avgFirst * 0.9) trend = "Verbessernd ↘";
    return {
      avgChats: avgC.toFixed(1),
      avgDelay: avgDel.toFixed(1),
      trend,
    };
  }, [history]);

  const kpis = [
    { label: "Ø Tagesumsatz", value: formatCurrency(avgRevenue), gold: true },
    { label: "Höchster Umsatz", value: formatCurrency(maxRevenue), gold: true },
    { label: "Ø MassDMs", value: String(avgDMs), gold: false },
    { label: "Ø Offene Chats", value: avgChats, gold: false },
    { label: "Ø Antwort-Verzug", value: `${avgDelay} Tage`, gold: false },
  ];

  const displayName = toTitleCase(chatterName);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 480, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          className="shrink-0 h-full border-l border-white/[0.08] bg-zinc-950/95 backdrop-blur-3xl overflow-y-auto overflow-x-hidden"
        >
          <div className="w-[480px] p-10 space-y-10">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-light text-foreground tracking-tight">{displayName}</h2>
                <p className="text-[11px] text-white/25 mt-1.5 font-light tracking-wider">{platform} · Performance</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/[0.05] text-white/30 hover:text-white/60 transition-colors duration-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <span className="h-5 w-5 border border-white/20 border-t-white/60 rounded-full" style={{ animation: "spin-slow 1s linear infinite" }} />
              </div>
            ) : history.length === 0 ? (
              <p className="text-center text-white/25 font-light py-16 text-sm">Noch keine historischen Daten vorhanden.</p>
            ) : (
              <>
                {/* KPI Cards */}
                <div className="grid grid-cols-2 gap-4">
                  {kpis.map((kpi) => (
                    <div key={kpi.label} className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-5">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light">{kpi.label}</p>
                      <p className={`text-xl font-light mt-2 ${kpi.gold ? "gold-text" : "text-foreground/80"}`}>{kpi.value}</p>
                    </div>
                  ))}
                </div>

                {/* Revenue Chart */}
                <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-6">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light mb-6">Umsatzverlauf</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={history}>
                      <XAxis dataKey="analysis_date" tickFormatter={formatDate} axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,0.15)", fontSize: 10 }} tickFormatter={(v) => `${v}€`} width={45} />
                      <Tooltip content={<RevenueTooltip />} cursor={{ stroke: "rgba(212,175,55,0.15)" }} />
                      <Line type="monotone" dataKey="revenue_today" stroke="#D4AF37" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#D4AF37", stroke: "rgba(212,175,55,0.3)", strokeWidth: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Postfach-Disziplin Section */}
                <div className="space-y-6">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light">Postfach-Disziplin (Historie)</p>

                  {/* Ghost-Chat Area Chart */}
                  <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-6">
                    <ResponsiveContainer width="100%" height={160}>
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

                  {/* AI Summary */}
                  {ghostSummary && (
                    <div className="rounded-xl bg-white/[0.015] border border-white/[0.04] p-5">
                      <p className="text-xs text-white/40 font-light leading-relaxed">
                        In den letzten 7 Tagen wurden im Schnitt <span className="text-[#E25822] font-medium">{ghostSummary.avgChats} Chats</span> für{" "}
                        <span className="text-[#E25822] font-medium">{ghostSummary.avgDelay} Tage</span> ignoriert.{" "}
                        Trend: <span className="font-medium text-white/60">{ghostSummary.trend}</span>
                      </p>
                    </div>
                  )}
                </div>

                {/* History List */}
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light mb-5">Verlauf</p>
                  <div className="rounded-xl bg-white/[0.015] border border-white/[0.04] overflow-hidden">
                    <div className="grid grid-cols-5 px-5 py-3 border-b border-white/[0.05]">
                      {["Datum", "Umsatz", "Chats", "Verzug", "DMs"].map((h) => (
                        <span key={h} className="text-[10px] uppercase tracking-[0.15em] text-white/20 font-light">{h}</span>
                      ))}
                    </div>
                    {[...history].reverse().map((row, i) => (
                      <div key={i} className="grid grid-cols-5 px-5 py-3 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.01] transition-colors duration-300">
                        <span className="text-xs text-white/40 font-light">{formatDate(row.analysis_date)}</span>
                        <span className="text-xs font-light gold-text">{formatCurrency(row.revenue_today)}</span>
                        <span className="text-xs text-white/35 font-light">{row.open_chats}</span>
                        <span className={`text-xs font-light ${row.response_delay_days > 0 ? "text-[#E25822]/70" : "text-white/20"}`}>
                          {row.response_delay_days > 0 ? `${row.response_delay_days}d` : "—"}
                        </span>
                        <span className="text-xs text-white/35 font-light">{row.mass_dms}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
