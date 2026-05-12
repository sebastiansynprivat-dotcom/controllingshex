import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Eye, Sparkles, Flame, AlertTriangle, ArrowLeftRight, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePlatform } from "@/contexts/PlatformContext";
import PersonActionCard from "@/components/PersonActionCard";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import ModelPerformanceSlideOver from "@/components/ModelPerformanceSlideOver";
import {
  buildTodayActions,
  type UnifiedAction,
  type TodayEngineResult,
  type ActionSourceKind,
} from "@/lib/today-engine";
import {
  loadTodoStates,
  setTodoStatus,
  type TodoState,
} from "@/lib/daily-todos";

type SectionMode = "primary" | "watch" | "wins" | "done";

type ThemeGroupId = "escalation" | "account" | "performance";

const KIND_TO_GROUP: Record<ActionSourceKind, ThemeGroupId> = {
  verzug: "escalation",
  recovery: "escalation",
  swap: "account",
  talent: "account",
  mismatch: "account",
  phase: "account",
  revenue: "performance",
  activity: "performance",
  model: "performance",
  slot: "performance",
  positive: "performance",
};

const GROUP_DEFS: { id: ThemeGroupId; label: string; icon: typeof Flame; accent: string; dot: string }[] = [
  { id: "escalation", label: "Eskalation", icon: AlertTriangle, accent: "text-red-300", dot: "bg-red-400/80" },
  { id: "account", label: "Account-Aktionen", icon: ArrowLeftRight, accent: "text-cyan-300", dot: "bg-cyan-400/80" },
  { id: "performance", label: "Performance", icon: BarChart3, accent: "text-emerald-300", dot: "bg-emerald-400/80" },
];

function groupByTheme(actions: UnifiedAction[]) {
  const buckets: Record<ThemeGroupId, UnifiedAction[]> = {
    escalation: [], account: [], performance: [],
  };
  for (const a of actions) {
    const g = KIND_TO_GROUP[a.primaryKind] ?? "performance";
    buckets[g].push(a);
  }
  return GROUP_DEFS
    .map((def) => {
      const items = buckets[def.id];
      const sumImpact = items.reduce((s, a) => s + a.totalImpactEurPerWeek, 0);
      return { ...def, items, sumImpact };
    })
    .filter((g) => g.items.length > 0);
}

function fmtEur(v: number): string {
  return Math.round(v).toLocaleString("de-DE") + " €";
}

