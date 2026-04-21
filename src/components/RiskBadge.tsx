import type { RiskScore } from "@/lib/risk-forecast";
import { cn } from "@/lib/utils";

interface RiskBadgeProps {
  score: RiskScore["score"];
  band: RiskScore["band"];
  size?: "sm" | "md";
  className?: string;
}

const BAND_CLASS: Record<RiskScore["band"], string> = {
  low: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
};

const BAND_DOT: Record<RiskScore["band"], string> = {
  low: "bg-emerald-400",
  medium: "bg-amber-400",
  high: "bg-orange-400",
  critical: "bg-red-500",
};

export function RiskBadge({ score, band, size = "sm", className }: RiskBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium tracking-tight",
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
