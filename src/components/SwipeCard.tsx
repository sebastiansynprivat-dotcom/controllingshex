import { motion, useMotionValue, useTransform, useAnimation, PanInfo, AnimatePresence } from "framer-motion";
import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import { toast } from "sonner";
import { Users, AlertTriangle, TrendingDown, MessageSquareOff, Inbox, Sparkles, Mail, Key, Target, Check, Pencil, X as XIcon } from "lucide-react";
import { type ModelPerformance, formatFollowers } from "@/lib/model-performance";
import WeekTrendCard from "@/components/WeekTrendCard";
import LastInputBadge from "@/components/LastInputBadge";
import type { InputSource } from "@/lib/chatter-inputs";
import { type ChatterBenchmark, formatBenchmarkLabel, getBenchmarkTone } from "@/lib/peer-benchmarks";
import type { CategoryDecision } from "@/lib/categorize-v2";
import type { StabilizedDecision } from "@/lib/category-state";
import CategoryReasonPopover from "@/components/CategoryReasonPopover";
import { suggestDailyGoal, formatEur, type DailyGoal, type GoalSuggestion } from "@/lib/daily-goals";
import { Input } from "@/components/ui/input";

export interface AccountLogin {
  account: string;
  email?: string | null;
  password?: string | null;
}

interface ChatterData {
  name: string;
  kpis: Record<string, string>;
  recommendation?: string;
  categoryEmoji?: string;
  categoryName?: string;
  startDate?: string;
  history?: { analysis_date: string; revenue_today: number; mass_dms: number; response_delay_days: number }[];
  modelPerf?: ModelPerformance;
  peerBm?: ChatterBenchmark;
  decision?: CategoryDecision | StabilizedDecision;
}

interface AnomalyAlertInfo {
  alert_type: string;
  severity: string;
  message: string;
}

interface SwapDeltaInfo {
  deltaLabel: string; // pre-formatted, e.g. "+18%"
  tone: "pos" | "neg" | "neutral";
  direction: "upgrade" | "downgrade" | "lateral" | "unknown";
  daysSince: number;
}

interface RecoveryDeltaInfo {
  recoveryEur: number;     // 7-Tage-Potenzial
  baseline: number;        // 30d-Median
  currentAvg: number;      // letzte 3 Tage Schnitt
  gapPct: number;          // 0..1
}

interface Props {
  chatter: ChatterData;
  alerts?: AnomalyAlertInfo[];
  lastInputAt?: string | null;
  lastInputSource?: InputSource | null;
  onLastInputClick?: () => void;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  onSwipeUp: () => void;
  onSwipeDown?: () => void;
  isTop: boolean;
  stackIndex?: number;
  accountLogins?: AccountLogin[];
  swapDelta?: SwapDeltaInfo | null;
  recoveryDelta?: RecoveryDeltaInfo | null;
}

const ALERT_ICONS: Record<string, typeof AlertTriangle> = {
  verzug_spike: AlertTriangle,
  mass_dm_drop: MessageSquareOff,
  chat_jam: Inbox,
  revenue_drop: TrendingDown,
  positive_outlier: Sparkles,
};

const ALERT_LABELS: Record<string, string> = {
  verzug_spike: "Verzug",
  mass_dm_drop: "Mass-DMs",
  chat_jam: "Chat-Stau",
  revenue_drop: "Umsatz",
  positive_outlier: "Top",
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "border-red-500/50 bg-red-500/[0.08] text-red-300",
  high: "border-orange-400/50 bg-orange-400/[0.08] text-orange-300",
  medium: "border-yellow-400/50 bg-yellow-400/[0.06] text-yellow-200",
  info: "border-emerald-400/50 bg-emerald-400/[0.06] text-emerald-300",
};

