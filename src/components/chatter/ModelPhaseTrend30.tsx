import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { loadModelTimeline, formatEur, type ModelTimeline } from "@/lib/model-tracking";

const PHASE_COLORS = [
  "hsl(45, 90%, 55%)",
  "hsl(200, 80%, 60%)",
  "hsl(280, 70%, 65%)",
  "hsl(160, 70%, 50%)",
  "hsl(0, 70%, 60%)",
  "hsl(30, 80%, 55%)",
];

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

interface Props {
  platform: string;
  modelName: string;
  /** Der Chatter, dessen Profil geöffnet ist — wird im Chart hervorgehoben. */
  focusChatter?: string | null;
  compact?: boolean;
}

/**
 * 30-Tage-Trend eines Models mit farblich getrennten Chatter-Phasen.
 * Wird im ChatterSlideOver eingesetzt, wenn das Profil aus der Model-Sektion
 * heraus geöffnet wurde — dann sieht man auf einen Blick, welcher Chatter
 * das Model wann bespielt hat und wie hoch der Ø-Umsatz war.
 */
export default function ModelPhaseTrend30({ platform, modelName, focusChatter, compact = false }: Props) {
  const [tl, setTl] = useState<ModelTimeline | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    const to = new Date();
    // All-Time: sehr frühes Startdatum, damit die komplette Historie geladen wird.
    loadModelTimeline(
      platform,
      modelName,
      "2000-01-01",
      to.toISOString().split("T")[0],
    )
      .then((t) => !cancel && setTl(t))
      .finally(() => !cancel && setLoading(false));
    return () => {
      cancel = true;
    };
  }, [platform, modelName]);

  const chatterColors = useMemo(() => {
    const map = new Map<string, string>();
    let i = 0;
    for (const p of tl?.phases ?? []) {
      if (!map.has(p.chatterName)) {
        map.set(p.chatterName, PHASE_COLORS[i % PHASE_COLORS.length]);
        i++;
      }
    }
    return map;
  }, [tl]);

  const chartData = useMemo(() => {
    if (!tl) return [] as Array<Record<string, any>>;
    const chatters = Array.from(chatterColors.keys());
    const rows: Record<string, any>[] = tl.daily.map((d) => {
      const row: Record<string, any> = { date: d.date, chatter: d.chatter, revenue: d.revenue };
      for (const c of chatters) row[`c__${c}`] = null;
      if (d.chatter) row[`c__${d.chatter}`] = d.revenue;
      return row;
    });
    for (let i = 1; i < tl.daily.length; i++) {
      const prev = tl.daily[i - 1];
      const cur = tl.daily[i];
      if (prev.chatter && cur.chatter && prev.chatter !== cur.chatter) {
        rows[i][`c__${prev.chatter}`] = cur.revenue;
      }
    }
    return rows;
  }, [tl, chatterColors]);

  const focusKey = useMemo(() => {
    if (!focusChatter) return null;
    const target = focusChatter.trim().toLowerCase();
    for (const name of chatterColors.keys()) {
      if (name.trim().toLowerCase() === target) return name;
    }
    return null;
  }, [focusChatter, chatterColors]);

  if (loading && !tl) {
    return (
      <div className={`premium-card rounded-2xl ${compact ? "p-4" : "p-5"} text-center text-white/30 text-[11px] font-light`}>
        Lade All-Time-Trend …
      </div>
    );
  }
  if (!tl || tl.daily.length === 0 || tl.phases.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: "hsl(45 90% 55%)" }}
            />
            <span className="text-[10px] uppercase tracking-[0.18em] text-white/50 font-medium">
              30-Tage-Trend · {modelName}
            </span>
          </div>
        </div>
        <span className="premium-chip text-[9.5px] font-light px-2 py-0.5 rounded-full bg-white/[0.04] text-white/50 border border-white/[0.08]">
          {tl.phases.length} {tl.phases.length === 1 ? "Chatter" : "Chatter"}
        </span>
      </div>

      <div className={`premium-card ${compact ? "rounded-2xl p-3.5" : "rounded-2xl p-4"} space-y-3`}>
        {/* Phase-Bar */}
        <PhaseBar tl={tl} chatterColors={chatterColors} focusKey={focusKey} />

        {/* Chart */}
        <div className={compact ? "h-40 w-full" : "h-48 w-full"}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(0 0% 100% / 0.04)" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateShort}
                tick={{ fill: "hsl(0 0% 100% / 0.3)", fontSize: 9 }}
                stroke="hsl(0 0% 100% / 0.05)"
              />
              <YAxis
                tick={{ fill: "hsl(0 0% 100% / 0.3)", fontSize: 9 }}
                stroke="hsl(0 0% 100% / 0.05)"
                tickFormatter={(v) => `${v}€`}
                width={38}
              />
              <Tooltip
                cursor={{ stroke: "hsl(0 0% 100% / 0.15)", strokeWidth: 1 }}
                wrapperStyle={{ zIndex: 60, outline: "none", pointerEvents: "none" }}
                allowEscapeViewBox={{ x: true, y: true }}
                offset={12}
                isAnimationActive={false}
                content={({ active, payload, label }: any) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload || {};
                  const rev = Number(p.revenue ?? 0);
                  const color = p.chatter ? chatterColors.get(p.chatter) : undefined;
                  return (
                    <div
                      className="rounded-lg border border-white/10 bg-[#141414]/95 backdrop-blur-md px-2.5 py-1.5 shadow-2xl"
                      style={{ fontSize: 11, minWidth: 120 }}
                    >
                      <div className="text-[9px] uppercase tracking-wider text-white/40 mb-0.5">
                        {formatDateShort(label)}
                      </div>
                      <div className="text-[13px] font-medium text-white tabular-nums">
                        {rev.toFixed(0)} €
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                        {color && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />}
                        <span className="text-[10px] text-white/60 truncate">{p.chatter || "—"}</span>
                      </div>
                    </div>
                  );
                }}
              />
              {tl.phases.map((p, i) => (
                <ReferenceArea
                  key={i}
                  x1={p.fromDate}
                  x2={p.toDate}
                  fill={chatterColors.get(p.chatterName)}
                  fillOpacity={focusKey && p.chatterName === focusKey ? 0.22 : 0.13}
                  stroke="none"
                />
              ))}
              {tl.phases.slice(1).map((p, i) => (
                <ReferenceLine
                  key={`line-${i}`}
                  x={p.fromDate}
                  stroke={chatterColors.get(p.chatterName) || "hsl(0 0% 100% / 0.35)"}
                  strokeWidth={1.25}
                  strokeDasharray="4 3"
                />
              ))}
              {Array.from(chatterColors.entries()).map(([name, color]) => {
                const isFocus = focusKey && name === focusKey;
                return (
                  <Line
                    key={`line-${name}`}
                    type="monotone"
                    dataKey={`c__${name}`}
                    name={name}
                    stroke={color}
                    strokeWidth={isFocus ? 3 : 2.25}
                    strokeOpacity={focusKey && !isFocus ? 0.55 : 1}
                    connectNulls={false}
                    dot={{ r: isFocus ? 3 : 2.25, fill: color, stroke: "#0e0e0e", strokeWidth: 1.25 }}
                    activeDot={{ r: 4.5, stroke: color, strokeWidth: 2, fill: "#0e0e0e" }}
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Ø/Tag pro Chatter */}
        <div className="grid gap-1">
          {tl.phases.map((p, i) => {
            const color = chatterColors.get(p.chatterName) || "hsl(0 0% 100% / 0.35)";
            const isFocus = focusKey && p.chatterName === focusKey;
            return (
              <div
                key={`meta-${p.chatterName}-${p.fromDate}-${i}`}
                className={`flex items-center justify-between gap-3 rounded-md px-2 py-1 text-[10.5px] font-light min-w-0 ${
                  isFocus ? "bg-white/[0.05] border border-white/[0.08]" : "bg-transparent"
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className={`truncate ${isFocus ? "text-white/90" : "text-white/65"}`}>
                    {p.chatterName}
                  </span>
                  <span className="text-white/25 shrink-0">
                    · {formatDateShort(p.fromDate)}–{formatDateShort(p.toDate)} · {p.days}T
                  </span>
                </div>
                <span className="shrink-0 tabular-nums gold-text-subtle">
                  {formatEur(p.avgPerDay)} Ø/Tag
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PhaseBar({
  tl,
  chatterColors,
  focusKey,
}: {
  tl: ModelTimeline;
  chatterColors: Map<string, string>;
  focusKey: string | null;
}) {
  const totalDays = tl.phases.reduce((s, p) => s + p.days, 0);
  if (totalDays <= 0) return null;
  return (
    <div className="flex h-5 w-full overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.03]">
      {tl.phases.map((p, i) => {
        const color = chatterColors.get(p.chatterName) || "hsl(0 0% 100% / 0.35)";
        const width = Math.max(6, (p.days / totalDays) * 100);
        const isFocus = focusKey && p.chatterName === focusKey;
        return (
          <div
            key={`bar-${p.chatterName}-${p.fromDate}-${i}`}
            className="relative min-w-0 border-r border-background/40 last:border-r-0"
            style={{
              width: `${width}%`,
              background: isFocus
                ? `linear-gradient(90deg, ${color}66, ${color}cc)`
                : `linear-gradient(90deg, ${color}33, ${color}77)`,
              opacity: focusKey && !isFocus ? 0.6 : 1,
            }}
            title={`${p.chatterName}: ${formatDateShort(p.fromDate)}–${formatDateShort(p.toDate)} · ${formatEur(p.avgPerDay)} Ø/Tag`}
          >
            <div className="absolute inset-0 flex items-center px-1.5 min-w-0">
              <span className="truncate text-[9.5px] font-medium text-white drop-shadow-sm">
                {p.chatterName}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
