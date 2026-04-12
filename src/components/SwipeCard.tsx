import { motion, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { useMemo } from "react";
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
  isTop: boolean;
}

export default function SwipeCard({ chatter, onSwipeRight, onSwipeLeft, onSwipeUp, isTop }: Props) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const opacityRight = useTransform(x, [0, 100], [0, 1]);
  const opacityLeft = useTransform(x, [-100, 0], [1, 0]);
  const opacityUp = useTransform(y, [-100, 0], [1, 0]);

  const kpiEntries = useMemo(() => {
    return Object.entries(chatter.kpis).filter(([k]) => k !== "Name" && k !== "name");
  }, [chatter.kpis]);

  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.y < -120) {
      onSwipeUp();
    } else if (info.offset.x > 120) {
      onSwipeRight();
    } else if (info.offset.x < -120) {
      onSwipeLeft();
    }
  };

  if (!isTop) {
    return (
      <motion.div
        className="absolute inset-0 rounded-2xl border border-border bg-[hsl(var(--surface-1))] p-6"
        style={{ scale: 0.95, opacity: 0.5 }}
      />
    );
  }

  return (
    <motion.div
      className="absolute inset-0 rounded-2xl border border-border bg-[hsl(var(--surface-1))] p-5 cursor-grab active:cursor-grabbing touch-none select-none flex flex-col"
      style={{ x, y, rotate }}
      drag
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={0.9}
      onDragEnd={handleDragEnd}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      whileDrag={{ scale: 1.02 }}
    >
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

      {/* Category badge */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{chatter.categoryEmoji || "📊"}</span>
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          {chatter.categoryName || "Unbekannt"}
        </span>
      </div>

      {/* Name — tap to copy */}
      <h2
        className="text-xl font-semibold text-foreground mb-4 capitalize cursor-pointer active:text-primary transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(chatter.name.replace(/_/g, " "));
          const el = e.currentTarget;
          el.dataset.copied = "true";
          setTimeout(() => delete el.dataset.copied, 1000);
        }}
        title="Klicken zum Kopieren"
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
                <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="hsl(var(--primary))"
                fill="url(#sparkGrad)"
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recommendation — scrollable */}
      {chatter.recommendation && (
        <div className="mt-auto bg-secondary rounded-lg px-3 py-2.5 overflow-y-auto max-h-32" onPointerDown={(e) => e.stopPropagation()}>
          <p className="text-[11px] text-muted-foreground mb-0.5">Empfehlung</p>
          <p className="text-xs text-foreground/80 leading-relaxed">
            {chatter.recommendation}
          </p>
        </div>
      )}
    </motion.div>
  );
}
