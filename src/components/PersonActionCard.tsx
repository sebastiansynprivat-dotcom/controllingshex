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
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UnifiedAction, ActionSourceKind } from "@/lib/today-engine";

interface Props {
  action: UnifiedAction;
  onChatterClick?: (name: string, compareWith?: string | null) => void;
  onModelClick?: (modelName: string, chatterName: string | null) => void;
  onAct: (action: UnifiedAction, kind: "done" | "snooze" | "dismiss") => void;
}

// Tone → accent stripe + text color for category label + impact chip
const TONE_STYLES: Record<
  UnifiedAction["tone"],
  { stripe: string; label: string; impactChip: string; ring: string }
> = {
  critical: {
    stripe: "bg-red-500",
    label: "text-red-300",
    impactChip: "bg-red-500/10 border-red-500/30 text-red-200",
    ring: "border-red-500/20 hover:border-red-500/40",
  },
  warning: {
    stripe: "bg-amber-500",
    label: "text-amber-300",
    impactChip: "bg-amber-500/10 border-amber-500/30 text-amber-200",
    ring: "border-amber-500/20 hover:border-amber-500/40",
  },
  info: {
    stripe: "bg-cyan-500",
    label: "text-cyan-300",
    impactChip: "bg-cyan-500/10 border-cyan-500/25 text-cyan-200",
    ring: "border-white/10 hover:border-primary/25",
  },
  positive: {
    stripe: "bg-emerald-500",
    label: "text-emerald-400",
    impactChip: "bg-emerald-500/10 border-emerald-500/25 text-emerald-300",
    ring: "border-emerald-500/15 hover:border-emerald-500/35",
  },
};

const KIND_ICON: Record<ActionSourceKind, typeof Flame> = {
  verzug: AlertTriangle,
  recovery: TrendingDown,
  revenue: TrendingDown,
  activity: Activity,
  model: Users,
  positive: Sparkles,
  talent: Rocket,
  phase: Calendar,
  mismatch: Users,
  swap: ArrowLeftRight,
  slot: Activity,
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
};

function fmtEur(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v <= 0) return "—";
  return "+" + Math.round(v).toLocaleString("de-DE") + " €";
}

function initials(name: string | null | undefined): string {
  if (!name) return "··";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "··";
}

