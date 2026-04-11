import { TrendingUp, TrendingDown, Minus, Users, AlertTriangle, DollarSign, X } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface AnalysisCategory {
  emoji: string;
  categoryName: string;
  chatters: { name: string; kpis: Record<string, string>; recommendation?: string }[];
}

interface AnalysisResult {
  categories: AnalysisCategory[];
}

interface ReportSummary {
  analysis_date: string;
  chatter_count: number;
  result_json: unknown;
}

function isAnalysisResult(value: unknown): value is AnalysisResult {
  return !!value && typeof value === "object" && Array.isArray((value as AnalysisResult).categories);
}

function extractKpis(report: ReportSummary) {
  const result = isAnalysisResult(report.result_json) ? report.result_json : null;
  let warnings = 0;
  let zeroAccounts = 0;

  if (result) {
    for (const cat of result.categories) {
      const name = cat.categoryName.toLowerCase();
      if (name.includes("warnung") || name.includes("kritisch") || name.includes("achtung") || name.includes("🔴") || name.includes("rot")) {
        warnings += cat.chatters.length;
      }
      if (name.includes("0€") || name.includes("0 €") || name.includes("inaktiv") || name.includes("kein umsatz")) {
        zeroAccounts += cat.chatters.length;
      }
    }
  }

  return {
    date: report.analysis_date,
    dateLabel: new Date(report.analysis_date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }),
    chatters: report.chatter_count,
    warnings,
    zeroAccounts,
  };
}

interface TrendWidgetProps {
  reports: ReportSummary[];
  selectedIndex: number;
}

function TrendIcon({ current, previous }: { current: number; previous: number }) {
  if (current > previous) return <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />;
  if (current < previous) return <TrendingDown className="h-3.5 w-3.5 text-red-400" />;
  return <Minus className="h-3.5 w-3.5 text-white/30" />;
}

function DeltaBadge({ current, previous, invert = false }: { current: number; previous: number; invert?: boolean }) {
  const delta = current - previous;
  if (delta === 0) return null;
  const isGood = invert ? delta < 0 : delta > 0;
  return (
    <span className={`text-[10px] font-medium ${isGood ? "text-emerald-400" : "text-red-400"}`}>
      {delta > 0 ? "+" : ""}{delta}
    </span>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-background/95 backdrop-blur-sm px-3 py-2 shadow-xl">
      <p className="text-[11px] text-white/40 mb-1">{label}</p>
      <p className="text-sm font-medium text-foreground">{payload[0].value}</p>
    </div>
  );
};

type CardKey = "chatters" | "warnings" | "zeroAccounts";

const cardMeta: Record<CardKey, { label: string; icon: typeof Users; invert: boolean; color: string }> = {
  chatters: { label: "Chatters", icon: Users, invert: false, color: "hsl(var(--primary))" },
  warnings: { label: "Warnungen", icon: AlertTriangle, invert: true, color: "#f59e0b" },
  zeroAccounts: { label: "0€ Accounts", icon: DollarSign, invert: true, color: "#ef4444" },
};

export default function TrendWidget({ reports, selectedIndex }: TrendWidgetProps) {
  const allKpis = useMemo(() => reports.map(extractKpis).reverse(), [reports]);
  const [expandedCard, setExpandedCard] = useState<CardKey | null>(null);

  const current = allKpis.length > 0 ? allKpis[allKpis.length - 1 - selectedIndex] : null;
  const previous = allKpis.length > 1 && selectedIndex < reports.length - 1
    ? allKpis[allKpis.length - 2 - selectedIndex]
    : null;

  if (!current) return null;

  const cards: { key: CardKey; value: number }[] = [
    { key: "chatters", value: current.chatters },
    { key: "warnings", value: current.warnings },
    { key: "zeroAccounts", value: current.zeroAccounts },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {cards.map((card) => {
          const meta = cardMeta[card.key];
          const isExpanded = expandedCard === card.key;
          return (
            <div
              key={card.key}
              onClick={() => setExpandedCard(isExpanded ? null : card.key)}
              className={`rounded-xl border p-3 sm:p-4 space-y-2 transition-all duration-300 cursor-pointer ${
                isExpanded
                  ? "border-white/20 bg-white/[0.04]"
                  : "border-white/[0.06] bg-white/[0.02] hover:border-white/10"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-white/40">
                  <meta.icon className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-medium tracking-wide uppercase">{meta.label}</span>
                </div>
                {previous && <TrendIcon current={card.value} previous={previous[card.key]} />}
              </div>

              <div className="flex items-end gap-2">
                <span className="text-xl sm:text-2xl font-light text-foreground">{card.value}</span>
                {previous && <DeltaBadge current={card.value} previous={previous[card.key]} invert={meta.invert} />}
              </div>

              {allKpis.length >= 3 && (
                <div className="h-8 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={allKpis}>
                      <Line type="monotone" dataKey={card.key} stroke={meta.color} strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Expanded detail chart */}
      <AnimatePresence>
        {expandedCard && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = cardMeta[expandedCard].icon;
                    return <Icon className="h-4 w-4 text-white/40" />;
                  })()}
                  <span className="text-sm font-medium text-foreground/80">
                    {cardMeta[expandedCard].label} — Verlauf
                  </span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setExpandedCard(null); }}
                  className="p-1 rounded-md hover:bg-white/5 text-white/30 hover:text-white/60 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="h-48 sm:h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={allKpis} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="dateLabel"
                      tick={{ fontSize: 11, fill: "rgba(255,255,255,0.3)" }}
                      axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "rgba(255,255,255,0.3)" }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="monotone"
                      dataKey={expandedCard}
                      stroke={cardMeta[expandedCard].color}
                      strokeWidth={2}
                      dot={{ r: 3, fill: cardMeta[expandedCard].color, strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: cardMeta[expandedCard].color, strokeWidth: 2, stroke: "rgba(255,255,255,0.2)" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Data table */}
              <div className="mt-4 max-h-32 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-white/30 border-b border-white/[0.06]">
                      <th className="text-left pb-2 font-medium">Datum</th>
                      <th className="text-right pb-2 font-medium">{cardMeta[expandedCard].label}</th>
                      <th className="text-right pb-2 font-medium">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...allKpis].reverse().map((row, i, arr) => {
                      const prev = i < arr.length - 1 ? arr[i + 1] : null;
                      const delta = prev ? row[expandedCard] - prev[expandedCard] : 0;
                      return (
                        <tr key={row.date} className="border-b border-white/[0.03]">
                          <td className="py-1.5 text-foreground/60">
                            {new Date(row.date).toLocaleDateString("de-DE")}
                          </td>
                          <td className="py-1.5 text-right text-foreground">{row[expandedCard]}</td>
                          <td className={`py-1.5 text-right ${
                            delta === 0 ? "text-white/20" :
                            (cardMeta[expandedCard].invert ? delta < 0 : delta > 0) ? "text-emerald-400" : "text-red-400"
                          }`}>
                            {i < arr.length - 1 ? (delta > 0 ? `+${delta}` : delta) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
