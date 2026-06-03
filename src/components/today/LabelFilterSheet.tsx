/**
 * LabelFilterSheet — Multi-Select welche Labels aktuell im Heute-Tab erscheinen.
 */
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { isSystemLabel, isUpgradeReceivedLabel, type ChatterLabel } from "@/lib/chatter-labels";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: ChatterLabel[];
  /** Anzahl gelabelter Chatter pro Label-ID — fürs UI-Count */
  countsByLabel: Map<string, number>;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export default function LabelFilterSheet({
  open,
  onOpenChange,
  labels,
  countsByLabel,
  selectedIds,
  onToggle,
  onSelectAll,
  onClearAll,
}: Props) {
  const visibleLabels = labels.filter((l) => isSystemLabel(l) && !isUpgradeReceivedLabel(l));
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl border-white/[0.08] max-h-[80vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-foreground/90 font-light">
            Labels filtern
          </SheetTitle>
          <SheetDescription className="text-white/40 text-[12px]">
            Wähle, welche Labels im Heute-Tab als Karten erscheinen.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={onSelectAll}
            className="text-[11px] text-white/55 hover:text-white/85 px-2 py-1 rounded-md hover:bg-white/[0.05] transition-all"
          >
            Alle
          </button>
          <button
            onClick={onClearAll}
            className="text-[11px] text-white/55 hover:text-white/85 px-2 py-1 rounded-md hover:bg-white/[0.05] transition-all"
          >
            Keine
          </button>
        </div>
        <div className="mt-3 space-y-2 pb-4">
          {visibleLabels.length === 0 && (
            <p className="text-[12px] text-white/40 text-center py-6">
              Noch keine Labels angelegt.
            </p>
          )}
          {visibleLabels.map((l) => {
            const active = selectedIds.has(l.id);
            const count = countsByLabel.get(l.id) ?? 0;
            return (
              <button
                key={l.id}
                onClick={() => onToggle(l.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl border transition-all text-left",
                  active
                    ? "bg-white/[0.07]"
                    : "bg-white/[0.02] hover:bg-white/[0.05]",
                )}
                style={{
                  borderColor: active ? `${l.color}66` : "rgba(255,255,255,0.06)",
                }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: l.color }}
                />
                <MagneticHover as="span" range={16} pull={0.5} className="flex-1">
                  <span className="block text-[13.5px] font-medium text-foreground">
                    {l.label_name}
                  </span>
                </MagneticHover>
                <span className="text-[11px] text-white/35 tabular-nums">
                  {count}
                </span>
                <div
                  className={cn(
                    "h-5 w-5 rounded-md flex items-center justify-center transition-all",
                    active
                      ? "bg-emerald-500/90 border-emerald-400"
                      : "border border-white/15",
                  )}
                >
                  {active && <Check className="h-3 w-3 text-emerald-950" strokeWidth={3} />}
                </div>
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
