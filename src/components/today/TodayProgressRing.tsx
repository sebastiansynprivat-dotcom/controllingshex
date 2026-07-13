import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Props {
  pct: number;
  done: number;
  total: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/**
 * Kompakter Progress-Ring für die Heute-Command-Bar.
 * Sanfter Verlauf gold → emerald, tabular Zähler in der Mitte.
 */
export default function TodayProgressRing({
  pct,
  done,
  total,
  size = 68,
  strokeWidth = 5,
  className,
}: Props) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * circumference;

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="today-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--gold))" stopOpacity="0.85" />
            <stop offset="100%" stopColor="rgb(52, 211, 153)" stopOpacity="0.95" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#today-ring-grad)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - dash }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[13px] font-light tabular-nums text-foreground/90">
          {done}<span className="text-white/30">/{total}</span>
        </span>
        <span className="text-[8.5px] uppercase tracking-[0.18em] text-white/35 mt-0.5">
          {clamped}%
        </span>
      </div>
    </div>
  );
}
