import { TrendingUp, TrendingDown, Minus, X } from "lucide-react";
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

function extractCategoryTimeline(reports: ReportSummary[]) {
  const latestResult = reports.length > 0 && isAnalysisResult(reports[0].result_json)
    ? reports[0].result_json
    : null;

  if (!latestResult) return { categoryNames: [], timeline: [], emojis: {} as Record<string, string> };

  const categoryNames = latestResult.categories.map((c) => c.categoryName);
  const emojis = Object.fromEntries(latestResult.categories.map((c) => [c.categoryName, c.emoji]));

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

  return { categoryNames, timeline, emojis };
}

interface TrendWidgetProps {
  reports: ReportSummary[];
  selectedIndex: number;
}

function TrendIcon({ current, previous }: { current: number; previous: number }) {
  if (current > previous) return <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />;
  if (current < previous) return <TrendingDown className="h-3.5 w-3.5 text-red-400" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  const delta = current - previous;
  if (delta === 0) return null;

  return (
    <span className={`text-[10px] font-medium ${delta < 0 ? "text-emerald-400" : "text-red-400"}`}>
      {delta > 0 ? "+" : ""}{delta}
    </span>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-xl">
      <p className="mb-1 text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{payload[0].value}</p>
    </div>
  );
};

const categoryColors = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(var(--destructive))",
  "hsl(var(--sidebar-ring))",
  "hsl(var(--primary))",
  "hsl(var(--accent))",
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
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden"
    >
      <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground/80">{label} — Verlauf</span>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground/70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="h-48 w-full sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={{ stroke: "hsl(var(--border))" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
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
                activeDot={{ r: 5, fill: color, strokeWidth: 2, stroke: "hsl(var(--border))" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 max-h-32 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="pb-2 text-left font-medium">Datum</th>
                <th className="pb-2 text-right font-medium">Anzahl</th>
                <th className="pb-2 text-right font-medium">Δ</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((row, i, arr) => {
                const val = (row[dataKey] as number) || 0;
                const prevVal = i < arr.length - 1 ? (arr[i + 1][dataKey] as number) || 0 : 0;
                const delta = val - prevVal;

                return (
                  <tr key={row.date as string} className="border-b border-border/60">
                    <td className="py-1.5 text-foreground/60">{new Date(row.date as string).toLocaleDateString("de-DE")}</td>
                    <td className="py-1.5 text-right text-foreground">{val}</td>
                    <td className={`py-1.5 text-right ${delta === 0 ? "text-muted-foreground" : delta < 0 ? "text-emerald-400" : "text-red-400"}`}>
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
  const { categoryNames, timeline, emojis } = useMemo(() => extractCategoryTimeline(reports), [reports]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const currentTimelineIdx = timeline.length - 1 - selectedIndex;
  const prevTimelineIdx = currentTimelineIdx - 1;
  const maxVisibleValue = Math.max(
    1,
    ...categoryNames.map((catName) => ((currentTimelineIdx >= 0 ? (timeline[currentTimelineIdx]?.[catName] as number) : 0) || 0)),
  );

  if (categoryNames.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {categoryNames.map((catName, i) => {
          const color = categoryColors[i % categoryColors.length];
          const currentVal = currentTimelineIdx >= 0 ? (timeline[currentTimelineIdx]?.[catName] as number) || 0 : 0;
          const prevVal = prevTimelineIdx >= 0 ? (timeline[prevTimelineIdx]?.[catName] as number) || 0 : 0;
          const isExpanded = expandedCategory === catName;
          const widthPercent = `${Math.max(8, (currentVal / maxVisibleValue) * 100)}%`;

          return (
            <button
              key={catName}
              type="button"
              onClick={() => setExpandedCategory(isExpanded ? null : catName)}
              className={`rounded-lg border p-2.5 text-left transition-all duration-300 ${
                isExpanded
                  ? "border-primary/30 bg-card"
                  : "border-border bg-card/70 hover:border-primary/20"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[10px] font-medium text-foreground/60">
                  {emojis[catName] || ""} {catName}
                </span>
                {prevTimelineIdx >= 0 && <TrendIcon current={currentVal} previous={prevVal} />}
              </div>

              <div className="mt-2 flex items-end gap-1.5">
                <span className="text-base font-light text-foreground">{currentVal}</span>
                {prevTimelineIdx >= 0 && <DeltaBadge current={currentVal} previous={prevVal} />}
              </div>

              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: widthPercent, backgroundColor: color }}
                />
              </div>
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {expandedCategory && (
          <ExpandedChart
            dataKey={expandedCategory}
            label={expandedCategory}
            color={categoryColors[categoryNames.indexOf(expandedCategory) % categoryColors.length]}
            data={timeline}
            onClose={(e) => {
              e.stopPropagation();
              setExpandedCategory(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