// Map category to a thematic accent color (HSL tuples for tailwind arbitrary values)
function categoryAccent(name?: string): { hue: string; ring: string; tint: string; glow: string } {
  const n = (name || "").toUpperCase();
  if (/EINBRUCH|WARNUNG|0€/.test(n)) return { hue: "0 84% 60%", ring: "from-red-500/40", tint: "rgba(239,68,68,0.18)", glow: "rgba(239,68,68,0.35)" };
  if (/COACHING|ENGERE|VIDEO/.test(n)) return { hue: "38 92% 55%", ring: "from-amber-500/40", tint: "rgba(245,158,11,0.16)", glow: "rgba(245,158,11,0.30)" };
  if (/UPGRADE|BREAKOUT|TOP/.test(n)) return { hue: "152 70% 45%", ring: "from-emerald-500/40", tint: "rgba(16,185,129,0.18)", glow: "rgba(16,185,129,0.32)" };
  if (/ONBOARDING|COMEBACK|MODEL/.test(n)) return { hue: "212 90% 60%", ring: "from-blue-500/40", tint: "rgba(59,130,246,0.16)", glow: "rgba(59,130,246,0.30)" };
  if (/TRAFFIC|CONVERSION|BEOBACHT/.test(n)) return { hue: "270 80% 65%", ring: "from-violet-500/40", tint: "rgba(168,85,247,0.16)", glow: "rgba(168,85,247,0.30)" };
  return { hue: "240 5% 60%", ring: "from-zinc-400/30", tint: "rgba(161,161,170,0.10)", glow: "rgba(161,161,170,0.20)" };
}

function pickHeroKpi(kpis: Record<string, string>): { key: string; value: string } | null {
  const keys = Object.keys(kpis).filter((k) => k !== "Name" && k !== "name");
  if (keys.length === 0) return null;
  const priority = ["Umsatz", "umsatz", "Revenue", "revenue", "Umsatz heute", "Umsatz Heute"];
  for (const p of priority) {
    const found = keys.find((k) => k.toLowerCase().includes(p.toLowerCase()));
    if (found) return { key: found, value: kpis[found] };
  }
  return { key: keys[0], value: kpis[keys[0]] };
}