export default function PersonActionCard({ action, onChatterClick, onModelClick, onAct }: Props) {
  const [expanded, setExpanded] = useState(false);
  const tone = TONE_STYLES[action.tone];

  const headlineSignal = action.signals[0];
  const bundled = action.signals.length > 1;
  const headline = bundled && action.chatterName
    ? `${action.chatterName} — ${action.signals.length} Signale`
    : headlineSignal.title;

  const categoryLabel = bundled
    ? `${KIND_LABEL[action.primaryKind]} · Bündel`
    : KIND_LABEL[action.primaryKind];

  const impactStr = fmtEur(action.totalImpactEurPerWeek);
  const hasImpact = impactStr !== "—";

  const openDetails = () => {
    if (action.chatterName && onChatterClick) {
      onChatterClick(action.chatterName);
    } else if (action.modelName && onModelClick) {
      onModelClick(action.modelName, action.chatterName);
    }
  };

  const handleCardClick = () => {
    if (bundled) setExpanded((v) => !v);
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
      {/* Accent stripe */}
      <div className={cn("absolute left-0 top-0 bottom-0 w-1", tone.stripe)} />

      <div className="p-4 pl-5 flex flex-col gap-3">
        {/* Top: category + title (left) | impact + persistence (right) */}
        <div className="flex justify-between items-start gap-3">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <span className={cn("text-[10px] font-semibold uppercase tracking-widest", tone.label)}>
              {categoryLabel}
            </span>
            <h3 className="text-[14px] font-medium text-foreground leading-snug truncate">
              {headline}
            </h3>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span
              className={cn(
                "px-2 py-0.5 rounded-md text-[11px] font-semibold tabular-nums border",
                hasImpact
                  ? tone.impactChip
                  : "bg-white/[0.04] border-white/10 text-white/40",
              )}
            >
              {hasImpact ? `${impactStr}/Wo` : "—/Wo"}
            </span>
            {action.persistence >= 2 && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-tight border bg-fuchsia-500/10 border-fuchsia-500/25 text-fuchsia-300 flex items-center gap-1">
                <Flame className="h-2.5 w-2.5" />
                {action.persistence}T in Folge
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-[12.5px] text-white/55 font-light leading-relaxed">
          {bundled
            ? action.signals.map((s) => KIND_LABEL[s.kind]).join(" · ") +
              (action.modelInfo ? ` · ${action.modelInfo}` : "")
            : headlineSignal.why}
        </p>

        {/* Bundle hint */}
        {bundled && !expanded && (
          <button
            onClick={(e) => { stop(e); setExpanded(true); }}
            className="text-left py-1.5 px-3 rounded-lg bg-white/[0.03] border border-white/10 hover:border-white/20 transition-colors"
          >
            <p className="text-[11px] font-semibold text-white/60 flex items-center gap-1.5">
              <ChevronDown className="h-3 w-3" />
              + {action.signals.length - 1} weitere Signal{action.signals.length - 1 === 1 ? "" : "e"}
              {action.chatterName ? ` für ${action.chatterName}` : ""}
            </p>
          </button>
        )}

        {/* Footer: identity + actions */}
        <div className="flex items-center justify-between pt-3 border-t border-white/5">
          <button
            onClick={(e) => { stop(e); openDetails(); }}
            className="flex items-center gap-2 text-white/45 hover:text-white/70 transition-colors"
          >
            <div className="w-6 h-6 rounded bg-white/[0.05] border border-white/10 flex items-center justify-center text-[10px] font-semibold tabular-nums">
              {initials(action.chatterName ?? action.modelName)}
            </div>
            <span className="text-[11px] font-medium">
              {bundled ? (expanded ? "Einklappen" : "Aufklappen") : "Details ansehen"}
            </span>
          </button>

          <div className="flex items-center gap-3 opacity-70 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { stop(e); onAct(action, "snooze"); }}
              title="4h später"
              className="text-white/40 hover:text-white/80 transition-colors"
            >
              <Clock className="h-4 w-4" />
            </button>
            <button
              onClick={(e) => { stop(e); onAct(action, "dismiss"); }}
              title="Heute ausblenden"
              className="text-white/40 hover:text-rose-400 transition-colors"
            >
              <XIcon className="h-4 w-4" />
            </button>
            <button
              onClick={(e) => { stop(e); onAct(action, "done"); }}
              title="Erledigt"
              className="text-emerald-400/80 hover:text-emerald-300 transition-colors"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && bundled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
            onClick={stop}
          >
            <div className="px-4 pl-5 pb-4 -mt-1 space-y-2">
              {action.signals.map((s) => {
                const Icon = KIND_ICON[s.kind] ?? Gem;
                return (
                  <div key={s.todoKey} className="flex items-start gap-2.5 p-2 rounded-lg bg-white/[0.02] border border-white/5">
                    <div className="h-6 w-6 rounded-md bg-white/[0.04] border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon className="h-3 w-3 text-white/55" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-foreground/85 font-light leading-snug">{s.title}</p>
                      <p className="text-[10.5px] text-white/40 font-light mt-0.5 leading-relaxed">{s.why}</p>
                      {s.impactReason && (
                        <p className="text-[10px] text-white/30 font-light mt-0.5 italic leading-relaxed">
                          € · {s.impactReason}
                        </p>
                      )}
                    </div>
                    {s.impactEurPerWeek != null && s.impactEurPerWeek > 0 ? (
                      <span className="text-[10px] tabular-nums text-emerald-300/80 shrink-0 mt-0.5">
                        +{Math.round(s.impactEurPerWeek)}€
                      </span>
                    ) : s.impactEurPerWeek == null ? (
                      <span className="text-[10px] tabular-nums text-white/30 shrink-0 mt-0.5">?</span>
                    ) : null}
                  </div>
                );
              })}
              {action.modelInfo && (
                <p className="text-[10.5px] text-white/35 font-light pt-1">Models heute: {action.modelInfo}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
