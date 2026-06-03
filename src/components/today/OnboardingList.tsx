/**
 * OnboardingList — Chatter ab Tag 5, gruppiert nach Onboarding-Tag.
 * Quick-Action: System-Label vergeben (exklusiv) → Chatter fällt aus der Liste.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sprout, ChevronRight, Tag, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MagneticHover } from "@/components/MagneticHover";
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
      <div className="space-y-6">
        {groups.map((g) => (
          <div key={g.day} className="space-y-3">
            <div className="flex items-center gap-3 px-0.5">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/[0.08] border border-emerald-400/15">
                <Sprout className="h-3 w-3 text-emerald-300" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-200/90">
                  Tag {g.day}
                </span>
              </div>
              <div className="flex-1 h-px bg-gradient-to-r from-white/[0.08] via-white/[0.04] to-transparent" />
              <span className="text-[10.5px] tabular-nums text-white/35 font-light">
                {g.items.length}
              </span>
            </div>
            <div className="space-y-2">
              {g.items.map((c) => (
                <motion.div
                  key={c.chatterKey}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 80 }}
                  transition={{ duration: 0.18 }}
                  className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.035] to-white/[0.015] backdrop-blur-xl hover:border-white/[0.14] hover:from-white/[0.05] transition-all"
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onChatterClick(c.chatterName)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onChatterClick(c.chatterName);
                      }
                    }}
                    className="w-full text-left px-4 py-3.5 flex items-center gap-3 cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <MagneticHover as="span" range={18} pull={0.55}>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await navigator.clipboard.writeText(c.chatterName);
                                toast.success(`${c.chatterName} kopiert`);
                              } catch {
                                toast.error("Kopieren fehlgeschlagen");
                              }
                            }}
                            className="group/copy inline-flex items-center gap-1.5 -mx-1 px-1 py-0.5 rounded-md hover:bg-white/[0.06] active:scale-[0.98] transition-all"
                            aria-label={`${c.chatterName} kopieren`}
                            title="Klicken zum Kopieren"
                          >
                            <span className="text-[14px] font-medium text-foreground truncate tracking-[-0.005em]">
                              {c.chatterName}
                            </span>
                            <Copy className="h-3 w-3 text-white/25 group-hover/copy:text-white/70 transition-colors" />
                          </button>
                        </MagneticHover>
                      </div>
                      <p className="text-[11px] text-white/35 font-light mt-1 truncate">
                        {c.account ? `Account · ${c.account}` : "Kein Account zugewiesen"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setPicker(c);
                      }}
                      className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/60 hover:bg-white/[0.1] hover:text-white active:scale-95 transition-all"
                      aria-label="Label setzen"
                    >
                      <Tag className="h-3.5 w-3.5" />
                    </button>
                    <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/45 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </motion.div>
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
                <MagneticHover as="span" range={16} pull={0.5}>
                  <span className="text-[14px] font-medium text-foreground">
                    {l.label_name}
                  </span>
                </MagneticHover>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
