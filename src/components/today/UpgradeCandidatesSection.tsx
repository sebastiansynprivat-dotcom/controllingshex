/**
 * UpgradeCandidatesSection — gelabelte Upgrade-Kandidaten (🟢 Upgrade, 💛 Premium Upgrade)
 * als eigene Luxus-Sektion im Heute-Tab.
 *
 * Visuell an die Push-Sektion angelehnt: Glassmorphism-Header, einzelne Kachel,
 * farbiger Glow, Glanzkante, runder Chevron-Toggle.
 */
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Rocket, Check } from "lucide-react";

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

export default function UpgradeCandidatesSection({
  cards,
  doneKeys,
  platform,
  onChatterClick,
  onComplete,
  onLabelRemoved,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const visible = useMemo(
    () => cards.filter((c) => isUpgradeTaskLabel(c.label) && !doneKeys.has(c.todoKey)),
    [cards, doneKeys],
  );

  const doneCount = useMemo(() => {
    return cards.filter((c) => isUpgradeTaskLabel(c.label) && doneKeys.has(c.todoKey)).length;
  }, [cards, doneKeys]);

  if (visible.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-3"
    >
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-end justify-between gap-4 group text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Rocket className="h-3 w-3 text-emerald-300/80" />
            <span className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/80 font-semibold">
              Gelabelte Upgrades
            </span>
          </div>
          <h2 className="text-xl font-light tracking-tight text-white/95 leading-tight">
            Upgrade-Kandidaten
          </h2>
          <p className="mt-1 text-[11.5px] text-white/50 font-light">
            {visible.length} offen
            {doneCount > 0 && <span className="text-emerald-300/80"> · {doneCount} heute erledigt</span>}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-white/30 group-hover:text-white/60 transition-transform shrink-0",
            collapsed && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="content"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div
              className={cn(
                "relative rounded-2xl overflow-hidden border border-white/[0.07]",
                "bg-white/[0.025] backdrop-blur-xl",
                "shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_20px_60px_-30px_rgba(0,0,0,0.6)]",
              )}
            >
              {/* Emerald-Glow */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/[0.10] via-transparent to-transparent opacity-80"
              />
              {/* Glanzkante oben */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
              />

              <div className="relative p-3 space-y-2">
                <AnimatePresence initial={false}>
                  {visible.map((c) => (
                    <LabelCardRow
                      key={c.todoKey}
                      card={c}
                      platform={platform}
                      onChatterClick={onChatterClick}
                      onComplete={onComplete}
                      onLabelRemoved={onLabelRemoved}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
