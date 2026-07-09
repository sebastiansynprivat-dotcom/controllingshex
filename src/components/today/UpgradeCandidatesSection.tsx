/**
 * UpgradeCandidatesSection — gelabelte Upgrade-Kandidaten (🟢 Upgrade, 💛 Premium Upgrade)
 * als eigene Sektion im Heute-Tab.
 *
 * "Offene Upgrades" ist standardmäßig eingeklappt; "Heute upgegradet" bleibt
 * ausgeklappt. Beide Gruppen lassen sich über den Header auf- und zuklappen.
 */
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import LabelCardRow from "@/components/today/LabelCardRow";
import { isUpgradeTaskLabel } from "@/lib/chatter-labels";
import type { LabelCard } from "@/lib/label-tasks";

interface Props {
  cards: LabelCard[];
  doneKeys: Set<string>;
  platform: string;
  onChatterClick: (name: string) => void;
  onComplete: (key: string) => Promise<void>;
  onLabelRemoved: () => void;
}

type GroupId = "open" | "done";

interface GroupDef {
  id: GroupId;
  emoji: string;
  label: string;
  sub: string;
  accent: string;
  glow: string;
  chip: string;
}

const GROUPS: GroupDef[] = [
  {
    id: "open",
    emoji: "🚀",
    label: "Offene Upgrades",
    sub: "Gelabelt als 🟢 Upgrade oder 💛 Premium — jetzt closen",
    accent: "text-emerald-200",
    glow: "from-emerald-500/[0.10] via-transparent to-transparent",
    chip: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
  },
  {
    id: "done",
    emoji: "✅",
    label: "Heute upgegradet",
    sub: "Bereits abgehakt — sauber weggearbeitet",
    accent: "text-white/70",
    glow: "from-white/[0.05] via-transparent to-transparent",
    chip: "bg-white/[0.08] text-white/70 border-white/15",
  },
];

export default function UpgradeCandidatesSection({
  cards,
  doneKeys,
  platform,
  onChatterClick,
  onComplete,
  onLabelRemoved,
}: Props) {
  const openCards = useMemo(
    () => cards.filter((c) => isUpgradeTaskLabel(c.label) && !doneKeys.has(c.todoKey)),
    [cards, doneKeys],
  );

  const doneCards = useMemo(
    () => cards.filter((c) => isUpgradeTaskLabel(c.label) && doneKeys.has(c.todoKey)),
    [cards, doneKeys],
  );

  if (openCards.length === 0 && doneCards.length === 0) return null;

  const byGroup: Record<GroupId, LabelCard[]> = {
    open: openCards,
    done: doneCards,
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-3 mb-4"
    >
      <div className="space-y-2.5">
        {GROUPS.map((g) => {
          const list = byGroup[g.id];
          if (list.length === 0) return null;
          return (
            <motion.div
              key={g.id}
              layout
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                "relative rounded-2xl overflow-hidden border border-white/[0.07]",
                "bg-white/[0.025] backdrop-blur-xl",
                "shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_20px_60px_-30px_rgba(0,0,0,0.6)]",
                "border-white/[0.12]",
              )}
            >
              {/* subtiler Farbschimmer */}
              <div
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-80",
                  g.glow,
                )}
              />
              {/* Glanzkante oben */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
              />

              <div className="relative w-full flex items-center gap-3 px-4 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[16px] leading-none drop-shadow-sm">{g.emoji}</span>
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-[11px] uppercase tracking-[0.18em] font-semibold",
                          g.accent,
                        )}
                      >
                        {g.label}
                      </span>
                      <span
                        className={cn(
                          "tabular-nums text-[10px] font-semibold px-1.5 py-0.5 rounded-full border",
                          g.chip,
                        )}
                      >
                        {list.length}
                      </span>
                    </div>
                    <span className="text-[10.5px] text-white/35 font-light truncate">
                      {g.sub}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mx-4 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
              <div className="p-3 space-y-2">
                {list.map((c) => (
                  <LabelCardRow
                    key={c.todoKey}
                    card={c}
                    platform={platform}
                    onChatterClick={onChatterClick}
                    onComplete={onComplete}
                    onLabelRemoved={onLabelRemoved}
                  />
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.section>
  );
}
