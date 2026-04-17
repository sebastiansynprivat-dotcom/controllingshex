import { useMemo } from "react";
import { ResponsiveContainer, AreaChart, Area, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Sparkles, Activity } from "lucide-react";

export interface WeekTrendRow {
  analysis_date: string;
  revenue_today: number;
  mass_dms: number;
  response_delay_days: number;
}

interface Props {
  history: WeekTrendRow[];
  /** "lower-is-better" metrics flip color logic. Default fields handled internally. */
  compact?: boolean;
}

type Direction = "up" | "down" | "stable";

interface MetricStat {
  start: number;
  end: number;
  delta: number; // percent (rounded). For metrics where start=0 and end>0 => Infinity-like, we cap.
  direction: Direction;
  goodDirection: "up" | "down"; // up = up is good (revenue), down = up is bad (delay, dms when high)
  trendingMonotone: "rising" | "falling" | "mixed";
}

function formatDateShort(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

function formatCurrencyShort(v: number) {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k €`;
  return `${Math.round(v)} €`;
}

function pctChange(start: number, end: number): number {
  if (start === 0 && end === 0) return 0;
  if (start === 0) return end > 0 ? 999 : -999;
  return Math.round(((end - start) / start) * 100);
}

function classifyMonotone(values: number[]): "rising" | "falling" | "mixed" {
  if (values.length < 3) return "mixed";
  let rising = true;
  let falling = true;
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) rising = false;
    if (values[i] > values[i - 1]) falling = false;
  }
  if (rising && !falling) return "rising";
  if (falling && !rising) return "falling";
  return "mixed";
}

function computeStat(values: number[], goodDirection: "up" | "down"): MetricStat {
  const start = values[0] ?? 0;
  const end = values[values.length - 1] ?? 0;
  const delta = pctChange(start, end);
  const direction: Direction = Math.abs(delta) < 5 ? "stable" : delta > 0 ? "up" : "down";
  return {
    start,
    end,
    delta,
    direction,
    goodDirection,
    trendingMonotone: classifyMonotone(values),
  };
}

function deltaColorClass(stat: MetricStat): string {
  if (stat.direction === "stable") return "bg-white/[0.04] text-white/40 border-white/[0.06]";
  const isGood =
    (stat.direction === "up" && stat.goodDirection === "up") ||
    (stat.direction === "down" && stat.goodDirection === "down");
  return isGood
    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
    : "bg-red-500/10 text-red-400 border-red-500/20";
}

function strokeColor(stat: MetricStat): string {
  if (stat.direction === "stable") return "#a1a1aa";
  const isGood =
    (stat.direction === "up" && stat.goodDirection === "up") ||
    (stat.direction === "down" && stat.goodDirection === "down");
  return isGood ? "#10b981" : "#ef4444";
}

function DirectionIcon({ direction }: { direction: Direction }) {
  if (direction === "up") return <TrendingUp className="h-3 w-3" />;
  if (direction === "down") return <TrendingDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
}

function SparklineTooltip({ active, payload, formatter }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="bg-zinc-900/90 backdrop-blur-2xl border border-white/[0.08] rounded-lg px-3 py-2 shadow-xl">
      <p className="text-[10px] text-white/40 font-light tracking-wider mb-0.5">
        {formatDateShort(row.analysis_date)}
      </p>
      <p className="text-xs font-medium text-white/90">{formatter(row.value)}</p>
    </div>
  );
}

interface SparkConfig {
  key: "revenue" | "delay" | "dms";
  label: string;
  unit: string;
  formatter: (v: number) => string;
  goodDirection: "up" | "down";
  values: number[];
  data: { analysis_date: string; value: number }[];
  gradientId: string;
}

export default function WeekTrendCard({ history, compact = false }: Props) {
  const last7 = useMemo(() => history.slice(-7), [history]);

  const configs = useMemo<SparkConfig[]>(() => {
    if (last7.length === 0) return [];
    const dates = last7.map((r) => r.analysis_date);

    return [
      {
        key: "revenue",
        label: "Umsatz",
        unit: "€",
        formatter: formatCurrencyShort,
        goodDirection: "up",
        values: last7.map((r) => r.revenue_today),
        data: last7.map((r) => ({ analysis_date: r.analysis_date, value: r.revenue_today })),
        gradientId: `wtRev-${dates[0]}`,
      },
      {
        key: "delay",
        label: "Verzug",
        unit: "Tage",
        formatter: (v: number) => `${v} d`,
        goodDirection: "down",
        values: last7.map((r) => r.response_delay_days),
        data: last7.map((r) => ({ analysis_date: r.analysis_date, value: r.response_delay_days })),
        gradientId: `wtDel-${dates[0]}`,
      },
      {
        key: "dms",
        label: "Mass-DMs",
        unit: "",
        formatter: (v: number) => String(Math.round(v)),
        goodDirection: "down",
        values: last7.map((r) => r.mass_dms),
        data: last7.map((r) => ({ analysis_date: r.analysis_date, value: r.mass_dms })),
        gradientId: `wtDms-${dates[0]}`,
      },
    ];
  }, [last7]);

  const stats = useMemo(() => {
    return configs.map((c) => ({ config: c, stat: computeStat(c.values, c.goodDirection) }));
  }, [configs]);

  // Smart insights
  const insights = useMemo(() => {
    const out: { tone: "danger" | "warn" | "good" | "neutral"; text: string }[] = [];
    for (const { config, stat } of stats) {
      // Skip if no data variation (all zeros)
      const allZero = config.values.every((v) => v === 0);
      if (allZero && config.key !== "delay") continue;

      if (config.key === "revenue") {
        if (stat.direction === "up" && stat.delta >= 50) {
          out.push({ tone: "good", text: `Umsatz hat sich diese Woche ${stat.delta >= 100 ? "mehr als verdoppelt" : `um ${stat.delta}% gesteigert`}.` });
        } else if (stat.direction === "down" && stat.delta <= -30) {
          out.push({ tone: "danger", text: `Umsatz ist um ${Math.abs(stat.delta)}% eingebrochen.` });
        } else if (stat.trendingMonotone === "falling" && config.values.length >= 4) {
          out.push({ tone: "warn", text: "Umsatz fällt seit mehreren Tagen kontinuierlich." });
        } else if (stat.trendingMonotone === "rising" && config.values.length >= 4) {
          out.push({ tone: "good", text: "Umsatz steigt seit mehreren Tagen kontinuierlich." });
        }
      }

      if (config.key === "delay") {
        const maxDelay = Math.max(...config.values);
        if (maxDelay >= 3 && stat.trendingMonotone === "rising") {
          out.push({ tone: "danger", text: `Verzug steigt — aktuell ${stat.end} Tage.` });
        } else if (stat.end >= 2 && stat.start <= 0) {
          out.push({ tone: "warn", text: `Verzug neu aufgetreten (${stat.end} Tage).` });
        } else if (stat.start > 0 && stat.end === 0) {
          out.push({ tone: "good", text: "Verzug aufgeholt." });
        }
      }

      if (config.key === "dms") {
        if (stat.direction === "up" && stat.delta >= 100 && stat.end >= 30) {
          out.push({ tone: "warn", text: `Mass-DMs ${stat.delta >= 200 ? "verdreifacht" : "verdoppelt"} — Chat-Stau droht.` });
        } else if (stat.direction === "down" && stat.delta <= -50 && stat.start >= 20) {
          out.push({ tone: "warn", text: `Mass-DMs eingebrochen (-${Math.abs(stat.delta)}%) — Aktivität gesunken.` });
        }
      }
    }

    if (out.length === 0) {
      out.push({ tone: "neutral", text: "Stabil — keine Auffälligkeiten in der Woche." });
    }
    return out;
  }, [stats]);

  if (last7.length < 2) {
    return null;
  }

  const insightToneClass = (tone: "danger" | "warn" | "good" | "neutral") => {
    switch (tone) {
      case "danger":
        return "border-red-500/30 bg-red-500/[0.06] text-red-300";
      case "warn":
        return "border-amber-500/30 bg-amber-500/[0.06] text-amber-200";
      case "good":
        return "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300";
      default:
        return "border-white/[0.06] bg-white/[0.02] text-white/50";
    }
  };

  const insightIcon = (tone: "danger" | "warn" | "good" | "neutral") => {
    switch (tone) {
      case "danger":
        return <AlertTriangle className="h-3 w-3 shrink-0" />;
      case "warn":
        return <Activity className="h-3 w-3 shrink-0" />;
      case "good":
        return <Sparkles className="h-3 w-3 shrink-0" />;
      default:
        return <Minus className="h-3 w-3 shrink-0" />;
    }
  };

  return (
    <div className={`rounded-2xl bg-white/[0.02] border border-white/[0.05] ${compact ? "p-3" : "p-7"} ${compact ? "space-y-3" : "space-y-5"}`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light">7-Tage-Trend</p>
        <span className="text-[10px] text-white/25 font-light">
          {formatDateShort(last7[0].analysis_date)} → {formatDateShort(last7[last7.length - 1].analysis_date)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {stats.map(({ config, stat }) => {
          const color = strokeColor(stat);
          return (
            <div
              key={config.key}
              className="rounded-xl bg-white/[0.015] border border-white/[0.04] p-2.5 flex flex-col gap-1.5"
            >
              <p className="text-[10px] uppercase tracking-[0.1em] text-white/55 font-medium leading-tight">
                {config.label}
              </p>

              <div className="h-9 -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={config.data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                    <defs>
                      <linearGradient id={config.gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="analysis_date" hide />
                    <YAxis hide domain={["auto", "auto"]} />
                    <Tooltip
                      content={<SparklineTooltip formatter={config.formatter} />}
                      cursor={{ stroke: "rgba(255,255,255,0.08)" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={color}
                      strokeWidth={1.5}
                      fill={`url(#${config.gradientId})`}
                      dot={false}
                      activeDot={{ r: 3, fill: color, stroke: "rgba(255,255,255,0.1)", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-medium text-white/85 truncate" title={`${config.formatter(stat.start)} → ${config.formatter(stat.end)}`}>
                  {config.formatter(stat.end)}
                </span>
                <span
                  className={`inline-flex items-center gap-0.5 text-[9px] font-medium px-1 py-0.5 rounded border ${deltaColorClass(stat)}`}
                  title={`${config.formatter(stat.start)} → ${config.formatter(stat.end)}`}
                >
                  <DirectionIcon direction={stat.direction} />
                  {stat.direction === "stable" ? "0%" : `${stat.delta > 0 ? "+" : ""}${Math.abs(stat.delta) >= 999 ? "∞" : stat.delta}%`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Smart Insights */}
      <div className="space-y-1.5">
        {insights.map((ins, i) => (
          <div
            key={i}
            className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 ${insightToneClass(ins.tone)}`}
          >
            <span className="mt-0.5">{insightIcon(ins.tone)}</span>
            <p className="text-[11px] leading-snug font-light">{ins.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
