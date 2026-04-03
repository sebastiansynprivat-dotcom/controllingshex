import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

interface HistoryRow {
  analysis_date: string;
  revenue_today: number;
  mass_dms: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  chatterName: string;
  platform: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

function formatCurrency(v: number) {
  return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/* Custom Tooltip */
function GlassTooltip({ active, payload, label }: any) {
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

export default function ChatterSlideOver({ open, onClose, chatterName, platform }: Props) {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !chatterName) return;
    setLoading(true);
    supabase
      .from("chatter_history")
      .select("analysis_date, revenue_today, mass_dms")
      .eq("chatter_name", chatterName)
      .eq("platform", platform)
      .order("analysis_date", { ascending: true })
      .then(({ data }) => {
        setHistory(
          (data || []).map((r: any) => ({
            analysis_date: r.analysis_date,
            revenue_today: Number(r.revenue_today) || 0,
            mass_dms: Number(r.mass_dms) || 0,
          }))
        );
        setLoading(false);
      });
  }, [open, chatterName, platform]);

  const avgRevenue = history.length ? history.reduce((s, r) => s + r.revenue_today, 0) / history.length : 0;
  const maxRevenue = history.length ? Math.max(...history.map((r) => r.revenue_today)) : 0;
  const avgDMs = history.length ? Math.round(history.reduce((s, r) => s + r.mass_dms, 0) / history.length) : 0;

  const kpis = [
    { label: "Ø Tagesumsatz", value: formatCurrency(avgRevenue) },
    { label: "Höchster Umsatz", value: formatCurrency(maxRevenue) },
    { label: "Ø MassDMs", value: String(avgDMs) },
  ];

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-xl bg-zinc-950/95 backdrop-blur-3xl border-l border-white/[0.08] overflow-y-auto"
          >
            <div className="p-8 space-y-10">
              {/* Close */}
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-light text-foreground tracking-tight">{chatterName}</h2>
                  <p className="text-xs text-white/25 mt-1 font-light tracking-wider">{platform} · Historische Performance</p>
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
                  <div className="grid grid-cols-3 gap-4">
                    {kpis.map((kpi) => (
                      <div key={kpi.label} className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-5">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-light">{kpi.label}</p>
                        <p className="text-3xl font-light gold-text mt-2">{kpi.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Line Chart */}
                  <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-6">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light mb-6">Umsatzverlauf</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={history}>
                        <XAxis
                          dataKey="analysis_date"
                          tickFormatter={formatDate}
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "rgba(255,255,255,0.15)", fontSize: 10 }}
                          tickFormatter={(v) => `${v}€`}
                          width={50}
                        />
                        <Tooltip content={<GlassTooltip />} cursor={{ stroke: "rgba(212,175,55,0.15)" }} />
                        <Line
                          type="monotone"
                          dataKey="revenue_today"
                          stroke="#D4AF37"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, fill: "#D4AF37", stroke: "rgba(212,175,55,0.3)", strokeWidth: 6 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* History List */}
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light mb-4">Verlauf</p>
                    <div className="rounded-xl bg-white/[0.015] border border-white/[0.04] overflow-hidden">
                      {/* Header */}
                      <div className="grid grid-cols-3 px-6 py-3 border-b border-white/[0.05]">
                        {["Datum", "Umsatz", "MassDMs"].map((h) => (
                          <span key={h} className="text-[10px] uppercase tracking-[0.2em] text-white/20 font-light">{h}</span>
                        ))}
                      </div>
                      {[...history].reverse().map((row, i) => (
                        <div key={i} className="grid grid-cols-3 px-6 py-3.5 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.01] transition-colors duration-300">
                          <span className="text-sm text-white/50 font-light">{formatDate(row.analysis_date)}</span>
                          <span className="text-sm font-light gold-text">{formatCurrency(row.revenue_today)}</span>
                          <span className="text-sm text-white/40 font-light">{row.mass_dms}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
