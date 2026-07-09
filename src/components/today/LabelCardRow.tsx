/**
 * LabelCardRow — einzelne Label-Karte, abhakbar pro Tag.
 */
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { Check, ChevronRight, Clock, MessageCircle, X as XIcon, Users, TrendingUp, BarChart3 } from "lucide-react";

import { cn } from "@/lib/utils";
import { MagneticHover } from "@/components/MagneticHover";
import { removeLabelFromChatter } from "@/lib/chatter-labels";
import type { LabelCard } from "@/lib/label-tasks";

function formatCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(n);
}

interface Props {
  card: LabelCard;
  platform: string;
  readonly?: boolean;
  onChatterClick: (name: string) => void;
  onComplete: (key: string) => Promise<void>;
  onLabelRemoved: () => void;
}

export default function LabelCardRow({
  card,
  platform,
  readonly = false,
  onChatterClick,
  onComplete,
  onLabelRemoved,
}: Props) {
  const [celebrating, setCelebrating] = useState(false);
  const [removing, setRemoving] = useState(false);

  const handleDone = () => {
    if (celebrating || readonly) return;
    setCelebrating(true);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { (navigator as any).vibrate?.([8, 30, 14]); } catch {}
    }
    window.setTimeout(() => {
      onComplete(card.todoKey).catch(() => {
        setCelebrating(false);
      });
    }, 420);
  };

  const handleRemoveLabel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (removing) return;
    setRemoving(true);
    try {
      await removeLabelFromChatter(platform, card.chatterName, card.label.id);
      onLabelRemoved();
    } catch {
      setRemoving(false);
    }
  };

  const oldestDays = Math.round(card.liveOldestChatDays);
  const todayRev = Math.round(card.todayRevenue);

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={
        celebrating
          ? { opacity: 1, scale: [1, 1.025, 0.985] }
          : { opacity: 1, scale: 1 }
      }
      exit={
        celebrating
          ? { opacity: 0, y: -28, scale: 0.94, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } }
          : { opacity: 0, x: 80, transition: { duration: 0.18 } }
      }
      transition={{ duration: celebrating ? 0.6 : 0.15, ease: "easeOut" }}
      className={cn(
        "group relative w-full transition-all duration-300",
        readonly && "opacity-60",
      )}
    >
      {/* Celebration overlay */}
      <AnimatePresence>
        {celebrating && (
          <motion.div
            className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-2xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-emerald-400/40 via-emerald-300/15 to-transparent blur-2xl"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: [0, 0.9, 0], scale: [0.7, 1.1, 1.25] }}
              transition={{ duration: 0.55, ease: "easeOut" }}
            />
            <motion.div
              className="absolute inset-0 flex items-center justify-center"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: [0.4, 1.15, 1], opacity: [0, 1, 1] }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="h-12 w-12 rounded-full bg-emerald-400/95 shadow-[0_0_36px_-4px_rgba(52,211,153,0.9)] flex items-center justify-center">
                <Check className="h-6 w-6 text-emerald-950" strokeWidth={3.5} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        role="button"
        tabIndex={0}
        onClick={() => onChatterClick(card.chatterName)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onChatterClick(card.chatterName);
          }
        }}
        className="w-full text-left premium-card rounded-2xl p-4 border border-white/[0.05] hover:border-white/[0.12] transition-all cursor-pointer"
        style={{
          borderLeftColor: card.label.color,
          borderLeftWidth: 2,
        }}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <MagneticHover as="span" range={18}>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await navigator.clipboard.writeText(card.chatterName);
                    } catch {}
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      navigator.clipboard.writeText(card.chatterName).catch(() => {});
                    }
                  }}
                  aria-label={`${card.chatterName} kopieren`}
                  title="Klicken zum Kopieren"
                  className="text-left -mx-1 px-1 rounded-md active:scale-[0.98] transition-transform cursor-pointer inline-block"
                >
                  <span className="text-[14.5px] font-medium text-foreground">
                    {card.chatterName}
                  </span>
                </span>
              </MagneticHover>
              <span
                className="px-2 py-0.5 rounded-full text-[9.5px] font-medium border"
                style={{
                  color: card.label.color,
                  borderColor: `${card.label.color}55`,
                  backgroundColor: `${card.label.color}14`,
                }}
              >
                {card.label.label_name}
              </span>
            </div>
            <p className="text-[11.5px] text-white/45 font-light mt-1">
              {card.account ? `Account: ${card.account}` : "Kein Account"}
            </p>
            {card.account && (card.accountFollowers != null || card.accountTodayRevenue != null) && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {card.accountFollowers != null && card.accountFollowers > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[10.5px] text-white/65 tabular-nums">
                    <Users className="h-3 w-3 text-white/40" />
                    {formatCompact(card.accountFollowers)} Follower
                  </span>
                )}
                {card.accountTodayRevenue != null && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/[0.08] border border-emerald-500/20 text-[10.5px] text-emerald-200/90 tabular-nums">
                    <TrendingUp className="h-3 w-3 text-emerald-300/70" />
                    Account heute {Math.round(card.accountTodayRevenue)} €
                  </span>
                )}
              </div>
            )}
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[10.5px] text-white/65 tabular-nums">
                <MessageCircle className="h-3 w-3 text-white/40" />
                {card.liveOpenChats} offen
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[10.5px] text-white/65 tabular-nums">
                <Clock className="h-3 w-3 text-white/40" />
                ältester {oldestDays} T
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/[0.08] border border-emerald-500/20 text-[10.5px] text-emerald-200/90 tabular-nums">
                <BarChart3 className="h-3 w-3 text-emerald-300/70" />
                Ø {(card.chatterAvgDailyRevenue || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/Tag
              </span>
              {todayRev > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[10.5px] text-emerald-300/85 tabular-nums">
                  <TrendingUp className="h-3 w-3 text-emerald-300/70" />
                  Chatter heute {todayRev} €
                </span>
              )}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-white/20 mt-1 shrink-0" />
        </div>

        {!readonly && (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleDone(); }}
              disabled={celebrating}
              className="flex-1 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-[12px] font-medium hover:bg-emerald-500/25 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              Abschließen
            </button>
            <button
              type="button"
              onClick={handleRemoveLabel}
              disabled={removing}
              className="h-9 px-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/55 text-[11px] font-medium hover:bg-white/[0.08] hover:text-white/75 transition-all flex items-center gap-1.5 disabled:opacity-50"
              title="Label entfernen"
            >
              <XIcon className="h-3.5 w-3.5" />
              Label
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
