import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Eye, Sparkles, Flame, AlertTriangle, ArrowLeftRight, LifeBuoy, Shuffle, Clock, TrendingUp, Activity, Star, CalendarClock, ThumbsUp, BellRing } from "lucide-react";
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
import {
  recordActionDone,
  backfillOutcomes,
  loadPendingFeedback,
  setOutcomeFeedback,
  loadWeekRecap,
  type ActionOutcomeRow,
  type WeekRecap,
} from "@/lib/action-outcomes";

type StatusMode = "open" | "wins" | "done";
type KindTab = "all" | ActionSourceKind;



const KIND_DEFS: { id: ActionSourceKind; label: string; icon: typeof Flame; accent: string; dot: string }[] = [
  { id: "verzug",   label: "Verzug",         icon: AlertTriangle,  accent: "text-red-300",      dot: "bg-red-400/80" },
  { id: "recovery", label: "Recovery",       icon: LifeBuoy,       accent: "text-orange-300",   dot: "bg-orange-400/80" },
  { id: "wakeup",   label: "Wieder aktiv",   icon: BellRing,       accent: "text-emerald-300",  dot: "bg-emerald-400/80" },
  { id: "swap",     label: "Account-Tausch", icon: ArrowLeftRight, accent: "text-cyan-300",     dot: "bg-cyan-400/80" },
  { id: "talent",   label: "Talent",         icon: Sparkles,       accent: "text-violet-300",   dot: "bg-violet-400/80" },
  { id: "mismatch", label: "Mismatch",       icon: Shuffle,        accent: "text-amber-300",    dot: "bg-amber-400/80" },
  { id: "phase",    label: "Phase",          icon: Clock,          accent: "text-sky-300",      dot: "bg-sky-400/80" },
  { id: "revenue",  label: "Revenue",        icon: TrendingUp,     accent: "text-emerald-300",  dot: "bg-emerald-400/80" },
  { id: "activity", label: "Aktivität",      icon: Activity,       accent: "text-teal-300",     dot: "bg-teal-400/80" },
  { id: "model",    label: "Model",          icon: Star,           accent: "text-fuchsia-300",  dot: "bg-fuchsia-400/80" },
  { id: "slot",     label: "Slot / Schicht", icon: CalendarClock,  accent: "text-indigo-300",   dot: "bg-indigo-400/80" },
  { id: "positive", label: "Wins-Signal",    icon: ThumbsUp,       accent: "text-lime-300",     dot: "bg-lime-400/80" },
];

