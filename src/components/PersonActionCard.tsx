import { motion } from "framer-motion";
import {
  Check,
  Clock,
  X as XIcon,
  ChevronRight,
  RefreshCw,
  Zap,
  TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UnifiedAction, ActionSourceKind } from "@/lib/today-engine";

interface Props {
  action: UnifiedAction;
  onChatterClick?: (name: string, compareWith?: string | null) => void;
  onModelClick?: (modelName: string, chatterName: string | null) => void;
  onAct: (action: UnifiedAction, kind: "done" | "snooze" | "dismiss" | "reject-account") => void;
  /** Karten in Wins/Erledigt-Ansicht: kein primary action button, gedimmt. */
  readonly?: boolean;
}

const TONE: Record<
  UnifiedAction["tone"],
  {
    glow: string;
    accent: string;
    bar: string;
    barDim: string;
    dot: string;
    statusLabel: string;
  }
> = {
  critical: {
    glow: "from-red-500/15 via-red-500/5",
    accent: "text-red-300",
    bar: "bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.4)]",
    barDim: "bg-red-500/40",
    dot: "bg-red-500",
    statusLabel: "Kritisch",
  },
  warning: {
    glow: "from-amber-500/15 via-amber-500/5",
    accent: "text-amber-300",
    bar: "bg-amber-500/80 shadow-[0_0_8px_rgba(245,158,11,0.4)]",
    barDim: "bg-amber-500/40",
    dot: "bg-amber-500",
    statusLabel: "Warnung",
  },
  info: {
    glow: "from-cyan-500/12 via-cyan-500/4",
    accent: "text-cyan-300",
    bar: "bg-cyan-500/80 shadow-[0_0_8px_rgba(6,182,212,0.35)]",
    barDim: "bg-cyan-500/35",
    dot: "bg-cyan-500",
    statusLabel: "Hinweis",
  },
  positive: {
    glow: "from-emerald-500/15 via-emerald-500/5",
    accent: "text-emerald-300",
    bar: "bg-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.4)]",
    barDim: "bg-emerald-500/40",
    dot: "bg-emerald-500",
    statusLabel: "Win",
  },
};

const KIND_LABEL: Record<ActionSourceKind, string> = {
  verzug: "Verzug",
  recovery: "Recovery",
  revenue: "Umsatz",
  activity: "Aktivität",
  model: "Model",
  positive: "Win",
  talent: "Talent",
  phase: "Phase",
  mismatch: "Mismatch",
  swap: "Account-Tausch",
  slot: "Slot",
  potential: "Potenzial",
  wakeup: "Wieder aktiv",
};

function fmtEur(v: number | null | undefined): string {
  if (v == null || v <= 0) return "—";
  return "+" + Math.round(v).toLocaleString("de-DE") + " €";
}

function fmtPeak(p: { startHour: number; endHour: number } | null): string | null {
  if (!p) return null;
  const fmt = (h: number) => `${h.toString().padStart(2, "0")}`;
  return `${fmt(p.startHour)}–${fmt(p.endHour)}`;
}

function initials(name: string | null | undefined): string {
  if (!name) return "··";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "··";
}

const MAX_SIGNAL_ROWS = 4;

