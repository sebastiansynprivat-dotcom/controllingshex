/**
 * LabelCardList — alle Chatter mit aktivem Label, gruppiert nach Label,
 * gleiches Look & Feel wie die Standard-Action-Karten. Abhakbar pro Tag.
 * Label-Gruppen sind standardmäßig eingeklappt.
 */
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
import { useState } from "react";
import { ChevronRight, ChevronDown, Tag } from "lucide-react";

import { cn } from "@/lib/utils";
import LabelCardRow from "@/components/today/LabelCardRow";
import type { LabelCard } from "@/lib/label-tasks";

function formatCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(n);
}

interface Props {
  cards: LabelCard[];
  doneKeys: Set<string>;
  platform: string;
  onChatterClick: (name: string) => void;
  onComplete: (todoKey: string) => Promise<void>;
  onLabelRemoved: () => void;
  readonly?: boolean;
}

export default function LabelCardList({
  cards,
  doneKeys,
  platform,
  onChatterClick,
  onComplete,
  onLabelRemoved,
  readonly = false,
}: Props) {
  const visible = cards.filter((c) => !doneKeys.has(c.todoKey));
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set(visible.map((c) => c.label.id)));

  if (visible.length === 0) {
    return (
      <div className="premium-card rounded-2xl p-8 text-center">
        <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-3">
          <Tag className="h-4 w-4 text-emerald-300" />
        </div>
        <p className="text-[13px] text-foreground/70 font-light">
          Keine offenen Label-Karten
        </p>
        <p className="text-[11px] text-white/30 font-light mt-1">
          Tauchen beim nächsten Report wieder auf, solange das Label gesetzt ist.
        </p>
      </div>
    );
  }

  // Gruppiert nach Label-ID
  const byLabel = new Map<string, LabelCard[]>();
  for (const c of visible) {
    const arr = byLabel.get(c.label.id) ?? [];
    arr.push(c);
    byLabel.set(c.label.id, arr);
  }

  const toggleLabel = (labelId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(labelId)) next.delete(labelId);
      else next.add(labelId);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <AnimatePresence initial={false}>
        {[...byLabel.entries()].map(([labelId, items]) => {
          const label = items[0].label;
          const isCollapsed = collapsedIds.has(labelId);
          return (
            <motion.div
              key={labelId}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <button
                type="button"
                onClick={() => toggleLabel(labelId)}
                className="group flex items-center gap-3 px-0.5 w-full text-left"
                aria-expanded={!isCollapsed}
              >
                <div
                  className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border transition-all group-hover:border-white/20"
                  style={{
                    backgroundColor: `${label.color}10`,
                    borderColor: `${label.color}33`,
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  <span
                    className="text-[10px] font-semibold uppercase tracking-[0.22em]"
                    style={{ color: label.color }}
                  >
                    {label.label_name}
                  </span>
                  <span
                    className="text-[10px] tabular-nums font-medium px-1.5 py-0.5 rounded-full"
                    style={{
                      color: label.color,
                      backgroundColor: `${label.color}22`,
                    }}
                  >
                    {items.length}
                  </span>
                </div>
                <div className="flex-1 h-px bg-gradient-to-r from-white/[0.08] via-white/[0.04] to-transparent" />
                <div className="flex items-center gap-1.5">
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 text-white/40 transition-transform duration-200",
                      isCollapsed && "-rotate-90"
                    )}
                  />
                </div>
              </button>
              <AnimatePresence initial={false}>
                {!isCollapsed && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="space-y-3"
                  >
                    <AnimatePresence initial={false}>
                      {items.map((c) => (
                        <LabelCardRow
                          key={c.todoKey}
                          card={c}
                          platform={platform}
                          readonly={readonly}
                          onChatterClick={onChatterClick}
                          onComplete={onComplete}
                          onLabelRemoved={onLabelRemoved}
                        />
                      ))}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

