import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Clock, X as XIcon, AlertTriangle, TrendingDown, Zap, MessageSquare, Activity, Sparkles, Users, Rocket } from "lucide-react";
import TalentCompareModal from "@/components/TalentCompareModal";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  generateDailyTodos,
  loadTodoStates,
  setTodoStatus,
  type DailyTodo,
  type TodoState,
  type TodoCategory,
} from "@/lib/daily-todos";

interface Props {
  platform: string;
  limit?: number;
  onChatterClick?: (name: string) => void;
  onModelClick?: (modelName: string, chatterName: string | null) => void;
  compact?: boolean;
}

const CATEGORY_META: Record<TodoCategory, { label: string; color: string; icon: typeof Zap }> = {
  verzug: { label: "Verzug", color: "text-red-300 bg-red-500/10 border-red-500/25", icon: AlertTriangle },
  revenue: { label: "Umsatz", color: "text-amber-300 bg-amber-500/10 border-amber-500/25", icon: TrendingDown },
  activity: { label: "Aktivität", color: "text-blue-300 bg-blue-500/10 border-blue-500/25", icon: Activity },
  model: { label: "Model", color: "text-purple-300 bg-purple-500/10 border-purple-500/25", icon: Users },
  team: { label: "Team", color: "text-cyan-300 bg-cyan-500/10 border-cyan-500/25", icon: MessageSquare },
  positive: { label: "Win", color: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25", icon: Sparkles },
  talent: { label: "Talent", color: "text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/25", icon: Rocket },
};

export default function DailyTodoList({ platform, limit, onChatterClick, onModelClick, compact }: Props) {
  const [todos, setTodos] = useState<DailyTodo[]>([]);
  const [states, setStates] = useState<Record<string, TodoState>>({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    Promise.all([generateDailyTodos(platform), loadTodoStates(platform)])
      .then(([t, s]) => {
        if (cancel) return;
        setTodos(t);
        setStates(s);
      })
      .catch((e) => console.error("[DailyTodoList]", e))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [platform]);

  const visible = useMemo(() => {
    const now = new Date();
    const filtered = todos.filter((t) => {
      const st = states[t.key];
      if (!st) return true;
      if (st.status === "done" || st.status === "dismissed") return false;
      if (st.status === "snoozed" && st.snoozed_until) {
        return new Date(st.snoozed_until) <= now;
      }
      return true;
    });
    return limit ? filtered.slice(0, limit) : filtered;
  }, [todos, states, limit]);

  const act = async (todo: DailyTodo, action: "done" | "snooze" | "dismiss") => {
    const prev = states[todo.key];
    const newState: TodoState =
      action === "done"
        ? { status: "done", snoozed_until: null }
        : action === "dismiss"
        ? { status: "dismissed", snoozed_until: null }
        : { status: "snoozed", snoozed_until: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() };

    setStates((s) => ({ ...s, [todo.key]: newState }));
    try {
      await setTodoStatus(
        platform,
        todo.key,
        newState.status,
        newState.snoozed_until
      );
      if (action === "done") toast.success("Erledigt");
      else if (action === "snooze") toast.success("4h verschoben");
      else toast.success("Heute ausgeblendet");
    } catch (e) {
      // rollback
      setStates((s) => {
        const cp = { ...s };
        if (prev) cp[todo.key] = prev;
        else delete cp[todo.key];
        return cp;
      });
      toast.error("Speichern fehlgeschlagen");
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-white/25 text-xs font-light tracking-wide">
        Berechne heutige Aufgaben …
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="premium-card rounded-2xl p-6 text-center">
        <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-3">
          <Check className="h-4 w-4 text-emerald-300" />
        </div>
        <p className="text-[13px] text-foreground/70 font-light">Alles klar für heute.</p>
        <p className="text-[11px] text-white/30 font-light mt-1">Keine kritischen Aktionen offen.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {visible.map((t) => {
          const meta = CATEGORY_META[t.category];
          const Icon = meta.icon;
          return (
            <motion.div
              key={t.key}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 80, transition: { duration: 0.2 } }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="premium-card rounded-xl p-4 flex items-start gap-3 group hover:border-primary/15 transition-colors"
            >
              <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center border shrink-0", meta.color)}>
                <Icon className="h-3.5 w-3.5" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {t.category === "talent" && t.chatterName ? (
                    <button
                      onClick={() => {
                        const params = new URLSearchParams({
                          mode: "swap",
                          compare: `${t.chatterName}|${t.compareWith ?? ""}`,
                        });
                        navigate(`/tinder?${params.toString()}`);
                      }}
                      className="text-[13px] text-foreground/90 font-light hover:text-primary transition-colors text-left"
                    >
                      {t.title}
                    </button>
                  ) : t.category === "model" && t.modelName && onModelClick ? (
                    <button
                      onClick={() => onModelClick(t.modelName!, t.chatterName ?? null)}
                      className="text-[13px] text-foreground/90 font-light hover:text-primary transition-colors text-left"
                    >
                      {t.title}
                    </button>
                  ) : t.chatterName && onChatterClick ? (
                    <button
                      onClick={() => onChatterClick(t.chatterName!)}
                      className="text-[13px] text-foreground/90 font-light hover:text-primary transition-colors text-left"
                    >
                      {t.title}
                    </button>
                  ) : (
                    <span className="text-[13px] text-foreground/90 font-light">{t.title}</span>
                  )}
                  <span className={cn("text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border", meta.color)}>
                    {meta.label}
                  </span>
                </div>
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
                  className="h-7 w-7 rounded-md flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-500/10"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
