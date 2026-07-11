import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

import {
  Check,
  Clock,
  X as XIcon,
  ChevronRight,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MagneticHover } from "@/components/MagneticHover";
import type { UnifiedAction, ActionSourceKind, ActionSignal } from "@/lib/today-engine";

interface Props {
  action: UnifiedAction;
  onChatterClick?: (name: string, compareWith?: string | null) => void;
  onModelClick?: (modelName: string, chatterName: string | null) => void;
  onAct: (action: UnifiedAction, kind: "done" | "snooze" | "dismiss" | "reject-account") => void;
  /** Karten in Wins/Erledigt-Ansicht: kein primary action button, gedimmt. */
  readonly?: boolean;
  /** Verzug-Detail pro Model (nur für Verzug-Karten): Model-Name, offene Chats, Verzug-Tage. */
  verzugBreakdown?: { account: string; openChats: number; delayDays: number }[];
  /** 14T-Durchschnitt offener Chats pro Chatter (nur für Verzug-Karten). */
  verzugAvgOpenChats?: number;
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

const UPGRADE_TONE = {
  glow: "from-emerald-500/10 via-emerald-600/[0.03]",
  accent: "text-emerald-300",
  bar: "bg-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.4)]",
  barDim: "bg-emerald-500/40",
  dot: "bg-emerald-500",
  statusLabel: "Upgrade",
  pill: "border-emerald-400/25 bg-emerald-500/[0.06] text-emerald-300/90",
  insertBar: "bg-emerald-500/60",
};

const DOWNGRADE_TONE = {
  glow: "from-red-500/10 via-red-600/[0.03]",
  accent: "text-red-300",
  bar: "bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.4)]",
  barDim: "bg-red-500/40",
  dot: "bg-red-500",
  statusLabel: "Downgrade",
  pill: "border-red-400/25 bg-red-500/[0.06] text-red-300/90",
  insertBar: "bg-red-500/60",
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
  upgrade: "Upgrade-Kandidat",
  downgrade: "Downgrade-Kandidat",
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

function getVerzugStats(
  action: UnifiedAction,
  breakdown?: { account: string; openChats: number; delayDays: number }[],
  avgOpenChats?: number,
) {
  let oldestDays = breakdown && breakdown.length > 0
    ? Math.max(...breakdown.map((m) => Number(m?.delayDays) || 0))
    : null;
  let openChats = breakdown ? breakdown.reduce((s, m) => s + (Number(m?.openChats) || 0), 0) : null;
  if (oldestDays == null || openChats == null) {
    const signals = Array.isArray(action?.signals) ? action.signals : [];
    const sig = signals.find((s) => s?.kind === "verzug");
    if (sig) {
      const title = typeof sig.title === "string" ? sig.title : "";
      const why = typeof sig.why === "string" ? sig.why : "";
      const oldestMatch = title.match(/(\d+)\s*T/) || why.match(/(\d+)\s*T/);
      if (oldestDays == null && oldestMatch) oldestDays = Number(oldestMatch[1]);
      const openMatch = why.match(/(\d+)\s+ungelesen/);
      if (openChats == null && openMatch) openChats = Number(openMatch[1]);
    }
  }
  return {
    oldestDays: oldestDays ?? 0,
    openChats: openChats ?? 0,
    avgOpenChats: avgOpenChats ?? 0,
  };
}

function VerzugCompactCards({
  oldestDays,
  openChats,
  avgOpenChats,
}: {
  oldestDays: number;
  openChats: number;
  avgOpenChats: number;
}) {
  const items = [
    { label: "Ältester Chat", value: `${oldestDays} Tage`, title: "Alter des ältesten aktuell noch offenen Chats." },
    { label: "Offen jetzt", value: `${openChats}`, title: "Aktuell offene (ungelesene) Chats über alle Models dieses Chatters." },
    {
      label: "Ø offen/Tag · 14T",
      value: `${avgOpenChats}`,
      title: `Wie viele Chats hatte dieser Chatter im Schnitt pro Tag offen — gemittelt über die letzten 14 Tage. Beispiel: 22 heißt, an einem typischen Tag lagen ~22 ungelesene Chats an. Vergleichswert zu "Offen jetzt", um zu sehen, ob der Rückstand ungewöhnlich hoch ist.`,
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          title={item.title}
          className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5 text-center"
        >
          <div className="text-[10px] uppercase tracking-wider text-white/50 font-medium leading-tight">
            {item.label}
          </div>
          <div className="mt-1 text-[14px] font-semibold text-white/90 tabular-nums leading-tight">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

const MAX_SIGNAL_ROWS = 3;

type MetaChip = { kind: "live" | "model" | "plain"; text: string };

function parseMetaChips(meta: string): MetaChip[] {
  const parts = String(meta ?? "").split(" · ");
  const chips: MetaChip[] = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const liveMatch = p.match(/^Live\s*\(([^)]+)\):\s*(.*)$/i);
    if (liveMatch) {
      chips.push({ kind: "live", text: `Live · ${liveMatch[1]}` });
      if (liveMatch[2]) chips.push({ kind: "plain", text: liveMatch[2] });
      continue;
    }
    const modelMatch = p.match(/^Models?:\s*(.*)$/i);
    if (modelMatch) {
      const models = modelMatch[1].split(/,\s*/).map((m) => m.trim()).filter(Boolean);
      for (const m of models) chips.push({ kind: "model", text: m });
      continue;
    }
    chips.push({ kind: "plain", text: p });
  }
  return chips;
}

export default function PersonActionCard({
  action,
  onChatterClick,
  onModelClick,
  onAct,
  readonly = false,
  verzugBreakdown,
  verzugAvgOpenChats,
}: Props) {

  const [celebrating, setCelebrating] = useState(false);
  const safeSignals: ActionSignal[] = Array.isArray(action?.signals)
    ? action.signals.filter(Boolean)
    : [];
  const fallbackSignal: ActionSignal = {
    source: "todo",
    kind: action?.primaryKind ?? "activity",
    title: action?.chatterName ?? action?.modelName ?? "Aktion",
    why: "",
    impactEurPerWeek: null,
    todoKey: action?.bundleKey ?? "fallback-action",
  };
  const headlineSignal = safeSignals[0] ?? fallbackSignal;
  const tone =
    action.primaryKind === "upgrade"
      ? UPGRADE_TONE
      : action.primaryKind === "downgrade"
        ? DOWNGRADE_TONE
        : TONE[action.tone] ?? TONE.warning;

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

  const bundled = safeSignals.length > 1;

  const displayName =
    action.chatterName ?? action.modelName ?? String(headlineSignal.title ?? "Aktion");

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
    const prioritized = safeSignals.find(
      (s) => directCompareKinds.has(s.kind) && (s.compareWith || s.secondaryChatter),
    );
    if (prioritized)
      return prioritized.compareWith ?? prioritized.secondaryChatter ?? null;
    const any = safeSignals.find((s) => s.compareWith || s.secondaryChatter);
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
    kindLabel: string | null;
  };

  const rows: Row[] = bundled
    ? safeSignals.slice(0, MAX_SIGNAL_ROWS).map((s, i) => ({
        key: s.todoKey ?? `${action.bundleKey ?? "signal"}-${i}`,
        title: typeof s.title === "string" ? s.title : String(s.title ?? "Aktion"),
        meta: typeof s.why === "string" ? s.why : null,
        intensity: i === 0 ? "strong" : i === 1 ? "medium" : "soft",
        compareWith: s.compareWith ?? s.secondaryChatter ?? null,
        kindLabel: KIND_LABEL[s.kind] ?? null,
      }))
    : (() => {
        const r: Row[] = [
          {
            key: headlineSignal.todoKey ?? action.bundleKey ?? "headline-signal",
            title: typeof headlineSignal.title === "string" ? headlineSignal.title : String(headlineSignal.title ?? "Aktion"),
            meta: typeof headlineSignal.why === "string" ? headlineSignal.why : null,
            intensity: "strong",
            compareWith:
              headlineSignal.compareWith ?? headlineSignal.secondaryChatter ?? null,
            kindLabel: KIND_LABEL[headlineSignal.kind] ?? null,
          },
        ];
        const ev = headlineSignal.evidence ?? [];
        ev.slice(0, MAX_SIGNAL_ROWS - 1).forEach((e, i) => {
          r.push({
            key: `ev-${i}`,
            title: typeof e.text === "string" ? e.text : String(e.text ?? "Beleg"),
            meta: null,
            intensity: "soft",
            compareWith: null,
            kindLabel: null,
          });
        });
        return r;
      })();

  const restCount = bundled ? Math.max(0, safeSignals.length - MAX_SIGNAL_ROWS) : 0;

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
                <MagneticHover as="span" range={20}>
                  {action.chatterName ? (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await navigator.clipboard.writeText(action.chatterName!);
                        } catch {}
                      }}
                      aria-label={`${action.chatterName} kopieren`}
                      title="Klicken zum Kopieren"
                      className="text-left -mx-1 px-1 rounded-md active:scale-[0.98] transition-transform"
                    >
                      <h3 className="text-[17px] font-semibold tracking-tight text-white/95 truncate">
                        {displayName}
                      </h3>
                    </button>
                  ) : (
                    <h3 className="text-[17px] font-semibold tracking-tight text-white/95 truncate">
                      {displayName}
                    </h3>
                  )}
                </MagneticHover>
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
                  ? `${safeSignals.length} aktive Signale detektiert`
                  : "1 Signal detektiert"}
              </p>
            </div>

            <div className="text-right shrink-0">
              {action.primaryKind === "upgrade" || action.primaryKind === "verzug" ? (
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
              ) : (
                <>
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
                </>
              )}
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
              {showCoi && action.primaryKind !== "verzug" && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.04] text-[10.5px] font-medium text-rose-300/85 tabular-nums">
                  <TrendingDown className="h-3 w-3" />
                  −{action.costOfInactionEurPerWeek.toLocaleString("de-DE")} €<span className="text-rose-300/55">/Wo</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Signal-Liste */}
        <div className="px-5 pb-4 flex flex-col gap-2.5">
          {action.primaryKind === "verzug" ? (
            <VerzugCompactCards {...getVerzugStats(action, verzugBreakdown, verzugAvgOpenChats)} />
          ) : (
            <>
              {rows.map((r, i) => {
                const clickable =
                  !!r.compareWith && !!action.chatterName && !readonly;
                const isStrong = r.intensity === "strong";
                const isMedium = r.intensity === "medium";
                const isSoft = r.intensity === "soft";
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
                      "group/item relative w-full text-left rounded-xl p-4 pr-10 transition-colors overflow-hidden",
                      isStrong &&
                        "bg-black/35 border border-white/[0.06] hover:bg-black/45 hover:border-white/[0.10]",
                      isMedium &&
                        "bg-black/20 border border-white/[0.04] hover:bg-black/30 hover:border-white/[0.08]",
                      isSoft &&
                        "bg-transparent border-t border-white/[0.05] rounded-none px-4 py-3 hover:bg-white/[0.02]",
                    )}
                  >
                    <div
                      className={cn(
                        "absolute left-0 top-0 bottom-0",
                        isStrong && `w-1.5 ${tone.insertBar}`,
                        isMedium && `w-1 ${tone.barDim}`,
                        isSoft && `w-px ${tone.barDim} opacity-60`,
                      )}
                    />
                    <div className="flex flex-col gap-1.5 min-w-0">
                      {r.kindLabel && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.16em]",
                            tone.accent,
                            !isStrong && "opacity-70",
                          )}
                        >
                          <span className={cn("h-1 w-1 rounded-full", tone.dot)} />
                          {r.kindLabel}
                        </span>
                      )}
                      <span
                        className={cn(
                          "font-medium break-words leading-[1.25]",
                          isStrong && "text-[14px] text-white/95",
                          isMedium && "text-[13.5px] text-white/85",
                          isSoft && "text-[13px] text-white/70",
                        )}
                      >
                        {r.title}
                      </span>
                      {r.meta && (isSoft ? (
                        <span className="text-[12px] text-white/45 font-normal break-words leading-[1.45] line-clamp-2">
                          {r.meta}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {parseMetaChips(r.meta).map((chip, idx) => {
                            const baseText = isStrong ? "text-white/75" : "text-white/55";
                            if (chip.kind === "live") {
                              return (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-medium text-emerald-300/90 tabular-nums"
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  {chip.text}
                                </span>
                              );
                            }
                            if (chip.kind === "model") {
                              return (
                                <span
                                  key={idx}
                                  className="inline-flex items-center px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[11px] font-medium text-white/70"
                                >
                                  {chip.text}
                                </span>
                              );
                            }
                            return (
                              <span
                                key={idx}
                                className={cn(
                                  "inline-flex items-center px-2 py-0.5 rounded-md bg-white/[0.025] text-[11.5px] font-normal tabular-nums",
                                  baseText,
                                )}
                              >
                                {chip.text}
                              </span>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20 group-hover/item:text-white/45 transition-colors shrink-0" />
                  </button>
                );
              })}
              {restCount > 0 && (
                <p className="text-[10px] text-white/35 font-light px-1 pt-0.5">
                  + {restCount} weitere Signal{restCount > 1 ? "e" : ""}
                </p>
              )}
            </>
          )}
        </div>

        {action.primaryKind === "verzug" && verzugBreakdown && verzugBreakdown.length > 0 && (
          <div className="px-5 pb-4">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-white/[0.05] bg-white/[0.015]">
                <span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-white/50">
                  Aufschlüsselung pro Model
                </span>
                <span className="text-[9.5px] font-medium uppercase tracking-[0.16em] text-white/30 tabular-nums">
                  {verzugBreakdown.length} {verzugBreakdown.length === 1 ? "Model" : "Models"}
                </span>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {verzugBreakdown.map((m) => {
                  const critical = m.delayDays >= 3;
                  const warn = m.delayDays >= 1 && m.delayDays < 3;
                  return (
                    <button
                      key={m.account}
                      type="button"
                      onClick={(e) => {
                        stop(e);
                        if (onModelClick) onModelClick(m.account, action.chatterName ?? null);
                      }}
                      className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-white/[0.03] transition-colors"
                    >
                      <span className="text-[12.5px] font-medium text-white/90 truncate tracking-wide">
                        {m.account}
                      </span>
                      <div className="flex items-center gap-2 shrink-0 tabular-nums">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[11px] font-medium text-white/75">
                          {m.openChats} offen
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border",
                            critical && "bg-red-500/12 border-red-500/25 text-red-300",
                            warn && "bg-amber-500/12 border-amber-500/25 text-amber-300",
                            !critical && !warn && "bg-white/[0.04] border-white/[0.06] text-white/50",
                          )}
                        >
                          <Clock className="h-3 w-3" />
                          {m.delayDays > 0 ? `${m.delayDays}d Verzug` : "aktuell"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}

        <div className="px-5 pb-5 pt-1">
          <div className="flex items-center justify-between border-t border-white/[0.05] pt-3">
            {action.primaryKind === "verzug" ? (
              <button
                type="button"
                onClick={(e) => { stop(e); openDetails(); }}
                className="flex items-center gap-2 -ml-1 pl-2 pr-2.5 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors min-w-0 text-[11px] font-medium text-white/45 uppercase tracking-wider"
              >
                Details öffnen
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  openDetails();
                }}
                className="flex items-center gap-2 -ml-1 pl-2 pr-2.5 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors min-w-0"
              >
                <TrendingUp className="h-3.5 w-3.5 text-emerald-300/90 shrink-0" />
                <span className="text-[12px] font-semibold text-emerald-300/90 tabular-nums">
                  {impactPrefix}{impactStr}
                  <span className="text-[10px] font-medium text-emerald-300/55 ml-0.5">/Wo möglich</span>
                </span>
              </button>
            )}



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