function groupByKind(actions: UnifiedAction[]) {
  const buckets = new Map<ActionSourceKind, UnifiedAction[]>();
  for (const a of actions) {
    const arr = buckets.get(a.primaryKind) ?? [];
    arr.push(a);
    buckets.set(a.primaryKind, arr);
  }
  return KIND_DEFS
    .map((def) => {
      const items = buckets.get(def.id) ?? [];
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
  const [status, setStatus] = useState<StatusMode>("open");
  const [kindTab, setKindTab] = useState<KindTab>("all");
  const [pendingFeedback, setPendingFeedback] = useState<ActionOutcomeRow[]>([]);
  const [recap, setRecap] = useState<WeekRecap | null>(null);
  const isSunday = new Date().getDay() === 0;

  const toggleKind = (k: ActionSourceKind) => {
    setExcludedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const todayLabel = new Date().toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    // Backfill alte Outcomes vorab — füllt 24/48/72h-Snapshots
    backfillOutcomes(platform).catch(() => {});
    Promise.all([
      buildTodayActions(platform),
      loadTodoStates(platform),
      loadPendingFeedback(platform),
      isSunday ? loadWeekRecap(platform) : Promise.resolve(null),
    ])
      .then(([d, s, fb, rc]) => {
        if (cancel) return;
        setData(d);
        setStates(s);
        setPendingFeedback(fb);
        setRecap(rc);
      })
      .catch((e) => console.error("[Today]", e))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [platform, isSunday]);

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

  const act = async (action: UnifiedAction, kind: "done" | "snooze" | "dismiss" | "reject-account") => {
    if (kind === "reject-account") {
      const sig = action.signals.find((s) => s.rejectAccount);
      const rej = sig?.rejectAccount;
      if (!rej) return;
      try {
        const { addRejection } = await import("@/lib/talent-rejections");
        await addRejection(platform, rej.riser, rej.account);
        toast.success("Anderer Account wird gesucht");
        // Today neu laden
        const fresh = await buildTodayActions(platform);
        setData(fresh);
      } catch {
        toast.error("Konnte nicht speichern");
      }
      return;
    }
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
      if (kind === "done") {
        toast.success("Erledigt 🏻");
        // A1 — Outcome-Snapshot fürs ROI-Lernen
        recordActionDone(platform, action).catch(() => {});
      }
      else if (kind === "snooze") toast.success("4h verschoben");
      else toast.success("Heute ausgeblendet");
    } catch {
      setStates(prevStates);
      toast.error("Speichern fehlgeschlagen");
    }
  };

  const submitFeedback = async (id: string, helped: boolean) => {
    setPendingFeedback((prev) => prev.filter((p) => p.id !== id));
    try {
      await setOutcomeFeedback(id, helped);
      toast.success(helped ? "Danke 🏻" : "Notiert");
    } catch {
      toast.error("Konnte nicht speichern");
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

          {/* A3 — Wochen-Recap (nur Sonntag) */}
          {!loading && recap && recap.count > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="premium-card rounded-2xl p-4 border border-emerald-500/20 bg-emerald-500/[0.04]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                  <span className="text-[10.5px] uppercase tracking-widest text-emerald-300/90 font-semibold">
                    Wochen-Recap
                  </span>
                </div>
                <span className={cn(
                  "text-base font-extralight tabular-nums",
                  recap.totalDelta >= 0 ? "text-emerald-300" : "text-red-300"
                )}>
                  {recap.totalDelta >= 0 ? "+" : ""}{fmtEur(recap.totalDelta)}
                </span>
              </div>
              <p className="text-[11.5px] text-white/55 font-light mt-1.5 leading-relaxed">
                {recap.count} Aktionen · Top-Hebel:{" "}
                {recap.topChatter && (
                  <span className="text-foreground/80">{recap.topChatter.name}</span>
                )}
                {recap.topActionType && (
                  <span className="text-white/45"> · {recap.topActionType.type}</span>
                )}
              </p>
            </motion.div>
          )}

          {/* A2 — Pending Feedback */}
          {!loading && pendingFeedback.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="premium-card rounded-2xl p-4 border border-violet-500/20 bg-violet-500/[0.03] space-y-3"
            >
              <div className="flex items-center gap-2">
                <ThumbsUp className="h-3.5 w-3.5 text-violet-300" />
                <span className="text-[10.5px] uppercase tracking-widest text-violet-300/90 font-semibold">
                  Hat geholfen?
                </span>
                <span className="text-[10.5px] text-white/35 tabular-nums">· {pendingFeedback.length}</span>
              </div>
              <div className="space-y-1.5">
                {pendingFeedback.slice(0, 3).map((fb) => (
                  <div key={fb.id} className="flex items-center justify-between gap-3 py-1">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] text-foreground/85 font-light truncate">
                        {fb.chatter_name} · <span className="text-white/45">{fb.action_type}</span>
                      </p>
                      {fb.delta_24h != null && (
                        <p className={cn(
                          "text-[10.5px] tabular-nums font-light",
                          fb.delta_24h >= 0 ? "text-emerald-300/80" : "text-red-300/70"
                        )}>
                          24h: {fb.delta_24h >= 0 ? "+" : ""}{fmtEur(fb.delta_24h)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => submitFeedback(fb.id, true)}
                        className="h-7 w-7 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors flex items-center justify-center"
                        aria-label="Hat geholfen"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => submitFeedback(fb.id, false)}
                        className="h-7 w-7 rounded-full border border-white/15 bg-white/[0.03] text-white/55 hover:text-white/85 transition-colors flex items-center justify-center text-[14px] leading-none"
                        aria-label="Nicht geholfen"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

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
          ) : section === "primary" || section === "watch" ? (
            <>
              {/* Kategorie-Filter */}
              {(() => {
                const allGroups = groupByKind(visibleList);
                if (allGroups.length <= 1) return null;
                return (
                  <div className="flex items-center gap-1.5 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 scrollbar-none">
                    {allGroups.map((g) => {
                      const Icon = g.icon;
                      const active = !excludedKinds.has(g.id);
                      return (
                        <button
                          key={g.id}
                          onClick={() => toggleKind(g.id)}
                          className={cn(
                            "shrink-0 px-2.5 py-1 rounded-full text-[10.5px] font-light tracking-wide transition-all border flex items-center gap-1.5",
                            active
                              ? "bg-white/[0.04] border-white/15 text-foreground/90"
                              : "bg-transparent border-white/[0.08] text-white/30 hover:text-white/55"
                          )}
                          title={active ? "Ausblenden" : "Einblenden"}
                        >
                          <Icon className={cn("h-3 w-3", active ? g.accent : "text-white/30")} />
                          <span>{g.label}</span>
                          <span className={cn("tabular-nums", active ? "text-white/45" : "text-white/25")}>
                            {g.items.length}
                          </span>
                        </button>
                      );
                    })}
                    {excludedKinds.size > 0 && (
                      <button
                        onClick={() => setExcludedKinds(new Set())}
                        className="shrink-0 px-2.5 py-1 rounded-full text-[10.5px] font-light tracking-wide text-white/40 hover:text-white/70 transition-colors"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                );
              })()}
              <div className="space-y-5">
                <AnimatePresence initial={false}>
                  {groupByKind(visibleList).filter((g) => !excludedKinds.has(g.id)).map((g) => {
                  const Icon = g.icon;
                  return (
                    <div key={g.id} className="space-y-2">
                      <div className="flex items-center justify-between gap-3 px-1 pb-1.5 border-b border-white/[0.06]">
                        <div className="flex items-center gap-2">
                          <span className={cn("h-1.5 w-1.5 rounded-full", g.dot)} />
                          <Icon className={cn("h-3.5 w-3.5", g.accent)} />
                          <span className={cn("text-[10.5px] font-semibold uppercase tracking-widest", g.accent)}>
                            {g.label}
                          </span>
                          <span className="text-[10.5px] tabular-nums text-white/35 font-light">
                            · {g.items.length}
                          </span>
                        </div>
                        {g.sumImpact > 0 && (
                          <span className="text-[10.5px] tabular-nums text-emerald-300/80 font-light">
                            +{fmtEur(g.sumImpact)}/Wo
                          </span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {g.items.map((a) => (
                          <PersonActionCard
                            key={a.bundleKey}
                            action={a}
                            onChatterClick={(name, compareWith) => setSelectedChatter({ name, compareWith: compareWith ?? null })}
                            onModelClick={(name, chatter) => setSelectedModel({ name, chatter })}
                            onAct={act}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </AnimatePresence>
              </div>
            </>
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
