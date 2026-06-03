/**
 * OnboardingList — Chatter ab Tag 5, gruppiert nach Onboarding-Tag.
 * Quick-Action: System-Label vergeben (exklusiv) → Chatter fällt aus der Liste.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sprout, ChevronRight, Tag } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { OnboardingGroup, OnboardingChatter } from "@/lib/onboarding-filter";
import {
  type ChatterLabel,
  isSystemLabel,
  setSystemLabelExclusive,
} from "@/lib/chatter-labels";

interface Props {
  groups: OnboardingGroup[];
  allLabels: ChatterLabel[];
  platform: string;
  onChatterClick: (name: string) => void;
  onAssigned: () => void;
}

export default function OnboardingList({
  groups,
  allLabels,
  platform,
  onChatterClick,
  onAssigned,
}: Props) {
  const [picker, setPicker] = useState<OnboardingChatter | null>(null);
  const [saving, setSaving] = useState(false);

  const systemLabels = allLabels.filter(isSystemLabel);

  if (groups.length === 0) {
    return (
      <div className="premium-card rounded-2xl p-8 text-center">
        <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-3">
          <Sprout className="h-4 w-4 text-emerald-300" />
        </div>
        <p className="text-[13px] text-foreground/70 font-light">
          Alle Onboarding-Chatter durchgearbeitet
        </p>
        <p className="text-[11px] text-white/30 font-light mt-1">
          Neue tauchen ab Tag 5 wieder hier auf.
        </p>
      </div>
    );
  }

  const handlePick = async (label: ChatterLabel) => {
    if (!picker || saving) return;
    setSaving(true);
    try {
      await setSystemLabelExclusive(platform, picker.chatterName, label.id, allLabels);
      toast.success(`${picker.chatterName}: ${label.label_name}`);
      setPicker(null);
      onAssigned();
    } catch (e) {
      console.error(e);
      toast.error("Konnte Label nicht setzen");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.day} className="space-y-2">
            <div className="flex items-center gap-2 px-1 pb-1 opacity-70">
              <Sprout className="h-3 w-3 text-emerald-300" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                Tag {g.day}
              </span>
              <span className="text-[10px] tabular-nums text-white/30 font-light">
                · {g.items.length}
              </span>
            </div>
            <div className="space-y-2">
              {g.items.map((c) => (
                <motion.button
                  key={c.chatterKey}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 80 }}
                  transition={{ duration: 0.18 }}
                  onClick={() => onChatterClick(c.chatterName)}
                  className="w-full text-left premium-card rounded-2xl px-4 py-3 border border-white/[0.05] hover:border-white/[0.12] transition-all flex items-center gap-3 group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-medium text-foreground truncate">
                        {c.chatterName}
                      </span>
                      {c.assignedLabels.length > 0 && (
                        <span className="flex items-center gap-1">
                          {c.assignedLabels.slice(0, 2).map((l) => (
                            <span
                              key={l.id}
                              className="px-1.5 py-0.5 rounded-full text-[9px] font-medium border"
                              style={{
                                color: l.color,
                                borderColor: `${l.color}55`,
                                backgroundColor: `${l.color}14`,
                              }}
                            >
                              {l.label_name}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-white/40 font-light mt-0.5 truncate">
                      {c.account ? `Account: ${c.account}` : "Kein Account zugewiesen"}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPicker(c);
                    }}
                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-[10.5px] font-medium text-white/70 hover:bg-white/[0.1] hover:text-white transition-all"
                  >
                    <Tag className="h-3 w-3" />
                    Label
                  </button>
                  <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/40 transition-colors" />
                </motion.button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Sheet open={!!picker} onOpenChange={(o) => !o && setPicker(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl border-white/[0.08]">
          <SheetHeader>
            <SheetTitle className="text-foreground/90 font-light">
              {picker?.chatterName}
            </SheetTitle>
            <SheetDescription className="text-white/40 text-[12px]">
              Wähle ein Label — der Chatter verschwindet danach aus dem Onboarding-Filter.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-2.5">
            {systemLabels.map((l) => (
              <button
                key={l.id}
                onClick={() => handlePick(l)}
                disabled={saving}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-all text-left",
                  "bg-white/[0.03] hover:bg-white/[0.08]",
                  "disabled:opacity-40 disabled:cursor-wait",
                )}
                style={{
                  borderColor: `${l.color}40`,
                }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: l.color }}
                />
                <span className="text-[14px] font-medium text-foreground">
                  {l.label_name}
                </span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
