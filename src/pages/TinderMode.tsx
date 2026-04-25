import { useState, useEffect, useCallback, useMemo } from "react";
import { usePlatform } from "@/contexts/PlatformContext";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence, motion } from "framer-motion";
import SwipeCard, { type AccountLogin } from "@/components/SwipeCard";
import SwipeActionPanel from "@/components/SwipeActionPanel";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import SwapModeView from "@/components/SwapModeView";
import CompareModeView from "@/components/CompareModeView";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import type { SwapInput, SwapModelInfo } from "@/lib/swap-suggestions";
import { Check, X, ChevronUp, RotateCcw, Undo2, Tag, StickyNote, Send, Plus, AlertTriangle, Trash2, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from "@/components/ui/select";
import { toast } from "sonner";
import { loadModelPerformances, type ModelPerformance, type ModelInfo } from "@/lib/model-performance";
import { loadLastInputs, logManualInput, type LastInputInfo } from "@/lib/chatter-inputs";
import QuickInputPrompt from "@/components/QuickInputPrompt";
import InputHistorySheet from "@/components/InputHistorySheet";
import { mapToActionCategory } from "@/lib/action-categories";
import { getCategoryCriteria, SPECIAL_FILTER_CRITERIA } from "@/lib/category-criteria";
import { onChatterDataUpdated } from "@/lib/data-events";
import { loadBenchmarks, getChatterBenchmark, type ChatterBenchmark, type BenchmarkBundle } from "@/lib/peer-benchmarks";
import { ACCOUNT_TIERS, tierForFollowers, type AccountTierId } from "@/lib/account-tiers";
import { loadSwapTracking, formatDelta, deltaTone, tierDirectionLabel, type SwapTrackingEntry } from "@/lib/swap-tracking";
import { loadRecoveryHistory, computeRecoveryQueue, type RecoveryEntry } from "@/lib/recovery-queue";
import { Repeat } from "lucide-react";
import TimeRangeToggle from "@/components/TimeRangeToggle";
import {
  buildTimeRange,
  loadHistoryForRange,
  recategorizeByWindow,
  recategorizeByWindowV2,
  rangeDays,
  type TimeRange,
  type HistoryRow as RangeHistoryRow,
} from "@/lib/timerange-categorize";
import { getActionEmoji, type ActionCategoryName } from "@/lib/action-categories";
import { loadAlertThresholds, effectiveThresholds, type AlertThresholds } from "@/lib/alert-thresholds";
import type { CategoryDecision } from "@/lib/categorize-v2";
import { categorizeChatters } from "@/lib/categorize-v2";
import type { StabilizedDecision } from "@/lib/category-state";
import { stabilizeAndPersist } from "@/lib/category-state";

interface ChatterData {
  name: string;
  account?: string;
  kpis: Record<string, string>;
  recommendation?: string;
  categoryEmoji?: string;
  categoryName?: string;
  startDate?: string;
  history?: { analysis_date: string; revenue_today: number; mass_dms: number; open_chats: number; response_delay_days: number }[];
  modelPerf?: ModelPerformance;
  peerBm?: ChatterBenchmark;
  /** V2: Erklärbare Kategorie-Entscheidung (Reasons + Signals) */
  decision?: CategoryDecision | StabilizedDecision;
}

interface AnalysisCategory {
  emoji: string;
  categoryName: string;
  chatters: {
    name: string;
    startDate?: string;
    account?: string;
    kpis: Record<string, string>;
    recommendation?: string;
  }[];
}

interface AnalysisResult {
  categories: AnalysisCategory[];
}
// Normalize chatter name for comparison: "niklas_la" and "Niklas La" should match
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
}

function splitAccounts(accountValue?: string): string[] {
  return (accountValue || "")
    .split(",")
    .map((part) => part.toLowerCase().trim())
    .filter(Boolean);
}

function toTitleCase(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseLooseDate(dateStr?: string): Date | null {
  if (!dateStr) return null;

  const dmy = dateStr.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    let yearNum = parseInt(y, 10);
    if (yearNum < 100) yearNum += 2000;
    const result = new Date(Date.UTC(yearNum, parseInt(m, 10) - 1, parseInt(d, 10)));
    return Number.isNaN(result.getTime()) ? null : result;
  }

  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const result = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    return Number.isNaN(result.getTime()) ? null : result;
  }

  return null;
}

function mapToSwipeCategory(rawName: string): { emoji: string; name: string } {
  return mapToActionCategory(rawName);
}

// Category priority order for sequential navigation (strict, top-down)
const CATEGORY_PRIORITY = [
  "SOFORT EINGREIFEN",
  "COACHING NÖTIG",
  "PUSHEN",
  "BELOHNEN",
  "RE-ASSIGNEN",
  "BEOBACHTEN",
];

const PREFETCH_CARD_COUNT = 3;

