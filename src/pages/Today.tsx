import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Eye, EyeOff, Sparkles, Flame, AlertTriangle, ArrowLeftRight, LifeBuoy, Shuffle, Clock, TrendingUp, TrendingDown, Activity, Star, CalendarClock, ThumbsUp, BellRing, Sprout, Tag, Megaphone, CalendarDays, ChevronDown, Rocket, Archive, RotateCcw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

import { cn } from "@/lib/utils";
import { usePlatform } from "@/contexts/PlatformContext";
import PersonActionCard from "@/components/PersonActionCard";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import ModelPerformanceSlideOver from "@/components/ModelPerformanceSlideOver";
import ModelTrackingView from "@/components/today/ModelTrackingView";
import OnboardingList from "@/components/today/OnboardingList";
import LabelCardList from "@/components/today/LabelCardList";
import LabelFilterSheet from "@/components/today/LabelFilterSheet";
import PushSection from "@/components/today/PushSection";
import CompareTray from "@/components/today/CompareTray";

import { useSidebar } from "@/components/ui/sidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useDragScroll } from "@/hooks/use-drag-scroll";
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
import { supabase } from "@/integrations/supabase/client";
import {
  fetchHiddenUpgrades,
  hideUpgradeChatter,
  unhideUpgradeChatter,
  hiddenChatterKey,
  onHiddenUpgradesUpdated,
  type HiddenUpgradeEntry,
} from "@/lib/hidden-upgrades";

export type VerzugBreakdownEntry = { account: string; openChats: number; delayDays: number };


type StatusMode = "open" | "wins" | "onboarding" | "done";
type ExtraFilter = "none" | "onboarding" | "labels" | "push";
type KindTab = "all" | ActionSourceKind;
type TopTab = "actions" | "tracking";

const LABEL_FILTER_STORAGE_KEY = "today.activeLabelFilters";
const SWAP_RENDER_BATCH = 8;



