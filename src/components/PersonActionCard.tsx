import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Clock,
  X as XIcon,
  ChevronDown,
  AlertTriangle,
  TrendingDown,
  Activity,
  Users,
  Sparkles,
  Rocket,
  Gem,
  ArrowLeftRight,
  Calendar,
  Flame,
  Zap,
  Target,
  History,
  TrendingUp,
  BellRing,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UnifiedAction, ActionSourceKind } from "@/lib/today-engine";

interface Props {
  action: UnifiedAction;
  onChatterClick?: (name: string, compareWith?: string | null) => void;
  onModelClick?: (modelName: string, chatterName: string | null) => void;
  onAct: (action: UnifiedAction, kind: "done" | "snooze" | "dismiss") => void;
}

// Tone → einzige Farbquelle der Karte
const TONE: Record<
  UnifiedAction["tone"],
  { stripe: string; label: string; impact: string; ring: string }
> = {
  critical: {
    stripe: "bg-red-500",
    label: "text-red-300/90",
    impact: "text-red-200",
    ring: "border-red-500/15 hover:border-red-500/35",
  },
  warning: {
    stripe: "bg-amber-500",
    label: "text-amber-300/90",
    impact: "text-amber-200",
    ring: "border-amber-500/15 hover:border-amber-500/35",
  },
  info: {
    stripe: "bg-cyan-500",
    label: "text-cyan-300/90",
    impact: "text-cyan-200",
    ring: "border-white/10 hover:border-primary/25",
  },
  positive: {
    stripe: "bg-emerald-500",
    label: "text-emerald-300/90",
    impact: "text-emerald-300",
    ring: "border-emerald-500/12 hover:border-emerald-500/30",
  },
};

