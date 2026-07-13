import { Sparkles, TrendingUp, TrendingDown } from "lucide-react";
import type { ModelContentScore } from "@/lib/content-scout";

interface Props {
  item: ModelContentScore;
  onClick: () => void;
}

function fmtEur(v: number): string {
  return `${Math.round(v).toLocaleString("de-DE")} €`;
}

export default function HiddenGemCard({ item, onClick }: Props) {
  const delta = item.revenueDeltaPct;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative text-left w-full rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-500/[0.08] via-white/[0.02] to-transparent p-4 hover:border-amber-400/40 transition-all"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="h-3 w-3 text-amber-300" />
            <span className="text-[10px] uppercase tracking-[0.15em] text-amber-300/85 font-medium">Unterschätzt</span>
          </div>
          <div className="text-[15px] font-medium text-foreground truncate">{item.model}</div>
          <div className="text-[11px] text-foreground/50 font-light">
            {item.tier?.emoji} {item.followers.toLocaleString("de-DE")} Follower
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[22px] font-semibold tracking-tight text-amber-200">{item.score}</div>
          <div className="text-[9px] uppercase tracking-widest text-foreground/40">Score</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Sales / T" value={item.avgSalesPerDay.toFixed(1)} />
        <Stat label="€ / T" value={fmtEur(item.avgRevenuePerDay)} />
        <Stat label="Chats / T" value={Math.round(item.avgOpenChats).toString()} />
      </div>

      {delta !== null && (
        <div className={`mt-3 flex items-center gap-1 text-[11px] font-light ${delta >= 0 ? "text-emerald-300/85" : "text-red-300/85"}`}>
          {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {delta >= 0 ? "+" : ""}{delta}% vs. Vorperiode
        </div>
      )}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/[0.05] py-1.5">
      <div className="text-[13px] font-medium text-foreground/90">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-foreground/40 font-light">{label}</div>
    </div>
  );
}
