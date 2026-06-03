import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import {
  Check,
  Clock,
  X as XIcon,
  ChevronRight,
  RefreshCw,
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
    pill: string;
    insertBar: string;
  }
> = {
  critical: {
    glow: "from-red-500/10 via-red-500/[0.03]",
    accent: "text-red-300",
    bar: "bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.4)]",
    barDim: "bg-red-500/40",
    dot: "bg-red-500",
    statusLabel: "Kritisch",
    pill: "border-red-400/25 bg-red-500/[0.06] text-red-300/90",
    insertBar: "bg-red-500/60",
  },
  warning: {
    glow: "from-amber-500/10 via-amber-500/[0.03]",
    accent: "text-amber-300",
    bar: "bg-amber-500/80 shadow-[0_0_8px_rgba(245,158,11,0.4)]",
    barDim: "bg-amber-500/40",
    dot: "bg-amber-500",
    statusLabel: "Warnung",
    pill: "border-amber-400/25 bg-amber-500/[0.06] text-amber-300/90",
    insertBar: "bg-amber-500/60",
  },
  info: {
    glow: "from-cyan-500/8 via-cyan-500/[0.02]",
    accent: "text-cyan-300",
    bar: "bg-cyan-500/80 shadow-[0_0_8px_rgba(6,182,212,0.35)]",
    barDim: "bg-cyan-500/35",
    dot: "bg-cyan-500",
    statusLabel: "Hinweis",
    pill: "border-cyan-400/25 bg-cyan-500/[0.06] text-cyan-300/90",
    insertBar: "bg-cyan-500/60",
  },
  positive: {
    glow: "from-emerald-500/10 via-emerald-500/[0.03]",
    accent: "text-emerald-300",
    bar: "bg-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.4)]",
    barDim: "bg-emerald-500/40",
    dot: "bg-emerald-500",
    statusLabel: "Win",
    pill: "border-emerald-400/25 bg-emerald-500/[0.06] text-emerald-300/90",
    insertBar: "bg-emerald-500/60",
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
  const [celebrating, setCelebrating] = useState(false);
  const tone = TONE[action.tone];

  const handleComplete = () => {
    if (celebrating) return;
    setCelebrating(true);
    // leichte Vibration als Premium-Haptik (falls verfügbar)
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { (navigator as any).vibrate?.([8, 30, 14]); } catch {}
    }
    // Animation laufen lassen, dann Aktion auslösen → Exit-Animation übernimmt
    window.setTimeout(() => onAct(action, "done"), 620);
  };

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
      animate={
        celebrating
          ? { opacity: 1, scale: [1, 1.025, 0.985], filter: ["brightness(1)", "brightness(1.35)", "brightness(1.05)"] }
          : { opacity: 1, scale: 1 }
      }
      exit={
        celebrating
          ? { opacity: 0, y: -28, scale: 0.94, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } }
          : { opacity: 0, x: 80, transition: { duration: 0.18 } }
      }
      transition={{ duration: celebrating ? 0.6 : 0.15, ease: "easeOut" }}
      className={cn(
        "group relative w-full transition-all duration-300",
        readonly && "opacity-60",
      )}
    >
      {/* Celebration Overlay — Premium Glücksgefühl beim Abschließen */}
      <AnimatePresence>
        {celebrating && (
          <motion.div
            key="celebrate"
            className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-2xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Sanfter Erfolg-Glow */}
            <motion.div
              className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-emerald-400/40 via-emerald-300/15 to-transparent blur-2xl"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: [0, 0.9, 0], scale: [0.7, 1.1, 1.25] }}
              transition={{ duration: 0.65, ease: "easeOut" }}
            />
            {/* Sheen sweep */}
            <motion.div
              className="absolute inset-y-0 -left-1/3 w-1/2 bg-gradient-to-r from-transparent via-white/25 to-transparent skew-x-12"
              initial={{ x: "-40%", opacity: 0 }}
              animate={{ x: "260%", opacity: [0, 1, 0] }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            />
            {/* Großer Check-Ring mittig */}
            <motion.div
              className="absolute inset-0 flex items-center justify-center"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: [0.4, 1.15, 1], opacity: [0, 1, 1] }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="relative h-14 w-14 rounded-full bg-emerald-400/95 shadow-[0_0_40px_-4px_rgba(52,211,153,0.9)] flex items-center justify-center">
                <Check className="h-7 w-7 text-emerald-950" strokeWidth={3.5} />
                <motion.span
                  className="absolute inset-0 rounded-full border-2 border-emerald-300/80"
                  initial={{ scale: 1, opacity: 0.8 }}
                  animate={{ scale: 1.9, opacity: 0 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
            </motion.div>
            {/* Sparkle Partikel */}
            {[...Array(10)].map((_, i) => {
              const angle = (i / 10) * Math.PI * 2;
              const dist = 70 + (i % 3) * 14;
              return (
                <motion.span
                  key={i}
                  className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-emerald-300"
                  initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
                  animate={{
                    x: Math.cos(angle) * dist,
                    y: Math.sin(angle) * dist,
                    opacity: [0, 1, 0],
                    scale: [0.4, 1, 0.6],
                  }}
                  transition={{ duration: 0.55, ease: "easeOut", delay: 0.05 }}
                />
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hintergrund-Glow (Tone) */}
      <div
        className={cn(
          "absolute -inset-px rounded-2xl bg-gradient-to-b to-transparent opacity-80 pointer-events-none",
          tone.glow,
          readonly && "opacity-30",
        )}
      />

      <div className="relative flex flex-col overflow-hidden rounded-2xl bg-white/[0.025] backdrop-blur-xl border border-white/[0.06] shadow-2xl transition-all duration-300 group-hover:border-white/[0.12] group-hover:bg-white/[0.04] group-hover:-translate-y-px group-hover:shadow-[0_18px_50px_-22px_rgba(0,0,0,0.7)]">
        {/* Header */}
        <div className="p-5 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-[17px] font-semibold tracking-tight text-white/95 truncate">
                  {displayName}
                </h3>
                <span
                  className={cn(
                    "px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider shrink-0",
                    tone.pill,
                  )}
                >
                  {bundled ? bundleLabel : singleLabel}
                </span>
              </div>
              <p className="text-[10.5px] font-bold text-white/35 uppercase tracking-[0.18em]">
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
                  "mt-1 text-[9px] font-bold uppercase tracking-[0.18em] flex items-center justify-end gap-1.5",
                  tone.accent,
                  "opacity-85",
                )}
              >
                <span className={cn("w-1 h-1 rounded-full animate-pulse", tone.dot)} />
                {tone.statusLabel}
              </div>
            </div>
          </div>

          {(action.inPeakNow || peakLabel || showCoi) && (
            <div className="flex items-center gap-2 mt-3.5">
              {action.inPeakNow ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.04] text-[10.5px] font-medium text-emerald-300/90 tabular-nums">
                  <Clock className="h-3 w-3" /> Peak jetzt
                </span>
              ) : peakLabel ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.04] text-[10.5px] font-medium text-white/55 tabular-nums">
                  <Clock className="h-3 w-3" /> {peakLabel} Uhr
                </span>
              ) : null}
              {showCoi && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.04] text-[10.5px] font-medium text-rose-300/85 tabular-nums">
                  <TrendingDown className="h-3 w-3" />
                  −{action.costOfInactionEurPerWeek.toLocaleString("de-DE")} €<span className="text-rose-300/55">/Wo</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Signal-Liste */}
        <div className="px-5 pb-4 flex flex-col gap-2">
          {rows.map((r, i) => {
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
                  "group/item relative w-full text-left rounded-xl bg-black/30 border border-white/[0.04] p-4 pr-10 transition-colors overflow-hidden",
                  "hover:bg-black/40 hover:border-white/[0.08]",
                  i > 0 && "bg-black/20",
                )}
              >
                <div
                  className={cn(
                    "absolute left-0 top-0 bottom-0 w-1",
                    i === 0 ? tone.insertBar : tone.barDim,
                  )}
                />
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-[11px] font-bold text-white/90 uppercase tracking-wider break-words">
                    {r.title}
                  </span>
                  {r.meta && (
                    <span className="text-[11.5px] text-white/55 font-light break-words leading-relaxed">
                      {r.meta}
                    </span>
                  )}
                </div>
                <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 group-hover/item:text-white/55 transition-colors shrink-0" />
              </button>
            );
          })}
          {restCount > 0 && (
            <p className="text-[10px] text-white/35 font-light px-1 pt-0.5">
              + {restCount} weitere Signal{restCount > 1 ? "e" : ""}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-1">
          <div className="flex items-center justify-between border-t border-white/[0.05] pt-3">
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                openDetails();
              }}
              className="flex items-center gap-3 -ml-1 pl-1 pr-2 py-1 rounded-lg hover:bg-white/[0.03] transition-colors min-w-0"
            >
              <div className="relative shrink-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-white/12 to-transparent text-[10px] font-bold text-white/80 border border-white/10">
                  {initials(action.chatterName ?? action.modelName)}
                </div>
                <div
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background",
                    tone.dot,
                  )}
                />
              </div>
              <div className="flex flex-col leading-tight min-w-0 text-left">
                <span className="text-[12px] font-medium text-white/80 truncate">
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
                    disabled={celebrating}
                    onClick={(e) => {
                      stop(e);
                      handleComplete();
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 bg-white text-black text-[11px] font-bold rounded-lg hover:bg-neutral-200 active:scale-[0.97] transition-all disabled:opacity-80 shadow-[0_0_24px_-6px_rgba(255,255,255,0.18)]"
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
