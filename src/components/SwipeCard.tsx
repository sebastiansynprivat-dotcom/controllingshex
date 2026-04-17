import { motion, useMotionValue, useTransform, useAnimation, PanInfo } from "framer-motion";
import { useMemo, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Users, AlertTriangle, TrendingDown, MessageSquareOff, Inbox, Sparkles } from "lucide-react";
import { type ModelPerformance, formatFollowers } from "@/lib/model-performance";
import WeekTrendCard from "@/components/WeekTrendCard";

interface ChatterData {
  name: string;
  kpis: Record<string, string>;
  recommendation?: string;
  categoryEmoji?: string;
  categoryName?: string;
  startDate?: string;
  history?: { analysis_date: string; revenue_today: number; mass_dms: number; response_delay_days: number }[];
  modelPerf?: ModelPerformance;
}

interface AnomalyAlertInfo {
  alert_type: string;
  severity: string;
  message: string;
}

interface Props {
  chatter: ChatterData;
  alerts?: AnomalyAlertInfo[];
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  onSwipeUp: () => void;
  onSwipeDown?: () => void;
  isTop: boolean;
  stackIndex?: number;
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

function triggerHaptic(style: "light" | "medium" = "light") {
  try {
    if ("vibrate" in navigator) {
      navigator.vibrate(style === "medium" ? [15, 30, 15] : 10);
    }
  } catch {}
}

export default function SwipeCard({ chatter, alerts = [], onSwipeRight, onSwipeLeft, onSwipeUp, onSwipeDown, isTop, stackIndex = 0 }: Props) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const controls = useAnimation();
  const didHandleGestureRef = useRef(false);
  const isDraggingRef = useRef(false);
  const lastTapRef = useRef<number>(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const displayY = useTransform(y, (value) => (value < 0 ? value * 0.45 : value));
  const opacityRight = useTransform(x, [0, 100], [0, 1]);
  const opacityLeft = useTransform(x, [-100, 0], [1, 0]);
  const opacityUp = useTransform(y, [-100, 0], [1, 0]);
  const opacityDown = useTransform(y, [0, 100], [0, 1]);

  const kpiEntries = useMemo(() => {
    return Object.entries(chatter.kpis).filter(([k]) => k !== "Name" && k !== "name");
  }, [chatter.kpis]);

  const isVisible = stackIndex === 0;
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

  const handleCardTap = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      // Double-tap → Details
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      triggerHaptic("medium");
      onSwipeUp();
    } else {
      // Single-tap → nach 300ms Name kopieren
      tapTimerRef.current = setTimeout(() => {
        navigator.clipboard.writeText(chatter.name.replace(/_/g, " "));
        toast.success("Name kopiert");
        triggerHaptic("light");
      }, 300);
    }
    lastTapRef.current = now;
  }, [chatter.name, onSwipeUp]);

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
    const verticalThreshold = 70; // Lower threshold for up/down — feels more natural
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

  return (
    <motion.div
      className={`absolute inset-0 rounded-2xl border border-white/[0.08] p-5 flex flex-col select-none overflow-hidden ${
        isTop ? "cursor-grab active:cursor-grabbing touch-none" : "pointer-events-none"
      }`}
      style={{
        ...(isTop
          ? { x, y: displayY, rotate, zIndex: 20, willChange: "transform" }
          : { scale: stackScale, y: stackOffsetY, opacity: isVisible ? stackOpacity : 0, zIndex: 20 - stackIndex, willChange: "auto" }
        ),
        background: "linear-gradient(165deg, hsl(0 0% 100% / 0.04) 0%, hsl(240 6% 5%) 40%, hsl(240 6% 4%) 100%)",
        boxShadow: isTop
          ? "0 8px 40px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)"
          : "0 4px 20px -8px rgba(0,0,0,0.4)",
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
      {isTop && (
        <>
          {/* Swipe overlays */}
          <motion.div
            className="absolute inset-0 rounded-2xl border-2 border-green-500/50 bg-green-500/5 flex items-center justify-center pointer-events-none z-10"
            style={{ opacity: opacityRight }}
          >
            <span className="text-green-400 text-4xl font-bold rotate-[-15deg]">✓ OK</span>
          </motion.div>
          <motion.div
            className="absolute inset-0 rounded-2xl border-2 border-red-500/50 bg-red-500/5 flex items-center justify-center pointer-events-none z-10"
            style={{ opacity: opacityLeft }}
          >
            <span className="text-red-400 text-4xl font-bold rotate-[15deg]">✗ AKTION</span>
          </motion.div>
          <motion.div
            className="absolute inset-0 rounded-2xl border-2 border-blue-500/50 bg-blue-500/5 flex items-center justify-center pointer-events-none z-10"
            style={{ opacity: opacityUp }}
          >
            <span className="text-blue-400 text-2xl font-bold">↑ DETAILS</span>
          </motion.div>
          {onSwipeDown && (
            <motion.div
              className="absolute inset-0 rounded-2xl border-2 border-amber-500/50 bg-amber-500/5 flex items-center justify-center pointer-events-none z-10"
              style={{ opacity: opacityDown }}
            >
              <span className="text-amber-400 text-2xl font-bold">↓ SKIP</span>
            </motion.div>
          )}
        </>
      )}

      {/* Scrollbarer Inhaltsbereich — damit Trend-Karte nicht abgeschnitten wird */}
      <div
        className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1"
        onPointerDown={isTop ? (e) => e.stopPropagation() : undefined}
        style={{ touchAction: isTop ? "pan-y" : "none" }}
      >
        {/* Category badge + start date */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">{chatter.categoryEmoji || "📊"}</span>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              {chatter.categoryName || "Unbekannt"}
            </span>
          </div>
          {chatter.startDate && (
            <span className="text-[10px] text-muted-foreground/70 font-medium">
              seit {chatter.startDate}
            </span>
          )}
        </div>

        {/* Name */}
        <h2 className="text-xl font-semibold text-foreground mb-1 capitalize">
          {chatter.name.replace(/_/g, " ")}
        </h2>

        {/* Auto-Alert Banner */}
        {alerts.length > 0 && (
          <div className="space-y-1.5 mb-3 mt-2">
            {alerts.slice(0, 3).map((a, i) => {
              const Icon = ALERT_ICONS[a.alert_type] ?? AlertTriangle;
              const colorClass = SEVERITY_COLOR[a.severity] ?? SEVERITY_COLOR.medium;
              return (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-lg border-l-2 px-2.5 py-1.5 ${colorClass}`}
                >
                  <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 opacity-80" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider font-semibold opacity-90">
                        {ALERT_LABELS[a.alert_type] ?? a.alert_type}
                      </span>
                    </div>
                    <p className="text-[11px] leading-snug opacity-90">{a.message}</p>
                  </div>
                </div>
              );
            })}
            {alerts.length > 3 && (
              <p className="text-[10px] text-muted-foreground/60 text-center">
                +{alerts.length - 3} weitere Auffälligkeiten
              </p>
            )}
          </div>
        )}

        {chatter.modelPerf && chatter.modelPerf.followers > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <Users className="h-3 w-3" />
              {formatFollowers(chatter.modelPerf.followers)}
            </span>
            {chatter.modelPerf.status !== "first" && chatter.modelPerf.percentChange !== null && (
              <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${
                chatter.modelPerf.status === "better"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : chatter.modelPerf.status === "worse"
                  ? "bg-red-500/10 text-red-400"
                  : "bg-secondary text-muted-foreground"
              }`}>
                {chatter.modelPerf.percentChange > 0 ? "+" : ""}{chatter.modelPerf.percentChange}% vs. Vorgänger
              </span>
            )}
            {chatter.modelPerf.status === "first" && (
              <span className="text-[10px] text-muted-foreground/40">Erster Chatter</span>
            )}
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-2.5 mb-3">
          {kpiEntries.slice(0, 6).map(([key, value]) => (
            <div key={key} className="bg-secondary rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{key}</p>
              <p className="text-sm font-medium text-foreground">{value}</p>
            </div>
          ))}
        </div>

        {/* 7-Tage-Trend (nur Top-Karte rendert Charts, andere zeigen Platzhalter) */}
        {isTop && chatter.history && chatter.history.length > 1 && (
          <WeekTrendCard history={chatter.history} compact />
        )}
      </div>
    </motion.div>
  );
}