const KIND_DEFS: { id: ActionSourceKind; label: string; icon: typeof Flame; accent: string; dot: string }[] = [
  { id: "verzug",   label: "Verzug",         icon: AlertTriangle,  accent: "text-red-300",      dot: "bg-red-400/80" },
  { id: "recovery", label: "Recovery",       icon: LifeBuoy,       accent: "text-orange-300",   dot: "bg-orange-400/80" },
  // { id: "wakeup",   label: "Wieder aktiv",   icon: BellRing,       accent: "text-emerald-300",  dot: "bg-emerald-400/80" }, // entfernt auf Wunsch
  { id: "swap",     label: "Account-Tausch", icon: ArrowLeftRight, accent: "text-cyan-300",     dot: "bg-cyan-400/80" },
  { id: "upgrade",  label: "Upgrade-Kandidaten", icon: Rocket,    accent: "text-emerald-300",  dot: "bg-emerald-400/80" },
  { id: "downgrade", label: "Downgrade-Kandidaten", icon: TrendingDown, accent: "text-red-300", dot: "bg-red-400/80" },
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

/** Liest die "ältester Chat XT"-Tage aus einem Verzug-Signal. */
function getVerzugDays(a: UnifiedAction): number | null {
  for (const s of a.signals) {
    if (s.kind !== "verzug") continue;
    const m = s.title.match(/(\d+)\s*T/i) || s.why.match(/ältester Chat\s+(\d+)\s*T/i);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function normalizeBreakdownKey(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ");
}

function splitAccounts(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
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
  const [compareUpDown, setCompareUpDown] = useState(false);
  const trayStorageKey = `today.compareTray.${platform}`;
  const [trayIds, setTrayIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(trayStorageKey);
      setTrayIds(raw ? new Set(JSON.parse(raw)) : new Set());
    } catch {
      setTrayIds(new Set());
    }
  }, [trayStorageKey]);
  const persistTray = (next: Set<string>) => {
    setTrayIds(next);
    try {
      localStorage.setItem(trayStorageKey, JSON.stringify([...next]));
    } catch {
      // ignore
    }
  };

  // Dauerhaft ausgeblendete Upgrade-Kandidaten (Chatter ohne realistisches Upgrade-Potenzial)
  const [hiddenUpgrades, setHiddenUpgrades] = useState<HiddenUpgradeEntry[]>([]);
  const [showHiddenPanel, setShowHiddenPanel] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const rows = await fetchHiddenUpgrades(platform);
      if (!cancelled) setHiddenUpgrades(rows);
    };
    load();
    const off = onHiddenUpgradesUpdated(load);
    return () => { cancelled = true; off(); };
  }, [platform]);
  const hiddenUpgradeKeys = useMemo(
    () => new Set(hiddenUpgrades.map((h) => h.chatterKey)),
    [hiddenUpgrades],
  );

  const [verzugDayFilter, setVerzugDayFilter] = useState<Set<number>>(new Set());
  const [extraFilter, setExtraFilter] = useState<ExtraFilter>("none");
  const [pendingFeedback, setPendingFeedback] = useState<ActionOutcomeRow[]>([]);
  const [recap, setRecap] = useState<WeekRecap | null>(null);
  const [topTab, setTopTab] = useState<TopTab>("actions");
  const [swapRenderCount, setSwapRenderCount] = useState(SWAP_RENDER_BATCH);
  const { ref: filterScrollRef } = useDragScroll<HTMLDivElement>({ wheel: false });

  // Labels + Onboarding
  const [labels, setLabels] = useState<ChatterLabel[]>([]);
  const [assignments, setAssignments] = useState<LabelAssignment[]>([]);
  const [onboardingGroups, setOnboardingGroups] = useState<import("@/lib/onboarding-filter").OnboardingGroup[]>([]);
  const [labelCards, setLabelCards] = useState<import("@/lib/label-tasks").LabelCard[]>([]);
  const [labelFilterOpen, setLabelFilterOpen] = useState(false);
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(LABEL_FILTER_STORAGE_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch {
      // ignore corrupted local filter cache
    }
    return new Set();
  });
  const [labelDataNonce, setLabelDataNonce] = useState(0);
  const reloadLabelData = () => setLabelDataNonce((n) => n + 1);

  const [verzugBreakdown, setVerzugBreakdown] = useState<Map<string, VerzugBreakdownEntry[]>>(new Map());

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

  // Verzug-Model-Breakdown: Account-Liste aus dem neuesten Report, Zahlen aus Live.
  useEffect(() => {
    if (!data) return;
    const all: UnifiedAction[] = [...(data.primary || []), ...(data.watchlist || []), ...(data.wins || [])];
    const chatterNames: string[] = Array.from(
      new Set(
        all
          .filter((a) => a.primaryKind === "verzug" && a.chatterName)
          .map((a) => a.chatterName as string),
      ),
    );
    if (chatterNames.length === 0) {
      setVerzugBreakdown(new Map());
      return;
    }

    let cancel = false;
    (async () => {
      try {
        const today = new Date().toISOString().split("T")[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
        const targetKeys = new Set(chatterNames.map(normalizeBreakdownKey));

        const [historyRes, liveRes] = await Promise.all([
          supabase
            .from("chatter_history")
            .select("chatter_name, account, open_chats, response_delay_days, analysis_date, revenue_today")
            .ilike("platform", platform)
            .order("analysis_date", { ascending: false })
            .limit(5000),
          supabase
            .from("chatter_history_live")
            .select("chatter_name, unread_chats, oldest_chat, date, updated_at")
            .ilike("platform", platform)
            .gte("date", yesterday),
        ]);
        if (cancel || historyRes.error || liveRes.error) return;

        const rows = ((historyRes.data ?? []) as any[]).filter((r) =>
          targetKeys.has(normalizeBreakdownKey(r.chatter_name)),
        );
        const liveRows = ((liveRes.data ?? []) as any[]).filter((r) =>
          targetKeys.has(normalizeBreakdownKey(r.chatter_name)),
        );

        type LiveAgg = { unread: number; oldest: number; date: string; updatedAt: string };
        const newestLiveDateByChatter = new Map<string, string>();
        for (const r of liveRows) {
          const key = normalizeBreakdownKey(r.chatter_name);
          const d = (r.date || "") as string;
          if (!key || !d) continue;
          const prev = newestLiveDateByChatter.get(key);
          if (!prev || d > prev) newestLiveDateByChatter.set(key, d);
        }
        const liveByChatter = new Map<string, LiveAgg>();
        for (const r of liveRows) {
          const key = normalizeBreakdownKey(r.chatter_name);
          const d = (r.date || "") as string;
          if (!key || !d || d !== newestLiveDateByChatter.get(key)) continue;
          const cur = liveByChatter.get(key) ?? { unread: 0, oldest: 0, date: d, updatedAt: "" };
          cur.unread += Number(r.unread_chats) || 0;
          cur.oldest = Math.max(cur.oldest, Number(r.oldest_chat) || 0);
          if ((r.updated_at ?? "") > cur.updatedAt) cur.updatedAt = r.updated_at ?? "";
          liveByChatter.set(key, cur);
        }

        // Nur der neueste analysis_date pro Chatter zählt für die Account-Zuordnung.
        const latestDateByChatter = new Map<string, string>();
        for (const r of rows) {
          const name = normalizeBreakdownKey(r.chatter_name);
          const d = (r.analysis_date || "") as string;
          if (!name || !d) continue;
          const prev = latestDateByChatter.get(name);
          if (!prev || d > prev) latestDateByChatter.set(name, d);
        }

        type AccountSnapshot = { account: string; reportOpen: number; reportDelay: number };
        const accountsByChatter = new Map<string, Map<string, AccountSnapshot>>();
        const displayNameByKey = new Map<string, string>();
        for (const r of rows) {
          const nameKey = normalizeBreakdownKey(r.chatter_name);
          const displayName = (r.chatter_name || "").trim();
          const accounts = splitAccounts(r.account);
          if (!nameKey || accounts.length === 0) continue;
          if ((r.analysis_date || "") !== latestDateByChatter.get(nameKey)) continue;
          if (displayName && !displayNameByKey.has(nameKey)) displayNameByKey.set(nameKey, displayName);

          const rev = Number(r.revenue_today) || 0;
          const reportDelay = rev > 0 ? 0 : Number(r.response_delay_days) || 0;
          const reportOpen = (Number(r.open_chats) || 0) / accounts.length;
          const byAccount = accountsByChatter.get(nameKey) ?? new Map<string, AccountSnapshot>();
          for (const account of accounts) {
            const accountKey = normalizeBreakdownKey(account);
            const cur = byAccount.get(accountKey) ?? { account, reportOpen: 0, reportDelay: 0 };
            cur.reportOpen += reportOpen;
            cur.reportDelay = Math.max(cur.reportDelay, reportDelay);
            byAccount.set(accountKey, cur);
          }
          accountsByChatter.set(nameKey, byAccount);
        }

        const map = new Map<string, VerzugBreakdownEntry[]>();
        for (const [nameKey, byAccount] of accountsByChatter) {
          const accounts = [...byAccount.values()];
          const live = liveByChatter.get(nameKey);
          const liveUnread = Math.max(0, Math.round(live?.unread ?? 0));
          const liveDelay = live && live.date === today ? Math.max(0, Math.round(live.oldest)) : 0;

          let liveCarrierKey: string | null = null;
          const positiveAccounts = accounts.filter((a) => a.reportOpen > 0);
          if (accounts.length === 1) {
            liveCarrierKey = normalizeBreakdownKey(accounts[0].account);
          } else if (positiveAccounts.length === 1) {
            liveCarrierKey = normalizeBreakdownKey(positiveAccounts[0].account);
          } else if (liveUnread > 0 && accounts.length > 0) {
            const strongest = [...accounts].sort(
              (a, b) => b.reportDelay - a.reportDelay || b.reportOpen - a.reportOpen || a.account.localeCompare(b.account),
            )[0];
            liveCarrierKey = normalizeBreakdownKey(strongest.account);
          }

          const arr = accounts.map((account) => {
            const accountKey = normalizeBreakdownKey(account.account);
            const carriesLive = accountKey === liveCarrierKey;
            return {
              account: account.account,
              openChats: carriesLive ? liveUnread : 0,
              delayDays: carriesLive && liveUnread > 0 ? liveDelay : 0,
            };
          });

          const displayName = displayNameByKey.get(nameKey) ?? chatterNames.find((n) => normalizeBreakdownKey(n) === nameKey) ?? nameKey;
          map.set(displayName, arr);
          for (const originalName of chatterNames) {
            if (normalizeBreakdownKey(originalName) === nameKey) map.set(originalName, arr);
          }
        }

        // Sortieren: Live-Problem oben, danach stabile Account-Reihenfolge.
        for (const [k, arr] of map) {
          arr.sort((a, b) => b.delayDays - a.delayDays || b.openChats - a.openChats);
          map.set(k, arr);
        }

        setVerzugBreakdown(map);
      } catch (e) {
        console.error("[Today/verzugBreakdown]", e);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [platform, data]);



  // localStorage sync für selectedLabelIds
  useEffect(() => {
    try {
      localStorage.setItem(LABEL_FILTER_STORAGE_KEY, JSON.stringify([...selectedLabelIds]));
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
    const isHidden = (a: UnifiedAction) => a.primaryKind === "wakeup"; // Wieder-aktiv komplett ausblenden


    for (const a of data.primary) {
      if (isHidden(a)) continue;
      const v = visibility(a);
      if (v === "open") open.push(a);
      else if (v === "done") done.push(a);
    }
    for (const a of data.watchlist) {
      if (isHidden(a)) continue;
      const v = visibility(a);
      if (v === "open") watch.push(a);
      else if (v === "done") done.push(a);
    }
    for (const a of data.wins) {
      if (isHidden(a)) continue;
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
        : status === "onboarding"
          ? []
          : filtered.done;

  // Verfügbare Kategorien für Tabs (nur welche mit count > 0)
  const availableKinds = groupByKind(statusList);
  const baseVisibleList = (
    kindTab === "all"
      ? statusList
      : statusList.filter((a) => a.primaryKind === kindTab)
  ).filter((a) => {
    // Dauerhaft ausgeblendete Chatter aus Upgrade-Kandidaten entfernen
    if (a.primaryKind !== "upgrade") return true;
    if (!a.chatterName) return true;
    return !hiddenUpgradeKeys.has(hiddenChatterKey(a.chatterName));
  });

  // Verzug-Tage-Filter: alle vorkommenden Tage mit Counts (sortiert: höchster Verzug zuerst)
  const verzugDayCounts = useMemo(() => {
    if (kindTab !== "verzug") return [] as { days: number; count: number }[];
    const m = new Map<number, number>();
    for (const a of baseVisibleList) {
      const d = getVerzugDays(a);
      if (d == null) continue;
      m.set(d, (m.get(d) ?? 0) + 1);
    }
    return [...m.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([days, count]) => ({ days, count }));
  }, [baseVisibleList, kindTab]);

  // Reset Tage-Filter wenn Tab wechselt oder gewählte Tage nicht mehr existieren
  useEffect(() => {
    if (kindTab !== "verzug") {
      if (verzugDayFilter.size > 0) setVerzugDayFilter(new Set());
      return;
    }
    const validDays = new Set(verzugDayCounts.map((d) => d.days));
    if (verzugDayFilter.size > 0 && ![...verzugDayFilter].every((d) => validDays.has(d))) {
      setVerzugDayFilter(new Set([...verzugDayFilter].filter((d) => validDays.has(d))));
    }
  }, [kindTab, verzugDayCounts, verzugDayFilter]);

  const visibleList =
    kindTab === "verzug" && verzugDayFilter.size > 0
      ? baseVisibleList.filter((a) => {
          const d = getVerzugDays(a);
          return d != null && verzugDayFilter.has(d);
        })
      : baseVisibleList;

  const isSwapTab = kindTab === "swap" && extraFilter === "none";
  const renderedVisibleList = isSwapTab ? visibleList.slice(0, swapRenderCount) : visibleList;
  const remainingSwapCount = isSwapTab ? Math.max(0, visibleList.length - renderedVisibleList.length) : 0;

  const isUpDownTab = kindTab === "upgrade" || kindTab === "downgrade";
  const upgradeListAll = useMemo(
    () => (isUpDownTab ? statusList.filter((a) => a.primaryKind === "upgrade") : []),
    [isUpDownTab, statusList],
  );
  const downgradeListAll = useMemo(
    () => (isUpDownTab ? statusList.filter((a) => a.primaryKind === "downgrade") : []),
    [isUpDownTab, statusList],
  );
  const upgradeList = useMemo(
    () => upgradeListAll.filter((a) => {
      if (trayIds.has(a.bundleKey)) return false;
      if (a.chatterName && hiddenUpgradeKeys.has(hiddenChatterKey(a.chatterName))) return false;
      return true;
    }),
    [upgradeListAll, trayIds, hiddenUpgradeKeys],
  );
  const downgradeList = useMemo(
    () => downgradeListAll
      .filter((a) => !trayIds.has(a.bundleKey))
      .sort((a, b) => {
        // Höchster Umsatzimpact oben, bei Gleichstand chronologisch (ältestes Muster zuerst)
        if (b.totalImpactEurPerWeek !== a.totalImpactEurPerWeek) {
          return b.totalImpactEurPerWeek - a.totalImpactEurPerWeek;
        }
        const da = a.downgradeSince ?? "9999-12-31";
        const db = b.downgradeSince ?? "9999-12-31";
        return da.localeCompare(db);
      }),
    [downgradeListAll, trayIds],
  );
  const trayItems = useMemo(
    () => [...upgradeListAll, ...downgradeListAll].filter((a) => trayIds.has(a.bundleKey)),
    [upgradeListAll, downgradeListAll, trayIds],
  );
  const upgradeImpact = useMemo(
    () => upgradeList.reduce((s, a) => s + a.totalImpactEurPerWeek, 0),
    [upgradeList],
  );
  const compareActive = compareUpDown && isUpDownTab;



  useEffect(() => {
    if (isSwapTab) setSwapRenderCount(SWAP_RENDER_BATCH);
  }, [isSwapTab, status, platform]);

  useEffect(() => {
    if (!isSwapTab || swapRenderCount >= visibleList.length) return;
    const id = window.setTimeout(() => {
      setSwapRenderCount((count) => Math.min(count + SWAP_RENDER_BATCH, visibleList.length));
    }, 90);
    return () => window.clearTimeout(id);
  }, [isSwapTab, swapRenderCount, visibleList.length]);

  // Falls aktiver Kind-Tab leer wird, auf "all" zurück (in Effect, nicht in Render)
  useEffect(() => {
    if (kindTab !== "all" && !availableKinds.some((g) => g.id === kindTab)) {
      setKindTab("all");
    }
  }, [kindTab, availableKinds]);


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
  useEffect(() => {
    if (labels.length === 0 || visibleLabelIdSet.size === 0) return;

    const selectedVisible = labels.filter((l) => visibleLabelIdSet.has(l.id) && selectedLabelIds.has(l.id));
    const visibleWithOpenCards = new Set(
      labelCards
        .filter((c) => visibleLabelIdSet.has(c.label.id) && states[c.todoKey]?.status !== "done")
        .map((c) => c.label.id),
    );
    const selectedHasOnlyUpgradeCards = selectedVisible.length > 0
      && selectedVisible.every((l) => l.label_name === "🟢 Upgrade" || l.label_name === "💛 Premium Upgrade")
      && [...visibleWithOpenCards].some((id) => !selectedLabelIds.has(id));

    // Auch zurücksetzen, wenn gespeicherte IDs nicht mehr zu aktuellen Labels gehören (stale Filter)
    const selectedHasAnyValidVisible = selectedVisible.length > 0;

    if (selectedLabelIds.size === 0 || selectedHasOnlyUpgradeCards || !selectedHasAnyValidVisible) {
      setSelectedLabelIds(new Set(visibleLabelIdSet));
    }
  }, [labelCards, labels, selectedLabelIds, states, visibleLabelIdSet]);
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
    ...(onboardingCount > 0 ? [{ id: "onboarding" as StatusMode, label: "Onboarding", count: onboardingCount }] : []),
    { id: "done", label: "Erledigt", count: filtered.done.length },
  ];

  // Nur "Erledigt" ist readonly — Wins können wie normale Aktionen abgehakt werden
  const isReadonly = status === "done";

  // Ambient Filter-Tint — gibt jeder Filter-Auswahl eine eigene Stimmungsfarbe
  const activeTint = (() => {
    if (status === "wins")  return { key: "wins",    color: "163,230,53",  intensity: 0.14 }; // Lime → Dopamin
    if (status === "onboarding") return { key: "onb-status", color: "52,211,153", intensity: 0.11 };
    if (status === "done")  return { key: "done",    color: "148,163,184", intensity: 0.05 }; // Slate → ruhig
    if (extraFilter === "push")       return { key: "push", color: "236,72,153",  intensity: 0.12 };
    if (extraFilter === "onboarding") return { key: "onb", color: "52,211,153", intensity: 0.11 };
    if (extraFilter === "labels")     return { key: "lbl", color: "251,191,36", intensity: 0.10 };
    if (kindTab !== "all") {
      const map: Partial<Record<ActionSourceKind, string>> = {
        verzug: "248,113,113", recovery: "251,146,60", wakeup: "52,211,153",
        swap: "34,211,238",   phase: "56,189,248",    revenue: "52,211,153",
        activity: "45,212,191", model: "232,121,249", slot: "129,140,248",
        upgrade: "52,211,153",
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
          ) : extraFilter === "push" ? (
            <PushSection
              platform={platform}
              onChatterClick={(name) => setSelectedChatter({ name, compareWith: null })}
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
          ) : baseVisibleList.length === 0 ? (
            <EmptyState status={status} hasAnyOpen={filtered.primary.length + filtered.watchlist.length > 0} />
          ) : (

            <ErrorBoundary>
            <AnimatePresence mode="sync" initial={false}>
              <motion.div
                key={kindTab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: "easeOut" }}
                className="space-y-3"
              >
                {kindTab === "verzug" && verzugDayCounts.length > 0 && (
                  <VerzugDayFilterCard
                    days={verzugDayCounts}
                    selected={verzugDayFilter}
                    onToggle={(d) => {
                      setVerzugDayFilter((prev) => {
                        const next = new Set(prev);
                        if (next.has(d)) next.delete(d);
                        else next.add(d);
                        return next;
                      });
                    }}
                    onClear={() => setVerzugDayFilter(new Set())}
                    totalCount={baseVisibleList.length}
                  />
                )}


                {isUpDownTab && (upgradeList.length > 0 || downgradeList.length > 0) && (
                  <div className="flex items-center gap-2">
                    {([
                      { id: "single" as const, label: "Einzeln" },
                      { id: "compare" as const, label: "Vergleich" },
                    ]).map((opt) => {
                      const active = (opt.id === "compare") === compareUpDown;
                      return (
                        <button
                          key={opt.id}
                          data-updown-toggle={opt.id}
                          onClick={() => setCompareUpDown(opt.id === "compare")}
                          className={cn(
                            "px-3 py-1.5 rounded-full text-[11px] font-light tracking-wide transition-all border",
                            active
                              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-200"
                              : "bg-white/[0.02] border-white/10 text-white/45 hover:text-white/70 hover:border-white/20",
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                    {compareActive && (
                      <span className="text-[10px] text-white/30 font-light tracking-wide ml-1">
                        {upgradeList.length} Upgrade · {downgradeList.length} Downgrade
                      </span>
                    )}
                  </div>
                )}

                {compareActive ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {([
                      { key: "upgrade" as const, label: "Upgrade", sublabel: "bereit für mehr", icon: Rocket, accent: "text-emerald-300", border: "border-emerald-500/20", bg: "bg-emerald-500/[0.03]", badge: "bg-emerald-500/15 border-emerald-400/25 text-emerald-200", items: upgradeList },
                      { key: "downgrade" as const, label: "Downgrade", sublabel: "Rückgang", icon: TrendingDown, accent: "text-red-300", border: "border-red-500/20", bg: "bg-red-500/[0.03]", badge: "bg-red-500/15 border-red-400/25 text-red-200", items: downgradeList },
                    ]).map((col) => {
                      const Icon = col.icon;
                      return (
                        <div
                          key={col.key}
                          className={cn("rounded-2xl border flex flex-col min-h-0 overflow-hidden", col.border, col.bg)}
                        >
                          <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.06] bg-white/[0.02]">
                            <div className="flex items-center gap-2.5">
                              <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg border bg-white/[0.04]", col.border, col.accent)}>
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="flex flex-col">
                                <span className={cn("text-[12px] font-semibold leading-none tracking-tight", col.accent)}>
                                  {col.label}
                                </span>
                                <span className="text-[10px] text-white/35 font-light leading-none mt-1">
                                  {col.sublabel}
                                </span>
                              </div>
                            </div>
                            <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium tabular-nums border", col.badge)}>
                              {col.items.length}
                            </span>
                          </div>
                          <div className="p-3 space-y-3 overflow-y-auto pr-1 max-h-[70vh]">
                            {col.items.length === 0 ? (
                              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-center text-[11px] text-white/40 font-light">
                                Keine Einträge
                              </div>
                            ) : (
                              col.items.map((a) => (
                                <div
                                  key={a.bundleKey}
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData("application/x-tray-bundlekey", a.bundleKey);
                                    e.dataTransfer.effectAllowed = "move";
                                  }}
                                  className="group relative cursor-grab active:cursor-grabbing"
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const next = new Set(trayIds);
                                      next.add(a.bundleKey);
                                      persistTray(next);
                                    }}
                                    title="In Ablage"
                                    className="absolute top-2 right-2 z-10 h-7 w-7 rounded-full flex items-center justify-center bg-background/70 border border-white/[0.08] text-white/50 hover:text-emerald-200 hover:border-emerald-400/40 hover:bg-emerald-500/15 opacity-0 group-hover:opacity-100 transition-all backdrop-blur-md"
                                    aria-label="In Ablage legen"
                                  >
                                    <Archive className="h-3.5 w-3.5" />
                                  </button>
                                  {col.key === "upgrade" && a.chatterName && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void hideUpgradeChatter(platform, a.chatterName!);
                                      }}
                                      title="Dauerhaft ausblenden (kein Upgrade möglich)"
                                      className="absolute top-2 right-11 z-10 h-7 w-7 rounded-full flex items-center justify-center bg-background/70 border border-white/[0.08] text-white/50 hover:text-amber-200 hover:border-amber-400/40 hover:bg-amber-500/15 opacity-0 group-hover:opacity-100 transition-all backdrop-blur-md"
                                      aria-label="Chatter dauerhaft ausblenden"
                                    >
                                      <EyeOff className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  <PersonActionCard
                                    action={a}
                                    onChatterClick={(name, compareWith) => setSelectedChatter({ name, compareWith: compareWith ?? null })}
                                    onModelClick={(name, chatter) => setSelectedModel({ name, chatter })}
                                    onAct={act}
                                    readonly={isReadonly}
                                    verzugBreakdown={a.chatterName ? verzugBreakdown.get(a.chatterName) : undefined}
                                  />

                                </div>
                              ))
                            )}

                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : kindTab === "all" ? (
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
                              verzugBreakdown={a.chatterName ? verzugBreakdown.get(a.chatterName) : undefined}
                            />
                          ))}

                        </div>
                      </div>
                    ))}
                  </div>
                ) : visibleList.length === 0 ? (
                  <div className="premium-card rounded-2xl p-6 text-center text-[12px] text-white/45 font-light">
                    Keine Einträge für die gewählten Verzugs-Tage.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {renderedVisibleList.map((a) => {
                      const isUpgrade = a.primaryKind === "upgrade" && a.chatterName;
                      const card = (
                        <PersonActionCard
                          action={a}
                          onChatterClick={(name, compareWith) => setSelectedChatter({ name, compareWith: compareWith ?? null })}
                          onModelClick={(name, chatter) => setSelectedModel({ name, chatter })}
                          onAct={act}
                          readonly={isReadonly}
                          verzugBreakdown={a.chatterName ? verzugBreakdown.get(a.chatterName) : undefined}
                        />
                      );
                      if (!isUpgrade) return <div key={a.bundleKey}>{card}</div>;
                      return (
                        <div key={a.bundleKey} className="group relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void hideUpgradeChatter(platform, a.chatterName!);
                            }}
                            title="Dauerhaft ausblenden (kein Upgrade möglich)"
                            className="absolute top-2 right-2 z-10 h-7 w-7 rounded-full flex items-center justify-center bg-background/70 border border-white/[0.08] text-white/50 hover:text-amber-200 hover:border-amber-400/40 hover:bg-amber-500/15 opacity-0 group-hover:opacity-100 transition-all backdrop-blur-md"
                            aria-label="Chatter dauerhaft ausblenden"
                          >
                            <EyeOff className="h-3.5 w-3.5" />
                          </button>
                          {card}
                        </div>
                      );
                    })}
                    {remainingSwapCount > 0 && (
                      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-center text-[11px] font-light text-white/35">
                        Lade weitere {remainingSwapCount} Account-Tausch-Vorschläge …
                      </div>
                    )}
                  </div>
                )}

                {/* Ausgeblendet-Panel: nur im Upgrade-Tab und nur wenn Einträge vorhanden */}
                {kindTab === "upgrade" && hiddenUpgrades.length > 0 && (
                  <div className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowHiddenPanel((v) => !v)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-white/50">
                          <EyeOff className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
                            Ausgeblendet
                          </span>
                          <span className="text-[10px] text-white/35 font-light leading-none mt-1">
                            Chatter ohne realistisches Upgrade — dauerhaft versteckt
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium tabular-nums bg-white/[0.05] border border-white/[0.08] text-white/60">
                          {hiddenUpgrades.length}
                        </span>
                        <ChevronDown className={cn("h-4 w-4 text-white/40 transition-transform", showHiddenPanel && "rotate-180")} />
                      </div>
                    </button>
                    {showHiddenPanel && (
                      <div className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
                        {hiddenUpgrades.map((h) => (
                          <div key={h.chatterKey} className="flex items-center justify-between px-4 py-2.5">
                            <span className="text-[13px] text-white/80 font-light">{h.originalName}</span>
                            <button
                              type="button"
                              onClick={() => void unhideUpgradeChatter(platform, h.chatterKey)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-medium tracking-wide border border-white/[0.08] bg-white/[0.03] text-white/60 hover:text-emerald-200 hover:border-emerald-400/40 hover:bg-emerald-500/10 transition-all"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Wieder einblenden
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
            </ErrorBoundary>
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
          <div className="pointer-events-auto relative mx-auto w-full max-w-3xl px-3 pb-3 pt-2 sm:px-0 sm:pb-6">

            <div className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-background/70 backdrop-blur-2xl shadow-[0_16px_48px_-20px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.025)_inset]">
              <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] bg-card/20" />
              <div
                ref={filterScrollRef}
                onWheel={(e) => {
                  const el = e.currentTarget;
                  if (el.scrollWidth <= el.clientWidth + 1) return;
                  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                    e.preventDefault();
                    el.scrollLeft += e.deltaY;
                  }
                }}
                className="relative flex items-center gap-1.5 overflow-x-auto overscroll-x-contain px-3 py-2.5 scrollbar-none snap-x snap-proximity scroll-px-3 cursor-grab [-webkit-overflow-scrolling:touch]"
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
                <button
                  onClick={() => { setExtraFilter("push"); setKindTab("all"); }}
                  className={cn(
                    "snap-start shrink-0 px-3.5 py-1.5 rounded-full text-[10.5px] font-semibold uppercase tracking-wider transition-all border flex items-center gap-1.5",
                    extraFilter === "push"
                      ? "bg-pink-500/[0.12] border-pink-400/30 text-pink-100 shadow-[0_0_18px_-6px_rgba(236,72,153,0.4)]"
                      : "bg-white/[0.02] border-white/[0.06] text-white/45 hover:text-white/80 hover:border-white/[0.12]",
                  )}
                >
                  <Megaphone className={cn("h-3 w-3", extraFilter === "push" ? "text-pink-300" : "text-white/40")} />
                  Push
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
                      onClick={() => {
                        setExtraFilter("none");
                        if (g.id === "swap") setSwapRenderCount(SWAP_RENDER_BATCH);
                        setKindTab(g.id);
                      }}
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

      {compareActive && (
        <CompareTray
          items={trayItems}
          onDropAction={(key) => {
            const next = new Set(trayIds);
            next.add(key);
            persistTray(next);
          }}
          onReturn={(a) => {
            const next = new Set(trayIds);
            next.delete(a.bundleKey);
            persistTray(next);
          }}
          onCheckOff={(a) => {
            act(a, "done");
            const next = new Set(trayIds);
            next.delete(a.bundleKey);
            persistTray(next);
          }}
          onCompare={(u, d) => {
            if (!u.chatterName || !d.chatterName) return;
            setSelectedChatter({ name: u.chatterName, compareWith: d.chatterName });
          }}
        />
      )}
    </>

  );
}





function VerzugDayFilterCard({
  days,
  selected,
  onToggle,
  onClear,
  totalCount,
}: {
  days: { days: number; count: number }[];
  selected: Set<number>;
  onToggle: (d: number) => void;
  onClear: () => void;
  totalCount: number;
}) {
  const selectedCount = selected.size
    ? days.filter((d) => selected.has(d.days)).reduce((s, d) => s + d.count, 0)
    : totalCount;

  const label = selected.size === 0
    ? `Alle Tage · ${totalCount}`
    : selected.size === 1
      ? `${[...selected][0]} ${[...selected][0] === 1 ? "Tag" : "Tage"} im Verzug · ${selectedCount}`
      : `${selected.size} Tage ausgewählt · ${selectedCount}`;

  return (
    <div className="premium-card rounded-2xl border border-red-500/15 bg-red-500/[0.025] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-red-500/10 border border-red-500/20 shrink-0">
            <CalendarDays className="h-3.5 w-3.5 text-red-300" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-red-300/80 font-semibold">
              Filter nach Verzugs-Tagen
            </p>
            <p className="text-[11px] text-white/45 font-light truncate">
              {selected.size === 0 ? "Alle Tage anzeigen" : "Mehrere Verzugs-Tage wählbar"}
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-red-400/25 bg-red-500/[0.06] text-[11px] font-light text-red-100/90 hover:bg-red-500/[0.10] hover:border-red-400/40 transition-colors"
              aria-label="Verzugs-Tage filtern"
            >
              <span className="tabular-nums">{label}</span>
              <ChevronDown className="h-3 w-3 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-64 bg-background/95 backdrop-blur-xl border-white/[0.08] max-h-[min(24rem,60vh)] overflow-y-auto"
          >
            <DropdownMenuLabel className="text-[10px] tracking-[0.24em] uppercase text-white/40 font-light">
              Verzugs-Tage
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-white/[0.05]" />
            <DropdownMenuItem
              onClick={onClear}
              onSelect={(e) => e.preventDefault()}
              className={cn(
                "flex items-center justify-between gap-3 py-2 cursor-pointer",
                selected.size === 0 ? "bg-white/[0.04]" : "",
              )}
            >
              <span className="text-[12px] font-light text-white/90">Alle Tage</span>
              <span className="text-[10px] tabular-nums text-white/40">{totalCount}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/[0.05]" />
            {days.map((d) => {
              const active = selected.has(d.days);
              return (
                <DropdownMenuItem
                  key={d.days}
                  onClick={() => onToggle(d.days)}
                  onSelect={(e) => e.preventDefault()}
                  className={cn(
                    "flex items-center justify-between gap-3 py-2 cursor-pointer",
                    active ? "bg-red-500/[0.08]" : "",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "h-4 w-4 rounded border flex items-center justify-center transition-colors",
                        active
                          ? "bg-red-500 border-red-500"
                          : "border-white/20 bg-transparent"
                      )}
                    >
                      {active && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[12px] font-light text-white/90">
                        {d.days} {d.days === 1 ? "Tag" : "Tage"} im Verzug
                      </span>
                      <span className="text-[10px] text-white/40 font-light">
                        Ältester offener Chat seit {d.days}T
                      </span>
                    </div>
                  </div>
                  <span className={cn("text-[10px] tabular-nums", active ? "text-red-200" : "text-white/40")}>
                    {d.count}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
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