export default function Today() {
  const { platform } = usePlatform();
  const [data, setData] = useState<TodayEngineResult | null>(null);
  const [states, setStates] = useState<Record<string, TodoState>>({});
  const [loading, setLoading] = useState(true);
  const [selectedChatter, setSelectedChatter] = useState<{ name: string; compareWith: string | null } | null>(null);
  const [selectedModel, setSelectedModel] = useState<{ name: string; chatter: string | null } | null>(null);
  const [section, setSection] = useState<SectionMode>("primary");

  const todayLabel = new Date().toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    Promise.all([buildTodayActions(platform), loadTodoStates(platform)])
      .then(([d, s]) => {
        if (cancel) return;
        setData(d);
        setStates(s);
      })
      .catch((e) => console.error("[Today]", e))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [platform]);

  const visibility = (action: UnifiedAction): "open" | "done" | "hidden" | "snoozed-active" => {
    const now = new Date();
    let anyOpen = false;
    let anyDone = false;
    for (const k of action.todoKeys) {
      const st = states[k];
      if (!st) { anyOpen = true; continue; }
      if (st.status === "done") { anyDone = true; continue; }
      if (st.status === "dismissed") { continue; }
      if (st.status === "snoozed" && st.snoozed_until && new Date(st.snoozed_until) > now) {
        continue;
      }
      anyOpen = true;
    }
    if (anyOpen) return "open";
    if (anyDone) return "done";
    return "hidden";
  };

  const filtered = useMemo(() => {
    if (!data) return { primary: [], watchlist: [], wins: [], done: [], openImpact: 0, doneImpact: 0 };
    const open: UnifiedAction[] = [];
    const watch: UnifiedAction[] = [];
    const wins: UnifiedAction[] = [];
    const done: UnifiedAction[] = [];

    for (const a of data.primary) {
      const v = visibility(a);
      if (v === "open") open.push(a);
      else if (v === "done") done.push(a);
    }
    for (const a of data.watchlist) {
      const v = visibility(a);
      if (v === "open") watch.push(a);
      else if (v === "done") done.push(a);
    }
    for (const a of data.wins) {
      const v = visibility(a);
      if (v === "open") wins.push(a);
      else if (v === "done") done.push(a);
    }

    const openImpact = open.reduce((s, a) => s + a.totalImpactEurPerWeek, 0);
    const doneImpact = done.reduce((s, a) => s + a.totalImpactEurPerWeek, 0);

    return { primary: open, watchlist: watch, wins, done, openImpact, doneImpact };
  }, [data, states]);

  const totalPrimaryActions = (data?.primary.length ?? 0);
  const completedPrimary = totalPrimaryActions - filtered.primary.length;
  const progressPct = totalPrimaryActions > 0
    ? Math.round((completedPrimary / totalPrimaryActions) * 100)
    : 0;

  const act = async (action: UnifiedAction, kind: "done" | "snooze" | "dismiss") => {
    const prevStates = { ...states };
    const newSnooze = kind === "snooze"
      ? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
      : null;
    const status: TodoState["status"] = kind === "done" ? "done" : kind === "dismiss" ? "dismissed" : "snoozed";

    const next = { ...states };
    for (const k of action.todoKeys) {
      next[k] = { status, snoozed_until: newSnooze };
    }
    setStates(next);

    try {
      await Promise.all(action.todoKeys.map((k) => setTodoStatus(platform, k, status, newSnooze)));
      if (kind === "done") toast.success("Erledigt 🏻");
      else if (kind === "snooze") toast.success("4h verschoben");
      else toast.success("Heute ausgeblendet");
    } catch {
      setStates(prevStates);
      toast.error("Speichern fehlgeschlagen");
    }
  };

  const sections: { id: SectionMode; label: string; icon: typeof Flame; count: number }[] = [
    { id: "primary", label: "Jetzt machen", icon: Flame, count: filtered.primary.length },
    { id: "watch", label: "Im Auge behalten", icon: Eye, count: filtered.watchlist.length },
    { id: "wins", label: "Wins", icon: Sparkles, count: filtered.wins.length },
    { id: "done", label: "Erledigt", icon: Check, count: filtered.done.length },
  ];

  const visibleList = section === "primary"
    ? filtered.primary
    : section === "watch"
      ? filtered.watchlist
      : section === "wins"
        ? filtered.wins
        : filtered.done;

  return (
    <>
      <AnimatePresence mode="wait">
        <motion.div
          key={platform}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-3xl mx-auto space-y-6"
        >
          {/* Header */}
          <div>
            <div className="flex items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extralight tracking-tight text-foreground">Heute</h1>
                <p className="text-[11px] text-white/30 mt-1.5 font-light tracking-wider uppercase">
                  {todayLabel} · {platform}
                </p>
              </div>
              {!loading && totalPrimaryActions > 0 && (
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-white/35">Offener €-Hebel / Wo</p>
                  <p className="text-2xl font-extralight tabular-nums text-emerald-300/95">
                    +{fmtEur(filtered.openImpact)}
                  </p>
                </div>
              )}
            </div>
            {!loading && totalPrimaryActions > 0 && (
              <div className="mt-4">
                <div className="h-1 rounded-full bg-white/[0.05] overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-emerald-400/70 to-emerald-300/90"
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPct}%` }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
                <p className="text-[10px] text-white/35 font-light mt-1.5 tracking-wide">
                  {completedPrimary} von {totalPrimaryActions} Top-Aktionen erledigt
                </p>
              </div>
            )}
          </div>

          {/* Section tabs */}
          <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 scrollbar-none">
            {sections.map((s) => {
              const Icon = s.icon;
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "shrink-0 px-3.5 py-2 rounded-full text-[12px] font-light tracking-wide transition-all border flex items-center gap-1.5",
                    active
                      ? "bg-primary/15 border-primary/40 text-foreground"
                      : "bg-white/[0.02] border-white/10 text-white/45 hover:text-white/70 hover:border-white/20"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {s.label}
                  <span className={cn("tabular-nums ml-0.5", active ? "text-primary/90" : "text-white/30")}>
                    {s.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Content */}
          {loading ? (
            <div className="text-center py-12 text-white/25 text-xs font-light tracking-wide">
              Bündele Tagesaufgaben …
            </div>
          ) : visibleList.length === 0 ? (
            <EmptyState section={section} hasAnyOpen={filtered.primary.length + filtered.watchlist.length > 0} />
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {visibleList.map((a) => (
                  <PersonActionCard
                    key={a.bundleKey}
                    action={a}
                    onChatterClick={(name, compareWith) => setSelectedChatter({ name, compareWith: compareWith ?? null })}
                    onModelClick={(name, chatter) => setSelectedModel({ name, chatter })}
                    onAct={act}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {selectedChatter && (
        <ChatterSlideOver
          open={!!selectedChatter}
          onClose={() => setSelectedChatter(null)}
          chatterName={selectedChatter.name}
          initialCompareWith={selectedChatter.compareWith}
          platform={platform}
        />
      )}

      <ModelPerformanceSlideOver
        open={!!selectedModel}
        onClose={() => setSelectedModel(null)}
        modelName={selectedModel?.name ?? null}
        focusChatter={selectedModel?.chatter ?? null}
        platform={platform}
      />
    </>
  );
}

function EmptyState({ section, hasAnyOpen }: { section: SectionMode; hasAnyOpen: boolean }) {
  const cfg = section === "primary"
    ? {
        title: hasAnyOpen ? "Top-Aktionen abgearbeitet 🏻" : "Alles klar für heute",
        sub: hasAnyOpen ? "Schau im Auge behalten — kleinere Hebel warten." : "Keine kritischen Aktionen offen.",
      }
    : section === "watch"
      ? { title: "Nichts auf der Watchlist", sub: "Alles, was zählt, ist oben." }
      : section === "wins"
        ? { title: "Heute noch keine Wins", sub: "Schau später nochmal rein." }
        : { title: "Noch nichts erledigt", sub: "Die ersten Häkchen warten." };

  return (
    <div className="premium-card rounded-2xl p-8 text-center">
      <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-3">
        <Check className="h-4 w-4 text-emerald-300" />
      </div>
      <p className="text-[13px] text-foreground/70 font-light">{cfg.title}</p>
      <p className="text-[11px] text-white/30 font-light mt-1">{cfg.sub}</p>
    </div>
  );
}