function getInitials(name: string): string {
  const clean = name.replace(/_/g, " ").trim();
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function triggerHaptic(style: "light" | "medium" = "light") {
  try {
    if ("vibrate" in navigator) {
      navigator.vibrate(style === "medium" ? [15, 30, 15] : 10);
    }
  } catch {}
}

export default function SwipeCard({ chatter, alerts = [], lastInputAt = null, lastInputSource = null, onLastInputClick, onSwipeRight, onSwipeLeft, onSwipeUp, onSwipeDown, isTop, stackIndex = 0, accountLogins = [], swapDelta = null, recoveryDelta = null }: Props) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const controls = useAnimation();
  const didHandleGestureRef = useRef(false);
  const isDraggingRef = useRef(false);
  const tapCountRef = useRef<number>(0);
  const lastTapTimeRef = useRef<number>(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loginPicker, setLoginPicker] = useState<null | "email" | "password">(null);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const displayY = useTransform(y, (value) => (value < 0 ? value * 0.45 : value));

  // Edge-glow opacities (replaces the big overlay text)
  const edgeRight = useTransform(x, [0, 140], [0, 1]);
  const edgeLeft = useTransform(x, [-140, 0], [1, 0]);
  const edgeUp = useTransform(y, [-140, 0], [1, 0]);
  const edgeDown = useTransform(y, [0, 140], [0, 1]);

  const accent = useMemo(() => categoryAccent(chatter.categoryName), [chatter.categoryName]);
  const hero = useMemo(() => pickHeroKpi(chatter.kpis), [chatter.kpis]);

  const kpiEntries = useMemo(() => {
    const entries = Object.entries(chatter.kpis).filter(([k]) => k !== "Name" && k !== "name");
    if (hero) return entries.filter(([k]) => k !== hero.key);
    return entries;
  }, [chatter.kpis, hero]);

  const initials = useMemo(() => getInitials(chatter.name), [chatter.name]);
  const hasCritical = useMemo(() => alerts.some((a) => a.severity === "critical" || a.severity === "high"), [alerts]);

  // Only top card visible — hintere Karten unsichtbar (werden nur preloaded)
  const stackScale = 1;
  const stackOffsetY = 0;
  const stackOpacity = stackIndex === 0 ? 1 : 0;

  const snapBack = useCallback(() => {
    controls.start({
      x: 0, y: 0, rotate: 0, opacity: 1,
      transition: { type: "spring", stiffness: 400, damping: 28 },
    });
  }, [controls]);

  const peekAndReturn = useCallback((direction: "up" | "left", callback: () => void) => {
    triggerHaptic("light");
    const peek = direction === "up"
      ? { y: -50, x: 0, rotate: 0, opacity: 0.9 }
      : { x: -50, y: 0, rotate: -3, opacity: 0.9 };
    controls.start({
      ...peek,
      transition: { duration: 0.12, ease: "easeOut" },
    }).then(() => {
      callback();
      controls.start({
        x: 0, y: 0, rotate: 0, opacity: 1,
        transition: { type: "spring", stiffness: 400, damping: 28, delay: 0.08 },
      });
    });
  }, [controls]);

  const openDetails = useCallback(() => {
    triggerHaptic("light");
    didHandleGestureRef.current = true;
    onSwipeUp();
    controls.start({
      x: 0,
      y: 0,
      rotate: 0,
      opacity: 1,
      transition: { type: "spring", stiffness: 520, damping: 34, mass: 0.7 },
    });
  }, [controls, onSwipeUp]);

  const flyOff = useCallback(async (direction: "right" | "down", callback: () => void) => {
    triggerHaptic("medium");
    didHandleGestureRef.current = true;
    const targets = {
      right: { x: 500, y: 0, rotate: 20 },
      down: { x: 0, y: 500, rotate: 0 },
    };
    await controls.start({
      ...targets[direction],
      opacity: 0,
      transition: { duration: 0.3, ease: "easeIn" },
    });
    callback();
  }, [controls]);

  const handleDrag = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    isDraggingRef.current = true;
    if (didHandleGestureRef.current) return;

    const absX = Math.abs(info.offset.x);
    const absY = Math.abs(info.offset.y);
    const isVerticalIntent = absY > absX * 1.1;

    if (info.offset.y < -56 && isVerticalIntent) {
      openDetails();
    }
  }, [openDetails]);

  const copyLogin = useCallback((field: "email" | "password") => {
    const valid = accountLogins.filter((a) => (field === "email" ? a.email : a.password));
    if (valid.length === 0) {
      toast.error(field === "email" ? "Keine E-Mail hinterlegt" : "Kein Passwort hinterlegt");
      return;
    }
    if (valid.length === 1) {
      const value = (field === "email" ? valid[0].email : valid[0].password) || "";
      navigator.clipboard.writeText(value);
      toast.success(`${field === "email" ? "E-Mail" : "Passwort"} kopiert · ${valid[0].account}`);
      triggerHaptic("medium");
      return;
    }
    setLoginPicker(field);
    triggerHaptic("light");
  }, [accountLogins]);

  const handleCardTap = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }
    const now = Date.now();
    const within = now - lastTapTimeRef.current < 320;
    tapCountRef.current = within ? tapCountRef.current + 1 : 1;
    lastTapTimeRef.current = now;

    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);

    // Resolve after short window so we know how many taps came in
    tapTimerRef.current = setTimeout(() => {
      const count = tapCountRef.current;
      tapCountRef.current = 0;
      tapTimerRef.current = null;

      if (count >= 4) {
        copyLogin("password");
      } else if (count === 3) {
        copyLogin("email");
      } else if (count === 2) {
        triggerHaptic("medium");
        onSwipeUp();
      } else {
        navigator.clipboard.writeText(chatter.name.replace(/_/g, " "));
        toast.success("Name kopiert");
        triggerHaptic("light");
      }
    }, 340);
  }, [chatter.name, onSwipeUp, copyLogin]);

  useEffect(() => {
    return () => {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    };
  }, []);

  const handleDragEnd = useCallback((_: any, info: PanInfo) => {
    if (didHandleGestureRef.current) {
      didHandleGestureRef.current = false;
      isDraggingRef.current = false;
      return;
    }

    const { offset } = info;
    const horizontalThreshold = 120;
    const verticalThreshold = 70;
    const absX = Math.abs(offset.x);
    const absY = Math.abs(offset.y);
    const isVerticalIntent = absY >= absX;
    const isHorizontalIntent = absX > absY;

    if (offset.y < -verticalThreshold && isVerticalIntent) {
      openDetails();
    } else if (offset.y > verticalThreshold && isVerticalIntent && onSwipeDown) {
      flyOff("down", onSwipeDown);
    } else if (offset.x > horizontalThreshold && isHorizontalIntent) {
      flyOff("right", onSwipeRight);
    } else if (offset.x < -horizontalThreshold && isHorizontalIntent) {
      didHandleGestureRef.current = true;
      peekAndReturn("left", onSwipeLeft);
    } else {
      snapBack();
    }
  }, [flyOff, snapBack, peekAndReturn, openDetails, onSwipeRight, onSwipeLeft, onSwipeDown]);

  // Severity-based outer ring shadow
  const severityRing = hasCritical
    ? "0 0 0 1px rgba(239,68,68,0.25), 0 0 28px -4px rgba(239,68,68,0.35)"
    : "";

  const baseShadow = isTop
    ? `0 14px 50px -14px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.07)${severityRing ? `, ${severityRing}` : ""}`
    : "0 4px 20px -8px rgba(0,0,0,0.4)";

  return (
    <motion.div
      className={`absolute inset-0 rounded-2xl p-3.5 flex flex-col select-none overflow-hidden ${
        isTop ? "cursor-grab active:cursor-grabbing touch-none" : "pointer-events-none"
      }`}
      style={{
        ...(isTop
          ? { x, y: displayY, rotate, zIndex: 20, willChange: "transform" }
          : { scale: stackScale, y: stackOffsetY, opacity: stackOpacity, zIndex: 20 - stackIndex, willChange: "auto" }
        ),
        background: `
          radial-gradient(130% 70% at 0% 0%, ${accent.tint} 0%, transparent 55%),
          radial-gradient(110% 80% at 100% 100%, hsl(${accent.hue} / 0.12) 0%, transparent 60%),
          linear-gradient(165deg, hsl(0 0% 100% / 0.05) 0%, hsl(240 6% 5%) 38%, hsl(240 8% 3%) 100%)
        `,
        boxShadow: baseShadow,
        border: "1px solid transparent",
      }}
      drag={isTop}
      dragDirectionLock={isTop}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={isTop ? 0.2 : 0}
      dragMomentum={false}
      onDrag={isTop ? handleDrag : undefined}
      onDragEnd={isTop ? handleDragEnd : undefined}
      animate={isTop ? controls : undefined}
      initial={false}
      whileDrag={isTop ? { scale: 1.02 } : undefined}
      onClick={isTop ? handleCardTap : undefined}
    >
      {/* Static accent border — dezent, einheitlich */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          border: `1px solid hsl(${accent.hue} / ${isTop ? 0.18 : 0.08})`,
        }}
      />

      {/* Top accent line — single visual anchor for category */}
      {isTop && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 left-6 right-6 h-px rounded-full"
          style={{
            background: `linear-gradient(to right, transparent 0%, hsl(${accent.hue} / 0.6) 50%, transparent 100%)`,
            boxShadow: `0 0 12px hsl(${accent.hue} / 0.4)`,
          }}
        />
      )}

      {/* Severity pulse — only when critical alerts present (functional, not decorative) */}
      {isTop && hasCritical && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl"
          animate={{ opacity: [0.2, 0.45, 0.2] }}
          transition={{ duration: 2.8, ease: "easeInOut", repeat: Infinity }}
          style={{
            boxShadow: "inset 0 0 0 1px rgba(239,68,68,0.3), inset 0 0 24px rgba(239,68,68,0.14)",
          }}
        />
      )}

      {isTop && (
        <>
          {/* Edge-glow swipe indicators — premium materiality */}
          <motion.div
            className="absolute inset-y-0 right-0 w-24 rounded-r-2xl pointer-events-none z-10"
            style={{
              opacity: edgeRight,
              background:
                "linear-gradient(to left, hsl(152 55% 45% / 0.42) 0%, hsl(152 50% 40% / 0.16) 35%, hsl(152 50% 40% / 0.04) 65%, transparent 100%)",
              boxShadow:
                "inset -1px 0 0 hsl(152 60% 55% / 0.45), inset -24px 0 40px -20px hsl(152 60% 50% / 0.35)",
            }}
          >
            <motion.div
              className="absolute top-3 right-3 text-[10px] tracking-[0.25em] uppercase font-light"
              style={{ opacity: edgeRight, color: "hsl(152 55% 78%)", textShadow: "0 0 12px hsl(152 60% 50% / 0.4)" }}
            >
              ✓ OK
            </motion.div>
          </motion.div>
          <motion.div
            className="absolute inset-y-0 left-0 w-24 rounded-l-2xl pointer-events-none z-10"
            style={{
              opacity: edgeLeft,
              background:
                "linear-gradient(to right, hsl(0 65% 50% / 0.42) 0%, hsl(0 60% 45% / 0.16) 35%, hsl(0 60% 45% / 0.04) 65%, transparent 100%)",
              boxShadow:
                "inset 1px 0 0 hsl(0 70% 60% / 0.45), inset 24px 0 40px -20px hsl(0 65% 50% / 0.35)",
            }}
          >
            <motion.div
              className="absolute top-3 left-3 text-[10px] tracking-[0.25em] uppercase font-light"
              style={{ opacity: edgeLeft, color: "hsl(0 70% 82%)", textShadow: "0 0 12px hsl(0 65% 50% / 0.4)" }}
            >
              ✗ Aktion
            </motion.div>
          </motion.div>
          <motion.div
            className="absolute inset-x-0 top-0 h-20 rounded-t-2xl pointer-events-none z-10"
            style={{
              opacity: edgeUp,
              background:
                "linear-gradient(to bottom, hsl(45 80% 55% / 0.4) 0%, hsl(45 75% 50% / 0.14) 45%, transparent 100%)",
              boxShadow:
                "inset 0 1px 0 hsl(45 85% 60% / 0.5), inset 0 24px 40px -20px hsl(45 80% 55% / 0.35)",
            }}
          >
            <motion.div
              className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] tracking-[0.25em] uppercase font-light"
              style={{ opacity: edgeUp, color: "hsl(45 75% 82%)", textShadow: "0 0 12px hsl(45 80% 55% / 0.45)" }}
            >
              ↑ Details
            </motion.div>
          </motion.div>
          {onSwipeDown && (
            <motion.div
              className="absolute inset-x-0 bottom-0 h-20 rounded-b-2xl pointer-events-none z-10"
              style={{
                opacity: edgeDown,
                background:
                  "linear-gradient(to top, hsl(25 75% 50% / 0.4) 0%, hsl(25 70% 48% / 0.14) 45%, transparent 100%)",
                boxShadow:
                  "inset 0 -1px 0 hsl(25 80% 60% / 0.5), inset 0 -24px 40px -20px hsl(25 75% 50% / 0.35)",
              }}
            >
              <motion.div
                className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] tracking-[0.25em] uppercase font-light"
                style={{ opacity: edgeDown, color: "hsl(25 75% 82%)", textShadow: "0 0 12px hsl(25 75% 50% / 0.4)" }}
              >
                ↓ Skip
              </motion.div>
            </motion.div>
          )}
        </>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col gap-2 relative z-[1]">
        {/* Category badge + start date */}
        <div className="flex items-center justify-between">
          {chatter.decision ? (
            <CategoryReasonPopover decision={chatter.decision}>
              <div
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-colors hover:brightness-110"
                style={{
                  borderColor: `hsl(${accent.hue} / 0.35)`,
                  background: `hsl(${accent.hue} / 0.08)`,
                }}
              >
                <span className="text-[11px] leading-none">{chatter.categoryEmoji || "📊"}</span>
                <span className="text-[9.5px] uppercase tracking-wider font-semibold" style={{ color: `hsl(${accent.hue} / 0.95)` }}>
                  {chatter.categoryName || "Unbekannt"}
                </span>
                <span className="text-[8px] opacity-60 ml-0.5">ⓘ</span>
              </div>
            </CategoryReasonPopover>
          ) : (
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border"
              style={{
                borderColor: `hsl(${accent.hue} / 0.25)`,
                background: `hsl(${accent.hue} / 0.08)`,
              }}
            >
              <span className="text-[11px] leading-none">{chatter.categoryEmoji || "📊"}</span>
              <span className="text-[9.5px] uppercase tracking-wider font-semibold" style={{ color: `hsl(${accent.hue} / 0.95)` }}>
                {chatter.categoryName || "Unbekannt"}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5 shrink-0">
            <LastInputBadge lastAt={lastInputAt} lastSource={lastInputSource} onClick={onLastInputClick} />
            {chatter.startDate && (
              <span className="text-[10px] text-muted-foreground/70 font-medium">
                seit {chatter.startDate}
              </span>
            )}
          </div>
        </div>

        {/* Avatar + Name */}
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold tracking-wide"
            style={{
              background: `linear-gradient(135deg, hsl(${accent.hue} / 0.22) 0%, hsl(${accent.hue} / 0.06) 100%)`,
              color: `hsl(${accent.hue} / 0.9)`,
              border: `1px solid hsl(${accent.hue} / 0.18)`,
            }}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-foreground capitalize leading-tight truncate">
              {chatter.name.replace(/_/g, " ")}
            </h2>
            {(chatter.modelPerf?.followers || chatter.peerBm) && (
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                {chatter.modelPerf && chatter.modelPerf.followers > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
                    <Users className="h-3 w-3" />
                    {formatFollowers(chatter.modelPerf.followers)}
                  </span>
                )}
                {chatter.modelPerf && chatter.modelPerf.status !== "first" && chatter.modelPerf.percentChange !== null && (
                  <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      chatter.modelPerf.status === "better"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : chatter.modelPerf.status === "worse"
                        ? "bg-red-500/10 text-red-400"
                        : "bg-secondary text-muted-foreground"
                    }`}
                    title={
                      chatter.modelPerf.isSplitEstimate
                        ? `Schätzung: Umsatz wurde nach Followern auf mehrere Accounts aufgeteilt (${chatter.modelPerf.previousChatterName} hatte bis zu ${chatter.modelPerf.previousMaxAccountsPerDay} Accounts/Tag, aktuell bis zu ${chatter.modelPerf.currentMaxAccountsPerDay})`
                        : `Vergleich vs. ${chatter.modelPerf.previousChatterName}`
                    }
                  >
                    {chatter.modelPerf.percentChange > 0 ? "+" : ""}{chatter.modelPerf.percentChange}%
                    {chatter.modelPerf.isSplitEstimate && <span className="ml-0.5 opacity-70">≈</span>}
                  </span>
                )}
                {chatter.modelPerf?.isSplitEstimate && (
                  <span
                    className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-400/90 border border-amber-500/20"
                    title="Mehrere Accounts gleichzeitig — Umsatz nach Follower-Anteil geschätzt"
                  >
                    ⚖️ Multi-Account
                  </span>
                )}
                {chatter.peerBm && (() => {
                  const label = formatBenchmarkLabel(chatter.peerBm);
                  if (!label) return null;
                  const tone = getBenchmarkTone(chatter.peerBm);
                  const toneCls =
                    tone === "positive" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : tone === "negative" ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : tone === "neutral" ? "bg-secondary text-muted-foreground border-border/40"
                    : "bg-muted/40 text-muted-foreground/70 border-border/30";
                  const icon = chatter.peerBm.source === "account-baseline" ? "📈" : "📊";
                  const tooltip = chatter.peerBm.source === "account-baseline" && chatter.peerBm.baseline
                    ? `Account-Ø: ${chatter.peerBm.baseline.avgRevenue.toFixed(0)}€/Tag (${chatter.peerBm.baseline.dayCount} Tage)`
                    : chatter.peerBm.cluster
                    ? `${chatter.peerBm.cluster.label} • Median ${chatter.peerBm.cluster.median.toFixed(0)}€ • ${chatter.peerBm.cluster.accountCount} Accounts`
                    : "Globaler Schnitt";
                  return (
                    <span
                      className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border ${toneCls}`}
                      title={tooltip}
                    >
                      <span>{icon}</span>
                      <span>{label}</span>
                    </span>
                  );
                })()}
              </div>
            )}
          </div>
        </div>

        {/* Auto-Alert Banner — kompakt, max 2 */}
        {alerts.length > 0 && (
          <div className="space-y-1">
            {alerts.slice(0, 2).map((a, i) => {
              const Icon = ALERT_ICONS[a.alert_type] ?? AlertTriangle;
              const colorClass = SEVERITY_COLOR[a.severity] ?? SEVERITY_COLOR.medium;
              return (
                <div
                  key={i}
                  className={`flex items-start gap-1.5 rounded-md border-l-2 px-2 py-1 ${colorClass}`}
                >
                  <Icon className="h-3 w-3 mt-0.5 shrink-0 opacity-80" />
                  <p className="text-[10.5px] leading-snug opacity-90 line-clamp-2 min-w-0 flex-1">
                    <span className="font-semibold uppercase tracking-wider mr-1">
                      {ALERT_LABELS[a.alert_type] ?? a.alert_type}:
                    </span>
                    {a.message}
                  </p>
                </div>
              );
            })}
            {alerts.length > 2 && (
              <p className="text-[9px] text-muted-foreground/60 text-center">
                +{alerts.length - 2} weitere
              </p>
            )}
          </div>
        )}

        {/* Hero KPI — single visual anchor, ruhiger Glow */}
        {hero && (
          <div
            className="rounded-xl px-3 py-2.5 border relative overflow-hidden"
            style={{
              borderColor: `hsl(${accent.hue} / 0.22)`,
              background: `linear-gradient(135deg, hsl(${accent.hue} / 0.12) 0%, hsl(${accent.hue} / 0.03) 100%)`,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05)`,
            }}
          >
            {/* Subtle shine sweep — selten, dezent */}
            {isTop && (
              <motion.div
                aria-hidden
                className="absolute inset-0 pointer-events-none"
                initial={{ x: "-120%" }}
                animate={{ x: "120%" }}
                transition={{ duration: 2.2, ease: "easeInOut", repeat: Infinity, repeatDelay: 7 }}
                style={{
                  background: "linear-gradient(105deg, transparent 42%, rgba(255,255,255,0.07) 50%, transparent 58%)",
                }}
              />
            )}
            <div className="relative z-[1] flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[9px] uppercase tracking-[0.2em] font-semibold" style={{ color: `hsl(${accent.hue} / 0.85)` }}>
                  {hero.key}
                </p>
                <p className="text-[26px] font-bold text-foreground leading-none mt-1 tracking-tight truncate">
                  {hero.value}
                </p>
              </div>
              {swapDelta && (() => {
                const tone = swapDelta.tone;
                const valueColor =
                  tone === "pos" ? "text-emerald-300"
                  : tone === "neg" ? "text-red-300"
                  : "text-foreground/85";
                const glow =
                  tone === "pos" ? "rgba(16,185,129,0.18)"
                  : tone === "neg" ? "rgba(239,68,68,0.18)"
                  : "rgba(255,255,255,0.08)";
                const dirArrow =
                  swapDelta.direction === "upgrade" ? "↗"
                  : swapDelta.direction === "downgrade" ? "↘"
                  : swapDelta.direction === "lateral" ? "→"
                  : null;
                const dirColor =
                  swapDelta.direction === "upgrade" ? "text-emerald-300/80"
                  : swapDelta.direction === "downgrade" ? "text-red-300/80"
                  : "text-white/40";
                return (
                  <div
                    className="shrink-0 rounded-lg border border-white/[0.08] px-2 py-1.5 backdrop-blur-md text-right"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(0,0,0,0.35) 100%)",
                      boxShadow: `0 4px 14px -6px ${glow}, inset 0 1px 0 rgba(255,255,255,0.04)`,
                    }}
                  >
                    <div className="flex items-center justify-end gap-1 leading-none">
                      <span className="text-[8px] uppercase tracking-[0.18em] text-white/40 font-medium">Wechsel</span>
                    </div>
                    <div className="flex items-baseline justify-end gap-1 mt-1">
                      <span className={`text-[13px] font-light tabular-nums leading-none ${valueColor}`}>
                        {swapDelta.deltaLabel}
                      </span>
                      {dirArrow && (
                        <span className={`text-[10px] leading-none ${dirColor}`}>{dirArrow}</span>
                      )}
                    </div>
                    <p className="text-[9px] text-white/35 font-light leading-none mt-1 tabular-nums text-right">
                      {swapDelta.daysSince}T
                    </p>
                  </div>
                );
              })()}
              {recoveryDelta && (() => {
                const eur = Math.round(recoveryDelta.recoveryEur);
                const pct = Math.round(recoveryDelta.gapPct * 100);
                const fmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(eur);
                return (
                  <div
                    className="shrink-0 rounded-lg border px-2 py-1.5 backdrop-blur-md text-right"
                    style={{
                      borderColor: "hsl(38 92% 60% / 0.22)",
                      background: "linear-gradient(135deg, hsl(38 92% 55% / 0.10) 0%, rgba(0,0,0,0.35) 100%)",
                      boxShadow: "0 4px 14px -6px hsl(38 92% 50% / 0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
                    }}
                  >
                    <div className="flex items-center justify-end gap-1 leading-none">
                      <span className="text-[8px] uppercase tracking-[0.18em] text-amber-300/70 font-medium">Recovery</span>
                    </div>
                    <div className="flex items-baseline justify-end gap-1 mt-1">
                      <span className="text-[13px] font-light tabular-nums leading-none text-amber-200">
                        +{fmt} €
                      </span>
                    </div>
                    <p className="text-[9px] text-white/40 font-light leading-none mt-1 tabular-nums text-right">
                      −{pct}% v. Ø
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* KPIs — 2x2 grid */}
        {kpiEntries.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5">
            {kpiEntries.slice(0, 4).map(([key, value]) => (
              <div key={key} className="bg-white/[0.025] border border-white/[0.04] rounded-md px-2 py-1.5">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide leading-tight">{key}</p>
                <p className="text-[13px] font-medium text-foreground leading-tight">{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* 7-Tage-Trend — füllt verbleibenden Raum */}
        {isTop && chatter.history && chatter.history.length > 1 && (
          <div className="flex-1 min-h-0 flex">
            <WeekTrendCard history={chatter.history} compact fillHeight />
          </div>
        )}
      </div>

      {/* Login picker — for chatters with multiple accounts */}
      <AnimatePresence>
        {loginPicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-30 flex items-end justify-center bg-black/60 backdrop-blur-sm rounded-2xl p-3"
            onClick={(e) => { e.stopPropagation(); setLoginPicker(null); }}
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              className="w-full max-w-sm rounded-xl border border-white/[0.08] bg-card/95 backdrop-blur-xl p-3 space-y-2 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 px-1 pb-1">
                {loginPicker === "email" ? <Mail className="h-3.5 w-3.5 text-muted-foreground" /> : <Key className="h-3.5 w-3.5 text-muted-foreground" />}
                <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                  {loginPicker === "email" ? "E-Mail kopieren" : "Passwort kopieren"} — Account wählen
                </p>
              </div>
              {accountLogins
                .filter((a) => (loginPicker === "email" ? a.email : a.password))
                .map((a) => {
                  const value = (loginPicker === "email" ? a.email : a.password) || "";
                  return (
                    <button
                      key={a.account}
                      onClick={() => {
                        navigator.clipboard.writeText(value);
                        toast.success(`${loginPicker === "email" ? "E-Mail" : "Passwort"} kopiert · ${a.account}`);
                        triggerHaptic("medium");
                        setLoginPicker(null);
                      }}
                      className="w-full text-left rounded-lg border border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06] px-3 py-2 transition-colors"
                    >
                      <p className="text-[13px] font-medium text-foreground">{a.account}</p>
                      <p className="text-[10px] text-muted-foreground/70 truncate">
                        {loginPicker === "email" ? value : "•".repeat(Math.min(value.length, 12))}
                      </p>
                    </button>
                  );
                })}
              <button
                onClick={() => setLoginPicker(null)}
                className="w-full text-[11px] text-muted-foreground/60 hover:text-muted-foreground py-2"
              >
                Abbrechen
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