export default function TinderMode() {
  const { platform } = usePlatform();
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    setIsDesktop(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  const [rawChatters, setRawChatters] = useState<ChatterData[]>([]);

  // Time-range selector for re-categorization
  const [timeRange, setTimeRangeState] = useState<TimeRange>(() => {
    try {
      const stored = localStorage.getItem("tinder.timeRange");
      if (stored) {
        const parsed = JSON.parse(stored) as TimeRange;
        if (parsed?.preset) {
          // Re-build to refresh from/to relative to today (except custom)
          if (parsed.preset === "custom") return parsed;
          return buildTimeRange(parsed.preset);
        }
      }
    } catch {}
    return buildTimeRange("today");
  });
  const setTimeRange = useCallback((r: TimeRange) => {
    setTimeRangeState(r);
    try { localStorage.setItem("tinder.timeRange", JSON.stringify(r)); } catch {}
  }, []);
  const [rangeHistory, setRangeHistory] = useState<RangeHistoryRow[]>([]);
  const [rangeHistoryKey, setRangeHistoryKey] = useState<string>("");
  const [rangeLoading, setRangeLoading] = useState(false);
  const [skippedNames, setSkippedNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [actionPanel, setActionPanel] = useState(false);
  const [slideOver, setSlideOver] = useState(false);
  const [labelPanel, setLabelPanel] = useState(false);
  const [notePanel, setNotePanel] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<AccountTierId | null>(null);
  const [selectedLabelFilter, setSelectedLabelFilter] = useState<string | null>(null);
  const [allLabelAssignments, setAllLabelAssignments] = useState<{ label_id: string; chatter_name: string }[]>([]);
  // alertChatterNames + alertsByChatter are derived below (DB for "today", window-aggregated otherwise)
  const [alertFilterActive, setAlertFilterActive] = useState(false);
  const [swapTrackingMap, setSwapTrackingMap] = useState<Map<string, SwapTrackingEntry>>(new Map());
  const [swapTrackFilterActive, setSwapTrackFilterActive] = useState(false);
  const [recoveryMap, setRecoveryMap] = useState<Map<string, RecoveryEntry>>(new Map());
  const [recoveryFilterActive, setRecoveryFilterActive] = useState(false);
  const [categoryDonePrompt, setCategoryDonePrompt] = useState<string | null>(null);
  const [checkedNames, setCheckedNames] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<string[]>([]);

  // Mode toggle: classic Swipe-Mode vs new Wechsel-Mode
  const [mode, setMode] = useState<"swipe" | "swap" | "compare">("swipe");
  const [compareSlideOverChatter, setCompareSlideOverChatter] = useState<string | null>(null);
  const [modelsList, setModelsList] = useState<SwapModelInfo[]>([]);
  const [benchmarkBundle, setBenchmarkBundle] = useState<BenchmarkBundle | null>(null);
  // V2 Decisions für heute (mit Hysterese persistiert).
  const [todayDecisions, setTodayDecisions] = useState<Map<string, StabilizedDecision>>(new Map());

  // Label state
  const [allLabels, setAllLabels] = useState<{ id: string; label_name: string; color: string }[]>([]);
  const [assignedLabelIds, setAssignedLabelIds] = useState<Set<string>>(new Set());
  const [newLabelName, setNewLabelName] = useState("");

  // Note state
  const [notes, setNotes] = useState<{ id: string; note_text: string; created_at: string }[]>([]);
  const [noteText, setNoteText] = useState("");

  // Input tracking
  const [inputsMap, setInputsMap] = useState<Map<string, LastInputInfo>>(new Map());
  const [historyChatter, setHistoryChatter] = useState<string | null>(null);
  const [quickPromptName, setQuickPromptName] = useState<string | null>(null);
  const [accountLoginsMap, setAccountLoginsMap] = useState<Map<string, AccountLogin[]>>(new Map());
  // First analysis_date per normalized chatter name (für "aktiv seit"-Filter im Compare-Mode)
  const [firstSeenByChatter, setFirstSeenByChatter] = useState<Map<string, string>>(new Map());
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);

  // Load all labels and assignments on mount for filter chips with counts
  useEffect(() => {
    Promise.all([
      supabase.from("chatter_labels").select("id, label_name, color").eq("platform", platform),
      supabase.from("chatter_label_assignments").select("label_id, chatter_name").eq("platform", platform),
    ]).then(([labelsRes, assignRes]) => {
      if (labelsRes.data) setAllLabels(labelsRes.data);
      if (assignRes.data) setAllLabelAssignments(assignRes.data);
    });
  }, [platform]);

  // Load active anomaly alerts for the active workspace (with messages) — DB-based, used for "today"
  const [dbAlertsByChatter, setDbAlertsByChatter] = useState<Map<string, { alert_type: string; severity: string; message: string }[]>>(new Map());
  const [dbAlertChatterNames, setDbAlertChatterNames] = useState<Set<string>>(new Set());
  useEffect(() => {
    const nowIso = new Date().toISOString();
    supabase
      .from("anomaly_alerts")
      .select("chatter_name, alert_type, severity, message, snoozed_until, status")
      .eq("platform", platform)
      .in("status", ["new", "seen", "snoozed"])
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
      .then(({ data }) => {
        const set = new Set<string>();
        const map = new Map<string, { alert_type: string; severity: string; message: string }[]>();
        (data || []).forEach((a: any) => {
          const key = normalizeName(a.chatter_name);
          set.add(key);
          const list = map.get(key) || [];
          list.push({ alert_type: a.alert_type, severity: a.severity, message: a.message });
          map.set(key, list);
        });
        setDbAlertChatterNames(set);
        setDbAlertsByChatter(map);
      });
  }, [platform]);

  // User-konfigurierbare Alert-Schwellen (aus localStorage)
  const [alertThresholds, setAlertThresholds] = useState<AlertThresholds>(() => loadAlertThresholds());
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AlertThresholds>).detail;
      if (detail) setAlertThresholds(detail);
    };
    window.addEventListener("alertThresholdsChanged", handler);
    window.addEventListener("storage", () => setAlertThresholds(loadAlertThresholds()));
    return () => {
      window.removeEventListener("alertThresholdsChanged", handler);
    };
  }, []);

  // Derive label filter set from allLabelAssignments
  const labelChatterNames = useMemo(() => {
    if (!selectedLabelFilter) return null;
    return new Set(
      allLabelAssignments
        .filter((a) => a.label_id === selectedLabelFilter)
        .map((a) => normalizeName(a.chatter_name))
    );
  }, [selectedLabelFilter, allLabelAssignments]);

  // Map: normalized chatter name → Set<labelId> (for compare-mode filter)
  const labelsByChatter = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const a of allLabelAssignments) {
      const key = normalizeName(a.chatter_name);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(a.label_id);
    }
    return map;
  }, [allLabelAssignments]);

  // Count chatters per label (only unchecked ones from current data)
  const labelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const chatterNorms = new Set(rawChatters.map((c) => normalizeName(c.name)));
    for (const a of allLabelAssignments) {
      if (chatterNorms.has(normalizeName(a.chatter_name))) {
        counts.set(a.label_id, (counts.get(a.label_id) || 0) + 1);
      }
    }
    return counts;
  }, [allLabelAssignments, rawChatters]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      // Parallel: report + today's checks
      const today = new Date().toISOString().split("T")[0];
      const [reportRes, checksRes] = await Promise.all([
        supabase
          .from("analysis_reports")
          .select("id, result_json")
          .eq("platform", platform)
          .not("result_json", "is", null)
          .order("analysis_date", { ascending: false })
          .limit(1)
          .single(),
        supabase
          .from("daily_chatter_checks")
          .select("chatter_name")
          .eq("platform", platform)
          .eq("check_date", today),
      ]);

      if (checksRes.data) {
        setCheckedNames(new Set(checksRes.data.map((c) => normalizeName(c.chatter_name))));
      }

      if (!reportRes.data?.result_json) {
        setRawChatters([]);
        setCurrentReportId(null);
        setLoading(false);
        return;
      }

      setCurrentReportId((reportRes.data as any).id ?? null);
      const result = reportRes.data.result_json as unknown as AnalysisResult;
      if (!result?.categories) {
        setRawChatters([]);
        setLoading(false);
        return;
      }

      const allChatters: ChatterData[] = [];
      for (const cat of result.categories) {
        const mapped = mapToSwipeCategory(cat.categoryName);
        for (const ch of cat.chatters) {
          allChatters.push({
            name: toTitleCase(ch.name),
            account: ch.account,
            kpis: ch.kpis,
            recommendation: ch.recommendation,
            categoryEmoji: mapped.emoji,
            categoryName: mapped.name,
            startDate: ch.startDate,
          });
        }
      }

      // Parallel: history + models
      const names = allChatters.map((c) => c.name);
      const [historyRes, modelsRes] = await Promise.all([
        supabase
          .from("chatter_history")
          .select("chatter_name, account, analysis_date, revenue_today, mass_dms, open_chats, response_delay_days")
          .eq("platform", platform)
          .in("chatter_name", names)
          .order("analysis_date", { ascending: true }),
        supabase
          .from("models")
          .select("model_name, follower_count, email, password")
          .eq("platform", platform),
      ]);

      if (historyRes.data) {
        const histMap = new Map<string, { analysis_date: string; revenue_today: number; mass_dms: number; open_chats: number; response_delay_days: number; account?: string }[]>();
        const firstSeenMap = new Map<string, string>();
        for (const h of historyRes.data) {
          if (!histMap.has(h.chatter_name)) histMap.set(h.chatter_name, []);
          histMap.get(h.chatter_name)!.push({
            analysis_date: h.analysis_date,
            revenue_today: Number(h.revenue_today) || 0,
            mass_dms: Number(h.mass_dms) || 0,
            open_chats: Number((h as any).open_chats) || 0,
            response_delay_days: Number(h.response_delay_days) || 0,
            account: (h as any).account ?? undefined,
          });
          // Da history asc sortiert ist, ist das erste Vorkommen das früheste
          const nKey = normalizeName(h.chatter_name);
          if (!firstSeenMap.has(nKey)) firstSeenMap.set(nKey, h.analysis_date);
        }
        for (const ch of allChatters) {
          ch.history = histMap.get(ch.name)?.slice(-7);
        }
        setFirstSeenByChatter(firstSeenMap);
      }


      // Build per-chatter account-login map (account name → email/password from models)
      if (historyRes.data && modelsRes.data) {
        const modelLookup = new Map<string, { email?: string | null; password?: string | null }>();
        for (const m of modelsRes.data as Array<{ model_name: string; email?: string | null; password?: string | null }>) {
          const key = (m.model_name || "").toLowerCase().trim();
          if (key) modelLookup.set(key, { email: m.email, password: m.password });
        }
        const acctsByChatter = new Map<string, Set<string>>();
        for (const h of historyRes.data as Array<{ chatter_name: string; account?: string | null }>) {
          const acc = (h.account || "").trim();
          if (!acc) continue;
          const key = normalizeName(h.chatter_name);
          if (!acctsByChatter.has(key)) acctsByChatter.set(key, new Set());
          acctsByChatter.get(key)!.add(acc);
        }
        // Also include the account from today's KPI data
        for (const ch of allChatters) {
          const acc = (ch.account || "").trim();
          if (!acc) continue;
          const key = normalizeName(ch.name);
          if (!acctsByChatter.has(key)) acctsByChatter.set(key, new Set());
          acctsByChatter.get(key)!.add(acc);
        }
        const loginMap = new Map<string, AccountLogin[]>();
        for (const [chKey, accSet] of acctsByChatter.entries()) {
          const logins: AccountLogin[] = [];
          for (const account of accSet) {
            const m = modelLookup.get(account.toLowerCase());
            if (m && (m.email || m.password)) {
              logins.push({ account, email: m.email, password: m.password });
            }
          }
          if (logins.length > 0) loginMap.set(chKey, logins);
        }
        setAccountLoginsMap(loginMap);
      }

      if (modelsRes.data && allChatters.length > 0) {
        setModelsList(modelsRes.data as SwapModelInfo[]);
        const perfs = await loadModelPerformances(
          platform,
          allChatters.map((c) => ({ name: c.name, account: c.account })),
          modelsRes.data as ModelInfo[]
        );
        for (const ch of allChatters) {
          if (perfs[ch.name]) ch.modelPerf = perfs[ch.name];
        }

        // Peer-Benchmarks: vollautomatisch aus History + Models
        try {
          const bundle = await loadBenchmarks(platform, 30);
          setBenchmarkBundle(bundle);
          const followerLookup = new Map<string, number>();
          for (const m of modelsRes.data) followerLookup.set((m.model_name || "").toLowerCase().trim(), m.follower_count || 0);
          for (const ch of allChatters) {
            const accountNames = splitAccounts(ch.account);
            if (accountNames.length === 0) continue;
            // Bei Mehrfach-Accounts: Follower aufsummieren, ersten Account als Label nutzen.
            const followers = accountNames.reduce((sum, name) => sum + (followerLookup.get(name) || 0), 0);
            const accLabel = accountNames.join(", ");
            const revKey = Object.keys(ch.kpis).find((k) => /umsatz|revenue/i.test(k));
            const revStr = revKey ? ch.kpis[revKey] : "0";
            const rev = parseFloat(revStr.replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
            ch.peerBm = getChatterBenchmark(bundle, accLabel, followers, rev);
          }
        } catch (err) {
          console.warn("Peer-benchmark load failed:", err);
        }
      }

      setRawChatters(allChatters);
      setUndoStack([]);
      setLoading(false);

      // Load last-input info per chatter (parallel, doesn't block UI)
      if (allChatters.length > 0) {
        loadLastInputs(platform, allChatters.map((c) => c.name)).then(setInputsMap);
      }
    };
    load();
    const off = onChatterDataUpdated(load);
    return () => { off(); };
  }, [platform]);

  // Swap-Tracking: Welche Chatter hatten kürzlich einen Account-Wechsel + waren vorher schon aktiv?
  useEffect(() => {
    let cancelled = false;
    loadSwapTracking(platform)
      .then((map) => {
        if (!cancelled) setSwapTrackingMap(map);
      })
      .catch((err) => console.warn("loadSwapTracking failed:", err));
    return () => { cancelled = true; };
  }, [platform]);

  // Recovery Queue: Chatter unter ihrem 30-Tage-Median (Umsatz-Hebel)
  useEffect(() => {
    let cancelled = false;
    loadRecoveryHistory(platform)
      .then((history) => {
        if (cancelled) return;
        const entries = computeRecoveryQueue(history);
        const map = new Map<string, RecoveryEntry>();
        for (const e of entries) map.set(normalizeName(e.chatterName), e);
        setRecoveryMap(map);
      })
      .catch((err) => console.warn("loadRecoveryQueue failed:", err));
    return () => { cancelled = true; };
  }, [platform]);

  // Refresh a single chatter's input info after a logged event
  const refreshInputForChatter = useCallback(async (chatterName: string) => {
    const fresh = await loadLastInputs(platform, [chatterName]);
    setInputsMap((prev) => {
      const next = new Map(prev);
      const key = normalizeName(chatterName);
      const info = fresh.get(key);
      if (info) next.set(key, info);
      return next;
    });
  }, [platform]);

  // Load history for the selected time-range (skip for "today" — uses original cats)
  useEffect(() => {
    if (timeRange.preset === "today") {
      setRangeHistory([]);
      setRangeHistoryKey("");
      return;
    }
    const key = `${platform}|${timeRange.from}|${timeRange.to}`;
    if (key === rangeHistoryKey) return;
    let cancelled = false;
    setRangeLoading(true);
    loadHistoryForRange(platform, timeRange.from, timeRange.to)
      .then((rows) => {
        if (cancelled) return;
        setRangeHistory(rows);
        setRangeHistoryKey(key);
      })
      .catch((err) => {
        console.warn("loadHistoryForRange failed:", err);
        if (!cancelled) {
          setRangeHistory([]);
          setRangeHistoryKey(key);
        }
      })
      .finally(() => {
        if (!cancelled) setRangeLoading(false);
      });
    return () => { cancelled = true; };
  }, [platform, timeRange.preset, timeRange.from, timeRange.to, rangeHistoryKey]);

  // V2 decisions for the selected window. Empty for "today" — heute kommt
  // die Kategorie aus dem Snapshot und wird unten via stabilizeAndPersist
  // (Hysterese, Punkt 10) zusätzlich geglättet.
  const recategorizedMap = useMemo(() => {
    if (timeRange.preset === "today") return new Map<string, CategoryDecision>();
    if (rangeHistory.length === 0 && rangeLoading) return new Map<string, CategoryDecision>();
    const onboardingStarts = new Map<string, string>();
    const todaysAccountByChatter = new Map<string, string>();
    const todaysFollowersByChatter = new Map<string, number>();
    const todaysRevenueByChatter = new Map<string, number>();
    for (const c of rawChatters) {
      const key = normalizeName(c.name);
      if (c.startDate) {
        const d = parseLooseDate(c.startDate);
        if (d) onboardingStarts.set(key, d.toISOString().split("T")[0]);
      }
      if (c.account) todaysAccountByChatter.set(key, c.account);
      // Follower aus modelPerf wenn vorhanden
      const followers = (c as any).modelPerf?.followerCount || 0;
      if (followers > 0) todaysFollowersByChatter.set(key, followers);
      const todayRev = Number(c.kpis?.["Tagesumsatz"]?.replace(/[^\d.-]/g, "")) || 0;
      todaysRevenueByChatter.set(key, todayRev);
    }
    return recategorizeByWindowV2(
      rawChatters.map((c) => c.name),
      rangeHistory,
      timeRange,
      {
        onboardingStarts,
        todaysAccountByChatter,
        todaysFollowersByChatter,
        todaysRevenueByChatter,
        benchmarks: benchmarkBundle,
      }
    );
  }, [rawChatters, rangeHistory, rangeLoading, timeRange, benchmarkBundle]);

  // Effective chatters list — applies window-based re-categorization unless "today".
  const chatters = useMemo<ChatterData[]>(() => {
    if (timeRange.preset === "today") {
      // Heute: Snapshot-Kategorie + ggf. v2-Decision aus todayDecisions (Hysterese)
      if (todayDecisions.size === 0) return rawChatters;
      return rawChatters.map((c) => {
        const dec = todayDecisions.get(normalizeName(c.name));
        if (!dec) return c;
        return {
          ...c,
          // Hysterese darf die Snapshot-Kategorie überschreiben (sanft):
          categoryName: dec.name,
          categoryEmoji: getActionEmoji(dec.name),
          decision: dec,
        };
      });
    }
    if (recategorizedMap.size === 0) return rawChatters;
    return rawChatters.map((c) => {
      const dec = recategorizedMap.get(normalizeName(c.name));
      if (!dec) return c;
      return {
        ...c,
        categoryName: dec.name,
        categoryEmoji: getActionEmoji(dec.name),
        decision: dec,
      };
    });
  }, [rawChatters, recategorizedMap, timeRange.preset, todayDecisions]);

  // Punkt 10 (Hysterese) + V2 Engine für „today": berechne v2 aus letzten 14 Tagen
  // History und persistiere den geglätteten State. Läuft nur im today-Mode.
  useEffect(() => {
    if (timeRange.preset !== "today") return;
    if (rawChatters.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const today = new Date();
        const from = new Date(today);
        from.setDate(from.getDate() - 13);
        const fromIso = from.toISOString().split("T")[0];
        const toIso = today.toISOString().split("T")[0];

        const history = await loadHistoryForRange(platform, fromIso, toIso);
        if (cancelled) return;

        const onboardingStarts = new Map<string, string>();
        const todaysAccountByChatter = new Map<string, string>();
        const todaysFollowersByChatter = new Map<string, number>();
        const todaysRevenueByChatter = new Map<string, number>();
        const displayNames = new Map<string, string>();
        for (const c of rawChatters) {
          const key = normalizeName(c.name);
          displayNames.set(key, c.name);
          if (c.startDate) {
            const d = parseLooseDate(c.startDate);
            if (d) onboardingStarts.set(key, d.toISOString().split("T")[0]);
          }
          if (c.account) todaysAccountByChatter.set(key, c.account);
          const followers = (c as any).modelPerf?.followerCount || 0;
          if (followers > 0) todaysFollowersByChatter.set(key, followers);
          const todayRev = Number(c.kpis?.["Tagesumsatz"]?.replace(/[^\d.-]/g, "")) || 0;
          todaysRevenueByChatter.set(key, todayRev);
        }

        const raw = categorizeChatters(
          rawChatters.map((c) => c.name),
          history,
          {
            onboardingStarts,
            todaysAccountByChatter,
            todaysFollowersByChatter,
            todaysRevenueByChatter,
            benchmarks: benchmarkBundle,
          }
        );
        const stabilized = await stabilizeAndPersist(platform, user.id, raw, displayNames);
        if (!cancelled) setTodayDecisions(stabilized);
      } catch (err) {
        console.warn("today decisions/hysteresis failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [rawChatters, platform, timeRange.preset, benchmarkBundle]);

  // Derived alerts: for "today" use DB alerts; for windows compute from rangeHistory aggregates.
  const { alertChatterNames, alertsByChatter } = useMemo(() => {
    if (timeRange.preset === "today") {
      return { alertChatterNames: dbAlertChatterNames, alertsByChatter: dbAlertsByChatter };
    }
    const set = new Set<string>();
    const map = new Map<string, { alert_type: string; severity: string; message: string }[]>();

    // Group history by normalized chatter name
    const byChatter = new Map<string, RangeHistoryRow[]>();
    for (const h of rangeHistory) {
      const key = normalizeName(h.chatter_name);
      if (!byChatter.has(key)) byChatter.set(key, []);
      byChatter.get(key)!.push(h);
    }

    const days = rangeDays(timeRange);

    // User-konfigurierbare Schwellen, an Fensterlänge angepasst (Floors capped auf days).
    const t = effectiveThresholds(alertThresholds, days);
    const zeroHighRate = t.zeroHighRate;
    const zeroMedRate = t.zeroMedRate;
    const zeroHighFloor = t.zeroHighFloor;
    const zeroMedFloor = t.zeroMedFloor;
    const delayMedDays = t.delayMedDays;
    const delayHighDays = t.delayHighDays;
    const trendMedPct = t.trendMedPct;
    const trendHighPct = t.trendHighPct;
    // Trend nur prüfen wenn wir genug Aktiv-Tage haben
    const minActiveForTrend = Math.max(3, Math.ceil(days * 0.3));

    for (const c of rawChatters) {
      const key = normalizeName(c.name);
      const rows = byChatter.get(key) || [];
      if (rows.length === 0) continue;
      // Relevanz-Filter: bei großen Fenstern muss der Chatter einen Mindestanteil
      // tatsächlich aktiv gewesen sein, sonst keine Alerts (vermeidet Rauschen bei
      // Chattern, die erst seit Kurzem im Roster sind).
      const minRowsForWindow = Math.max(2, Math.ceil(days * 0.3));
      if (rows.length < minRowsForWindow) continue;

      const revs = rows.map((r) => r.revenue_today);
      const sum = revs.reduce((a, b) => a + b, 0);
      const avgRev = sum / rows.length;
      const activeDays = rows.filter((r) => r.revenue_today > 0).length;
      const zeroDays = rows.length - activeDays;
      const zeroRate = zeroDays / rows.length;
      // Aktuelles (jüngstes) Response-Delay statt max — sonst hängt ein alter
      // Spike noch wochenlang als Alert nach.
      const sortedByDate = [...rows].sort((a, b) => a.analysis_date.localeCompare(b.analysis_date));
      const currentDelay = sortedByDate[sortedByDate.length - 1]?.response_delay_days || 0;

      // Trend: lineare Steigung über das Fenster
      let trend = 0;
      if (rows.length >= minActiveForTrend && avgRev > 0) {
        const n = rows.length;
        const meanX = (n - 1) / 2;
        let num = 0, den = 0;
        for (let i = 0; i < n; i++) {
          num += (i - meanX) * (revs[i] - avgRev);
          den += (i - meanX) ** 2;
        }
        const slope = den > 0 ? num / den : 0;
        trend = (slope * (n - 1)) / avgRev;
      }

      // Recent vs. baseline: zweite Hälfte ggü. erster Hälfte (nur bei ≥6 Rows sinnvoll)
      let recentDrop = 0;
      if (sortedByDate.length >= 6) {
        const mid = Math.floor(sortedByDate.length / 2);
        const firstAvg = sortedByDate.slice(0, mid).reduce((s, r) => s + r.revenue_today, 0) / mid;
        const secondAvg = sortedByDate.slice(mid).reduce((s, r) => s + r.revenue_today, 0) / (sortedByDate.length - mid);
        if (firstAvg > 0) recentDrop = (secondAvg - firstAvg) / firstAvg;
      }

      const alerts: { alert_type: string; severity: string; message: string }[] = [];

      // Null-Tage: BEIDE Bedingungen — relativer Anteil UND absoluter Floor
      if (zeroRate >= zeroHighRate && zeroDays >= zeroHighFloor) {
        alerts.push({
          alert_type: "zero_revenue_window",
          severity: "high",
          message: `${zeroDays} von ${rows.length} Tagen ohne Umsatz (${days}T)`,
        });
      } else if (zeroRate >= zeroMedRate && zeroDays >= zeroMedFloor) {
        alerts.push({
          alert_type: "frequent_zero_days",
          severity: "medium",
          message: `${zeroDays} von ${rows.length} Tagen ohne Umsatz (${days}T)`,
        });
      }

      // Response-Delay: aktueller Stand, nicht historisches Max
      if (currentDelay >= delayHighDays) {
        alerts.push({
          alert_type: "response_delay",
          severity: "high",
          message: `Aktuell ${currentDelay} Tage Antwortverzug`,
        });
      } else if (currentDelay >= delayMedDays) {
        alerts.push({
          alert_type: "response_delay",
          severity: "medium",
          message: `Aktuell ${currentDelay} Tage Antwortverzug`,
        });
      }

      // Trend-Drop: Slope ODER Recent-vs-Baseline. Mindest-Umsatz, sonst sind %-Werte Mist.
      if (avgRev >= 20) {
        if (trend <= trendMedPct) {
          alerts.push({
            alert_type: "revenue_drop",
            severity: trend <= trendHighPct ? "high" : "medium",
            message: `Umsatz-Trend ${Math.round(trend * 100)}% über ${days}T`,
          });
        } else if (recentDrop <= -0.4) {
          alerts.push({
            alert_type: "revenue_drop",
            severity: recentDrop <= -0.6 ? "high" : "medium",
            message: `Letzte Hälfte ${Math.round(recentDrop * 100)}% vs. Anfang`,
          });
        }
      }

      if (alerts.length > 0) {
        set.add(key);
        map.set(key, alerts);
      }
    }

    return { alertChatterNames: set, alertsByChatter: map };
  }, [timeRange, rangeHistory, rawChatters, dbAlertChatterNames, dbAlertsByChatter, alertThresholds]);


  // Map: normalized chatter name → tierIds based on all matched account follower tiers
  const tierIdsByChatter = useMemo(() => {
    const followerMap = new Map<string, number>();
    for (const m of modelsList) {
      followerMap.set((m.model_name || "").toLowerCase().trim(), m.follower_count || 0);
    }
    const map = new Map<string, AccountTierId[]>();
    for (const c of chatters) {
      const accountNames = splitAccounts(c.account);
      if (accountNames.length === 0) continue;

      const tierIds = Array.from(new Set(
        accountNames
          .map((accountName) => {
            const followers = followerMap.get(accountName);
            if (followers == null) return null;
            return tierForFollowers(followers)?.id ?? null;
          })
          .filter((tierId): tierId is AccountTierId => tierId !== null)
      ));

      if (tierIds.length > 0) map.set(normalizeName(c.name), tierIds);
    }
    return map;
  }, [chatters, modelsList]);

  // Map: normalized chatter name → Summe der Follower aller zugeordneten Accounts
  const followersByChatter = useMemo(() => {
    const followerMap = new Map<string, number>();
    for (const m of modelsList) {
      followerMap.set((m.model_name || "").toLowerCase().trim(), m.follower_count || 0);
    }
    const map = new Map<string, number>();
    for (const c of chatters) {
      const accountNames = splitAccounts(c.account);
      if (accountNames.length === 0) continue;
      const sum = accountNames.reduce((acc, n) => acc + (followerMap.get(n) || 0), 0);
      map.set(normalizeName(c.name), sum);
    }
    return map;
  }, [chatters, modelsList]);

  const chatterMatchesSelectedTier = useCallback((chatterName: string, tier: AccountTierId | null) => {
    if (!tier) return true;
    const tierIds = tierIdsByChatter.get(normalizeName(chatterName)) || [];
    return tierIds.includes(tier);
  }, [tierIdsByChatter]);

  // Tier-Counts (only over unchecked chatters, like uniqueCategories)
  const tierCounts = useMemo(() => {
    const counts = new Map<AccountTierId, number>();
    for (const c of chatters) {
      if (checkedNames.has(normalizeName(c.name))) continue;
      for (const tierId of tierIdsByChatter.get(normalizeName(c.name)) || []) {
        counts.set(tierId, (counts.get(tierId) || 0) + 1);
      }
    }
    return counts;
  }, [chatters, checkedNames, tierIdsByChatter]);

  // Extract unique categories with counts of unchecked chatters, scoped by active tier
  const uniqueCategories = useMemo(() => {
    let allUnchecked = chatters.filter((c) => !checkedNames.has(normalizeName(c.name)));
    if (selectedTier) {
      allUnchecked = allUnchecked.filter((c) => chatterMatchesSelectedTier(c.name, selectedTier));
    }
    const catMap = new Map<string, { emoji: string; name: string; count: number }>();
    for (const c of allUnchecked) {
      const key = c.categoryName || "WEITER SO";
      if (!catMap.has(key)) catMap.set(key, { emoji: c.categoryEmoji || "⚪", name: key, count: 0 });
      catMap.get(key)!.count++;
    }
    return Array.from(catMap.values()).sort((a, b) => {
      const ai = CATEGORY_PRIORITY.indexOf(a.name);
      const bi = CATEGORY_PRIORITY.indexOf(b.name);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [chatters, checkedNames, selectedTier, chatterMatchesSelectedTier]);

  // Build SwapInputs from current chatters (extract today's revenue from KPIs + history)
  const swapInputs = useMemo<SwapInput[]>(() => {
    return chatters.map((c) => {
      const revKey = Object.keys(c.kpis).find((k) => /umsatz|revenue/i.test(k));
      const revStr = revKey ? c.kpis[revKey] : "0";
      const rev = parseFloat(String(revStr).replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
      // Fallback: account aus history ableiten wenn der aktuelle Report keinen liefert.
      // chatter_history hat die accounts pro Tag — wir bauen eine kommagetrennte Liste.
      let account = c.account;
      if (!account || !account.trim()) {
        const histAccounts = (c.history as any[] | undefined)
          ?.map((h) => (h.account || "").trim())
          .filter((a) => a.length > 0) ?? [];
        const unique = Array.from(new Set(histAccounts));
        if (unique.length > 0) account = unique.join(",");
      }
      return {
        name: c.name,
        account,
        currentRevenue: rev,
        history: c.history,
      };
    });
  }, [chatters]);

  // Filter unchecked chatters by selected category, label, tier, alerts, swap-tracking
  const uncheckedChatters = useMemo(
    () => {
      let base = chatters.filter((c) => !checkedNames.has(normalizeName(c.name)));
      if (selectedCategory) {
        base = base.filter((c) => (c.categoryName || "WEITER SO") === selectedCategory);
      }
      if (selectedTier) {
        base = base.filter((c) => chatterMatchesSelectedTier(c.name, selectedTier));
      }
      if (labelChatterNames) {
        base = base.filter((c) => labelChatterNames.has(normalizeName(c.name)));
      }
      if (alertFilterActive) {
        base = base.filter((c) => alertChatterNames.has(normalizeName(c.name)));
      }
      if (swapTrackFilterActive) {
        base = base.filter((c) => swapTrackingMap.has(normalizeName(c.name)));
      }
      if (recoveryFilterActive) {
        base = base.filter((c) => recoveryMap.has(normalizeName(c.name)));
      }
      const notSkipped = base.filter((c) => !skippedNames.has(normalizeName(c.name)));
      const skipped = base.filter((c) => skippedNames.has(normalizeName(c.name)));
      return [...notSkipped, ...skipped];
    },
    [chatters, checkedNames, selectedCategory, selectedTier, chatterMatchesSelectedTier, skippedNames, labelChatterNames, alertFilterActive, alertChatterNames, swapTrackFilterActive, swapTrackingMap, recoveryFilterActive, recoveryMap]
  );

  const prefetchedChatters = useMemo(
    () => uncheckedChatters.slice(0, PREFETCH_CARD_COUNT),
    [uncheckedChatters]
  );

  const currentChatter = prefetchedChatters[0];
  const currentChatterName = currentChatter?.name ?? null;
  const filteredTotal = useMemo(() => {
    let base = chatters;
    if (selectedCategory) base = base.filter((c) => (c.categoryName || "WEITER SO") === selectedCategory);
    if (selectedTier) base = base.filter((c) => chatterMatchesSelectedTier(c.name, selectedTier));
    if (labelChatterNames) base = base.filter((c) => labelChatterNames.has(normalizeName(c.name)));
    if (alertFilterActive) base = base.filter((c) => alertChatterNames.has(normalizeName(c.name)));
    if (swapTrackFilterActive) base = base.filter((c) => swapTrackingMap.has(normalizeName(c.name)));
    if (recoveryFilterActive) base = base.filter((c) => recoveryMap.has(normalizeName(c.name)));
    return base.length;
  }, [chatters, selectedCategory, selectedTier, chatterMatchesSelectedTier, labelChatterNames, alertFilterActive, alertChatterNames, swapTrackFilterActive, swapTrackingMap, recoveryFilterActive, recoveryMap]);
  const filteredChecked = useMemo(() => {
    let base = chatters.filter((c) => checkedNames.has(normalizeName(c.name)));
    if (selectedCategory) base = base.filter((c) => (c.categoryName || "WEITER SO") === selectedCategory);
    if (selectedTier) base = base.filter((c) => chatterMatchesSelectedTier(c.name, selectedTier));
    if (labelChatterNames) base = base.filter((c) => labelChatterNames.has(normalizeName(c.name)));
    if (alertFilterActive) base = base.filter((c) => alertChatterNames.has(normalizeName(c.name)));
    if (swapTrackFilterActive) base = base.filter((c) => swapTrackingMap.has(normalizeName(c.name)));
    if (recoveryFilterActive) base = base.filter((c) => recoveryMap.has(normalizeName(c.name)));
    return base.length;
  }, [chatters, checkedNames, selectedCategory, selectedTier, chatterMatchesSelectedTier, labelChatterNames, alertFilterActive, alertChatterNames, swapTrackFilterActive, swapTrackingMap, recoveryFilterActive, recoveryMap]);
  const progress = filteredTotal > 0 ? (filteredChecked / filteredTotal) * 100 : 0;

  // Load label assignments lazily — only when panel is open
  useEffect(() => {
    if (!currentChatterName) return;
    if (!labelPanel) return;
    supabase.from("chatter_label_assignments").select("label_id").eq("chatter_name", currentChatterName).eq("platform", platform)
      .then(({ data }) => { if (data) setAssignedLabelIds(new Set(data.map((d) => d.label_id))); });
  }, [currentChatterName, platform, labelPanel]);

  useEffect(() => {
    if (!currentChatterName || !notePanel) return;
    supabase.from("coaching_notes").select("id, note_text, created_at").eq("chatter_name", currentChatterName).eq("platform", platform).order("created_at", { ascending: false })
      .then(({ data }) => { if (data) setNotes(data); });
  }, [currentChatterName, platform, notePanel]);

  const markChecked = useCallback(async (name: string) => {
    const normalizedName = normalizeName(name);

    setCheckedNames((prev) => {
      if (prev.has(normalizedName)) return prev;
      const next = new Set(prev);
      next.add(normalizedName);
      return next;
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setCheckedNames((prev) => {
        const next = new Set(prev);
        next.delete(normalizedName);
        return next;
      });
      return;
    }

    const today = new Date().toISOString().split("T")[0];
    const { error } = await supabase.from("daily_chatter_checks").upsert(
      { chatter_name: name, platform, user_id: user.id, check_date: today },
      { onConflict: "user_id,chatter_name,check_date,platform", ignoreDuplicates: true }
    );

    if (error) {
      setCheckedNames((prev) => {
        const next = new Set(prev);
        next.delete(normalizedName);
        return next;
      });
      toast.error("Swipe konnte nicht gespeichert werden");
    }
  }, [platform]);

  const goNext = useCallback(() => {
    setActionPanel(false);
    // uncheckedChatters auto-updates, so index stays at 0 for next card
  }, []);

  const noop = useCallback(() => {}, []);

  const handleUndo = useCallback(async () => {
    const stack = [...undoStack];
    if (stack.length === 0) return;
    const lastName = stack.pop()!;
    setUndoStack(stack);
    setCheckedNames((s) => {
      const next = new Set(s);
      next.delete(normalizeName(lastName));
      return next;
    });
    // Also remove the skip flag if it was skipped
    setSkippedNames((prev) => {
      const next = new Set(prev);
      next.delete(normalizeName(lastName));
      return next;
    });
    setActionPanel(false);

    // Delete from DB
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const today = new Date().toISOString().split("T")[0];
    await supabase.from("daily_chatter_checks")
      .delete()
      .eq("chatter_name", lastName)
      .eq("platform", platform)
      .eq("user_id", user.id)
      .eq("check_date", today);
  }, [undoStack, platform]);

  // Swipe-right: pause and show input prompt — DON'T advance yet
  const handleSwipeRight = useCallback(() => {
    if (!currentChatter) return;
    setQuickPromptName(currentChatter.name);
  }, [currentChatter]);

  // Confirm advance after user picks input type or skips
  const advanceAfterPrompt = useCallback((name: string) => {
    setUndoStack((prev) => [...prev, name]);
    markChecked(name);
    setQuickPromptName(null);
    goNext();
  }, [markChecked, goNext]);

  const handleQuickInputPick = useCallback(async (type: "verbal" | "praise" | "observed" | "warning") => {
    const name = quickPromptName;
    if (!name) return;
    advanceAfterPrompt(name);
    const ok = await logManualInput(platform, name, type);
    if (ok) {
      refreshInputForChatter(name);
      const labels = { verbal: "💬 Input", praise: "🔥 Lob", observed: "👀 Beobachtet", warning: "⚠️ Warnung" };
      toast.success(`${labels[type]} getrackt`);
    } else {
      toast.error("Konnte nicht gespeichert werden");
    }
  }, [quickPromptName, platform, refreshInputForChatter, advanceAfterPrompt]);

  const handleQuickInputSkip = useCallback(() => {
    const name = quickPromptName;
    if (!name) return;
    advanceAfterPrompt(name);
  }, [quickPromptName, advanceAfterPrompt]);

  const handleSwipeLeft = useCallback(() => {
    setActionPanel(true);
  }, []);

  const handleSwipeUp = useCallback(() => {
    setSlideOver(true);
  }, []);

  const handleSwipeDown = useCallback(() => {
    if (!currentChatter) return;
    setSkippedNames((prev) => new Set(prev).add(normalizeName(currentChatter.name)));
    toast("Übersprungen — kommt später wieder", { icon: "⏭️" });
  }, [currentChatter]);

  const handleActionDone = useCallback(() => {
    if (currentChatter) {
      setUndoStack((prev) => [...prev, currentChatter.name]);
      markChecked(currentChatter.name);
    }
    setActionPanel(false);
    goNext();
  }, [currentChatter, markChecked, goNext]);

  const handleReset = () => {
    setCheckedNames(new Set());
    setUndoStack([]);
    setActionPanel(false);
  };

  // Label toggle — optimistic, no awaiting before UI update
  const toggleLabel = (labelId: string) => {
    if (!currentChatter) return;
    const chatterName = currentChatter.name;
    const wasActive = assignedLabelIds.has(labelId);

    // 1) Update UI immediately (optimistic)
    if (wasActive) {
      setAssignedLabelIds((prev) => { const n = new Set(prev); n.delete(labelId); return n; });
      setAllLabelAssignments((prev) => prev.filter((a) => !(a.label_id === labelId && normalizeName(a.chatter_name) === normalizeName(chatterName))));
    } else {
      setAssignedLabelIds((prev) => new Set(prev).add(labelId));
      setAllLabelAssignments((prev) => [...prev, { label_id: labelId, chatter_name: chatterName }]);
    }

    // 2) Persist in background, rollback on failure
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const op = wasActive
        ? supabase.from("chatter_label_assignments").delete()
            .eq("label_id", labelId).eq("chatter_name", chatterName).eq("platform", platform).eq("user_id", user.id)
        : supabase.from("chatter_label_assignments").insert({
            label_id: labelId, chatter_name: chatterName, platform, user_id: user.id,
          });
      const { error } = await op;
      if (error) {
        // rollback
        if (wasActive) {
          setAssignedLabelIds((prev) => new Set(prev).add(labelId));
          setAllLabelAssignments((prev) => [...prev, { label_id: labelId, chatter_name: chatterName }]);
        } else {
          setAssignedLabelIds((prev) => { const n = new Set(prev); n.delete(labelId); return n; });
          setAllLabelAssignments((prev) => prev.filter((a) => !(a.label_id === labelId && normalizeName(a.chatter_name) === normalizeName(chatterName))));
        }
      } else if (!wasActive) {
        // Successfully added a label → counts as input
        refreshInputForChatter(chatterName);
      }
    })();
  };

  const createLabel = async () => {
    if (!newLabelName.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const colors = ["#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"];
    const color = colors[allLabels.length % colors.length];
    const { data } = await supabase.from("chatter_labels")
      .insert({ user_id: user.id, platform, label_name: newLabelName.trim(), color })
      .select("id, label_name, color").single();
    if (data) { setAllLabels((prev) => [...prev, data]); setNewLabelName(""); }
  };

  // Save note
  const saveNote = async () => {
    if (!noteText.trim() || !currentChatter) return;
    const chatterName = currentChatter.name;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from("coaching_notes")
      .insert({ chatter_name: chatterName, note_text: noteText.trim(), platform, user_id: user.id })
      .select("id, note_text, created_at").single();
    if (error) { toast.error("Fehler beim Speichern"); return; }
    if (data) {
      setNotes((prev) => [data, ...prev]);
      setNoteText("");
      toast.success("Notiz gespeichert");
      refreshInputForChatter(chatterName);
    }
  };

  const deleteNote = async (noteId: string) => {
    const prev = notes;
    setNotes((p) => p.filter((n) => n.id !== noteId));
    const { error } = await supabase.from("coaching_notes").delete().eq("id", noteId);
    if (error) { setNotes(prev); toast.error("Fehler beim Löschen"); return; }
    toast.success("Notiz gelöscht");
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (actionPanel || slideOver) return;
      if (e.key === "ArrowRight") handleSwipeRight();
      if (e.key === "ArrowLeft") handleSwipeLeft();
      if (e.key === "ArrowUp") handleSwipeUp();
      if (e.key === "ArrowDown") { e.preventDefault(); handleSwipeDown(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); handleUndo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actionPanel, slideOver, handleSwipeRight, handleSwipeLeft, handleSwipeUp, handleSwipeDown, handleUndo]);

  const isDone = uncheckedChatters.length === 0;
  const allDone = chatters.every((c) => checkedNames.has(normalizeName(c.name)));

  // When category filter is active and all cards done, find next category
  useEffect(() => {
    if (!isDone || !selectedCategory || allDone) return;
    const uncheckedAll = chatters.filter((c) => !checkedNames.has(normalizeName(c.name)));
    const remaining = new Map<string, { emoji: string; name: string }>();
    for (const c of uncheckedAll) {
      const key = c.categoryName || "WEITER SO";
      if (key !== selectedCategory && !remaining.has(key)) {
        remaining.set(key, { emoji: c.categoryEmoji || "⚪", name: key });
      }
    }
    const sorted = Array.from(remaining.values()).sort((a, b) => {
      const ai = CATEGORY_PRIORITY.indexOf(a.name);
      const bi = CATEGORY_PRIORITY.indexOf(b.name);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    if (sorted.length > 0) {
      setCategoryDonePrompt(sorted[0].name);
    }
  }, [isDone, selectedCategory, allDone, chatters, checkedNames]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-6 w-6 border border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    );
  }

  if (chatters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <p className="text-sm">Keine Chatter-Daten vorhanden.</p>
        <p className="text-xs">Lade zuerst einen Report hoch.</p>
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 overflow-hidden overscroll-none"
      style={{
        maxHeight: '100dvh',
        // Im Swipe-Mode muss touchAction:none sein (sonst kollidiert Browser-Pan mit Karten-Drag).
        // In Wechsel/Vergleich brauchen wir vertikales Scrollen.
        touchAction: mode === 'swipe' ? 'none' : 'pan-y',
      }}
    >
      {/* Left: Card area */}
      <div
        className={`flex min-h-0 flex-col ${mode === 'swipe' ? 'px-4 pt-3 pb-4 overflow-hidden' : 'px-3 sm:px-4 pt-2 overflow-y-auto'} ${isDesktop ? (mode === "swap" || mode === "compare" ? "w-full" : "w-1/2 max-w-xl") : "w-full mx-auto"}`}
        style={mode === "swipe" ? undefined : { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
      {/* Mode Toggle: Swipe / Wechsel / Vergleich */}
      <div className="relative z-10 mb-3 flex shrink-0 p-0.5 rounded-full bg-background/95 border border-white/[0.08] shadow-[0_10px_32px_-22px_rgba(0,0,0,0.85)] backdrop-blur-xl">
        {([
          { id: "swipe", label: "Swipe" },
          { id: "swap", label: "Wechsel" },
          { id: "compare", label: "Vergleich" },
        ] as const).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`flex-1 text-xs font-medium py-1.5 rounded-full transition-all ${
              mode === m.id
                ? "bg-white/[0.08] text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "swap" ? (
        <SwapModeView platform={platform} chatters={swapInputs} models={modelsList} benchmarks={benchmarkBundle} />
      ) : mode === "compare" ? (
        <>
          {/* Time-Range Selector bleibt sichtbar im Compare-Mode */}
          <div className="mb-3 flex flex-col gap-1">
            <TimeRangeToggle value={timeRange} onChange={setTimeRange} />
            {timeRange.preset !== "today" && (
              <span className="text-[10px] text-muted-foreground/70 px-0.5">
                Vergleich basiert auf {rangeDays(timeRange)} {rangeDays(timeRange) === 1 ? "Tag" : "Tagen"}
                {rangeLoading && <span className="ml-1 opacity-60">· lädt…</span>}
              </span>
            )}
          </div>
          <CompareModeView
            chatters={chatters.map((c) => ({
              name: c.name,
              account: c.account,
              kpis: c.kpis,
              categoryName: c.categoryName,
              categoryEmoji: c.categoryEmoji,
              startDate: c.startDate,
            }))}
            swapInputs={swapInputs}
            models={modelsList}
            rangeHistory={rangeHistory}
            range={timeRange}
            recategorizedMap={new Map(Array.from(recategorizedMap, ([k, v]) => [k, v.name as ActionCategoryName]))}
            labelsByChatter={labelsByChatter}
            tierIdsByChatter={tierIdsByChatter}
            alertChatterNames={alertChatterNames}
            allLabels={allLabels}
            firstSeenByChatter={firstSeenByChatter}
            followersByChatter={followersByChatter}
            reportId={currentReportId}
            onChatterClick={(name) => setCompareSlideOverChatter(name)}
          />
        </>
      ) : (
      <>
      {/* Unified Filter — Kategorien + Labels + Alerts in einem Dropdown */}
      {(() => {
        const alertCount = chatters.filter(
          (c) => !checkedNames.has(normalizeName(c.name)) && alertChatterNames.has(normalizeName(c.name))
        ).length;
        const swapTrackCount = chatters.filter(
          (c) => !checkedNames.has(normalizeName(c.name)) && swapTrackingMap.has(normalizeName(c.name))
        ).length;
        const recoveryCount = chatters.filter(
          (c) => !checkedNames.has(normalizeName(c.name)) && recoveryMap.has(normalizeName(c.name))
        ).length;
        const allUncheckedCount = chatters.filter((c) => !checkedNames.has(normalizeName(c.name))).length;

        const currentValue = recoveryFilterActive
          ? "__recovery__"
          : swapTrackFilterActive
          ? "__swap_track__"
          : alertFilterActive
          ? "__alerts__"
          : selectedLabelFilter
          ? `label:${selectedLabelFilter}`
          : selectedCategory
          ? `cat:${selectedCategory}`
          : "__all__";

        // Active filter — icon + label (Forecast-style two-line trigger)
        let triggerIcon: React.ReactNode = null;
        let triggerName: React.ReactNode = (
          <span className="text-foreground font-light text-[13px] truncate">
            Alle Chatter <span className="ml-1 text-[10px] text-white/40">{allUncheckedCount}</span>
          </span>
        );
        if (recoveryFilterActive) {
          triggerIcon = <Sparkles className="h-3.5 w-3.5 text-amber-300/90 shrink-0" />;
          triggerName = (
            <span className="text-foreground font-light text-[13px] truncate">
              Revenue Recovery <span className="ml-1 text-[10px] text-white/40">{recoveryCount}</span>
            </span>
          );
        } else if (swapTrackFilterActive) {
          triggerIcon = <Repeat className="h-3.5 w-3.5 text-cyan-300/90 shrink-0" />;
          triggerName = (
            <span className="text-foreground font-light text-[13px] truncate">
              Nach Wechsel beobachten <span className="ml-1 text-[10px] text-white/40">{swapTrackCount}</span>
            </span>
          );
        } else if (alertFilterActive) {
          triggerIcon = <AlertTriangle className="h-3.5 w-3.5 text-red-400/90 shrink-0" />;
          triggerName = (
            <span className="text-foreground font-light text-[13px] truncate">
              Alerts <span className="ml-1 text-[10px] text-white/40">{alertCount}</span>
            </span>
          );
        } else if (selectedLabelFilter) {
          const lbl = allLabels.find((l) => l.id === selectedLabelFilter);
          if (lbl) {
            triggerIcon = (
              <span
                className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: lbl.color, boxShadow: `0 0 6px ${lbl.color}80` }}
              />
            );
            triggerName = (
              <span className="text-foreground font-light text-[13px] truncate">
                {lbl.label_name} <span className="ml-1 text-[10px] text-white/40">{labelCounts.get(lbl.id) || 0}</span>
              </span>
            );
          }
        } else if (selectedCategory) {
          const cat = uniqueCategories.find((c) => c.name === selectedCategory);
          triggerIcon = <span className="text-sm leading-none shrink-0">{cat?.emoji || "📊"}</span>;
          triggerName = (
            <span className="text-foreground font-light text-[13px] truncate">
              {selectedCategory} {cat && <span className="ml-1 text-[10px] text-white/40">{cat.count}</span>}
            </span>
          );
        }
        const triggerLabel: React.ReactNode = (
          <div className="flex items-center justify-between gap-2.5 w-full min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              {triggerIcon ?? <Sparkles className="h-3.5 w-3.5 text-orange-400/80 shrink-0" />}
              <div className="min-w-0 leading-tight text-left">
                <p className="text-[9px] uppercase tracking-[0.18em] text-white/40 font-medium gold-text-subtle">Filter</p>
                {triggerName}
              </div>
            </div>
          </div>
        );

        const handleChange = (value: string) => {
          setActionPanel(false);
          setSlideOver(false);
          setLabelPanel(false);
          setNotePanel(false);
          setCategoryDonePrompt(null);

          if (value === "__all__") {
            setAlertFilterActive(false);
            setSwapTrackFilterActive(false);
            setRecoveryFilterActive(false);
            setSelectedLabelFilter(null);
            setSelectedCategory(null);
          } else if (value === "__alerts__") {
            setAlertFilterActive(true);
            setSwapTrackFilterActive(false);
            setRecoveryFilterActive(false);
            setSelectedLabelFilter(null);
            setSelectedCategory(null);
          } else if (value === "__swap_track__") {
            setSwapTrackFilterActive(true);
            setAlertFilterActive(false);
            setRecoveryFilterActive(false);
            setSelectedLabelFilter(null);
            setSelectedCategory(null);
          } else if (value === "__recovery__") {
            setRecoveryFilterActive(true);
            setSwapTrackFilterActive(false);
            setAlertFilterActive(false);
            setSelectedLabelFilter(null);
            setSelectedCategory(null);
          } else if (value.startsWith("label:")) {
            setAlertFilterActive(false);
            setSwapTrackFilterActive(false);
            setRecoveryFilterActive(false);
            setSelectedCategory(null);
            setSelectedLabelFilter(value.slice(6));
          } else if (value.startsWith("cat:")) {
            setAlertFilterActive(false);
            setSwapTrackFilterActive(false);
            setRecoveryFilterActive(false);
            setSelectedLabelFilter(null);
            setSelectedCategory(value.slice(4));
          }
        };

        const toggleTier = (tierId: AccountTierId) => {
          setActionPanel(false);
          setSlideOver(false);
          setLabelPanel(false);
          setNotePanel(false);
          setCategoryDonePrompt(null);
          setSelectedTier((prev) => (prev === tierId ? null : tierId));
        };

        return (
          <div className="mb-3 space-y-2">
            {/* Time-Range Selector */}
            <div className="flex flex-col gap-1">
              <TimeRangeToggle value={timeRange} onChange={setTimeRange} />
              {timeRange.preset !== "today" && (
                <span className="text-[10px] text-muted-foreground/70 px-0.5">
                  Re-Kategorisiert nach Ø Performance · {rangeDays(timeRange)} {rangeDays(timeRange) === 1 ? "Tag" : "Tage"}
                  {rangeLoading && <span className="ml-1 opacity-60">· lädt…</span>}
                </span>
              )}
            </div>
            {tierCounts.size > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                {ACCOUNT_TIERS.map((tier) => {
                  const isActive = selectedTier === tier.id;
                  const count = tierCounts.get(tier.id) || 0;
                  const isEmpty = count === 0;
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      disabled={isEmpty}
                      onClick={() => toggleTier(tier.id)}
                      title={tier.description}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-light tracking-wide transition-all border backdrop-blur-sm ${
                        isActive
                          ? `${tier.activeBg} ${tier.activeBorder} ${tier.activeText} shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_4px_14px_-6px_rgba(0,0,0,0.5)]`
                          : isEmpty
                            ? "bg-transparent border-white/[0.03] text-white/15"
                            : "bg-white/[0.025] border-white/[0.07] text-white/55 hover:text-foreground/85 hover:bg-white/[0.045] hover:border-white/[0.12]"
                      }`}
                    >
                      <span>{tier.emoji}</span>
                      <span>{tier.label}</span>
                      <span className="text-[9px] opacity-60 tabular-nums">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <Select value={currentValue} onValueChange={handleChange}>
              <SelectTrigger className="premium-card premium-card-interactive w-full bg-white/[0.02] border-white/[0.08] h-auto py-2 rounded-lg px-3 hover:border-white/[0.14] focus:ring-1 focus:ring-white/10 focus:ring-offset-0 transition-all data-[state=open]:border-white/[0.16] data-[state=open]:bg-white/[0.035] [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-white/40 [&>svg]:transition-transform [&[data-state=open]>svg]:rotate-180 [&>span]:!line-clamp-none [&>span]:whitespace-normal [&>span]:text-left [&>span]:flex-1">
                <SelectValue>{triggerLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-[60vh] premium-card border-white/[0.08] bg-black/95 backdrop-blur-xl rounded-xl p-1.5 shadow-[0_20px_60px_-12px_rgba(0,0,0,0.6)]">
                <SelectItem value="__all__">
                  Alle Chatter
                  <span className="ml-1.5 text-[10px] opacity-50">{allUncheckedCount}</span>
                </SelectItem>

                {alertChatterNames.size > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectItem value="__alerts__">
                      <span className="inline-flex items-center gap-1.5 text-red-400">
                        <AlertTriangle className="h-3 w-3" /> Alerts
                      </span>
                      {alertCount > 0 && (
                        <span className="ml-1.5 text-[10px] opacity-50">{alertCount}</span>
                      )}
                    </SelectItem>
                  </>
                )}

                {swapTrackingMap.size > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectItem value="__swap_track__">
                      <span className="inline-flex items-center gap-1.5 text-cyan-300">
                        <Repeat className="h-3 w-3" /> Nach Wechsel beobachten
                      </span>
                      {swapTrackCount > 0 && (
                        <span className="ml-1.5 text-[10px] opacity-50">{swapTrackCount}</span>
                      )}
                    </SelectItem>
                  </>
                )}

                {recoveryMap.size > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectItem value="__recovery__">
                      <span className="inline-flex items-center gap-1.5 text-amber-300">
                        <Sparkles className="h-3 w-3" /> Revenue Recovery
                      </span>
                      {recoveryCount > 0 && (
                        <span className="ml-1.5 text-[10px] opacity-50">{recoveryCount}</span>
                      )}
                    </SelectItem>
                  </>
                )}

                {allLabels.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Labels</SelectLabel>
                      {allLabels.map((label) => (
                        <SelectItem key={label.id} value={`label:${label.id}`}>
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ backgroundColor: label.color }}
                            />
                            {label.label_name}
                          </span>
                          {(labelCounts.get(label.id) || 0) > 0 && (
                            <span className="ml-1.5 text-[10px] opacity-50">{labelCounts.get(label.id)}</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}

                {uniqueCategories.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Kategorien</SelectLabel>
                      {uniqueCategories.map((cat) => (
                        <SelectItem key={cat.name} value={`cat:${cat.name}`}>
                          {cat.emoji} {cat.name}
                          <span className="ml-1.5 text-[10px] opacity-50">{cat.count}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
              </SelectContent>
            </Select>
            {(() => {
              let criteria: ReturnType<typeof getCategoryCriteria> | null = null;
              if (recoveryFilterActive) criteria = SPECIAL_FILTER_CRITERIA.recovery;
              else if (swapTrackFilterActive) criteria = SPECIAL_FILTER_CRITERIA.swap_track;
              else if (alertFilterActive) criteria = SPECIAL_FILTER_CRITERIA.alerts;
              else if (selectedCategory) criteria = getCategoryCriteria(selectedCategory);
              if (!criteria) return null;
              return (
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2 backdrop-blur-sm">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles className="h-2.5 w-2.5 text-amber-300/70 shrink-0" />
                    <p className="text-[9px] uppercase tracking-[0.18em] text-white/40 font-medium">
                      Sortier-Kriterien
                    </p>
                  </div>
                  <p className="text-[11px] text-foreground/80 font-light leading-snug mb-1.5">
                    {criteria.short}
                  </p>
                  <ul className="space-y-0.5">
                    {criteria.rules.map((rule, i) => (
                      <li key={i} className="text-[10px] text-muted-foreground/75 font-light leading-snug flex gap-1.5">
                        <span className="text-white/30 shrink-0">·</span>
                        <span>{rule}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </div>
        );
      })()}



      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground font-medium">
            {filteredChecked}/{filteredTotal} gecheckt
          </span>
          <span className="text-[10px] text-muted-foreground">
            {uncheckedChatters.length} übrig
          </span>
        </div>
        <Progress value={progress} className="h-1" />
      </div>

      {/* Card stack */}
      <div className="relative flex-1 min-h-0" key={`stack-${selectedCategory ?? 'all'}`}>
        {isDone && allDone ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center h-full gap-4"
          >
            <div className="text-5xl">🎉</div>
            <p className="text-foreground font-medium">Alle Chatter durchgegangen!</p>
            <p className="text-sm text-muted-foreground">{checkedNames.size} von {chatters.length} gecheckt</p>
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Nochmal durchgehen
            </Button>
          </motion.div>
        ) : isDone && categoryDonePrompt ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center h-full gap-5"
          >
            <div className="text-4xl">✅</div>
            <p className="text-foreground font-medium text-center">
              Alle <span className="text-primary">{selectedCategory}</span> durchgegangen!
            </p>
            <p className="text-sm text-muted-foreground text-center">
              Weiter mit <span className="font-medium text-foreground">{categoryDonePrompt}</span>?
            </p>
            <div className="flex gap-3">
              <Button variant="outline" size="sm" onClick={() => { setSelectedCategory(null); setCategoryDonePrompt(null); }}>
                Übersicht
              </Button>
              <Button size="sm" onClick={() => { setSelectedCategory(categoryDonePrompt); setCategoryDonePrompt(null); }}>
                Ja, weiter
              </Button>
            </div>
          </motion.div>
        ) : isDone ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center h-full gap-4"
          >
            <div className="text-5xl">🎉</div>
            <p className="text-foreground font-medium">Kategorie fertig!</p>
            <Button variant="outline" size="sm" onClick={() => { setSelectedCategory(null); setCategoryDonePrompt(null); }}>
              Zurück zur Übersicht
            </Button>
          </motion.div>
        ) : (
          <>
            <AnimatePresence>
              {prefetchedChatters.slice().reverse().map((chatter, reverseIndex) => {
                const stackIndex = prefetchedChatters.length - 1 - reverseIndex;
                const isTopCard = stackIndex === 0;
                const swapEntry = isTopCard ? swapTrackingMap.get(normalizeName(chatter.name)) : undefined;
                const swapDeltaProp = swapEntry
                  ? {
                      deltaLabel: formatDelta(swapEntry.deltaPct),
                      tone: deltaTone(swapEntry.deltaPct) as "pos" | "neg" | "neutral",
                      direction: swapEntry.tierDirection,
                      daysSince: swapEntry.daysSince,
                    }
                  : null;
                const recoveryEntry = isTopCard ? recoveryMap.get(normalizeName(chatter.name)) : undefined;
                const recoveryDeltaProp = recoveryEntry
                  ? {
                      recoveryEur: recoveryEntry.recoveryEur,
                      baseline: recoveryEntry.baseline,
                      currentAvg: recoveryEntry.currentAvg,
                      gapPct: recoveryEntry.gapPct,
                    }
                  : null;

                return (
                  <SwipeCard
                    key={normalizeName(chatter.name)}
                    chatter={chatter}
                    alerts={alertsByChatter.get(normalizeName(chatter.name)) || []}
                    lastInputAt={inputsMap.get(normalizeName(chatter.name))?.lastAt ?? null}
                    lastInputSource={inputsMap.get(normalizeName(chatter.name))?.lastSource ?? null}
                    onLastInputClick={isTopCard ? () => setHistoryChatter(chatter.name) : undefined}
                    onSwipeRight={isTopCard ? handleSwipeRight : noop}
                    onSwipeLeft={isTopCard ? handleSwipeLeft : noop}
                    onSwipeUp={isTopCard ? handleSwipeUp : noop}
                    onSwipeDown={isTopCard ? handleSwipeDown : undefined}
                    isTop={isTopCard}
                    stackIndex={stackIndex}
                    accountLogins={accountLoginsMap.get(normalizeName(chatter.name)) || []}
                    swapDelta={swapDeltaProp}
                    recoveryDelta={recoveryDeltaProp}
                  />
                );
              })}
            </AnimatePresence>

            {/* Action panel overlay */}
            {currentChatter && (
              <SwipeActionPanel
                open={actionPanel}
                onClose={() => setActionPanel(false)}
                chatterName={currentChatter.name}
                platform={platform}
                onDone={handleActionDone}
              />
            )}

            {/* Quick-Input Prompt — overlays the stack so the next chatter is hidden */}
            {(() => {
              const promptChatter = quickPromptName
                ? chatters.find((c) => normalizeName(c.name) === normalizeName(quickPromptName))
                : null;
              return (
                <QuickInputPrompt
                  open={!!quickPromptName}
                  chatterName={quickPromptName || ""}
                  categoryEmoji={promptChatter?.categoryEmoji}
                  categoryName={promptChatter?.categoryName}
                  onPick={handleQuickInputPick}
                  onSkip={handleQuickInputSkip}
                />
              );
            })()}
          </>
        )}
      </div>

      {/* Bottom buttons */}
      {!isDone && currentChatter && (
        <>
          <div className="flex items-center justify-center gap-3 mt-4">
            <Button
              variant="outline"
              size="icon"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="h-9 w-9 rounded-full border-border text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => { setLabelPanel(true); setNotePanel(false); }}
              className="relative h-10 w-10 rounded-full border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Tag className="h-4 w-4" />
              {assignedLabelIds.size > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-bold h-4 w-4 rounded-full flex items-center justify-center">
                  {assignedLabelIds.size}
                </span>
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleSwipeLeft}
              className="h-12 w-12 rounded-full border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <X className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleSwipeUp}
              className="h-10 w-10 rounded-full border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
            >
              <ChevronUp className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleSwipeRight}
              className="h-12 w-12 rounded-full border-green-500/30 text-green-400 hover:bg-green-500/10 hover:text-green-300"
            >
              <Check className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => { setNotePanel(true); setLabelPanel(false); }}
              className="relative h-10 w-10 rounded-full border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <StickyNote className="h-4 w-4" />
              {notes.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-bold h-4 w-4 rounded-full flex items-center justify-center">
                  {notes.length}
                </span>
              )}
            </Button>
          </div>

          {/* Label Bottom Sheet — Premium */}
          <AnimatePresence>
            {labelPanel && (
              <motion.div
                className="fixed inset-0 z-40 flex items-end justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <motion.div
                  className="absolute inset-0 bg-black/60 backdrop-blur-md"
                  onClick={() => setLabelPanel(false)}
                />
                <motion.div
                  className="relative w-full max-w-md rounded-t-3xl px-5 pb-7 pt-3 overflow-hidden"
                  style={{
                    background: `radial-gradient(120% 60% at 50% 0%, hsl(40 45% 55% / 0.10) 0%, transparent 55%), linear-gradient(180deg, hsl(240 6% 7%) 0%, hsl(240 6% 4%) 100%)`,
                    borderTop: "1px solid hsl(0 0% 100% / 0.08)",
                    boxShadow: "0 -20px 60px -10px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
                  }}
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 30, stiffness: 340 }}
                >
                  <div
                    aria-hidden
                    className="absolute top-0 left-12 right-12 h-px rounded-full"
                    style={{
                      background: "linear-gradient(to right, transparent, hsl(40 45% 55% / 0.5), transparent)",
                      boxShadow: "0 0 12px hsl(40 45% 55% / 0.4)",
                    }}
                  />
                  <div className="flex justify-center mb-3">
                    <div className="w-10 h-1 rounded-full bg-white/10" />
                  </div>
                  <div className="flex items-center gap-2.5 mb-1">
                    <div
                      className="h-9 w-9 rounded-xl flex items-center justify-center"
                      style={{
                        background: "linear-gradient(135deg, hsl(40 45% 55% / 0.2), hsl(40 45% 55% / 0.06))",
                        border: "1px solid hsl(40 45% 55% / 0.2)",
                      }}
                    >
                      <Tag className="h-4 w-4" style={{ color: "hsl(40 50% 65%)" }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-medium leading-none">Labels für</p>
                      <h3 className="text-sm font-semibold text-foreground capitalize truncate mt-0.5">
                        {currentChatter.name.replace(/_/g, " ")}
                      </h3>
                    </div>
                    {assignedLabelIds.size > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-primary/15 text-primary border border-primary/20">
                        {assignedLabelIds.size} aktiv
                      </span>
                    )}
                  </div>
                  <div className="h-px bg-white/[0.06] my-4" />
                  {allLabels.length > 0 ? (
                    <div className="flex flex-wrap gap-2 mb-5">
                      {allLabels.map((label) => {
                        const active = assignedLabelIds.has(label.id);
                        return (
                          <motion.button
                            key={label.id}
                            onClick={() => { try { (navigator as any).vibrate?.(8); } catch {} toggleLabel(label.id); }}
                            whileTap={{ scale: 0.94 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30, mass: 0.5 }}
                            className="text-xs px-3.5 py-2 rounded-full font-medium border transition-all duration-150 ease-out inline-flex items-center gap-1.5 active:duration-75 touch-manipulation select-none"
                            style={
                              active
                                ? {
                                    backgroundColor: label.color,
                                    borderColor: label.color,
                                    color: "white",
                                    boxShadow: `0 4px 16px -4px ${label.color}80, 0 0 0 1px ${label.color}40`,
                                  }
                                : {
                                    backgroundColor: "hsl(0 0% 100% / 0.03)",
                                    borderColor: "hsl(0 0% 100% / 0.08)",
                                    color: "hsl(0 0% 75%)",
                                  }
                            }
                          >
                            <span
                              className="inline-block h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: active ? "rgba(255,255,255,0.95)" : label.color }}
                            />
                            {label.label_name}
                            {active && <Check className="h-3 w-3 ml-0.5" strokeWidth={3} />}
                          </motion.button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 mb-3 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015]">
                      <Sparkles className="h-5 w-5 text-white/25 mb-2" />
                      <p className="text-xs text-white/40 font-light">Noch keine Labels — leg dein erstes an</p>
                    </div>
                  )}
                  <div className="rounded-2xl bg-white/[0.025] border border-white/[0.06] p-1.5 flex gap-1.5 items-center">
                    <Input
                      value={newLabelName}
                      onChange={(e) => setNewLabelName(e.target.value)}
                      placeholder="Neues Label…"
                      className="h-9 text-xs bg-transparent border-0 text-foreground placeholder:text-white/30 focus-visible:ring-0 focus-visible:ring-offset-0 px-3"
                      onKeyDown={(e) => e.key === "Enter" && createLabel()}
                    />
                    <Button
                      size="sm"
                      onClick={createLabel}
                      disabled={!newLabelName.trim()}
                      className="h-8 px-3 rounded-xl shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Note Bottom Sheet — Premium */}
          <AnimatePresence>
            {notePanel && (
              <motion.div
                className="fixed inset-0 z-40 flex items-end justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <motion.div
                  className="absolute inset-0 bg-black/60 backdrop-blur-md"
                  onClick={() => setNotePanel(false)}
                />
                <motion.div
                  className="relative w-full max-w-md rounded-t-3xl px-5 pb-7 pt-3 overflow-hidden"
                  style={{
                    background: `radial-gradient(120% 60% at 50% 0%, hsl(212 90% 60% / 0.10) 0%, transparent 55%), linear-gradient(180deg, hsl(240 6% 7%) 0%, hsl(240 6% 4%) 100%)`,
                    borderTop: "1px solid hsl(0 0% 100% / 0.08)",
                    boxShadow: "0 -20px 60px -10px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
                  }}
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 30, stiffness: 340 }}
                >
                  <div
                    aria-hidden
                    className="absolute top-0 left-12 right-12 h-px rounded-full"
                    style={{
                      background: "linear-gradient(to right, transparent, hsl(212 90% 60% / 0.5), transparent)",
                      boxShadow: "0 0 12px hsl(212 90% 60% / 0.4)",
                    }}
                  />
                  <div className="flex justify-center mb-3">
                    <div className="w-10 h-1 rounded-full bg-white/10" />
                  </div>
                  <div className="flex items-center gap-2.5 mb-1">
                    <div
                      className="h-9 w-9 rounded-xl flex items-center justify-center"
                      style={{
                        background: "linear-gradient(135deg, hsl(212 90% 60% / 0.2), hsl(212 90% 60% / 0.06))",
                        border: "1px solid hsl(212 90% 60% / 0.2)",
                      }}
                    >
                      <StickyNote className="h-4 w-4" style={{ color: "hsl(212 90% 70%)" }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-medium leading-none">Notizen für</p>
                      <h3 className="text-sm font-semibold text-foreground capitalize truncate mt-0.5">
                        {currentChatter.name.replace(/_/g, " ")}
                      </h3>
                    </div>
                    {notes.length > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/20">
                        {notes.length}
                      </span>
                    )}
                  </div>
                  <div className="h-px bg-white/[0.06] my-4" />
                  <div className="rounded-2xl bg-white/[0.025] border border-white/[0.06] p-2 flex gap-2 mb-4 focus-within:border-blue-500/30 transition-colors">
                    <Textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Was ist heute aufgefallen?"
                      className="text-xs bg-transparent border-0 resize-none min-h-[56px] text-foreground placeholder:text-white/30 focus-visible:ring-0 focus-visible:ring-offset-0 px-2 py-1.5"
                      rows={2}
                    />
                    <Button size="sm" onClick={saveNote} disabled={!noteText.trim()} className="h-9 px-3 self-end rounded-xl shrink-0">
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {notes.length > 0 ? (
                    <div className="max-h-52 overflow-y-auto space-y-2 pr-1 -mr-1">
                      <AnimatePresence initial={false}>
                        {notes.map((n) => (
                          <motion.div
                            key={n.id}
                            layout
                            initial={{ opacity: 0, y: 8, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, x: -20, scale: 0.95 }}
                            transition={{ duration: 0.18 }}
                            className="group rounded-xl bg-white/[0.025] border border-white/[0.05] px-3 py-2.5 relative"
                          >
                            <p className="text-[11.5px] text-foreground/85 leading-relaxed pr-6 whitespace-pre-wrap">{n.note_text}</p>
                            <div className="flex items-center justify-between mt-1.5">
                              <p className="text-[9px] text-white/35 font-light tracking-wide">
                                {new Date(n.created_at).toLocaleDateString("de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                              </p>
                              <button
                                onClick={() => deleteNote(n.id)}
                                className="opacity-50 hover:opacity-100 transition-opacity text-white/50 hover:text-red-400 p-1 -m-1"
                                aria-label="Notiz löschen"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-6 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015]">
                      <StickyNote className="h-5 w-5 text-white/25 mb-2" />
                      <p className="text-xs text-white/40 font-light">Noch keine Notizen</p>
                    </div>
                  )}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Input History Sheet — opened via badge tap */}
      <InputHistorySheet
        open={!!historyChatter}
        onClose={() => setHistoryChatter(null)}
        chatterName={historyChatter || ""}
        events={historyChatter ? (inputsMap.get(normalizeName(historyChatter))?.events || []) : []}
      />

      {/* Chatter SlideOver (mobile: portal overlay) */}
      {!isDesktop && currentChatter && (
        <ChatterSlideOver
          open={slideOver}
          onClose={() => setSlideOver(false)}
          chatterName={currentChatter.name}
          platform={platform}
        />
      )}
      </>
      )}
      </div>

      {/* Right: Inline performance panel (desktop only, only in swipe mode) */}
      {isDesktop && mode === "swipe" && currentChatter && (
        <div className="w-1/2 h-full overflow-hidden">
          <ChatterSlideOver
            open={true}
            onClose={() => {}}
            chatterName={currentChatter.name}
            platform={platform}
            inline
          />
        </div>
      )}

      {/* Compare-Mode SlideOver (any chatter from list) */}
      {compareSlideOverChatter && (
        <ChatterSlideOver
          open={!!compareSlideOverChatter}
          onClose={() => setCompareSlideOverChatter(null)}
          chatterName={compareSlideOverChatter}
          platform={platform}
        />
      )}
    </div>
  );
}
