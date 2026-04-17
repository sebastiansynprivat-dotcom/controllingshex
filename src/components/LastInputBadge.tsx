import { Clock } from "lucide-react";
import { getInputBadgeStyle, getSourceMeta, type InputSource } from "@/lib/chatter-inputs";

interface Props {
  lastAt: string | null;
  lastSource: InputSource | null;
  onClick?: (e: React.MouseEvent) => void;
  compact?: boolean;
}

export default function LastInputBadge({ lastAt, lastSource, onClick, compact }: Props) {
  const style = getInputBadgeStyle(lastAt);
  const meta = lastSource ? getSourceMeta(lastSource) : null;

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      className={`inline-flex items-center gap-1 rounded-full border font-medium transition-all active:scale-95 ${
        compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]"
      }`}
      style={{
        borderColor: `hsl(${style.hue} / 0.35)`,
        background: `hsl(${style.hue} / 0.10)`,
        color: `hsl(${style.hue} / 0.95)`,
        boxShadow: style.intensity === "stale" ? `0 0 12px hsl(${style.hue} / 0.25)` : undefined,
      }}
      aria-label={`Letzter Input: ${style.label}`}
    >
      {meta ? (
        <span className="text-[10px] leading-none">{meta.icon}</span>
      ) : (
        <Clock className="h-2.5 w-2.5" />
      )}
      <span className="leading-none">{style.label}</span>
    </button>
  );
}
