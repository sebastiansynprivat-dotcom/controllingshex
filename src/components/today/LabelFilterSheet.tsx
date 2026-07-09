/**
 * LabelFilterSheet — Multi-Select welche Labels aktuell im Heute-Tab erscheinen.
 *
 * Visuell an die Push-Sektion angelehnt: Glassmorphism-Kacheln mit farbigem Glow,
 * Glanzkante und runden Toggle-Buttons.
 */
import { Check, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { MagneticHover } from "@/components/MagneticHover";
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
              <LabelFilterCard
                key={l.id}
                label={l}
                count={count}
                active={active}
                onToggle={() => onToggle(l.id)}
              />
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LabelFilterCard({
  label,
  count,
  active,
  onToggle,
}: {
  label: ChatterLabel;
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "relative w-full rounded-2xl overflow-hidden border border-white/[0.07]",
        "bg-white/[0.025] backdrop-blur-xl text-left transition-all",
        "shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_20px_60px_-30px_rgba(0,0,0,0.6)]",
        active && "border-white/[0.12]",
      )}
    >
      {/* farbiger Glow im Label-Color */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background: `radial-gradient(120% 100% at 0% 0%, ${label.color}14 0%, transparent 55%)`,
        }}
      />
      {/* Glanzkante oben */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
      />

      <div className="relative flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: label.color }}
          />
          <div className="min-w-0 flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <MagneticHover as="span" range={14} className="inline-block">
                <span className="text-[13px] font-medium text-foreground">
                  {label.label_name}
                </span>
              </MagneticHover>
              <span
                className="tabular-nums text-[10px] font-semibold px-1.5 py-0.5 rounded-full border"
                style={{
                  color: label.color,
                  borderColor: `${label.color}44`,
                  backgroundColor: `${label.color}14`,
                }}
              >
                {count}
              </span>
            </div>
            <span className="text-[10px] text-white/35 font-light truncate">
              {active ? "Aktiv im Heute-Tab" : "Ausgeblendet"}
            </span>
          </div>
        </div>

        <div
          className={cn(
            "h-7 w-7 rounded-full flex items-center justify-center border transition-all shrink-0",
            active
              ? "bg-emerald-500/90 border-emerald-400 text-emerald-950"
              : "border-white/10 bg-white/[0.03] text-white/40",
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            {active ? (
              <motion.div
                key="check"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </motion.div>
            ) : (
              <motion.div
                key="chevron"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </button>
  );
}
