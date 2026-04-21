import type { RiskScore } from "@/lib/risk-forecast";
import { cn } from "@/lib/utils";

interface RiskBadgeProps {
  score: RiskScore["score"];
  band: RiskScore["band"];
  size?: "sm" | "md";
  className?: string;
}

const BAND_CLASS: Record<RiskScore["band"], string> = {
  low: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
  medium: "bg-amber-500/10 text-amber-300 border-amber-500/25",
  high: "bg-orange-500/12 text-orange-300 border-orange-500/35",
  critical: "bg-red-500/15 text-red-300 border-red-500/40",
};

const BAND_DOT: Record<RiskScore["band"], string> = {
  low: "bg-emerald-400 shadow-[0_0_8px_hsl(155_70%_55%/0.7)]",
  medium: "bg-amber-400 shadow-[0_0_8px_hsl(45_90%_60%/0.7)]",
  high: "bg-orange-400 shadow-[0_0_10px_hsl(25_90%_60%/0.8)]",
  critical: "bg-red-500 shadow-[0_0_12px_hsl(0_85%_60%/0.9)] animate-pulse",
};

export function RiskBadge({ score, band, size = "sm", className }: RiskBadgeProps) {
  return (
    <span
      className={cn(
        "premium-chip inline-flex items-center gap-1.5 rounded-full border font-medium tracking-tight tabular-nums",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        BAND_CLASS[band],
        className,
      )}
      title={`Risk-Score ${score}/100`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", BAND_DOT[band])} />
      Risk {score}
    </span>
  );
}
