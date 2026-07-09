/**
 * Push-Sektion für den Heute-Tab.
 * Drei visuelle Gruppen: JETZT LIVE, CHATTER OFFLINE, MODELS SCHWEIGEN.
 */
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, Zap, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadPushCards, type PushCard, type PushBucketGroup } from "@/lib/push-buckets";
import { loadTodoStates, setTodoStatus, type TodoState } from "@/lib/daily-todos";

interface Props {
  platform: string;
  onChatterClick: (name: string) => void;
}

interface GroupDef {
  id: PushBucketGroup;
  emoji: string;
  label: string;
  sub: string;
  accent: string;
}

const GROUPS: GroupDef[] = [
  { id: "live", emoji: "🔥", label: "Jetzt live", sub: "Rescue · Kick · Hot · Boost · Push", accent: "text-orange-300/90" },
  { id: "offline", emoji: "🌙", label: "Chatter offline", sub: "Schichtstart · Abgetaucht · Offline", accent: "text-indigo-300/90" },
  { id: "silent_model", emoji: "📉", label: "Models schweigen", sub: "Heute 0 € trotz aktivem 7T-Schnitt", accent: "text-slate-300/90" },
];

export default function PushSection({ platform, onChatterClick }: Props) {
  const [cards, setCards] = useState<PushCard[] | null>(null);
  const [states, setStates] = useState<Record<string, TodoState>>({});
  const [collapsed, setCollapsed] = useState(false);
  const [groupCollapsed, setGroupCollapsed] = useState<Record<PushBucketGroup, boolean>>({
    live: false, offline: false, silent_model: false,
  });
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [c, s] = await Promise.all([
          loadPushCards(platform),
          loadTodoStates(platform),
        ]);
        if (cancel) return;
        setCards(c);
        setStates(s);
      } catch (e) {
        console.error("[PushSection]", e);
      }
    })();
    return () => { cancel = true; };
  }, [platform, refreshTick]);

  useEffect(() => {
    const id = setInterval(() => setRefreshTick((n) => n + 1), 120_000);
    return () => clearInterval(id);
  }, []);

  const visibility = (card: PushCard): "open" | "done" | "snoozed" => {
    const st = states[card.todoKey];
    if (!st) return "open";
    if (st.status === "done") return "done";
    if (st.status === "snoozed" && st.snoozed_until && new Date(st.snoozed_until) > new Date()) return "snoozed";
    return "open";
  };

  const openCards = useMemo(
    () => (cards ?? []).filter((c) => visibility(c) === "open"),
    [cards, states],
  );

  const byGroup = useMemo(() => {
    const m: Record<PushBucketGroup, PushCard[]> = { live: [], offline: [], silent_model: [] };
    for (const c of openCards) m[c.bucket.group].push(c);
    for (const k of Object.keys(m) as PushBucketGroup[]) {
      m[k].sort((a, b) => {
        if (a.bucket.order !== b.bucket.order) return a.bucket.order - b.bucket.order;
        return b.score - a.score;
      });
    }
    return m;
  }, [openCards]);

  const stats = useMemo(() => {
    let live = 0, offline = 0, urgent = 0, silent = 0;
    for (const c of openCards) {
      if (c.bucket.group === "silent_model") silent++;
      else if (c.isLive) live++;
      else offline++;
      if (c.bucket.id === "rescue" || c.bucket.id === "kick" || c.bucket.id === "shift_due") urgent++;
    }
    return { live, offline, urgent, silent };
  }, [openCards]);

  const act = async (card: PushCard, kind: "done" | "snooze") => {
    const prev = { ...states };
    const snoozedUntil = kind === "snooze" ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null;
    const status: TodoState["status"] = kind === "done" ? "done" : "snoozed";
    setStates({ ...prev, [card.todoKey]: { status, snoozed_until: snoozedUntil } });
    try {
      await setTodoStatus(platform, card.todoKey, status, snoozedUntil);
    } catch {
      setStates(prev);
    }
  };

  if (cards === null) return null;
  if (cards.length === 0) return null;

  const toggleGroup = (g: PushBucketGroup) => setGroupCollapsed((s) => ({ ...s, [g]: !s[g] }));

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
            <Zap className="h-3 w-3 text-yellow-300/80" />
            <span className="text-[10px] uppercase tracking-[0.18em] text-yellow-300/80 font-semibold">
              Live · Push
            </span>
          </div>
          <h2 className="text-xl font-light tracking-tight text-white/95 leading-tight">
            Wen pushst du jetzt?
          </h2>
          <p className="mt-1 text-[11.5px] text-white/50 font-light">
            {stats.offline} offline · {stats.live} live
            {stats.silent > 0 && <span className="text-slate-300/90"> · {stats.silent} stille Models</span>}
            {stats.urgent > 0 && <span className="text-orange-300/90"> · {stats.urgent} dringend</span>}
          </p>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 text-white/30 group-hover:text-white/60 transition-transform shrink-0", collapsed && "rotate-180")}
        />
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && openCards.length > 0 && (
          <motion.div
            key="content"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-4 pt-1">
              {GROUPS.map((g) => {
                const list = byGroup[g.id];
                if (list.length === 0) return null;
                const isCol = groupCollapsed[g.id];
                return (
                  <div key={g.id} className="space-y-2">
                    <button
                      onClick={() => toggleGroup(g.id)}
                      className="w-full flex items-center justify-between gap-3 group/hd text-left px-1"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[13px] leading-none">{g.emoji}</span>
                        <span className={cn("text-[10.5px] uppercase tracking-[0.16em] font-semibold", g.accent)}>
                          {g.label}
                        </span>
                        <span className="text-[10px] tabular-nums text-white/40 font-medium">({list.length})</span>
                        <span className="hidden sm:inline text-[10.5px] text-white/25 font-light truncate">· {g.sub}</span>
                      </div>
                      <ChevronDown
                        className={cn("h-3.5 w-3.5 text-white/25 group-hover/hd:text-white/60 transition-transform shrink-0", isCol && "-rotate-90")}
                      />
                    </button>
                    <AnimatePresence initial={false}>
                      {!isCol && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="space-y-2">
                            {list.map((card) => (
                              <PushCardItem
                                key={card.todoKey}
                                card={card}
                                onChatterClick={onChatterClick}
                                onAct={act}
                              />
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {openCards.length === 0 && !collapsed && (
        <div className="premium-card rounded-2xl p-5 text-center">
          <div className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-2">
            <Check className="h-3.5 w-3.5 text-emerald-300" />
          </div>
          <p className="text-[12px] text-white/65 font-light">Alle Push-Aktionen erledigt 🏻</p>
        </div>
      )}
    </motion.section>
  );
}

function PushCardItem({
  card,
  onChatterClick,
  onAct,
}: {
  card: PushCard;
  onChatterClick: (name: string) => void;
  onAct: (card: PushCard, kind: "done" | "snooze") => void;
}) {
  const isSilentModel = card.bucket.group === "silent_model";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className={cn("premium-card rounded-2xl p-3.5 border", card.bucket.ring, card.bucket.tint)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-[10px] font-bold uppercase tracking-[0.16em] flex items-center gap-1", card.bucket.accent)}>
              <span className="text-[12px] leading-none">{card.bucket.emoji}</span>
              {card.bucket.label}
            </span>
            {isSilentModel ? (
              <span className="text-[14px] font-medium text-foreground truncate">{card.chatterName}</span>
            ) : (
              <button
                onClick={() => onChatterClick(card.chatterName)}
                className="text-[14px] font-medium text-foreground hover:text-white transition-colors text-left truncate"
              >
                {card.chatterName}
              </button>
            )}
          </div>
          <p className="text-[12.5px] text-white/85 font-light mt-1.5 leading-snug">
            {card.suggestion}
          </p>
          <p className="text-[10.5px] text-white/40 font-light mt-1.5 tabular-nums">
            {card.dataLine}
          </p>
          {isSilentModel && card.assignedChatters && card.assignedChatters.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {card.assignedChatters.map((c) => (
                <button
                  key={c}
                  onClick={() => onChatterClick(c)}
                  className="px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-white/[0.05] border border-white/10 text-white/75 hover:bg-white/[0.1] hover:text-white transition-colors"
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={() => onAct(card, "done")}
            aria-label="Erledigt"
            className="h-8 w-8 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/20 transition-colors flex items-center justify-center"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onAct(card, "snooze")}
            aria-label="Snooze 1 Stunde"
            className="h-8 w-8 rounded-full bg-white/[0.04] border border-white/10 text-white/55 hover:text-white/80 hover:bg-white/[0.08] transition-colors flex items-center justify-center"
          >
            <Clock className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
