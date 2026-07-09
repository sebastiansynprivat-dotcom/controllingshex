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
  /** subtiler Farbschimmer für die Glass-Kachel */
  glow: string;
  /** Chip-Farbe für den Count */
  chip: string;
}

const GROUPS: GroupDef[] = [
  {
    id: "crisis",
    emoji: "🚨",
    label: "Krise — sofort ran",
    sub: "Rescue · Kick — brennt, jetzt entlasten",
    accent: "text-red-200",
    glow: "from-red-500/[0.10] via-transparent to-transparent",
    chip: "bg-red-500/15 text-red-200 border-red-400/30",
  },
  {
    id: "nudge",
    emoji: "💪",
    label: "Am Anschieben",
    sub: "Push — knapp unter Pace, kurz motivieren",
    accent: "text-yellow-200",
    glow: "from-yellow-500/[0.08] via-transparent to-transparent",
    chip: "bg-yellow-500/15 text-yellow-200 border-yellow-400/25",
  },
  {
    id: "winning",
    emoji: "🔥",
    label: "Läuft — bestätigen",
    sub: "Hot · Boost — Tempo halten, loben",
    accent: "text-emerald-200",
    glow: "from-emerald-500/[0.08] via-transparent to-transparent",
    chip: "bg-emerald-500/15 text-emerald-200 border-emerald-400/25",
  },
  {
    id: "offline",
    emoji: "🌙",
    label: "Chatter offline",
    sub: "Schichtstart · Abgetaucht · Offline",
    accent: "text-indigo-200",
    glow: "from-indigo-500/[0.08] via-transparent to-transparent",
    chip: "bg-indigo-500/15 text-indigo-200 border-indigo-400/25",
  },
  {
    id: "silent_model",
    emoji: "📉",
    label: "Models schweigen",
    sub: "Heute 0 € trotz aktivem 7T-Schnitt",
    accent: "text-slate-200",
    glow: "from-slate-400/[0.07] via-transparent to-transparent",
    chip: "bg-slate-400/15 text-slate-100 border-slate-300/20",
  },
];



export default function PushSection({ platform, onChatterClick }: Props) {
  const [cards, setCards] = useState<PushCard[] | null>(null);
  const [states, setStates] = useState<Record<string, TodoState>>({});
  const [collapsed, setCollapsed] = useState(false);
  const [groupCollapsed, setGroupCollapsed] = useState<Record<PushBucketGroup, boolean>>({
    live: true, offline: true, silent_model: true,
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
            <div className="space-y-2.5 pt-1">
              {GROUPS.map((g) => {
                const list = byGroup[g.id];
                if (list.length === 0) return null;
                const isCol = groupCollapsed[g.id];
                return (
                  <motion.div
                    key={g.id}
                    layout
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className={cn(
                      "relative rounded-2xl overflow-hidden border border-white/[0.07]",
                      "bg-white/[0.025] backdrop-blur-xl",
                      "shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_20px_60px_-30px_rgba(0,0,0,0.6)]",
                      "transition-colors",
                      !isCol && "border-white/[0.12]",
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

                    <button
                      onClick={() => toggleGroup(g.id)}
                      className="relative w-full flex items-center justify-between gap-3 group/hd text-left px-4 py-3.5"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-[16px] leading-none drop-shadow-sm">{g.emoji}</span>
                        <div className="min-w-0 flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className={cn("text-[11px] uppercase tracking-[0.18em] font-semibold", g.accent)}>
                              {g.label}
                            </span>
                            <span className={cn(
                              "tabular-nums text-[10px] font-semibold px-1.5 py-0.5 rounded-full border",
                              g.chip,
                            )}>
                              {list.length}
                            </span>
                          </div>
                          <span className="text-[10.5px] text-white/35 font-light truncate">{g.sub}</span>
                        </div>
                      </div>
                      <div
                        className={cn(
                          "h-7 w-7 rounded-full flex items-center justify-center border border-white/10 bg-white/[0.03]",
                          "group-hover/hd:bg-white/[0.08] group-hover/hd:border-white/20 transition-all",
                        )}
                      >
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 text-white/60 transition-transform duration-300",
                            isCol && "-rotate-90",
                          )}
                        />
                      </div>
                    </button>

                    <AnimatePresence initial={false}>
                      {!isCol && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                          className="relative overflow-hidden"
                        >
                          {/* Innerer Trenner */}
                          <div className="mx-4 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                          <div className="p-3 space-y-2">
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
                  </motion.div>
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
            <button
              onClick={() => onChatterClick(card.chatterName)}
              className="text-[14px] font-medium text-foreground hover:text-white transition-colors text-left truncate"
            >
              {card.chatterName}
            </button>
            {isSilentModel && card.modelName && (
              <span className="text-[11px] text-white/40 font-light">
                · {card.modelName}
              </span>
            )}
          </div>
          <p className="text-[12.5px] text-white/85 font-light mt-1.5 leading-snug">
            {card.suggestion}
          </p>
          <p className="text-[10.5px] text-white/40 font-light mt-1.5 tabular-nums">
            {card.dataLine}
          </p>
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
