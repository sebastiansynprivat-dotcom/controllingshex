import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Eye, Sparkles, Flame, AlertTriangle, ArrowLeftRight, LifeBuoy, Shuffle, Clock, TrendingUp, Activity, Star, CalendarClock, ThumbsUp, BellRing } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePlatform } from "@/contexts/PlatformContext";
import PersonActionCard from "@/components/PersonActionCard";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import ModelPerformanceSlideOver from "@/components/ModelPerformanceSlideOver";
import ModelTrackingView from "@/components/today/ModelTrackingView";
import MatchBoard from "@/components/today/MatchBoard";
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
type KindTab = "all" | ActionSourceKind | "board-talent" | "board-orphan";
type TopTab = "actions" | "tracking";



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
  const [boardCounts, setBoardCounts] = useState<{ talents: number; orphans: number }>({ talents: 0, orphans: 0 });
  const [pendingFeedback, setPendingFeedback] = useState<ActionOutcomeRow[]>([]);
  const [recap, setRecap] = useState<WeekRecap | null>(null);
  const [topTab, setTopTab] = useState<TopTab>("actions");
  const isSunday = new Date().getDay() === 0;


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

  // Status-Dropdown: Offen (= primary + watchlist), Wins, Erledigt
  const statusList: UnifiedAction[] =
    status === "open"
      ? [...filtered.primary, ...filtered.watchlist]
      : status === "wins"
        ? filtered.wins
        : filtered.done;

  // Verfügbare Kategorien für Tabs (nur welche mit count > 0)
  const availableKinds = groupByKind(statusList);
  const isBoardTab = kindTab === "board-talent" || kindTab === "board-orphan";
  const visibleList =
    kindTab === "all" || isBoardTab
      ? statusList
      : statusList.filter((a) => a.primaryKind === kindTab);

  // Falls aktiver Kind-Tab leer wird, auf "all" zurück (Board-Tabs ausgenommen)
  if (kindTab !== "all" && !isBoardTab && !availableKinds.some((g) => g.id === kindTab)) {
    queueMicrotask(() => setKindTab("all"));
  }

  const statusOptions: { id: StatusMode; label: string; count: number }[] = [
    { id: "open", label: "Offen", count: filtered.primary.length + filtered.watchlist.length },
    { id: "wins", label: "Wins", count: filtered.wins.length },
    { id: "done", label: "Erledigt", count: filtered.done.length },
  ];

  // Nur "Erledigt" ist readonly — Wins können wie normale Aktionen abgehakt werden
  const isReadonly = status === "done";

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

          {/* Top-Level Tab Switch */}
          <div className="flex items-center gap-1.5 border-b border-white/[0.05] pb-0">
            {[
              { id: "actions" as const, label: "Aktionen" },
              { id: "tracking" as const, label: "Model Tracking" },
            ].map((t) => {
              const active = topTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTopTab(t.id)}
                  className={cn(
                    "px-3 py-2 text-[12px] font-medium tracking-wide transition-all border-b-2 -mb-px",
                    active
                      ? "border-foreground/70 text-foreground"
                      : "border-transparent text-white/40 hover:text-white/70",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {topTab === "tracking" ? (
            <ModelTrackingView
              platform={platform}
              onSelectModel={(name, chatter) => setSelectedModel({ name, chatter })}
            />
          ) : (
            <>

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

          {/* Talent ↔ Account-Board (Drag & Drop) — sichtbar bei "Alle" oder als Filter-Ansicht */}
          {!loading && (
            <div className={cn((kindTab === "all" || isBoardTab) ? "" : "hidden")}>
              <MatchBoard
                platform={platform}
                view={
                  kindTab === "board-talent"
                    ? "talent-only"
                    : kindTab === "board-orphan"
                      ? "orphan-only"
                      : "full"
                }
                onCountsChange={setBoardCounts}
                onChatterClick={(name, compareWith) =>
                  setSelectedChatter({ name, compareWith: compareWith ?? null })
                }
              />
            </div>
          )}

          {/* Status-Pills + Kategorie-Tabs */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-1.5">
              {statusOptions.map((o) => {
                const active = status === o.id;
                return (
                  <button
                    key={o.id}
                    onClick={() => {
                      setStatus(o.id);
                      setKindTab("all");
                    }}
                    className={cn(
                      "px-3 py-1 rounded-full text-[10.5px] font-semibold uppercase tracking-wider transition-all border flex items-center gap-1.5",
                      active
                        ? "bg-white/[0.07] border-white/15 text-foreground/90"
                        : "bg-transparent border-white/[0.06] text-white/35 hover:text-white/65",
                    )}
                  >
                    {o.label}
                    <span className={cn("tabular-nums text-[10px]", active ? "text-white/55" : "text-white/25")}>
                      {o.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>


          {/* Content */}
          {loading ? (
            <div className="text-center py-12 text-white/25 text-xs font-light tracking-wide">
              Bündele Tagesaufgaben …
            </div>
          ) : isBoardTab ? null : visibleList.length === 0 ? (
            <EmptyState status={status} hasAnyOpen={filtered.primary.length + filtered.watchlist.length > 0} />
          ) : kindTab === "all" ? (
            <div className="space-y-5">
              <AnimatePresence initial={false}>
                {groupByKind(visibleList).map((g) => (
                  <div key={g.id} className="space-y-2">
                    <div className="flex items-center gap-2 px-1 pb-1 opacity-70">
                      <span className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", g.accent)}>
                        {g.label}
                      </span>
                      <span className="text-[10px] tabular-nums text-white/30 font-light">
                        · {g.items.length}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {g.items.map((a) => (
                        <PersonActionCard
                          key={a.bundleKey}
                          action={a}
                          onChatterClick={(name, compareWith) => setSelectedChatter({ name, compareWith: compareWith ?? null })}
                          onModelClick={(name, chatter) => setSelectedModel({ name, chatter })}
                          onAct={act}
                          readonly={isReadonly}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence initial={false}>
                {visibleList.map((a) => (
                  <PersonActionCard
                    key={a.bundleKey}
                    action={a}
                    onChatterClick={(name, compareWith) => setSelectedChatter({ name, compareWith: compareWith ?? null })}
                    onModelClick={(name, chatter) => setSelectedModel({ name, chatter })}
                    onAct={act}
                    readonly={isReadonly}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}

            </>
          )}

          {/* Spacer damit die letzte Karte nicht hinter der Bottom-Bar verschwindet */}
          <div aria-hidden className="h-20" />
        </motion.div>
      </AnimatePresence>

      {/* Bottom-Nav: Kategorie-Filter — luxuriös, frosted, sticky am unteren Rand */}
      {!loading && (availableKinds.length > 0 || kindTab !== "all" || boardCounts.talents > 0 || boardCounts.orphans > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)" }}
        >
          <div className="pointer-events-auto mx-auto max-w-3xl px-3 pb-3 sm:px-6">
            <div className="relative rounded-[20px] border border-white/[0.07] bg-background/65 backdrop-blur-2xl shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.02)_inset] overflow-hidden">
              {/* Top hairline highlight */}
              <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              {/* Edge fade masks */}
              <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-background/80 to-transparent z-10" />
              <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background/80 to-transparent z-10" />
              <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2.5 scrollbar-none">
                <button
                  onClick={() => setKindTab("all")}
                  className={cn(
                    "shrink-0 px-3.5 py-1.5 rounded-full text-[11.5px] font-medium tracking-wide transition-all border flex items-center gap-1.5",
                    kindTab === "all"
                      ? "bg-white/[0.09] border-white/20 text-foreground shadow-[0_0_18px_-6px_rgba(255,255,255,0.25)]"
                      : "bg-white/[0.02] border-white/[0.06] text-white/45 hover:text-white/80 hover:border-white/[0.12]",
                  )}
                >
                  Alle
                  <span className={cn("tabular-nums text-[10px]", kindTab === "all" ? "text-white/70" : "text-white/30")}>
                    {statusList.length}
                  </span>
                </button>
                {availableKinds.map((g) => {
                  const Icon = g.icon;
                  const active = kindTab === g.id;
                  return (
                    <button
                      key={g.id}
                      onClick={() => setKindTab(g.id)}
                      className={cn(
                        "shrink-0 px-3.5 py-1.5 rounded-full text-[11.5px] font-medium tracking-wide transition-all border flex items-center gap-1.5",
                        active
                          ? "bg-white/[0.09] border-white/20 text-foreground shadow-[0_0_18px_-6px_rgba(255,255,255,0.25)]"
                          : "bg-white/[0.02] border-white/[0.06] text-white/45 hover:text-white/80 hover:border-white/[0.12]",
                      )}
                    >
                      <Icon className={cn("h-3 w-3", active ? g.accent : "text-white/40")} />
                      {g.label}
                      <span className={cn("tabular-nums text-[10px]", active ? "text-white/70" : "text-white/30")}>
                        {g.items.length}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </motion.div>
      )}


      {/* Split-View: wenn Model-Monitor mit Chatter geöffnet wird,
          rendert sich der Chatter-SlideOver gleichzeitig auf der rechten Hälfte. */}
      {(() => {
        const splitActive = !!selectedModel && !!selectedModel.chatter;
        const chatterOpen = !!selectedChatter || splitActive;
        const chatterName = selectedChatter?.name ?? selectedModel?.chatter ?? null;
        const chatterCompare = selectedChatter?.compareWith ?? null;
        return (
          <>
            {chatterOpen && chatterName && (
              <ChatterSlideOver
                open={chatterOpen}
                onClose={() => {
                  setSelectedChatter(null);
                  if (splitActive) setSelectedModel(null);
                }}
                chatterName={chatterName}
                initialCompareWith={chatterCompare}
                platform={platform}
                splitView={splitActive}
              />
            )}

            <ModelPerformanceSlideOver
              open={!!selectedModel}
              onClose={() => setSelectedModel(null)}
              modelName={selectedModel?.name ?? null}
              focusChatter={selectedModel?.chatter ?? null}
              platform={platform}
              splitView={splitActive}
            />
          </>
        );
      })()}
    </>
  );
}

function EmptyState({ status, hasAnyOpen }: { status: StatusMode; hasAnyOpen: boolean }) {
  const cfg = status === "open"
    ? {
        title: hasAnyOpen ? "Alle offenen Aktionen erledigt 🏻" : "Alles klar für heute",
        sub: hasAnyOpen ? "Schau in Wins oder Erledigt für deinen Fortschritt." : "Keine offenen Aktionen.",
      }
    : status === "wins"
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
