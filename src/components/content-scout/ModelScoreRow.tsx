import { Sparkles, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { ModelContentScore } from "@/lib/content-scout";

interface Props {
  item: ModelContentScore;
  rank: number;
  onClick: () => void;
}

function fmtEur(v: number): string {
  return `${Math.round(v).toLocaleString("de-DE")} €`;
}

export default function ModelScoreRow({ item, rank, onClick }: Props) {
  const delta = item.revenueDeltaPct;
  const scoreColor = item.score >= 70 ? "text-emerald-300" : item.score >= 40 ? "text-yellow-200" : "text-foreground/50";
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-left rounded-xl border border-white/[0.05] bg-white/[0.015] hover:bg-white/[0.035] hover:border-white/[0.1] transition-all p-3 sm:p-4"
    >
      <div className="flex items-center gap-3">
        <div className="w-7 text-center text-[11px] font-light text-foreground/40 shrink-0">#{rank}</div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-medium text-foreground truncate">{item.model}</span>
            {item.hiddenGem && <Sparkles className="h-3 w-3 text-amber-300 shrink-0" />}
          </div>
          <div className="text-[10px] text-foreground/45 font-light">
            {item.tier?.emoji} {item.followers.toLocaleString("de-DE")} · {item.tier?.label ?? "—"}
          </div>
        </div>

        <div className="hidden sm:grid grid-cols-3 gap-4 text-right text-[11px] font-light shrink-0">
          <Col label="Sales/T" value={item.avgSalesPerDay.toFixed(1)} />
          <Col label="€/T" value={fmtEur(item.avgRevenuePerDay)} />
          <Col label="Chats/T" value={Math.round(item.avgOpenChats).toString()} />
        </div>

        <div className="shrink-0 flex items-center gap-2 min-w-[90px] justify-end">
          <div className="h-1.5 w-16 rounded-full bg-white/[0.05] overflow-hidden hidden sm:block">
            <div
              className={`h-full ${item.score >= 70 ? "bg-emerald-400/70" : item.score >= 40 ? "bg-yellow-400/70" : "bg-white/20"}`}
              style={{ width: `${item.score}%` }}
            />
          </div>
          <div className={`text-[16px] font-semibold tabular-nums ${scoreColor}`}>{item.score}</div>
        </div>

        <div className="w-14 text-right shrink-0 text-[11px] font-light">
          {delta === null ? (
            <Minus className="h-3 w-3 text-foreground/30 ml-auto" />
          ) : delta >= 0 ? (
            <span className="inline-flex items-center gap-0.5 text-emerald-300/85">
              <TrendingUp className="h-3 w-3" />+{delta}%
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 text-red-300/85">
              <TrendingDown className="h-3 w-3" />{delta}%
            </span>
          )}
        </div>
      </div>

      <div className="sm:hidden mt-2 grid grid-cols-3 gap-2 text-center text-[10px]">
        <MobCol label="Sales/T" value={item.avgSalesPerDay.toFixed(1)} />
        <MobCol label="€/T" value={fmtEur(item.avgRevenuePerDay)} />
        <MobCol label="Chats/T" value={Math.round(item.avgOpenChats).toString()} />
      </div>
    </button>
  );
}

function Col({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-foreground/85 tabular-nums">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-foreground/35">{label}</div>
    </div>
  );
}

function MobCol({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/[0.02] py-1">
      <div className="text-foreground/85 tabular-nums text-[11px]">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-foreground/40 font-light">{label}</div>
    </div>
  );
}
