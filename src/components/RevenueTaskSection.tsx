import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, X as XIcon, Gem, ArrowLeftRight, Activity, TrendingDown, Users, Calendar, Rocket } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  generateRevenueTasks,
  type RevenueTask,
  type RevenueTaskKind,
} from "@/lib/revenue-tasks";
import {
  loadTodoStates,
  setTodoStatus,
  type TodoState,
} from "@/lib/daily-todos";

interface Props {
  platform: string;
  onChatterClick?: (name: string) => void;
  onModelClick?: (modelName: string, chatterName: string | null) => void;
}

const KIND_META: Record<RevenueTaskKind, { label: string; icon: typeof Gem; tone: string }> = {
  recovery:  { label: "Recovery",       icon: TrendingDown,    tone: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25" },
  phase:     { label: "Phasen-Knick",   icon: Calendar,        tone: "text-purple-300 bg-purple-500/10 border-purple-500/25" },
  mismatch:  { label: "Tier-Mismatch",  icon: Users,           tone: "text-amber-300 bg-amber-500/10 border-amber-500/25" },
  swap:      { label: "Swap",           icon: ArrowLeftRight,  tone: "text-cyan-300 bg-cyan-500/10 border-cyan-500/25" },
  slot:      { label: "Peak-Slot leer", icon: Activity,        tone: "text-rose-300 bg-rose-500/10 border-rose-500/25" },
};

function fmtEur(v: number) {
  return Math.round(v).toLocaleString("de-DE") + " €";
}

type FilterMode = "top" | "other";

const TOP_COUNT = 5;

export default function RevenueTaskSection({ platform, onChatterClick, onModelClick }: Props) {
  const [tasks, setTasks] = useState<RevenueTask[]>([]);
  const [states, setStates] = useState<Record<string, TodoState>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>("top");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    Promise.all([generateRevenueTasks(platform), loadTodoStates(platform)])
      .then(([t, s]) => {
        if (cancel) return;
        setTasks(t);
        setStates(s);
      })
      .catch((e) => console.error("[RevenueTaskSection]", e))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [platform]);

  const allVisible = useMemo(() => {
    const now = new Date();
    return tasks.filter((t) => {
      const st = states[t.key];
      if (!st) return true;
      if (st.status === "done" || st.status === "dismissed") return false;
      if (st.status === "snoozed" && st.snoozed_until) {
        return new Date(st.snoozed_until) <= now;
      }
      return true;
    });
  }, [tasks, states]);

  const topTasks = useMemo(() => allVisible.slice(0, TOP_COUNT), [allVisible]);
  const otherTasks = useMemo(() => allVisible.slice(TOP_COUNT), [allVisible]);
  const visible = filter === "top" ? topTasks : otherTasks;

  const totalImpact = useMemo(
    () => visible.reduce((s, t) => s + t.impactEurPerWeek, 0),
    [visible]
  );

  const act = async (task: RevenueTask, action: "done" | "snooze" | "dismiss") => {
    const prev = states[task.key];
    const newState: TodoState =
      action === "done"
        ? { status: "done", snoozed_until: null }
        : action === "dismiss"
        ? { status: "dismissed", snoozed_until: null }
        : { status: "snoozed", snoozed_until: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() };
    setStates((s) => ({ ...s, [task.key]: newState }));
    try {
      await setTodoStatus(platform, task.key, newState.status, newState.snoozed_until);
      if (action === "done") toast.success("Erledigt 🏻");
      else if (action === "snooze") toast.success("4h verschoben");
      else toast.success("Heute ausgeblendet");
    } catch {
      setStates((s) => {
        const cp = { ...s };
        if (prev) cp[task.key] = prev; else delete cp[task.key];
        return cp;
      });
      toast.error("Speichern fehlgeschlagen");
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-extralight tracking-tight text-foreground flex items-center gap-2">
            <Gem className="h-4 w-4 text-emerald-300/80" />
            Umsatz-Hebel
          </h2>
          <p className="text-[11px] text-white/30 mt-1 font-light tracking-wider uppercase">
            Aufgaben mit messbarem €-Impact · sortiert nach Hebelwirkung
          </p>
        </div>
        {visible.length > 0 && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-white/35">Potenzial / Woche</p>
            <p className="text-xl font-light tabular-nums text-emerald-300/90">+{fmtEur(totalImpact)}</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {([
          { id: "top" as const, label: "Top-Hebel heute", count: topTasks.length },
          { id: "other" as const, label: "Weitere", count: otherTasks.length },
        ]).map((opt) => {
          const active = filter === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setFilter(opt.id)}
              className={cn(
                "px-3 py-1.5 rounded-full text-[11px] font-light tracking-wide transition-all border",
                active
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-200"
                  : "bg-white/[0.02] border-white/10 text-white/45 hover:text-white/70 hover:border-white/20"
              )}
            >
              {opt.label}
              <span className={cn("ml-1.5 tabular-nums", active ? "text-emerald-300/70" : "text-white/30")}>
                {opt.count}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-8 text-white/25 text-xs font-light tracking-wide">
          Berechne Umsatz-Hebel …
        </div>
      ) : visible.length === 0 ? (
        <div className="premium-card rounded-2xl p-6 text-center">
          <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-3">
            <Check className="h-4 w-4 text-emerald-300" />
          </div>
          <p className="text-[13px] text-foreground/70 font-light">Keine Umsatz-Hebel offen.</p>
          <p className="text-[11px] text-white/30 font-light mt-1">Alles im Soll oder erledigt.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {visible.map((t) => {
              const meta = KIND_META[t.kind];
              const Icon = meta.icon;
              return (
                <motion.div
                  key={t.key}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 80, transition: { duration: 0.2 } }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className="premium-card rounded-xl p-4 flex items-start gap-3 group hover:border-emerald-500/20 transition-colors"
                >
                  <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center border shrink-0", meta.tone)}>
                    <Icon className="h-4 w-4" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[11px] tabular-nums font-semibold text-emerald-300/90 px-1.5 py-0.5 rounded border border-emerald-500/25 bg-emerald-500/10">
                        +{fmtEur(t.impactEurPerWeek)}/Wo
                      </span>
                      <span className={cn("text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border", meta.tone)}>
                        {meta.label}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        if (t.kind === "phase" || t.kind === "slot") {
                          if (t.modelName && onModelClick) onModelClick(t.modelName, t.chatterName ?? null);
                        } else if (t.chatterName && onChatterClick) {
                          onChatterClick(t.chatterName);
                        }
                      }}
                      className="text-[13px] text-foreground/90 font-light hover:text-emerald-200 transition-colors text-left block w-full"
                    >
                      {t.title}
                    </button>
                    <p className="text-[11px] text-white/45 font-light mt-1 leading-relaxed">{t.why}</p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => act(t, "done")}
                      title="Erledigt"
                      className="h-7 w-7 rounded-md flex items-center justify-center text-emerald-400/70 hover:text-emerald-300 hover:bg-emerald-500/10"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => act(t, "snooze")}
                      title="4h später"
                      className="h-7 w-7 rounded-md flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/5"
                    >
                      <Clock className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => act(t, "dismiss")}
                      title="Heute ausblenden"
                      className="h-7 w-7 rounded-md flex items-center justify-center text-white/30 hover:text-rose-400 hover:bg-rose-500/10"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