const KIND_ICON: Record<ActionSourceKind, typeof Flame> = {
  verzug: AlertTriangle,
  recovery: TrendingDown,
  revenue: TrendingUp,
  activity: Activity,
  model: Users,
  positive: Sparkles,
  talent: Rocket,
  phase: Calendar,
  mismatch: Users,
  swap: ArrowLeftRight,
  slot: Activity,
  potential: Target,
  wakeup: BellRing,
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
  swap: "Swap",
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

export default function PersonActionCard({ action, onChatterClick, onModelClick, onAct }: Props) {
  const [expanded, setExpanded] = useState(false);
  const tone = TONE[action.tone];

  const headlineSignal = action.signals[0];
  const bundled = action.signals.length > 1;
  const headline = bundled && action.chatterName
    ? `${action.chatterName} · ${action.signals.length} Signale`
    : headlineSignal.title;

  const categoryLabel = bundled
    ? `${KIND_LABEL[action.primaryKind]} +${action.signals.length - 1}`
    : KIND_LABEL[action.primaryKind];

  const impactStr = fmtEur(action.totalImpactEurPerWeek);
  const hasImpact = impactStr !== "—";
  const impactPrefix = action.confidence === "low" ? "~" : "";
  const peakLabel = fmtPeak(action.peakWindow);
  const showCoi = action.costOfInactionEurPerWeek > 0 && (action.tone === "critical" || action.tone === "warning");
  const hasEvidence = !bundled && headlineSignal.evidence && headlineSignal.evidence.length > 0;
  const hasDetails = bundled || hasEvidence;

  const compareTarget = (() => {
    if (action.secondaryChatter) return action.secondaryChatter;
    const directCompareKinds = new Set<ActionSourceKind>(["talent", "swap", "mismatch", "phase"]);
    const prioritized = action.signals.find((s) => directCompareKinds.has(s.kind) && (s.compareWith || s.secondaryChatter));
    if (prioritized) return prioritized.compareWith ?? prioritized.secondaryChatter ?? null;
    const any = action.signals.find((s) => s.compareWith || s.secondaryChatter);
    return any?.compareWith ?? any?.secondaryChatter ?? null;
  })();

  const opensComparison = !!action.chatterName && !!compareTarget;

  const openDetails = (overrideCompare?: string | null) => {
    if (action.chatterName && onChatterClick) {
      onChatterClick(action.chatterName, overrideCompare !== undefined ? overrideCompare : compareTarget);
    } else if (action.modelName && onModelClick) {
      onModelClick(action.modelName, action.chatterName);
    }
  };

  const handleCardClick = () => {
    if (opensComparison) openDetails(compareTarget);
    else if (hasDetails) setExpanded((v) => !v);
    else openDetails();
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 80, transition: { duration: 0.2 } }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      onClick={handleCardClick}
      className={cn(
        "premium-card relative rounded-2xl overflow-hidden border transition-colors cursor-pointer group",
        tone.ring,
      )}
    >
      <div className={cn("absolute left-0 top-0 bottom-0 w-[3px]", tone.stripe)} />

      <div className="p-4 pl-5 flex flex-col gap-2.5">
        {/* Zeile 1: Kategorie · Impact */}
        <div className="flex items-center justify-between gap-3">
          <span className={cn("text-[10px] font-semibold uppercase tracking-[0.14em]", tone.label)}>
            {categoryLabel}
          </span>
          <span
            className={cn(
              "text-[13px] font-medium tabular-nums",
              hasImpact ? tone.impact : "text-white/35",
            )}
            title={
              action.confidence === "low"
                ? "Niedrige Konfidenz (<5 Tage Daten)"
                : action.confidence === "medium"
                  ? "Mittlere Konfidenz (5–14 Tage)"
                  : "Hohe Konfidenz (≥15 Tage)"
            }
          >
            {hasImpact ? `${impactPrefix}${impactStr}/Wo` : "—"}
          </span>
        </div>

        {/* Zeile 2: Headline */}
        <h3 className="text-[14.5px] font-normal text-foreground leading-snug">
          {headline}
        </h3>

        {/* Zeile 3: Ein-Satz-Why */}
        <p className="text-[12px] text-white/50 font-light leading-relaxed line-clamp-2">
          {bundled ? action.signals.map((s) => KIND_LABEL[s.kind]).join(" · ") : headlineSignal.why}
        </p>

        {/* Zeile 4: Mini-Meta (nur Icons, optional) */}
        {(showCoi || peakLabel) && (
          <div className="flex items-center gap-3 text-[10.5px] text-white/40 tabular-nums">
            {action.inPeakNow ? (
              <span className="flex items-center gap-1 text-emerald-300/90" title="Jetzt im Peak-Fenster">
                <Zap className="h-3 w-3" /> Peak jetzt
              </span>
            ) : peakLabel ? (
              <span className="flex items-center gap-1" title="Peak-Zeitfenster">
                <Zap className="h-3 w-3" /> {peakLabel}
              </span>
            ) : null}
            {showCoi && (
              <span className="flex items-center gap-1 text-rose-300/85" title="Folgekosten in 7 Tagen ohne Aktion">
                <TrendingDown className="h-3 w-3" />
                −{action.costOfInactionEurPerWeek.toLocaleString("de-DE")} €
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2.5 mt-0.5 border-t border-white/[0.06]">
          <button
            onClick={(e) => { stop(e); openDetails(); }}
            className="flex items-center gap-2 text-white/45 hover:text-white/75 transition-colors min-w-0"
          >
            <div className="w-5 h-5 rounded bg-white/[0.05] border border-white/10 flex items-center justify-center text-[9px] font-semibold tabular-nums shrink-0">
              {initials(action.chatterName ?? action.modelName)}
            </div>
            <span className="text-[11px] font-light truncate">
              {action.chatterName ?? action.modelName ?? "Details"}
            </span>
            {hasDetails && (
              <button
                onClick={(e) => { stop(e); setExpanded((v) => !v); }}
                className={cn(
                  "ml-1 p-0.5 rounded text-white/35 hover:text-white/70 transition-all",
                  expanded && "rotate-180",
                )}
                aria-label="Details aufklappen"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            )}
          </button>

          <div className="flex items-center gap-2.5 opacity-60 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { stop(e); onAct(action, "snooze"); }}
              title="4h später"
              className="text-white/40 hover:text-white/80 transition-colors p-1"
            >
              <Clock className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => { stop(e); onAct(action, "dismiss"); }}
              title="Heute ausblenden"
              className="text-white/40 hover:text-rose-400 transition-colors p-1"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => { stop(e); onAct(action, "done"); }}
              title="Erledigt"
              className="text-emerald-400/80 hover:text-emerald-300 transition-colors p-1"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && hasDetails && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
            onClick={stop}
          >
            <div className="px-4 pl-5 pb-4 -mt-1 space-y-2">
              {hasEvidence && (
                <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <History className="h-3 w-3 text-white/45" />
                    <span className="text-[10px] uppercase tracking-widest text-white/45 font-semibold">Beleg</span>
                  </div>
                  <ul className="space-y-1">
                    {headlineSignal.evidence!.slice(0, 3).map((ev, i) => (
                      <li key={i} className="text-[11px] text-white/65 font-light leading-relaxed tabular-nums">
                        · {ev.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {bundled && action.signals.map((s) => {
                const Icon = KIND_ICON[s.kind] ?? Gem;
                const sigCompare = s.compareWith ?? s.secondaryChatter ?? null;
                const isClickable = !!sigCompare && !!action.chatterName;
                return (
                  <div
                    key={s.todoKey}
                    onClick={isClickable ? (e) => { stop(e); openDetails(sigCompare); } : undefined}
                    className={cn(
                      "flex items-start gap-2.5 p-2 rounded-lg bg-white/[0.02] border border-white/5",
                      isClickable && "cursor-pointer hover:bg-white/[0.05] hover:border-white/10 transition-colors",
                    )}
                  >
                    <div className="h-6 w-6 rounded-md bg-white/[0.04] border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon className="h-3 w-3 text-white/55" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-foreground/85 font-light leading-snug">{s.title}</p>
                      <p className="text-[10.5px] text-white/40 font-light mt-0.5 leading-relaxed">{s.why}</p>
                    </div>
                    {s.impactEurPerWeek != null && s.impactEurPerWeek > 0 && (
                      <span className="text-[10px] tabular-nums text-emerald-300/80 shrink-0 mt-0.5">
                        +{Math.round(s.impactEurPerWeek)}€
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
