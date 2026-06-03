import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Eye, Sparkles, Flame, AlertTriangle, ArrowLeftRight, LifeBuoy, Shuffle, Clock, TrendingUp, Activity, Star, CalendarClock, ThumbsUp, BellRing, Sprout, Tag } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePlatform } from "@/contexts/PlatformContext";
import PersonActionCard from "@/components/PersonActionCard";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import ModelPerformanceSlideOver from "@/components/ModelPerformanceSlideOver";
import ModelTrackingView from "@/components/today/ModelTrackingView";
import OnboardingList from "@/components/today/OnboardingList";
import LabelCardList from "@/components/today/LabelCardList";
import LabelFilterSheet from "@/components/today/LabelFilterSheet";
import { useSidebar } from "@/components/ui/sidebar";
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
import {
  ensureSystemLabels,
  isSystemLabel,
  isUpgradeReceivedLabel,
  loadChatterLabels,
  loadLabelAssignments,
  type ChatterLabel,
  type LabelAssignment,
} from "@/lib/chatter-labels";

type StatusMode = "open" | "wins" | "done";
type ExtraFilter = "none" | "onboarding" | "labels";
type KindTab = "all" | ActionSourceKind;
type TopTab = "actions" | "tracking";



const KIND_DEFS: { id: ActionSourceKind; label: string; icon: typeof Flame; accent: string; dot: string }[] = [
  { id: "verzug",   label: "Verzug",         icon: AlertTriangle,  accent: "text-red-300",      dot: "bg-red-400/80" },
  { id: "recovery", label: "Recovery",       icon: LifeBuoy,       accent: "text-orange-300",   dot: "bg-orange-400/80" },
  { id: "wakeup",   label: "Wieder aktiv",   icon: BellRing,       accent: "text-emerald-300",  dot: "bg-emerald-400/80" },
  { id: "swap",     label: "Account-Tausch", icon: ArrowLeftRight, accent: "text-cyan-300",     dot: "bg-cyan-400/80" },
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
  const { state: sidebarState, isMobile: sidebarIsMobile } = useSidebar();
  const sidebarOffset = sidebarIsMobile ? "0px" : sidebarState === "collapsed" ? "5rem" : "16rem";
  useEffect(() => {
    document.documentElement.style.setProperty("--today-sidebar-offset", sidebarOffset);
    return () => { document.documentElement.style.removeProperty("--today-sidebar-offset"); };
  }, [sidebarOffset]);
  const [data, setData] = useState<TodayEngineResult | null>(null);
  const [states, setStates] = useState<Record<string, TodoState>>({});
  const [loading, setLoading] = useState(true);
  const [selectedChatter, setSelectedChatter] = useState<{ name: string; compareWith: string | null } | null>(null);
  const [selectedModel, setSelectedModel] = useState<{ name: string; chatter: string | null } | null>(null);
  const [status, setStatus] = useState<StatusMode>("open");
  const [kindTab, setKindTab] = useState<KindTab>("all");
  const [extraFilter, setExtraFilter] = useState<ExtraFilter>("none");
  const [pendingFeedback, setPendingFeedback] = useState<ActionOutcomeRow[]>([]);
  const [recap, setRecap] = useState<WeekRecap | null>(null);
  const [topTab, setTopTab] = useState<TopTab>("actions");

  // Labels + Onboarding
  const [labels, setLabels] = useState<ChatterLabel[]>([]);
  const [assignments, setAssignments] = useState<LabelAssignment[]>([]);
  const [onboardingGroups, setOnboardingGroups] = useState<import("@/lib/onboarding-filter").OnboardingGroup[]>([]);
  const [labelCards, setLabelCards] = useState<import("@/lib/label-tasks").LabelCard[]>([]);
  const [labelFilterOpen, setLabelFilterOpen] = useState(false);
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("today.activeLabelFilters");
      if (raw) return new Set(JSON.parse(raw));
    } catch {
      // ignore corrupted local filter cache
    }
    return new Set();
  });
  const [labelDataNonce, setLabelDataNonce] = useState(0);
  const reloadLabelData = () => setLabelDataNonce((n) => n + 1);

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
    // System-Labels seeden (idempotent)
    ensureSystemLabels(platform).catch(() => {});
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

  // Labels + Onboarding + Label-Karten — separat & reagiert auf labelDataNonce
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [lbls, asgs] = await Promise.all([
          loadChatterLabels(platform),
          loadLabelAssignments(platform),
        ]);
        if (cancel) return;
        setLabels(lbls);
        setAssignments(asgs);

        const [onboarding, lblCards] = await Promise.all([
          (await import("@/lib/onboarding-filter")).loadOnboardingChatters(platform, lbls, asgs),
          (await import("@/lib/label-tasks")).loadLabelCards(platform, lbls, asgs),
        ]);
        if (cancel) return;
        setOnboardingGroups(onboarding);
        setLabelCards(lblCards);
      } catch (e) {
        console.error("[Today/labels]", e);
      }
    })();
    return () => { cancel = true; };
  }, [platform, labelDataNonce]);

  // localStorage sync für selectedLabelIds
  useEffect(() => {
    try {
      localStorage.setItem("today.activeLabelFilters", JSON.stringify([...selectedLabelIds]));
    } catch {
      // ignore unavailable localStorage
    }
  }, [selectedLabelIds]);


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
        // Today neu laden
        const fresh = await buildTodayActions(platform);
        setData(fresh);
      } catch {
        // still silent
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
        // A1 — Outcome-Snapshot fürs ROI-Lernen
        recordActionDone(platform, action).catch(() => {});
      }
    } catch {
      setStates(prevStates);
    }
  };

  const submitFeedback = async (id: string, helped: boolean) => {
    setPendingFeedback((prev) => prev.filter((p) => p.id !== id));
    try {
      await setOutcomeFeedback(id, helped);
    } catch {
      // silent
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
  const visibleList =
    kindTab === "all"
      ? statusList
      : statusList.filter((a) => a.primaryKind === kindTab);

  // Falls aktiver Kind-Tab leer wird, auf "all" zurück
  if (kindTab !== "all" && !availableKinds.some((g) => g.id === kindTab)) {
    queueMicrotask(() => setKindTab("all"));
  }

  // Label-Karten: Counts pro Label + heute schon erledigte rausfiltern
  const systemLabelIdSet = useMemo(
    () => new Set(labels.filter(isSystemLabel).map((l) => l.id)),
    [labels],
  );
  // Im Labels-Tab sichtbare Labels = System-Labels OHNE "✅ Upgrade bekommen" (terminal)
  const visibleLabelIdSet = useMemo(
    () => new Set(labels.filter((l) => isSystemLabel(l) && !isUpgradeReceivedLabel(l)).map((l) => l.id)),
    [labels],
  );
  const labelCountsByLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of labelCards) {
      if (!visibleLabelIdSet.has(c.label.id)) continue;
      if (states[c.todoKey]?.status === "done") continue;
      m.set(c.label.id, (m.get(c.label.id) ?? 0) + 1);
    }
    return m;
  }, [labelCards, states, visibleLabelIdSet]);

  const visibleLabelCards = useMemo(
    () => labelCards.filter((c) => visibleLabelIdSet.has(c.label.id) && selectedLabelIds.has(c.label.id)),
    [labelCards, selectedLabelIds, visibleLabelIdSet],
  );
  const labelDoneKeys = useMemo(() => {
    const s = new Set<string>();
    for (const c of labelCards) if (states[c.todoKey]?.status === "done") s.add(c.todoKey);
    return s;
  }, [labelCards, states]);

  const totalLabelOpenCount = useMemo(() => {
    let n = 0;
    for (const c of labelCards) {
      if (!visibleLabelIdSet.has(c.label.id)) continue;
      if (!selectedLabelIds.has(c.label.id)) continue;
      if (states[c.todoKey]?.status === "done") continue;
      n += 1;
    }
    return n;
  }, [labelCards, selectedLabelIds, states, visibleLabelIdSet]);


  const onboardingCount = useMemo(
    () => onboardingGroups.reduce((s, g) => s + g.items.length, 0),
    [onboardingGroups],
  );

  const statusOptions: { id: StatusMode; label: string; count: number }[] = [
    { id: "open", label: "Offen", count: filtered.primary.length + filtered.watchlist.length },
    { id: "wins", label: "Wins", count: filtered.wins.length },
    { id: "done", label: "Erledigt", count: filtered.done.length },
  ];

  // Nur "Erledigt" ist readonly — Wins können wie normale Aktionen abgehakt werden
  const isReadonly = status === "done";

  // Ambient Filter-Tint — gibt jeder Filter-Auswahl eine eigene Stimmungsfarbe
  const activeTint = (() => {
    if (status === "wins")  return { key: "wins",    color: "163,230,53",  intensity: 0.14 }; // Lime → Dopamin
    if (status === "done")  return { key: "done",    color: "148,163,184", intensity: 0.05 }; // Slate → ruhig
    if (extraFilter === "onboarding") return { key: "onb", color: "52,211,153", intensity: 0.11 };
    if (extraFilter === "labels")     return { key: "lbl", color: "251,191,36", intensity: 0.10 };
    if (kindTab !== "all") {
      const map: Partial<Record<ActionSourceKind, string>> = {
        verzug: "248,113,113", recovery: "251,146,60", wakeup: "52,211,153",
        swap: "34,211,238",   phase: "56,189,248",    revenue: "52,211,153",
        activity: "45,212,191", model: "232,121,249", slot: "129,140,248",
        positive: "163,230,53",
      };
      return { key: kindTab, color: map[kindTab] ?? "255,255,255", intensity: 0.11 };
    }
    return { key: "open", color: "255,255,255", intensity: 0.015 };
  })();


  return (
    <>
      {/* Ambient Filter-Tint Layer — wechselt smooth zwischen Stimmungen */}
      <AnimatePresence mode="sync">
        <motion.div
          key={activeTint.key}
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 -z-10 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 90% 55% at 50% 0%, rgba(${activeTint.color}, ${activeTint.intensity}) 0%, rgba(${activeTint.color}, ${activeTint.intensity * 0.45}) 35%, transparent 70%)`,
          }}
        />
      </AnimatePresence>
      <AnimatePresence mode="wait">
        <motion.div
          key={platform}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-3xl mx-auto space-y-6 pb-32"
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








          {/* Content */}
          {loading ? (
            <div className="text-center py-12 text-white/25 text-xs font-light tracking-wide">
              Bündele Tagesaufgaben …
            </div>
          ) : extraFilter === "onboarding" ? (
            <OnboardingList
              groups={onboardingGroups}
              allLabels={labels}
              platform={platform}
              onChatterClick={(name) => setSelectedChatter({ name, compareWith: null })}
              onAssigned={reloadLabelData}
            />
          ) : extraFilter === "labels" ? (
            <LabelCardList
              cards={visibleLabelCards}
              doneKeys={labelDoneKeys}
              platform={platform}
              readonly={isReadonly}
              onChatterClick={(name) => setSelectedChatter({ name, compareWith: null })}
              onComplete={async (key) => {
                const prev = { ...states };
                setStates({ ...prev, [key]: { status: "done", snoozed_until: null } });
                try {
                  await setTodoStatus(platform, key, "done", null);
                } catch {
                  setStates(prev);
                  throw new Error("save failed");
                }
              }}
              onLabelRemoved={reloadLabelData}
            />
          ) : visibleList.length === 0 ? (
            <EmptyState status={status} hasAnyOpen={filtered.primary.length + filtered.watchlist.length > 0} />
          ) : (

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={kindTab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: "easeOut" }}
              >
                {kindTab === "all" ? (
                  <div className="space-y-5">
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
                  </div>
                ) : (
                  <div className="space-y-3">
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
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          )}

            </>
          )}

          {/* Spacer damit die letzte Karte nicht hinter der Bottom-Bar verschwindet */}
          <div aria-hidden className="h-20" />
        </motion.div>
      </AnimatePresence>

      {/* Bottom-Nav: Kategorie-Filter — via Portal an Body, garantiert viewport-fixed (premium mobile feel) */}
      {!loading && (availableKinds.length > 0 || kindTab !== "all" || onboardingCount > 0 || labels.length > 0) && createPortal(
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          className="fixed bottom-0 right-0 z-40 pointer-events-none overflow-visible bg-background/92 backdrop-blur-2xl sm:bg-transparent sm:backdrop-blur-0"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)", left: `var(--today-sidebar-offset, 0px)` }}
        >
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 bg-background/92 sm:hidden"
            style={{ height: "max(env(safe-area-inset-bottom), 0px)", transform: "translateY(100%)" }}
          />
          <div className="pointer-events-auto relative mx-auto w-fit max-w-3xl px-3 pb-3 pt-2 sm:px-0 sm:pb-6">

            <div className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-background/70 backdrop-blur-2xl shadow-[0_16px_48px_-20px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.025)_inset]">
              <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] bg-card/20" />
              <div
                className="relative flex items-center gap-1.5 overflow-x-auto overscroll-x-contain px-3 py-2.5 scrollbar-none snap-x snap-proximity scroll-px-3 scroll-smooth [-webkit-overflow-scrolling:touch] [scroll-behavior:smooth]"
                style={{ WebkitMaskImage: "linear-gradient(to right, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%)", maskImage: "linear-gradient(to right, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%)" }}
              >
                {statusOptions.map((o) => {
                  const active = status === o.id;
                  return (
                    <button
                      key={o.id}
                      onClick={() => {
                        setStatus(o.id);
                        setKindTab("all");
                        setExtraFilter("none");
                      }}

                      className={cn(
                        "snap-start shrink-0 px-3.5 py-1.5 rounded-full text-[10.5px] font-semibold uppercase tracking-wider transition-all border flex items-center gap-1.5",
                        active
                          ? "bg-white/[0.09] border-white/20 text-foreground shadow-[0_0_18px_-6px_rgba(255,255,255,0.25)]"
                          : "bg-white/[0.02] border-white/[0.06] text-white/45 hover:text-white/80 hover:border-white/[0.12]",
                      )}
                    >
                      {o.label}
                      <span className={cn("tabular-nums text-[10px]", active ? "text-white/70" : "text-white/30")}>
                        {o.count}
                      </span>
                    </button>
                  );
                })}
                <div className="shrink-0 h-5 w-px bg-white/10 mx-1" />
                <button
                  onClick={() => { setExtraFilter("none"); setKindTab("all"); }}
                  className={cn(
                    "snap-start shrink-0 px-3.5 py-1.5 rounded-full text-[10.5px] font-semibold uppercase tracking-wider transition-all border flex items-center gap-1.5",
                    kindTab === "all" && extraFilter === "none"
                      ? "bg-white/[0.09] border-white/20 text-foreground shadow-[0_0_18px_-6px_rgba(255,255,255,0.25)]"
                      : "bg-white/[0.02] border-white/[0.06] text-white/45 hover:text-white/80 hover:border-white/[0.12]",
                  )}
                >
                  Alle
                  <span className={cn("tabular-nums text-[10px]", kindTab === "all" && extraFilter === "none" ? "text-white/70" : "text-white/30")}>
                    {statusList.length}
                  </span>
                </button>
                {onboardingCount > 0 && (
                  <button
                    onClick={() => { setExtraFilter("onboarding"); setKindTab("all"); }}
                    className={cn(
                      "snap-start shrink-0 px-3.5 py-1.5 rounded-full text-[10.5px] font-semibold uppercase tracking-wider transition-all border flex items-center gap-1.5",
                      extraFilter === "onboarding"
                        ? "bg-emerald-500/[0.12] border-emerald-400/30 text-emerald-100 shadow-[0_0_18px_-6px_rgba(52,211,153,0.4)]"
                        : "bg-white/[0.02] border-white/[0.06] text-white/45 hover:text-white/80 hover:border-white/[0.12]",
                    )}
                  >
                    <Sprout className={cn("h-3 w-3", extraFilter === "onboarding" ? "text-emerald-300" : "text-white/40")} />
                    Onboarding
                    <span className={cn("tabular-nums text-[10px]", extraFilter === "onboarding" ? "text-emerald-200/85" : "text-white/30")}>
                      {onboardingCount}
                    </span>
                  </button>
                )}
                {labels.length > 0 && (
                  <button
                    onClick={() => {
                      if (extraFilter === "labels") {
                        setLabelFilterOpen(true);
                      } else {
                        setExtraFilter("labels");
                        setKindTab("all");
                        // Beim ersten Aktivieren: alle Labels markieren falls noch keine Auswahl
                        if (selectedLabelIds.size === 0) {
                          setSelectedLabelIds(new Set(labels.filter((l) => isSystemLabel(l) && !isUpgradeReceivedLabel(l)).map((l) => l.id)));
                        }
                      }
                    }}
                    className={cn(
                      "snap-start shrink-0 px-3.5 py-1.5 rounded-full text-[10.5px] font-semibold uppercase tracking-wider transition-all border flex items-center gap-1.5",
                      extraFilter === "labels"
                        ? "bg-white/[0.09] border-white/20 text-foreground shadow-[0_0_18px_-6px_rgba(255,255,255,0.25)]"
                        : "bg-white/[0.02] border-white/[0.06] text-white/45 hover:text-white/80 hover:border-white/[0.12]",
                    )}
                  >
                    <Tag className={cn("h-3 w-3", extraFilter === "labels" ? "text-amber-200" : "text-white/40")} />
                    Labels
                    <span className={cn("tabular-nums text-[10px]", extraFilter === "labels" ? "text-white/70" : "text-white/30")}>
                      {totalLabelOpenCount}
                    </span>
                  </button>
                )}

                {availableKinds.map((g) => {
                  const Icon = g.icon;
                  const active = kindTab === g.id;
                  return (
                    <button
                      key={g.id}
                      onClick={() => { setExtraFilter("none"); setKindTab(g.id); }}
                      className={cn(
                        "snap-start shrink-0 px-3.5 py-1.5 rounded-full text-[10.5px] font-semibold uppercase tracking-wider transition-all border flex items-center gap-1.5",
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
        </motion.div>,
        document.body,
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

      <LabelFilterSheet
        open={labelFilterOpen}
        onOpenChange={setLabelFilterOpen}
        labels={labels}
        countsByLabel={labelCountsByLabel}
        selectedIds={selectedLabelIds}
        onToggle={(id) => {
          const next = new Set(selectedLabelIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          setSelectedLabelIds(next);
        }}
        onSelectAll={() => setSelectedLabelIds(new Set(labels.filter((l) => isSystemLabel(l) && !isUpgradeReceivedLabel(l)).map((l) => l.id)))}
        onClearAll={() => setSelectedLabelIds(new Set())}
      />
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
