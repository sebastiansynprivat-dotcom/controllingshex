import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, TrendingDown, TrendingUp, AlertCircle } from "lucide-react";
import { usePlatform } from "@/contexts/PlatformContext";
import {
  loadEffortPotentialMatrix,
  type EffortPotentialResult,
  type EffortPotentialRow,
} from "@/lib/effort-potential";

interface Props {
  onSelectChatter?: (name: string) => void;
}

export default function EffortPotentialCard({ onSelectChatter }: Props) {
  const { platform } = usePlatform();
  const [data, setData] = useState<EffortPotentialResult | null>(null);
  const [lookback, setLookback] = useState<7 | 14>(14);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadEffortPotentialMatrix(platform, lookback).then((res) => {
      if (!cancelled) {
        setData(res);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [platform, lookback]);

  const empty = !loading && data && data.pullUp.length === 0 && data.underused.length === 0;

  return (
    <div className="premium-card rounded-2xl p-5 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-20 -right-20 h-48 w-48 rounded-full bg-[hsl(280_60%_60%/0.05)] blur-3xl" />
      <div className="relative">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-3.5 w-3.5 text-white/40" />
            <p className="text-[10px] uppercase tracking-[0.2em] gold-text-subtle font-medium">
              Effort × Potential
            </p>
          </div>
          <div className="flex items-center gap-0.5 rounded-full border border-white/[0.06] bg-white/[0.02] p-0.5">
            {([7, 14] as const).map((d) => (
              <button
                key={d}
                onClick={() => setLookback(d)}
                className={`px-2.5 py-0.5 text-[10px] font-light rounded-full tabular-nums transition-colors ${
                  lookback === d
                    ? "bg-white/[0.08] text-white/85"
                    : "text-white/40 hover:text-white/65"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-white/40 font-light leading-relaxed mb-4">
          Wer sitzt auf welchem Account — und passt das? Mismatches zeigen, wo
          ein Re-Assignment Sinn macht.
        </p>

        {loading ? (
          <p className="text-xs text-white/30 font-light">Lade Effort-Profile…</p>
        ) : empty ? (
          <p className="text-xs text-emerald-300/70 font-light">
            Alle Effort-Levels passen aktuell zum Account-Potenzial.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Column
              title="Hochziehen"
              subtitle="Viel Zeit · kleiner Account"
              icon={TrendingUp}
              tone="emerald"
              rows={data?.pullUp ?? []}
              onSelectChatter={onSelectChatter}
            />
            <Column
              title="Underused Top"
              subtitle="Großer Account · wenig Zeit"
              icon={TrendingDown}
              tone="amber"
              rows={data?.underused ?? []}
              onSelectChatter={onSelectChatter}
            />
          </div>
        )}

        {data && data.unassigned.length > 0 && (
          <div className="mt-4 flex items-center gap-2 text-[11px] text-white/45 font-light">
            <AlertCircle className="h-3 w-3 text-amber-300/70" />
            {data.unassigned.length} Chatter ohne zugewiesenen Account
          </div>
        )}
      </div>
    </div>
  );
}

function Column({
  title,
  subtitle,
  icon: Icon,
  tone,
  rows,
  onSelectChatter,
}: {
  title: string;
  subtitle: string;
  icon: typeof TrendingUp;
  tone: "emerald" | "amber";
  rows: EffortPotentialRow[];
  onSelectChatter?: (name: string) => void;
}) {
  const accent =
    tone === "emerald"
      ? "text-emerald-300/85 border-emerald-400/15"
      : "text-amber-300/85 border-amber-400/15";

  return (
    <div className={`rounded-xl border ${accent} bg-white/[0.015] p-3.5`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3" />
        <p className="text-[10px] uppercase tracking-[0.18em] font-medium">{title}</p>
      </div>
      <p className="text-[10px] text-white/35 font-light mb-3">{subtitle}</p>

      {rows.length === 0 ? (
        <p className="text-[11px] text-white/30 font-light">Keine Mismatches.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <button
              key={r.chatterName}
              onClick={() => onSelectChatter?.(r.chatterName)}
              className="w-full text-left px-2 py-2 rounded-lg hover:bg-white/[0.04] transition-colors group"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] text-white/90 font-light truncate">
                  {r.chatterName}
                </span>
                <span className="text-[10px] text-white/40 tabular-nums shrink-0">
                  Δ{r.delta > 0 ? "+" : ""}{r.delta}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-[10px] text-white/45 font-light tabular-nums">
                  Ø {r.avgHoursPerDay.toFixed(1)}h/Tag
                </span>
                {r.tier && (
                  <span className="text-[10px] text-white/55 font-light flex items-center gap-1">
                    <span>{r.tier.emoji}</span>
                    <span>{r.tier.label}</span>
                  </span>
                )}
              </div>
              {r.account && (
                <p className="text-[9.5px] text-white/30 font-light mt-0.5 truncate">
                  {r.account}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