export default function PersonActionCard({
  action,
  onChatterClick,
  onModelClick,
  onAct,
  readonly = false,
}: Props) {
  const tone = TONE[action.tone];

  const headlineSignal = action.signals[0];
  const bundled = action.signals.length > 1;

  const displayName =
    action.chatterName ?? action.modelName ?? headlineSignal.title;

  const bundleLabel = `${KIND_LABEL[action.primaryKind]}-Bundle`;
  const singleLabel = KIND_LABEL[action.primaryKind];

  const impactStr = fmtEur(action.totalImpactEurPerWeek);
  const hasImpact = impactStr !== "—";
  const impactPrefix = action.confidence === "low" ? "~" : "";

  const peakLabel = fmtPeak(action.peakWindow);
  const showCoi =
    action.costOfInactionEurPerWeek > 0 &&
    (action.tone === "critical" || action.tone === "warning");

  const compareTarget = (() => {
    if (action.secondaryChatter) return action.secondaryChatter;
    const directCompareKinds = new Set<ActionSourceKind>([
      "talent",
      "swap",
      "mismatch",
      "phase",
    ]);
    const prioritized = action.signals.find(
      (s) => directCompareKinds.has(s.kind) && (s.compareWith || s.secondaryChatter),
    );
    if (prioritized)
      return prioritized.compareWith ?? prioritized.secondaryChatter ?? null;
    const any = action.signals.find((s) => s.compareWith || s.secondaryChatter);
    return any?.compareWith ?? any?.secondaryChatter ?? null;
  })();

  const openDetails = (overrideCompare?: string | null) => {
    if (action.chatterName && onChatterClick) {
      onChatterClick(
        action.chatterName,
        overrideCompare !== undefined ? overrideCompare : compareTarget,
      );
    } else if (action.modelName && onModelClick) {
      onModelClick(action.modelName, action.chatterName);
    }
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // Signal-Rows: bei Bundle alle Signale; sonst optional Evidence-Einträge
  type Row = {
    key: string;
    title: string;
    meta: string | null;
    intensity: "strong" | "medium" | "soft";
    compareWith: string | null;
  };

  const rows: Row[] = bundled
    ? action.signals.slice(0, MAX_SIGNAL_ROWS).map((s, i) => ({
        key: s.todoKey,
        title: s.title,
        meta: s.why,
        intensity: i === 0 ? "strong" : i === 1 ? "medium" : "soft",
        compareWith: s.compareWith ?? s.secondaryChatter ?? null,
      }))
    : (() => {
        const r: Row[] = [
          {
            key: headlineSignal.todoKey,
            title: headlineSignal.title,
            meta: headlineSignal.why,
            intensity: "strong",
            compareWith:
              headlineSignal.compareWith ?? headlineSignal.secondaryChatter ?? null,
          },
        ];
        const ev = headlineSignal.evidence ?? [];
        ev.slice(0, MAX_SIGNAL_ROWS - 1).forEach((e, i) => {
          r.push({
            key: `ev-${i}`,
            title: e.text,
            meta: null,
            intensity: "soft",
            compareWith: null,
          });
        });
        return r;
      })();

  const restCount = bundled ? Math.max(0, action.signals.length - MAX_SIGNAL_ROWS) : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: 80, transition: { duration: 0.18 } }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={cn(
        "group relative w-full transition-all duration-300",
        readonly && "opacity-60",
      )}
    >
      {/* Hintergrund-Glow (Tone) */}
      <div
        className={cn(
          "absolute -inset-px rounded-2xl bg-gradient-to-b to-transparent opacity-80 pointer-events-none",
          tone.glow,
          readonly && "opacity-30",
        )}
      />

      <div className="relative flex flex-col overflow-hidden rounded-2xl bg-[#0C0C0C] border border-white/10 shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-white/[0.04] bg-gradient-to-r from-white/[0.015] to-transparent">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-[17px] font-semibold tracking-tight text-white/95 truncate">
                  {displayName}
                </h3>
                <span className="px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-[9px] font-bold text-white/45 uppercase tracking-widest shrink-0">
                  {bundled ? bundleLabel : singleLabel}
                </span>
              </div>
              <p className="text-[10.5px] font-semibold text-white/35 uppercase tracking-[0.12em]">
                {bundled
                  ? `${action.signals.length} aktive Signale detektiert`
                  : "1 Signal detektiert"}
              </p>
            </div>

            <div className="text-right shrink-0">
              <div
                className={cn(
                  "text-[22px] font-light tracking-tighter tabular-nums",
                  hasImpact ? tone.accent : "text-white/30",
                )}
                title={
                  action.confidence === "low"
                    ? "Niedrige Konfidenz (<5 Tage Daten)"
                    : action.confidence === "medium"
                      ? "Mittlere Konfidenz (5–14 Tage)"
                      : "Hohe Konfidenz (≥15 Tage)"
                }
              >
                {hasImpact ? (
                  <>
                    {impactPrefix}
                    {impactStr}{" "}
                    <span className="text-[13px] opacity-50">/Wo</span>
                  </>
                ) : (
                  "—"
                )}
              </div>
              <div
                className={cn(
                  "mt-1 text-[9px] font-bold uppercase tracking-[0.15em] flex items-center justify-end gap-1.5",
                  tone.accent,
                  "opacity-80",
                )}
              >
                <span className={cn("w-1 h-1 rounded-full animate-pulse", tone.dot)} />
                {tone.statusLabel}
              </div>
            </div>
          </div>

          {(action.inPeakNow || peakLabel || showCoi) && (
            <div className="flex items-center gap-4 mt-3 text-[10.5px] text-white/40 tabular-nums">
              {action.inPeakNow ? (
                <span className="flex items-center gap-1 text-emerald-300/90">
                  <Zap className="h-3 w-3" /> Peak jetzt
                </span>
              ) : peakLabel ? (
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" /> {peakLabel}
                </span>
              ) : null}
              {showCoi && (
                <span className="flex items-center gap-1 text-rose-300/85">
                  <TrendingDown className="h-3 w-3" />
                  −{action.costOfInactionEurPerWeek.toLocaleString("de-DE")} €
                </span>
              )}
            </div>
          )}
        </div>

        {/* Signal-Liste */}
        <div className="p-3 flex flex-col gap-1.5">
          {rows.map((r, i) => {
            const intensityCls =
              r.intensity === "strong"
                ? tone.bar
                : r.intensity === "medium"
                  ? tone.barDim
                  : "bg-white/10";
            const clickable =
              !!r.compareWith && !!action.chatterName && !readonly;
            return (
              <button
                key={r.key}
                type="button"
                onClick={(e) => {
                  stop(e);
                  if (clickable) openDetails(r.compareWith);
                  else openDetails();
                }}
                className={cn(
                  "group/item flex items-center justify-between gap-3 p-3 rounded-xl border text-left transition-colors",
                  i === 0
                    ? "bg-white/[0.03] border-white/[0.06]"
                    : "bg-white/[0.02] border-white/[0.04]",
                  "hover:bg-white/[0.05]",
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn("w-1 h-8 rounded-full shrink-0", intensityCls)} />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11.5px] font-bold text-white/85 uppercase tracking-wide break-words">
                      {r.title}
                    </span>
                    {r.meta && (
                      <span className="text-[10px] text-white/40 font-light break-words leading-snug mt-0.5">
                        {r.meta}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-white/20 group-hover/item:text-white/50 transition-colors shrink-0" />
              </button>
            );
          })}
          {restCount > 0 && (
            <p className="text-[10px] text-white/35 font-light px-3 pt-0.5">
              + {restCount} weitere Signal{restCount > 1 ? "e" : ""}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 pt-0">
          <div className="flex items-center justify-between rounded-xl bg-white/[0.02] border border-white/[0.05] p-2">
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                openDetails();
              }}
              className="flex items-center gap-3 pl-1 pr-2 py-0.5 rounded-lg hover:bg-white/[0.03] transition-colors min-w-0"
            >
              <div className="relative shrink-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-white/10 to-transparent text-[10px] font-bold text-white/75 border border-white/10">
                  {initials(action.chatterName ?? action.modelName)}
                </div>
                <div
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0C0C0C]",
                    tone.dot,
                  )}
                />
              </div>
              <div className="flex flex-col leading-tight min-w-0 text-left">
                <span className="text-[11px] font-medium text-white/75 truncate">
                  {action.chatterName ?? action.modelName ?? "Details"}
                </span>
                {compareTarget && (
                  <span className="text-[9px] font-semibold text-white/35 uppercase tracking-tight truncate">
                    vs. {compareTarget}
                  </span>
                )}
              </div>
            </button>

            <div className="flex items-center gap-1">
              {headlineSignal.rejectAccount && !readonly && (
                <button
                  type="button"
                  onClick={(e) => {
                    stop(e);
                    onAct(action, "reject-account");
                  }}
                  title="Anderer Account vorschlagen"
                  className="p-2 text-white/25 hover:text-violet-300 hover:bg-white/5 rounded-lg transition-all"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              )}
              {!readonly && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      stop(e);
                      onAct(action, "snooze");
                    }}
                    title="4h später"
                    className="p-2 text-white/25 hover:text-white/80 hover:bg-white/5 rounded-lg transition-all"
                  >
                    <Clock className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      stop(e);
                      onAct(action, "dismiss");
                    }}
                    title="Heute ausblenden"
                    className="p-2 text-white/25 hover:text-rose-400 hover:bg-white/5 rounded-lg transition-all"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      stop(e);
                      onAct(action, "done");
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-white text-black text-[11px] font-bold rounded-lg hover:bg-neutral-200 active:scale-[0.98] transition-all"
                  >
                    Abschließen
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </button>
                </>
              )}
              {readonly && (
                <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                  <Check className="h-3 w-3" />
                  Erledigt
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
