/**
 * MatchBoard — Talente (links) ↔ Account ungenutzt (rechts).
 *
 * Karten sind innerhalb ihrer Spalte per Drag-and-Drop sortierbar.
 * Reihenfolge wird pro User+Platform+Side in `settings` persistiert.
 * Reset-Knopf stellt den automatischen Rang wieder her.
 */
import { useEffect, useMemo, useState } from "react";
import { Star, Sparkles, AlertTriangle, RotateCcw, GripVertical } from "lucide-react";
import { motion } from "framer-motion";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { findTalentMatches, findOrphanedAccounts, type TalentMatch, type OrphanWarning } from "@/lib/talent-scout";
import { loadActiveRejections } from "@/lib/talent-rejections";

type TalentCard = {
  id: string;            // stable: "t:<riser>:<account>"
  riser: string;
  account: string;
  hasRevenueBoost: boolean;
  chatWorkDays: number;
  dmDays: number;
  revenueDays: number;
  avgRevenue: number;
  tierLabel: string;
};

type MismatchCard = {
  id: string;            // stable: "m:<chatter>:<account>"
  chatter: string;
  account: string;
  tierLabel: string;
  followers: number;
  openChats: number;
  oldestChatDays: number;
  activeDays: number;
};

interface Props {
  platform: string;
  onChatterClick?: (name: string, compareWith?: string | null) => void;
  view?: "full" | "talent-only" | "orphan-only";
  onCountsChange?: (counts: { talents: number; orphans: number }) => void;
  hideHeader?: boolean;
}

