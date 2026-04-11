import { TrendingUp, TrendingDown, Minus, Users, AlertTriangle, DollarSign } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { useMemo } from "react";

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

export default function TrendWidget({ reports, selectedIndex }: TrendWidgetProps) {
  const allKpis = useMemo(() => reports.map(extractKpis).reverse(), [reports]);
  
  const current = allKpis.length > 0 ? allKpis[allKpis.length - 1 - selectedIndex] : null;
  const previous = allKpis.length > 1 && selectedIndex < reports.length - 1
    ? allKpis[allKpis.length - 2 - selectedIndex]
    : null;

  if (!current) return null;

  const cards = [
    {
      label: "Chatters",
      value: current.chatters,
      icon: Users,
      sparkKey: "chatters" as const,
      invert: false,
    },
    {
      label: "Warnungen",
      value: current.warnings,
      icon: AlertTriangle,
      sparkKey: "warnings" as const,
      invert: true,
    },
    {
      label: "0€ Accounts",
      value: current.zeroAccounts,
      icon: DollarSign,
      sparkKey: "zeroAccounts" as const,
      invert: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 sm:p-4 space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white/40">
              <card.icon className="h-3.5 w-3.5" />
              <span className="text-[11px] font-medium tracking-wide uppercase">{card.label}</span>
            </div>
            {previous && <TrendIcon current={card.value} previous={previous[card.sparkKey]} />}
          </div>

          <div className="flex items-end gap-2">
            <span className="text-xl sm:text-2xl font-light text-foreground">{card.value}</span>
            {previous && <DeltaBadge current={card.value} previous={previous[card.sparkKey]} invert={card.invert} />}
          </div>

          {allKpis.length >= 3 && (
            <div className="h-8 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={allKpis}>
                  <Line
                    type="monotone"
                    dataKey={card.sparkKey}
                    stroke="hsl(var(--primary))"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
