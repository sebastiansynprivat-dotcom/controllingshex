import { TrendingUp, TrendingDown, Minus, Users, AlertTriangle, DollarSign, X, ChevronDown, ChevronUp } from "lucide-react";
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

/** Extract per-category counts across all reports */
function extractCategoryTimeline(reports: ReportSummary[]) {
  // Collect all unique category names from latest report
  const latestResult = reports.length > 0 && isAnalysisResult(reports[0].result_json)
    ? reports[0].result_json
    : null;
  if (!latestResult) return { categoryNames: [], timeline: [] };

  const categoryNames = latestResult.categories.map((c) => c.categoryName);

  // Build timeline (oldest first)
  const timeline = [...reports].reverse().map((report) => {
    const result = isAnalysisResult(report.result_json) ? report.result_json : null;
    const entry: Record<string, number | string> = {
      date: report.analysis_date,
      dateLabel: new Date(report.analysis_date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }),
    };
    for (const catName of categoryNames) {
      const found = result?.categories.find((c) => c.categoryName === catName);
      entry[catName] = found ? found.chatters.length : 0;
    }
    return entry;
  });

  return { categoryNames, timeline };
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

const categoryColors = [
  "hsl(var(--primary))", "#f59e0b", "#ef4444", "#10b981", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#a855f7",
  "#6366f1", "#84cc16", "#e11d48", "#0ea5e9", "#d946ef",
  "#22c55e", "#eab308", "#3b82f6", "#f43f5e", "#64748b",
  "#7c3aed", "#059669",
];

function ExpandedChart({
  dataKey,
  label,
  color,
  data,
  onClose,
}: {
  dataKey: string;
  label: string;
  color: string;
  data: Record<string, number | string>[];
  onClose: (e: React.MouseEvent) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden"
    >
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-foreground/80">{label} — Verlauf</span>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/5 text-white/30 hover:text-white/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="h-48 sm:h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
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
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                dot={{ r: 3, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: color, strokeWidth: 2, stroke: "rgba(255,255,255,0.2)" }}
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
                <th className="text-right pb-2 font-medium">Anzahl</th>
                <th className="text-right pb-2 font-medium">Δ</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((row, i, arr) => {
                const val = (row[dataKey] as number) || 0;
                const prevVal = i < arr.length - 1 ? (arr[i + 1][dataKey] as number) || 0 : 0;
                const delta = val - prevVal;
                return (
                  <tr key={row.date as string} className="border-b border-white/[0.03]">
                    <td className="py-1.5 text-foreground/60">
                      {new Date(row.date as string).toLocaleDateString("de-DE")}
                    </td>
                    <td className="py-1.5 text-right text-foreground">{val}</td>
                    <td className={`py-1.5 text-right ${
                      delta === 0 ? "text-white/20" : delta < 0 ? "text-emerald-400" : "text-red-400"
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
  );
}

export default function TrendWidget({ reports, selectedIndex }: TrendWidgetProps) {
  const { categoryNames, timeline } = useMemo(() => extractCategoryTimeline(reports), [reports]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const currentTimelineIdx = timeline.length - 1 - selectedIndex;
  const prevTimelineIdx = currentTimelineIdx - 1;

  if (categoryNames.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Per-category mini cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {categoryNames.map((catName, i) => {
          const color = categoryColors[i % categoryColors.length];
          const currentVal = currentTimelineIdx >= 0 ? (timeline[currentTimelineIdx]?.[catName] as number) || 0 : 0;
          const prevVal = prevTimelineIdx >= 0 ? (timeline[prevTimelineIdx]?.[catName] as number) || 0 : 0;
          const isExpanded = expandedCategory === catName;
          const latestResult = isAnalysisResult(reports[0]?.result_json) ? reports[0].result_json : null;
          const emoji = latestResult?.categories.find((c) => c.categoryName === catName)?.emoji || "";

          return (
            <div
              key={catName}
              onClick={() => setExpandedCategory(isExpanded ? null : catName)}
              className={`rounded-lg border p-2.5 space-y-1 transition-all duration-300 cursor-pointer ${
                isExpanded
                  ? "border-white/20 bg-white/[0.04]"
                  : "border-white/[0.04] bg-white/[0.01] hover:border-white/10"
              }`}
            >
              <div className="flex items-center justify-between min-w-0">
                <span className="text-[10px] text-white/35 font-medium truncate mr-1">
                  {emoji} {catName}
                </span>
                {prevTimelineIdx >= 0 && <TrendIcon current={currentVal} previous={prevVal} />}
              </div>
              <div className="flex items-end gap-1.5">
                <span className="text-base font-light text-foreground">{currentVal}</span>
                {prevTimelineIdx >= 0 && (
                  <DeltaBadge current={currentVal} previous={prevVal} invert={false} />
                )}
              </div>
              {timeline.length >= 3 && (
                <div className="h-6 w-full pointer-events-none">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timeline}>
                      <Line type="monotone" dataKey={catName} stroke={color} strokeWidth={1} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Expanded category chart */}
      <AnimatePresence>
        {expandedCategory && (
          <ExpandedChart
            dataKey={expandedCategory}
            label={expandedCategory}
            color={categoryColors[categoryNames.indexOf(expandedCategory) % categoryColors.length]}
            data={timeline}
            onClose={(e) => { e.stopPropagation(); setExpandedCategory(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