const fmtFollowers = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".0", "")}k` : String(n);

const sideKey = (platform: string, side: "talent" | "mismatch") =>
  `board_order:${platform}:${side}`;

async function loadOrder(platform: string, side: "talent" | "mismatch"): Promise<string[] | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("user_id", user.id)
    .eq("key", sideKey(platform, side))
    .maybeSingle();
  if (!data?.value) return null;
  try {
    const parsed = JSON.parse(data.value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveOrder(platform: string, side: "talent" | "mismatch", order: string[]) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("settings").upsert(
    {
      user_id: user.id,
      key: sideKey(platform, side),
      value: JSON.stringify(order),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,key" },
  );
}

async function clearOrder(platform: string, side: "talent" | "mismatch") {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("settings")
    .delete()
    .eq("user_id", user.id)
    .eq("key", sideKey(platform, side));
}

function reorderBySaved<T extends { id: string }>(items: T[], savedOrder: string[] | null): T[] {
  if (!savedOrder || savedOrder.length === 0) return items;
  const map = new Map(items.map((i) => [i.id, i]));
  const result: T[] = [];
  const used = new Set<string>();
  for (const id of savedOrder) {
    const i = map.get(id);
    if (i) { result.push(i); used.add(id); }
  }
  for (const i of items) {
    if (!used.has(i.id)) result.push(i);
  }
  return result;
}

export default function MatchBoard({ platform, onChatterClick, view = "full", onCountsChange, hideHeader = false }: Props) {
  const [talents, setTalents] = useState<TalentCard[]>([]);
  const [mismatches, setMismatches] = useState<MismatchCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onCountsChange?.({ talents: talents.length, orphans: mismatches.length });
  }, [talents.length, mismatches.length, onCountsChange]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    (async () => {
      try {
        const rejected = await loadActiveRejections(platform);
        const [matches, orphans, savedT, savedM] = await Promise.all([
          findTalentMatches(platform, rejected),
          findOrphanedAccounts(platform),
          loadOrder(platform, "talent"),
          loadOrder(platform, "mismatch"),
        ]);

        const talentCards: TalentCard[] = matches.map((m: TalentMatch) => ({
          id: `t:${m.riser.toLowerCase()}:${m.underuserAccount.toLowerCase()}`,
          riser: m.riser,
          account: m.underuserAccount,
          hasRevenueBoost: m.riserHasRevenueBoost,
          chatWorkDays: m.riserChatWorkDays,
          dmDays: m.riserDmDays,
          revenueDays: m.riserRevenueDays,
          avgRevenue: m.riserAvgRevenue,
          tierLabel: m.underuserTier.label,
        }));

        const mismatchCards: MismatchCard[] = orphans.map((o: OrphanWarning) => ({
          id: `m:${o.chatter.toLowerCase()}:${o.account.toLowerCase()}`,
          chatter: o.chatter,
          account: o.account,
          tierLabel: o.tier.label,
          followers: 0,
          openChats: o.openChats,
          oldestChatDays: o.oldestChatDays,
          activeDays: o.activeDays,
        }));

        if (cancel) return;
        setTalents(reorderBySaved(talentCards, savedT));
        setMismatches(reorderBySaved(mismatchCards, savedM));
      } catch (e) {
        console.error("[MatchBoard]", e);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [platform]);

  const handleDragEnd = (side: "talent" | "mismatch") => (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (side === "talent") {
      setTalents((items) => {
        const oldI = items.findIndex((i) => i.id === active.id);
        const newI = items.findIndex((i) => i.id === over.id);
        if (oldI < 0 || newI < 0) return items;
        const next = arrayMove(items, oldI, newI);
        saveOrder(platform, "talent", next.map((i) => i.id)).catch(() => {});
        return next;
      });
    } else {
      setMismatches((items) => {
        const oldI = items.findIndex((i) => i.id === active.id);
        const newI = items.findIndex((i) => i.id === over.id);
        if (oldI < 0 || newI < 0) return items;
        const next = arrayMove(items, oldI, newI);
        saveOrder(platform, "mismatch", next.map((i) => i.id)).catch(() => {});
        return next;
      });
    }
  };

  const resetSide = async (side: "talent" | "mismatch") => {
    await clearOrder(platform, side);
    // Re-trigger load
    const rejected = await loadActiveRejections(platform);
    if (side === "talent") {
      const matches = await findTalentMatches(platform, rejected);
      setTalents(matches.map((m) => ({
        id: `t:${m.riser.toLowerCase()}:${m.underuserAccount.toLowerCase()}`,
        riser: m.riser,
        account: m.underuserAccount,
        hasRevenueBoost: m.riserHasRevenueBoost,
        chatWorkDays: m.riserChatWorkDays,
        dmDays: m.riserDmDays,
        revenueDays: m.riserRevenueDays,
        avgRevenue: m.riserAvgRevenue,
        tierLabel: m.underuserTier.label,
      })));
    } else {
      const orphans = await findOrphanedAccounts(platform);
      setMismatches(orphans.map((o) => ({
        id: `m:${o.chatter.toLowerCase()}:${o.account.toLowerCase()}`,
        chatter: o.chatter,
        account: o.account,
        tierLabel: o.tier.label,
        followers: 0,
        openChats: o.openChats,
        oldestChatDays: o.oldestChatDays,
        activeDays: o.activeDays,
      })));
    }
  };

  if (loading) {
    return (
      <div className="premium-card rounded-2xl p-6 text-center text-[11px] text-white/30 font-light">
        Lade Talent-Board …
      </div>
    );
  }

  // Auch wenn beide Seiten leer sind: Board zeigen, damit klar ist, dass es existiert.

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-2"
    >
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10.5px] uppercase tracking-[0.18em] font-semibold text-white/55">
          Talent ↔ Account-Board
        </span>
        <span className="text-[10px] text-white/30 font-light">
          · per Drag &amp; Drop sortierbar
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* LINKS — Talente */}
        <BoardColumn
          title="Talente"
          icon={<Sparkles className="h-3.5 w-3.5 text-violet-300" />}
          accent="text-violet-300"
          emptyText="Aktuell keine Talente — Grundvoraussetzung Chats + Mass-DMs nicht erfüllt."
          count={talents.length}
          onReset={() => resetSide("talent")}
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd("talent")}>
            <SortableContext items={talents.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {talents.map((t) => (
                  <SortableTalentCard
                    key={t.id}
                    card={t}
                    onClick={() => onChatterClick?.(t.riser, null)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </BoardColumn>

        {/* RECHTS — Account-Mismatch */}
        <BoardColumn
          title="Account ungenutzt"
          icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-300" />}
          accent="text-amber-300"
          emptyText="Keine kritischen Mismatches gerade."
          count={mismatches.length}
          onReset={() => resetSide("mismatch")}
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd("mismatch")}>
            <SortableContext items={mismatches.map((m) => m.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {mismatches.map((m) => (
                  <SortableMismatchCard
                    key={m.id}
                    card={m}
                    onClick={() => onChatterClick?.(m.chatter, null)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </BoardColumn>
      </div>
    </motion.div>
  );
}

function BoardColumn({
  title, icon, accent, count, emptyText, onReset, children,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  count: number;
  emptyText: string;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="premium-card rounded-2xl p-3 border border-white/[0.05] bg-white/[0.015] space-y-2">
      <div className="flex items-center justify-between gap-2 pb-1 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          {icon}
          <span className={cn("text-[10.5px] uppercase tracking-[0.18em] font-semibold", accent)}>
            {title}
          </span>
          <span className="text-[10px] tabular-nums text-white/30 font-light">· {count}</span>
        </div>
        <button
          onClick={onReset}
          className="text-[10px] text-white/30 hover:text-white/60 transition-colors flex items-center gap-1"
          title="Reihenfolge zurücksetzen"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>
      {count === 0 ? (
        <p className="text-[11px] text-white/30 font-light px-1 py-3">{emptyText}</p>
      ) : (
        children
      )}
    </div>
  );
}

function SortableTalentCard({ card, onClick }: { card: TalentCard; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-xl border bg-white/[0.025] p-2.5 flex items-start gap-2 transition-colors",
        card.hasRevenueBoost
          ? "border-amber-400/30 bg-amber-400/[0.04] shadow-[0_0_20px_-8px_rgba(251,191,36,0.4)]"
          : "border-white/[0.06] hover:border-white/[0.12]",
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing text-white/25 hover:text-white/60 pt-0.5"
        aria-label="Karte verschieben"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button onClick={onClick} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          {card.hasRevenueBoost && <Star className="h-3 w-3 text-amber-300 fill-amber-300" />}
          <span className="text-[12.5px] font-medium text-foreground/90 truncate">
            {card.riser}
          </span>
          <span className="text-[10px] text-white/35 font-light truncate">→ {card.account}</span>
        </div>
        <p className="text-[10.5px] text-white/45 font-light mt-0.5 tabular-nums">
          {card.chatWorkDays}/6T Chats · {card.dmDays}/6T DMs
          {card.hasRevenueBoost && (
            <span className="text-amber-300/80"> · {card.revenueDays}/6T Umsatz Ø {card.avgRevenue} €</span>
          )}
        </p>
      </button>
    </div>
  );
}

function SortableMismatchCard({ card, onClick }: { card: MismatchCard; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-2.5 flex items-start gap-2 hover:border-white/[0.12] transition-colors"
    >
      <button
        {...attributes}
        {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing text-white/25 hover:text-white/60 pt-0.5"
        aria-label="Karte verschieben"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button onClick={onClick} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          <span className="text-[12.5px] font-medium text-foreground/90 truncate">
            {card.account}
          </span>
          <span className="text-[9.5px] uppercase tracking-wider text-amber-300/70 font-semibold">
            {card.tierLabel}
          </span>
        </div>
        <p className="text-[10.5px] text-white/45 font-light mt-0.5 tabular-nums truncate">
          bei {card.chatter} · ältester Chat {card.oldestChatDays}T · {card.openChats} ungelesen
        </p>
      </button>
    </div>
  );
}
