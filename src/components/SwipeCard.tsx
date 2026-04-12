import { motion, useMotionValue, useTransform, useAnimation, PanInfo } from "framer-motion";
import { useMemo, useCallback } from "react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { toast } from "sonner";

interface ChatterData {
  name: string;
  kpis: Record<string, string>;
  recommendation?: string;
  categoryEmoji?: string;
  categoryName?: string;
  revenueHistory?: { date: string; revenue: number }[];
}

interface Props {
  chatter: ChatterData;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  onSwipeUp: () => void;
  onSwipeDown?: () => void;
  isTop: boolean;
  stackIndex?: number;
}

function triggerHaptic(style: "light" | "medium" = "light") {
  try {
    if ("vibrate" in navigator) {
      navigator.vibrate(style === "medium" ? [15, 30, 15] : 10);
    }
  } catch {}
}

export default function SwipeCard({ chatter, onSwipeRight, onSwipeLeft, onSwipeUp, onSwipeDown, isTop, stackIndex = 0 }: Props) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const controls = useAnimation();
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const opacityRight = useTransform(x, [0, 100], [0, 1]);
  const opacityLeft = useTransform(x, [-100, 0], [1, 0]);
  const opacityUp = useTransform(y, [-100, 0], [1, 0]);
  const opacityDown = useTransform(y, [0, 100], [0, 1]);

  const kpiEntries = useMemo(() => {
    return Object.entries(chatter.kpis).filter(([k]) => k !== "Name" && k !== "name");
  }, [chatter.kpis]);

  const gradientId = useMemo(() => `sparkGrad-${chatter.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,[chatter.name]);
  const stackScale = Math.max(0.82, 1 - stackIndex * 0.04);
  const stackOffsetY = stackIndex * 12;
  const stackOpacity = Math.max(0.22, 1 - stackIndex * 0.14);

  const flyOff = useCallback(async (direction: "right" | "left" | "up" | "down", callback: () => void) => {
    triggerHaptic("medium");
    const targets: Record<string, { x: number; y: number; rotate: number }> = {
      right: { x: 500, y: 0, rotate: 20 },
      left: { x: -500, y: 0, rotate: -20 },
      up: { x: 0, y: -600, rotate: 0 },
      down: { x: 0, y: 500, rotate: 0 },
    };
    await controls.start({
      ...targets[direction],
      opacity: 0,
      transition: { duration: 0.3, ease: "easeIn" },
    });
    callback();
  }, [controls]);

  const handleDragEnd = useCallback((_: any, info: PanInfo) => {
    const { offset } = info;
    const distThreshold = 120;

    if (offset.y < -distThreshold) {
      flyOff("up", onSwipeUp);
    } else if (offset.y > distThreshold && onSwipeDown) {
      flyOff("down", onSwipeDown);
    } else if (offset.x > distThreshold) {
      flyOff("right", onSwipeRight);
    } else if (offset.x < -distThreshold) {
      flyOff("left", onSwipeLeft);
    } else {
      controls.start({ x: 0, y: 0, rotate: 0, opacity: 1, transition: { type: "spring", stiffness: 500, damping: 30 } });
    }
  }, [flyOff, onSwipeRight, onSwipeLeft, onSwipeUp, onSwipeDown, controls]);

  return (
    <motion.div
      className={`absolute inset-0 rounded-2xl border border-border bg-[hsl(var(--surface-1))] p-5 flex flex-col select-none ${
        isTop ? "cursor-grab active:cursor-grabbing touch-none" : "pointer-events-none"
      }`}
      style={isTop ? { x, y, rotate, zIndex: 20 } : { scale: stackScale, y: stackOffsetY, opacity: stackOpacity, zIndex: 20 - stackIndex }}
      drag={isTop}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={isTop ? 0.9 : 0}
      onDragEnd={isTop ? handleDragEnd : undefined}
      animate={isTop ? controls : undefined}
      initial={isTop ? { scale: 0.95, opacity: 0 } : false}
      whileDrag={isTop ? { scale: 1.02 } : undefined}
      onAnimationComplete={() => {
        // Reset motion values after mount animation
        if (x.get() === 0 && y.get() === 0) return;
      }}
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

      {/* Category badge */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{chatter.categoryEmoji || "📊"}</span>
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          {chatter.categoryName || "Unbekannt"}
        </span>
      </div>

      {/* Name — tap to copy */}
      <h2
        className={`text-xl font-semibold text-foreground mb-4 capitalize transition-colors ${
          isTop ? "cursor-pointer active:text-primary" : ""
        }`}
        onClick={isTop ? (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(chatter.name.replace(/_/g, " "));
          toast.success("Name kopiert");
        } : undefined}
        title={isTop ? "Klicken zum Kopieren" : undefined}
      >
        {chatter.name.replace(/_/g, " ")}
      </h2>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        {kpiEntries.slice(0, 6).map(([key, value]) => (
          <div key={key} className="bg-secondary rounded-lg px-3 py-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{key}</p>
            <p className="text-sm font-medium text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {/* Mini sparkline */}
      {chatter.revenueHistory && chatter.revenueHistory.length > 1 && (
        <div className="h-14 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chatter.revenueHistory}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="hsl(var(--primary))"
                fill={`url(#${gradientId})`}
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recommendation — scrollable */}
      {chatter.recommendation && (
        <div className="mt-auto bg-secondary rounded-lg px-3 py-2.5 overflow-y-auto max-h-32" onPointerDown={isTop ? (e) => e.stopPropagation() : undefined}>
          <p className="text-[11px] text-muted-foreground mb-0.5">Empfehlung</p>
          <p className="text-xs text-foreground/80 leading-relaxed">
            {chatter.recommendation}
          </p>
        </div>
      )}
    </motion.div>
  );
}
