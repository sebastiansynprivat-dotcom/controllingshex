import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { TrendingDown, ChevronRight, Sparkles, ChevronDown } from "lucide-react";
import CountUp from "@/components/CountUp";
import {
  computeRecoveryQueue,
  loadRecoveryHistory,
  totalRecoveryEur,
  type RecoveryEntry,
} from "@/lib/recovery-queue";

interface Props {
  platform: string;
  onChatterSelect: (name: string) => void;
}

function formatEur(v: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Math.round(v));
}

function Sparkline({ values, tone }: { values: number[]; tone: "warn" | "crit" }) {
  const w = 64;
  const h = 18;
  const max = Math.max(1, ...values);
  const stepX = w / Math.max(1, values.length - 1);
  const points = values.map((v, i) => `${i * stepX},${h - (v / max) * h}`).join(" ");
  const stroke = tone === "crit" ? "hsl(0 75% 65%)" : "hsl(38 92% 60%)";
  const fill = tone === "crit" ? "hsl(0 75% 65% / 0.12)" : "hsl(38 92% 60% / 0.12)";
  return (
    <svg width={w} height={h} className="shrink-0">
      <polygon points={`0,${h} ${points} ${w},${h}`} fill={fill} />
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RecoveryQueueCard({ platform, onChatterSelect }: Props) {
  const [entries, setEntries] = useState<RecoveryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const history = await loadRecoveryHistory(platform);
        if (cancelled) return;
        setEntries(computeRecoveryQueue(history));
      } catch (e) {
        console.error("[RecoveryQueue] load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const total = useMemo(() => totalRecoveryEur(entries), [entries]);
  const visible = expanded ? entries : entries.slice(0, 5);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] backdrop-blur-xl p-5">
        <div className="flex items-center gap-2 text-white/30 text-xs font-light">
          <div className="h-3 w-3 border border-white/20 border-t-white/60 rounded-full animate-spin" />
          Recovery-Potenzial wird berechnet…
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div
        className="relative rounded-2xl border border-white/[0.06] backdrop-blur-xl p-5 overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, hsl(150 60% 50% / 0.04) 0%, rgba(255,255,255,0.015) 60%, rgba(0,0,0,0.25) 100%)",
        }}
      >
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full flex items-center justify-center bg-emerald-400/10 border border-emerald-400/20">
            <Sparkles className="h-3.5 w-3.5 text-emerald-300/80" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-300/50 font-medium">Revenue Recovery</p>
            <p className="text-sm text-white/70 font-light mt-0.5">Alle Chatter laufen on track.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative rounded-2xl border border-white/[0.07] backdrop-blur-xl overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.01) 50%, rgba(0,0,0,0.35) 100%)",
        boxShadow: "0 20px 60px -30px hsl(38 92% 50% / 0.25), inset 0 1px 0 0 rgba(255,255,255,0.04)",
      }}
    >
      {/* Header */}
      <div className="flex items-end justify-between gap-4 px-5 pt-5 pb-4 border-b border-white/[0.05]">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.22em] text-amber-300/60 font-medium">Revenue Recovery</span>
            <span className="text-[10px] text-white/25 font-light">· 7-Tage-Potenzial</span>
          </div>
          <p className="text-[11px] text-white/35 font-light mt-1">
            {entries.length} Chatter unter Baseline
          </p>
        </div>
        <div className="text-right">
          <p className="text-[9px] uppercase tracking-[0.2em] text-white/55 font-medium">Erreichbar</p>
          <p
            className="text-3xl md:text-4xl font-extralight tabular-nums leading-none mt-1"
            style={{
              background: "linear-gradient(135deg, hsl(45 95% 70%) 0%, hsl(38 92% 55%) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            +<CountUp value={total} duration={1100} /> €
          </p>
        </div>
      </div>

      {/* List */}
      <div className="divide-y divide-white/[0.04]">
        {visible.map((e, i) => {
          const tone: "warn" | "crit" = e.gapPct >= 0.5 ? "crit" : "warn";
          const accent =
            tone === "crit"
              ? "text-rose-300/90"
              : "text-amber-300/90";
          return (
            <motion.button
              key={e.chatterName}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
              onClick={() => onChatterSelect(e.chatterName)}
              className="group w-full flex items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
            >
              <span className="text-[10px] tabular-nums text-white/25 font-light w-4">{i + 1}</span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm text-white/85 font-light truncate">{e.chatterName}</p>
                  {e.leaderboardRank !== undefined && (
                    <span
                      title={`Platz ${e.leaderboardRank} im 30-Tage-Leaderboard`}
                      className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-medium tabular-nums border ${
                        e.isTopPerformer
                          ? "border-amber-300/30 bg-amber-300/10 text-amber-200/90"
                          : e.leaderboardRank <= 25
                          ? "border-white/10 bg-white/[0.04] text-white/55"
                          : "border-white/[0.06] bg-white/[0.02] text-white/35"
                      }`}
                    >
                      #{e.leaderboardRank}
                    </span>
                  )}
                </div>
                {e.isTopPerformer && (
                  <p className="text-[9px] uppercase tracking-[0.18em] text-amber-300/70 font-medium mt-0.5">
                    Top-Performer im Dip
                  </p>
                )}
                <p className="text-[10px] text-white/35 font-light tabular-nums mt-0.5">
                  Ø {formatEur(e.baseline)} € · aktuell {formatEur(e.currentAvg)} €
                </p>
              </div>

              <Sparkline values={e.spark} tone={tone} />

              <div className="text-right shrink-0">
                <p className={`text-sm font-light tabular-nums ${accent}`}>
                  +{formatEur(e.recoveryEur)} €
                </p>
                <div className="flex items-center justify-end gap-1 mt-0.5">
                  <TrendingDown className="h-2.5 w-2.5 text-white/30" />
                  <span className="text-[9px] text-white/35 tabular-nums">
                    -{Math.round(e.gapPct * 100)} %
                  </span>
                </div>
              </div>

              <ChevronRight className="h-3.5 w-3.5 text-white/15 group-hover:text-white/40 transition-colors shrink-0" />
            </motion.button>
          );
        })}
      </div>

      {entries.length > 5 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-center gap-1 py-2.5 text-[10px] text-white/30 hover:text-white/55 transition-colors font-light border-t border-white/[0.04]"
        >
          {expanded ? "Weniger anzeigen" : `${entries.length - 5} weitere anzeigen`}
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </motion.div>
  );
}
