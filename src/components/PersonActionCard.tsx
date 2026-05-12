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
  onChatterClick?: (name: string) => void;
  onModelClick?: (modelName: string, chatterName: string | null) => void;
  onAct: (action: UnifiedAction, kind: "done" | "snooze" | "dismiss") => void;
}

const TONE_STYLES: Record<UnifiedAction["tone"], { ring: string; chip: string; icon: string }> = {
  critical: {
    ring: "border-red-500/30 hover:border-red-500/50",
    chip: "bg-red-500/15 border-red-500/35 text-red-200",
    icon: "text-red-300 bg-red-500/10 border-red-500/30",
  },
  warning: {
    ring: "border-amber-500/25 hover:border-amber-500/45",
    chip: "bg-amber-500/15 border-amber-500/35 text-amber-200",
    icon: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  },
  info: {
    ring: "border-white/10 hover:border-primary/25",
    chip: "bg-cyan-500/10 border-cyan-500/25 text-cyan-200",
    icon: "text-cyan-300 bg-cyan-500/10 border-cyan-500/25",
  },
  positive: {
    ring: "border-emerald-500/25 hover:border-emerald-500/45",
    chip: "bg-emerald-500/15 border-emerald-500/35 text-emerald-200",
    icon: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
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
  if (v == null) return "?";
  if (v <= 0) return "—";
  return "+" + Math.round(v).toLocaleString("de-DE") + " €";
}

export default function PersonActionCard({ action, onChatterClick, onModelClick, onAct }: Props) {
  const [expanded, setExpanded] = useState(false);
  const tone = TONE_STYLES[action.tone];
  const PrimaryIcon = KIND_ICON[action.primaryKind] ?? Flame;

  const headlineSignal = action.signals[0];
  const headline = action.signals.length > 1 && action.chatterName
    ? `${action.chatterName} — ${action.signals.length} Signale`
    : headlineSignal.title;

  const handleHeadlineClick = () => {
    if (action.signals.length > 1) {
      setExpanded((v) => !v);
      return;
    }
    if (action.chatterName && onChatterClick) {
      onChatterClick(action.chatterName);
    } else if (action.modelName && onModelClick) {
      onModelClick(action.modelName, action.chatterName);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 80, transition: { duration: 0.2 } }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "premium-card rounded-xl p-4 group transition-colors border",
        tone.ring,
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center border shrink-0", tone.icon)}>
          <PrimaryIcon className="h-4 w-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className={cn("text-[11px] tabular-nums font-semibold px-1.5 py-0.5 rounded border", tone.chip)}>
              {fmtEur(action.totalImpactEurPerWeek)}/Wo
            </span>
            {action.persistence >= 2 && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-200 flex items-center gap-1">
                <Flame className="h-2.5 w-2.5" />
                {action.persistence}T in Folge
              </span>
            )}
            {action.signals.length > 1 && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border bg-white/5 border-white/15 text-white/60">
                {action.signals.length} Signale
              </span>
            )}
            <span className={cn("text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border", tone.icon)}>
              {KIND_LABEL[action.primaryKind]}
            </span>
          </div>

          <button
            onClick={handleHeadlineClick}
            className="text-[13px] text-foreground/90 font-light hover:text-primary transition-colors text-left block w-full"
          >
            {headline}
          </button>

          {action.signals.length > 1 ? (
            <p className="text-[11px] text-white/45 font-light mt-1 leading-relaxed">
              {action.signals.map((s) => KIND_LABEL[s.kind]).join(" · ")}
              {action.modelInfo ? ` · ${action.modelInfo}` : ""}
            </p>
          ) : (
            <p className="text-[11px] text-white/45 font-light mt-1 leading-relaxed">{headlineSignal.why}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
          {action.signals.length > 1 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? "Einklappen" : "Details"}
              className={cn(
                "h-7 w-7 rounded-md flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 transition-transform",
                expanded && "rotate-180",
              )}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => onAct(action, "done")}
            title="Erledigt"
            className="h-7 w-7 rounded-md flex items-center justify-center text-emerald-400/70 hover:text-emerald-300 hover:bg-emerald-500/10"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onAct(action, "snooze")}
            title="4h später"
            className="h-7 w-7 rounded-md flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/5"
          >
            <Clock className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onAct(action, "dismiss")}
            title="Heute ausblenden"
            className="h-7 w-7 rounded-md flex items-center justify-center text-white/30 hover:text-rose-400 hover:bg-rose-500/10"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && action.signals.length > 1 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-3 mt-3 border-t border-white/5 space-y-2">
              {action.signals.map((s) => {
                const Icon = KIND_ICON[s.kind] ?? Gem;
                return (
                  <div key={s.todoKey} className="flex items-start gap-2.5">
                    <div className="h-6 w-6 rounded-md bg-white/[0.03] border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon className="h-3 w-3 text-white/50" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-foreground/80 font-light leading-snug">{s.title}</p>
                      <p className="text-[10.5px] text-white/40 font-light mt-0.5 leading-relaxed">{s.why}</p>
                    </div>
                    {s.impactEurPerWeek > 0 && (
                      <span className="text-[10px] tabular-nums text-emerald-300/80 shrink-0 mt-0.5">
                        +{Math.round(s.impactEurPerWeek)}€
                      </span>
                    )}
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
