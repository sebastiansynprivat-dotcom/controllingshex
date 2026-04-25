/**
 * Popover für Erklärbarkeit der Action-Kategorie (Punkt 8).
 *
 * Zeigt Reasons + die wichtigsten Signale in einem Premium-Look.
 * Mobil = Sheet-artig durch Popover (Radix), Desktop = Hover/Click.
 */
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Info } from "lucide-react";
import type { CategoryDecision } from "@/lib/categorize-v2";
import type { StabilizedDecision } from "@/lib/category-state";

interface Props {
  decision: CategoryDecision | StabilizedDecision;
  /** Trigger-Element (das Kategorie-Badge) */
  children: React.ReactNode;
}

function fmtPct(n: number, signed = false): string {
  const v = Math.round(n * 100);
  if (signed) return `${v >= 0 ? "+" : ""}${v}%`;
  return `${v}%`;
}
function fmtEur(n: number): string {
  return `${Math.round(n)}€`;
}

export default function CategoryReasonPopover({ decision, children }: Props) {
  const [open, setOpen] = useState(false);
  const s = decision.signals;
  const stab = decision as StabilizedDecision;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="inline-flex items-center gap-1 cursor-pointer focus:outline-none"
          aria-label="Kategorie-Begründung anzeigen"
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-[300px] p-0 border-border/60 bg-popover/95 backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2.5 border-b border-border/50 flex items-center gap-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] uppercase tracking-wider font-semibold text-foreground">
            Warum {decision.name}?
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground/80 capitalize">
            {decision.confidence}
          </span>
        </div>

        {/* Reasons */}
        <div className="px-3 py-2.5 space-y-1.5">
          {decision.reasons.length === 0 && (
            <div className="text-[11px] text-muted-foreground italic">Keine spezifischen Signale.</div>
          )}
          {decision.reasons.map((r, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] leading-snug text-foreground/90">
              <span className="text-primary/70 mt-[3px]">•</span>
              <span>{r}</span>
            </div>
          ))}
        </div>

        {/* Signal chips */}
        <div className="px-3 py-2 border-t border-border/40 grid grid-cols-2 gap-1.5">
          <SignalChip label="Tage" value={`${s.count}`} />
          <SignalChip label="Ø Umsatz" value={fmtEur(s.avgRev)} />
          <SignalChip label="0€-Anteil" value={fmtPct(s.zeroRate)} tone={s.zeroRate >= 0.5 ? "neg" : "neutral"} />
          <SignalChip label="Trend 7d" value={fmtPct(s.trend7v30, true)} tone={s.trend7v30 >= 0.1 ? "pos" : s.trend7v30 <= -0.2 ? "neg" : "neutral"} />
          <SignalChip label="Verzug aktuell" value={`${s.lastDelay}d`} tone={s.lastDelay >= 3 ? "neg" : "neutral"} />
          {s.peerPctOfMedian !== null && (
            <SignalChip label="vs. Peer-Ø" value={`${s.peerPctOfMedian}%`} tone={s.peerPctOfMedian >= 100 ? "pos" : s.peerPctOfMedian < 60 ? "neg" : "neutral"} />
          )}
          {s.consistencyStreak > 0 && (
            <SignalChip label="Konstanz" value={`${s.consistencyStreak}d`} tone="pos" />
          )}
          {s.accountChanges > 0 && (
            <SignalChip label="Accounts" value={`${s.accounts.length}`} tone="neutral" />
          )}
        </div>

        {stab.heldByHysteresis && (
          <div className="px-3 py-2 border-t border-border/40 text-[10.5px] text-muted-foreground/90 italic">
            Status wird durch Stabilitäts-Schutz gehalten.
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SignalChip({
  label,
  value,
  tone = "neutral",
}: { label: string; value: string; tone?: "pos" | "neg" | "neutral" }) {
  const toneClass =
    tone === "pos" ? "text-emerald-400/90"
    : tone === "neg" ? "text-rose-400/90"
    : "text-foreground/85";
  return (
    <div className="flex flex-col gap-0 px-2 py-1 rounded-md bg-muted/30 border border-border/30">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/80">{label}</span>
      <span className={`text-[11px] font-semibold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}
