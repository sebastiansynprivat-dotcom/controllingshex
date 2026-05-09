import { useEffect, useMemo, useState, useCallback } from "react";
import { motion, useMotionValue, useTransform, useAnimation, AnimatePresence, type PanInfo } from "framer-motion";
import { ArrowLeftRight, Check, X, ChevronUp, Users, TrendingUp, Sparkles, Zap, MessageSquare, Clock, Inbox, Undo2, UserPlus, Search, CalendarDays } from "lucide-react";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import TimeRangeToggle from "@/components/TimeRangeToggle";
import { buildTimeRange, rangeDays, type TimeRange } from "@/lib/timerange-categorize";
import {
  computeSwapCandidates,
  computeManualSwapCandidates,
  computeSwapExpectedGain,
  listAllSwapChatters,
  formatEur,
  formatSkill,
  tierColor,
  type SwapPair,
  type SwapChatter,
  type SwapInput,
  type SwapModelInfo,
} from "@/lib/swap-suggestions";
import { formatFollowers } from "@/lib/model-performance";
import type { BenchmarkBundle } from "@/lib/peer-benchmarks";
import { fetchLiveEfficiency, type LiveEfficiencyRow } from "@/lib/live-efficiency";

interface Props {
  platform: string;
  chatters: SwapInput[];
  models: SwapModelInfo[];
  benchmarks?: BenchmarkBundle | null;
}

const SWIPE_THRESHOLD = 120; // gemäß Memory: nur Distanz, keine velocity

/** Formatiert ISO-Datum (YYYY-MM-DD) als kompaktes deutsches Datum, z.B. "12. Apr 25" */
function formatStartDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "2-digit" });
}

type Side = "left" | "right";

interface MiniCardProps {
  chatter: SwapChatter;
  side: Side;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onSwipeUp: () => void;
  onSingleClick?: () => void;
  onDoubleClick?: () => void;
}

function SwapMiniCard({ chatter, side, onSwipeLeft, onSwipeRight, onSwipeUp, onSingleClick, onDoubleClick }: MiniCardProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-8, 0, 8]);
  const controls = useAnimation();
  const clickTimerRef = useState<{ t: ReturnType<typeof setTimeout> | null }>({ t: null })[0];

  const accentHsl = side === "left" ? "152 70% 45%" : "0 84% 60%";
  const tag = side === "left" ? "Underplaced" : "Overplaced";

  const handleDragEnd = useCallback(
    async (_e: any, info: PanInfo) => {
      const { offset } = info;
      const ax = Math.abs(offset.x);
      const ay = Math.abs(offset.y);
      if (ay > ax && offset.y < -SWIPE_THRESHOLD) {
        await controls.start({ y: -600, opacity: 0, transition: { duration: 0.18 } });
        onSwipeUp();
        return;
      }
      if (offset.x > SWIPE_THRESHOLD) {
        await controls.start({ x: 400, opacity: 0, transition: { duration: 0.18 } });
        onSwipeRight();
        return;
      }
      if (offset.x < -SWIPE_THRESHOLD) {
        await controls.start({ x: -400, opacity: 0, transition: { duration: 0.18 } });
        onSwipeLeft();
        return;
      }
      controls.start({ x: 0, y: 0, transition: { type: "spring", stiffness: 300, damping: 28 } });
    },
    [controls, onSwipeLeft, onSwipeRight, onSwipeUp]
  );

  const handleClick = useCallback(() => {
    // ignore if drag occurred
    if (Math.abs(x.get()) >= 6 || Math.abs(y.get()) >= 6) return;
    if (clickTimerRef.t) {
      clearTimeout(clickTimerRef.t);
      clickTimerRef.t = null;
      onDoubleClick?.();
      return;
    }
    clickTimerRef.t = setTimeout(() => {
      clickTimerRef.t = null;
      onSingleClick?.();
    }, 240);
  }, [x, y, onSingleClick, onDoubleClick, clickTimerRef]);

  return (
    <motion.div
      drag
      dragElastic={0.18}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      animate={controls}
      style={{ x, y, rotate, touchAction: "none" }}
      className="relative w-full rounded-3xl overflow-hidden select-none cursor-grab active:cursor-grabbing"
    >
      {/* dünner Akzent-Streifen oben statt farbiger Box */}
      <div
        className="absolute inset-x-0 top-0 h-[2px] z-10"
        style={{ background: `linear-gradient(90deg, transparent, hsl(${accentHsl} / 0.7), transparent)` }}
      />
      <div
        className="p-3 lg:p-7 border border-white/[0.06] rounded-2xl lg:rounded-3xl"
        style={{
          background: `radial-gradient(140% 100% at 50% -20%, hsl(${accentHsl} / 0.07) 0%, transparent 55%), linear-gradient(180deg, hsl(240 6% 8%) 0%, hsl(240 6% 5%) 100%)`,
          boxShadow: `0 24px 60px -24px hsl(240 10% 0% / 0.7), inset 0 1px 0 hsl(0 0% 100% / 0.04)`,
        }}
      >
        <div className="flex items-center justify-between mb-2 lg:mb-3">
          <span
            className="text-[8px] lg:text-[9px] uppercase tracking-[0.18em] font-semibold px-1.5 lg:px-2 py-0.5 lg:py-1 rounded-full border"
            style={{
              color: `hsl(${accentHsl})`,
              borderColor: `hsl(${accentHsl} / 0.35)`,
              background: `hsl(${accentHsl} / 0.08)`,
            }}
          >
            {tag}
          </span>
          <span
            className="text-[8px] lg:text-[9px] uppercase tracking-wider font-semibold px-1.5 lg:px-2 py-0.5 rounded-md border"
            style={{
              color: `hsl(${tierColor(chatter.tier)})`,
              borderColor: `hsl(${tierColor(chatter.tier)} / 0.35)`,
              background: `hsl(${tierColor(chatter.tier)} / 0.08)`,
            }}
          >
            {chatter.tier}
          </span>
        </div>

        <h3 className="text-base lg:text-2xl font-semibold text-foreground capitalize truncate mb-0.5 leading-tight">
          {chatter.name.replace(/_/g, " ")}
        </h3>
        <p className="text-[10px] lg:text-sm text-white/45 mb-1 truncate">@ {chatter.account}</p>
        <div className="flex items-center gap-2 lg:gap-3 mb-2 lg:mb-5 flex-wrap">
          <p className="text-[9px] lg:text-xs text-white/40 inline-flex items-center gap-1">
            <Users className="h-2.5 w-2.5 lg:h-3.5 lg:w-3.5" />
            {formatFollowers(chatter.followers)}
          </p>
          {chatter.firstSeen && (
            <p
              className="hidden lg:inline-flex text-[10px] lg:text-xs text-white/40 items-center gap-1"
              title={`Erster Eintrag: ${chatter.firstSeen}`}
            >
              <CalendarDays className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
              seit {formatStartDate(chatter.firstSeen)}
            </p>
          )}
        </div>

        {/* Skill-Score Bar */}
        <div className="rounded-lg lg:rounded-xl bg-white/[0.03] border border-white/[0.06] p-2 lg:p-4 mb-2 lg:mb-4">
          <div className="flex items-center justify-between mb-1 lg:mb-2">
            <span className="text-[8px] lg:text-[10px] uppercase tracking-wider text-white/45 inline-flex items-center gap-1">
              <Zap className="h-2.5 w-2.5 lg:h-3 lg:w-3" /> Skill
            </span>
            <span className="text-xs lg:text-lg font-bold tabular-nums" style={{ color: `hsl(${accentHsl})` }}>
              {formatSkill(chatter.skillScore)}
            </span>
          </div>
          <div className="h-1 lg:h-2 rounded-full bg-white/[0.05] overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.round(chatter.skillScore * 100)}%`,
                background: `linear-gradient(90deg, hsl(${accentHsl} / 0.6), hsl(${accentHsl}))`,
              }}
            />
          </div>
        </div>

        {/* Skill-Breakdown — auf Mobile versteckt um Höhe zu sparen.
            Bei Live-Score: €/h, €/Msg, Resp, Tage aktiv (statt Legacy DMs/Resp/Chat/€/F). */}
        <div className="hidden lg:grid grid-cols-4 gap-1.5 lg:gap-2 mb-2.5 lg:mb-4">
          {chatter.skillSource === "live" ? (
            <>
              <SkillPill icon={TrendingUp} label="€/h" value={chatter.scoreBreakdown.massDms} accentHsl={accentHsl} />
              <SkillPill icon={MessageSquare} label="€/Msg" value={chatter.scoreBreakdown.throughput} accentHsl={accentHsl} />
              <SkillPill icon={Clock} label="Resp" value={chatter.scoreBreakdown.response} accentHsl={accentHsl} />
              <SkillPill icon={Inbox} label="Tage" value={chatter.scoreBreakdown.revenue} accentHsl={accentHsl} />
            </>
          ) : (
            <>
              <SkillPill icon={MessageSquare} label="DMs" value={chatter.scoreBreakdown.massDms} accentHsl={accentHsl} />
              <SkillPill icon={Clock} label="Resp" value={chatter.scoreBreakdown.response} accentHsl={accentHsl} />
              <SkillPill icon={Inbox} label="Chat" value={chatter.scoreBreakdown.throughput} accentHsl={accentHsl} />
              <SkillPill icon={TrendingUp} label="€/F" value={chatter.scoreBreakdown.revenue} accentHsl={accentHsl} />
            </>
          )}
        </div>

        {/* Live-Effizienz Header — nur wenn Live-Daten vorhanden */}
        {chatter.live && chatter.skillSource === "live" && (
          <div className="hidden lg:flex items-center justify-between mb-2 px-1 text-[10px]">
            <span className="text-white/45 inline-flex items-center gap-1">
              <Zap className="h-3 w-3" />
              {Math.round(chatter.live.eur_per_active_hour)} € / aktive h
            </span>
            <span className="text-white/35" title={`${chatter.live.session_count} Sessions · ${chatter.live.active_days}/${chatter.live.range_days} Tage`}>
              {chatter.live.session_count} Sess. · {Math.round(chatter.live.total_active_min / 60)}h aktiv
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5 lg:gap-3">
          <div className="rounded-md lg:rounded-lg bg-white/[0.03] border border-white/[0.06] p-1.5 lg:p-3">
            <p className="text-[8px] lg:text-[10px] uppercase tracking-wider text-white/40">7T-Ø</p>
            <p className="text-xs lg:text-base font-semibold text-foreground tabular-nums">{formatEur(chatter.avgRevenue)}</p>
          </div>
          <div className="rounded-md lg:rounded-lg bg-white/[0.03] border border-white/[0.06] p-1.5 lg:p-3">
            <p className="text-[8px] lg:text-[10px] uppercase tracking-wider text-white/40">Heute</p>
            <p className="text-xs lg:text-base font-semibold text-foreground tabular-nums">{formatEur(chatter.currentRevenue)}</p>
          </div>
        </div>

        <div className="hidden lg:block mt-3 lg:mt-4 text-[10px] lg:text-[11px] text-white/35 text-center">
          Wische in jede Richtung &nbsp;·&nbsp; nur diese Karte tauschen
        </div>
      </div>
    </motion.div>
  );
}

function SkillPill({
  icon: Icon,
  label,
  value,
  accentHsl,
}: {
  icon: typeof Zap;
  label: string;
  value: number;
  accentHsl: string;
}) {
  return (
    <div className="rounded-md bg-white/[0.02] border border-white/[0.05] py-1.5 px-1 flex flex-col items-center">
      <Icon className="h-2.5 w-2.5 text-white/45 mb-0.5" />
      <span className="text-[8px] uppercase tracking-wider text-white/35">{label}</span>
      <span className="text-[10px] font-semibold mt-0.5" style={{ color: `hsl(${accentHsl})` }}>
        {Math.round(value * 100)}
      </span>
    </div>
  );
}

export default function SwapModeView({ platform, chatters, models, benchmarks }: Props) {
  /** Zeitfenster für Skill/Avg-Berechnung — analog zu Auffälligkeiten/Vergleich */
  const [timeRange, setTimeRange] = useState<TimeRange>(() => buildTimeRange("7d"));
  const swapWindow = useMemo(
    () => ({ windowDays: rangeDays(timeRange), from: timeRange.from, to: timeRange.to }),
    [timeRange]
  );

  /** Live-Effizienz pro Chatter (key = chatter_name lowercase). Wird stündlich serverseitig
   *  aus chatter_activity_sessions berechnet — basiert auf echten Online-Phasen statt
   *  Tagessummen. Fällt zurück auf den Legacy-Skill-Score wenn ein Chatter <60min/<3 Sessions
   *  in dem gewählten Range hat. */
  const [liveEfficiency, setLiveEfficiency] = useState<Map<string, LiveEfficiencyRow>>(new Map());
  useEffect(() => {
    let cancelled = false;
    fetchLiveEfficiency(platform, timeRange.from, timeRange.to).then((m) => {
      if (!cancelled) setLiveEfficiency(m);
    });
    return () => { cancelled = true; };
  }, [platform, timeRange.from, timeRange.to]);

  const autoPairs = useMemo(
    () => computeSwapCandidates(chatters, models, benchmarks ?? null, { platform, window: swapWindow, liveEfficiency }),
    [chatters, models, benchmarks, platform, swapWindow, liveEfficiency]
  );

  /** Manueller Modus: Wenn ein Chatter gewählt wurde, ersetzen seine Vorschläge die Auto-Pairs. */
  const [manualChatterName, setManualChatterName] = useState<string | null>(null);
  const [manualPickerOpen, setManualPickerOpen] = useState(false);
  const [manualSearch, setManualSearch] = useState("");

  const allChatterOptions = useMemo(
    () => listAllSwapChatters(chatters, models, swapWindow, liveEfficiency),
    [chatters, models, swapWindow, liveEfficiency]
  );
  /** Pro Chatter-Name nur 1 Eintrag (mit höchstem Skill) für Auswahl */
  const uniqueChatterOptions = useMemo(() => {
    const map = new Map<string, SwapChatter>();
    for (const c of allChatterOptions) {
      const existing = map.get(c.name);
      if (!existing || c.skillScore > existing.skillScore) map.set(c.name, c);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [allChatterOptions]);

  const manualPairs = useMemo(() => {
    if (!manualChatterName) return null;
    return computeManualSwapCandidates(chatters, models, manualChatterName, benchmarks ?? null, 8, swapWindow, liveEfficiency);
  }, [manualChatterName, chatters, models, benchmarks, swapWindow, liveEfficiency]);

  const allPairs = manualPairs ?? autoPairs;
  const isManualMode = manualPairs !== null;

  const [pairIdx, setPairIdx] = useState(0);
  const [leftAltIdx, setLeftAltIdx] = useState(0);
  const [rightAltIdx, setRightAltIdx] = useState(0);
  /** analysis_date des neuesten Reports — Ausblendungen sind an diesen Key gebunden.
   *  Sobald ein neuer Report kommt, ändert sich der Key → alte Ausblendungen verfallen. */
  const [reportDateKey, setReportDateKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("analysis_reports")
        .select("analysis_date")
        .eq("user_id", user.id)
        .eq("platform", platform)
        .order("analysis_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setReportDateKey(data?.analysis_date ?? "no-report");
    })();
    return () => { cancelled = true; };
  }, [platform]);

  const storageKey = useMemo(
    () => reportDateKey ? `swap_report_dismissed::${platform}::${reportDateKey}` : null,
    [platform, reportDateKey]
  );
  /** Persistenter Key für einzeln weggewischte Karten-Keys (an Report gebunden) */
  const cardStorageKey = useMemo(
    () => reportDateKey ? `swap_report_dismissed_cards::${platform}::${reportDateKey}` : null,
    [platform, reportDateKey]
  );
  const [dailyDismissed, setDailyDismissed] = useState<Set<string>>(new Set());
  /** Pro Karte: einzeln verworfene Kandidaten-Keys — persistiert bis zum nächsten Report */
  const [dismissedLeftKeys, setDismissedLeftKeys] = useState<Set<string>>(new Set());
  const [dismissedRightKeys, setDismissedRightKeys] = useState<Set<string>>(new Set());
  // Lade Ausblendungen sobald storageKey bekannt ist + räume veraltete Keys auf
  useEffect(() => {
    if (typeof window === "undefined" || !storageKey || !cardStorageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      setDailyDismissed(raw ? new Set(JSON.parse(raw) as string[]) : new Set());
      const rawCards = window.localStorage.getItem(cardStorageKey);
      if (rawCards) {
        const parsed = JSON.parse(rawCards) as { left?: string[]; right?: string[] };
        setDismissedLeftKeys(new Set(parsed.left ?? []));
        setDismissedRightKeys(new Set(parsed.right ?? []));
      } else {
        setDismissedLeftKeys(new Set());
        setDismissedRightKeys(new Set());
      }
      // Alte Keys (anderer Report) löschen
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i);
        if (
          k &&
          (k.startsWith("swap_report_dismissed::") ||
           k.startsWith("swap_report_dismissed_cards::") ||
           k.startsWith("swap_daily_dismissed::")) &&
          k !== storageKey &&
          k !== cardStorageKey
        ) {
          window.localStorage.removeItem(k);
        }
      }
    } catch { /* ignore */ }
  }, [storageKey, cardStorageKey]);
  // Persistieren dailyDismissed
  useEffect(() => {
    if (typeof window === "undefined" || !storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(Array.from(dailyDismissed)));
    } catch { /* ignore */ }
  }, [dailyDismissed, storageKey]);
  // Persistieren dismissedLeftKeys / dismissedRightKeys
  useEffect(() => {
    if (typeof window === "undefined" || !cardStorageKey) return;
    try {
      window.localStorage.setItem(
        cardStorageKey,
        JSON.stringify({ left: Array.from(dismissedLeftKeys), right: Array.from(dismissedRightKeys) })
      );
    } catch { /* ignore */ }
  }, [dismissedLeftKeys, dismissedRightKeys, cardStorageKey]);
  /** Pair-Keys die in dieser Session lokal verworfen wurden (zusätzlich zu DB-Snoozes) */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  /** Pair-Keys die in dieser Session "für später" geskippt wurden — kommen am Ende wieder. */
  const [skippedForLater, setSkippedForLater] = useState<Set<string>>(new Set());
  /** Pair-Keys die in der DB aktiv geblockt sind (snoozed_until > now ODER status=approved) */
  const [persistedBlocked, setPersistedBlocked] = useState<Set<string>>(new Set());
  const [profileOpen, setProfileOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  /** Stack der letzten Aktionen für Undo (max 20) */
  type HistoryEntry = {
    /** DB-ID falls eine Decision persistiert wurde (sonst null bei Alt-Cycle) */
    decisionId: string | null;
    pairKeys: string[];
    sessionKey: string;
    pairIdxBefore: number;
    leftAltIdxBefore: number;
    rightAltIdxBefore: number;
    action: "approved" | "rejected" | "snoozed" | "alt-left" | "alt-right";
    leftName: string;
    rightName: string;
    /** Chatter-Namen die durch diese Aktion in dailyDismissed eingefügt wurden (für Undo) */
    dailyDismissedAdded?: string[];
    /** Card-Keys die durch alt-cycle in dismissedLeftKeys/RightKeys eingefügt wurden (für Undo) */
    dismissedLeftAdded?: string[];
    dismissedRightAdded?: string[];
  };
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  /** Pair-Key beider Richtungen — Tausch ist symmetrisch */
  const pairKeyVariants = useCallback((aName: string, aAcc: string, bName: string, bAcc: string) => {
    const k1 = `${aName}::${aAcc}::${bName}::${bAcc}`;
    const k2 = `${bName}::${bAcc}::${aName}::${aAcc}`;
    return [k1, k2];
  }, []);

  const buildKey = useCallback(
    (left?: SwapChatter, right?: SwapChatter) => {
      if (!left || !right) return "";
      return `${left.name}::${left.account}::${right.name}::${right.account}`;
    },
    []
  );

  // Lade aktive Block-Einträge aus swap_decisions
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("swap_decisions")
        .select("chatter_a, chatter_b, model_a, model_b, status, snoozed_until")
        .eq("user_id", user.id)
        .eq("platform", platform)
        .or(`status.eq.approved,snoozed_until.gt.${nowIso}`);
      if (cancelled || error || !data) return;
      const blocked = new Set<string>();
      for (const row of data) {
        const aName = row.chatter_a || "";
        const bName = row.chatter_b || "";
        const aAcc = row.model_a || "";
        const bAcc = row.model_b || "";
        for (const k of pairKeyVariants(aName, aAcc, bName, bAcc)) blocked.add(k);
      }
      setPersistedBlocked(blocked);
    })();
    return () => { cancelled = true; };
  }, [platform, pairKeyVariants]);

  // Reset alt-overrides when pair index changes (Indizes nur, nicht die persistierten Dismissals)
  useEffect(() => {
    setLeftAltIdx(0);
    setRightAltIdx(0);
  }, [pairIdx]);

  // Reset pair index + history when manual mode toggles (persistierte Dismissals bleiben)
  useEffect(() => {
    setPairIdx(0);
    setLeftAltIdx(0);
    setRightAltIdx(0);
  }, [manualChatterName]);

  const currentPair: SwapPair | undefined = useMemo(() => {
    // Erst Pairs die nicht "für später" geskippt wurden, dann am Ende die geskippten.
    const tryFind = (includeSkipped: boolean) => {
      let i = pairIdx;
      while (i < allPairs.length) {
        const p = allPairs[i];
        const sessionKey = `${p.left.key}::${p.right.key}`;
        const dbKey = buildKey(p.left, p.right);
        const blockedByDaily =
          dailyDismissed.has(p.left.name) || dailyDismissed.has(p.right.name);
        const isSkipped = skippedForLater.has(sessionKey);
        const passSkip = includeSkipped ? true : !isSkipped;
        if (!blockedByDaily && !dismissed.has(sessionKey) && !persistedBlocked.has(dbKey) && passSkip) return p;
        i++;
      }
      return undefined;
    };
    return tryFind(false) ?? tryFind(true);
  }, [allPairs, pairIdx, dismissed, persistedBlocked, buildKey, dailyDismissed, skippedForLater]);

  /** Sichtbare Pairs (nach allen Filtern) — für korrekten Header-Counter.
   *  Underplaced (links) & Overplaced (rechts) werden separat als unique Chatter-Namen gezählt,
   *  damit der Counter zur Checkliste passt (jeder Chatter zählt nur einmal pro Seite). */
  const visiblePairsInfo = useMemo(() => {
    const underTotal = new Set<string>();
    const overTotal = new Set<string>();
    const underDone = new Set<string>();
    const overDone = new Set<string>();
    let total = 0;
    let currentPos = 0;
    allPairs.forEach((p) => {
      const sessionKey = `${p.left.key}::${p.right.key}`;
      const dbKey = buildKey(p.left, p.right);
      const leftDone = dailyDismissed.has(p.left.name);
      const rightDone = dailyDismissed.has(p.right.name);
      const pairDone = dismissed.has(sessionKey) || persistedBlocked.has(dbKey);
      // Universum: jeder eindeutige Chatter, der überhaupt mal vorgeschlagen wurde
      underTotal.add(p.left.name);
      overTotal.add(p.right.name);
      if (leftDone || pairDone) underDone.add(p.left.name);
      if (rightDone || pairDone) overDone.add(p.right.name);

      const blocked = leftDone || rightDone || pairDone;
      if (!blocked) {
        total++;
        if (currentPair && p === currentPair) currentPos = total;
      }
    });
    return {
      total,
      currentPos,
      underDone: underDone.size,
      underTotal: underTotal.size,
      overDone: overDone.size,
      overTotal: overTotal.size,
    };
  }, [allPairs, dismissed, persistedBlocked, dailyDismissed, buildKey, currentPair]);

  /** Liefert alle Kandidaten der linken Seite in Reihenfolge: [main, ...alts] */
  const leftCandidates: SwapChatter[] = useMemo(() => {
    if (!currentPair) return [];
    return [currentPair.left, ...currentPair.leftAlternatives];
  }, [currentPair]);

  const rightCandidates: SwapChatter[] = useMemo(() => {
    if (!currentPair) return [];
    return [currentPair.right, ...currentPair.rightAlternatives];
  }, [currentPair]);

  /** Erster nicht-dismisster Kandidat ab leftAltIdx (zirkulär) */
  const visibleLeft: SwapChatter | undefined = useMemo(() => {
    if (leftCandidates.length === 0) return undefined;
    const n = leftCandidates.length;
    for (let off = 0; off < n; off++) {
      const c = leftCandidates[(leftAltIdx + off) % n];
      if (dismissedLeftKeys.has(c.key)) continue;
      if (dailyDismissed.has(c.name)) continue;
      return c;
    }
    return undefined;
  }, [leftCandidates, leftAltIdx, dismissedLeftKeys, dailyDismissed]);

  const visibleRight: SwapChatter | undefined = useMemo(() => {
    if (rightCandidates.length === 0) return undefined;
    const n = rightCandidates.length;
    for (let off = 0; off < n; off++) {
      const c = rightCandidates[(rightAltIdx + off) % n];
      if (dismissedRightKeys.has(c.key)) continue;
      if (dailyDismissed.has(c.name)) continue;
      return c;
    }
    return undefined;
  }, [rightCandidates, rightAltIdx, dismissedRightKeys, dailyDismissed]);

  const visibleGain = useMemo(() => {
    if (!visibleLeft || !visibleRight) return 0;
    return Math.max(0, computeSwapExpectedGain(visibleLeft, visibleRight, benchmarks ?? null));
  }, [visibleLeft, visibleRight, benchmarks]);

  const advancePair = useCallback(() => {
    setPairIdx((i) => i + 1);
  }, []);

  /** Lokal aus dem Stack entfernen (für visuellen Wechsel zur nächsten Karte) */
  const removeFromStack = useCallback((left: SwapChatter, right: SwapChatter) => {
    const sessionKey = `${left.key}::${right.key}`;
    setDismissed((prev) => {
      const n = new Set(prev);
      n.add(sessionKey);
      return n;
    });
    advancePair();
  }, [advancePair]);

  const copyChatterName = useCallback(async (name: string) => {
    const display = name.replace(/_/g, " ");
    try {
      await navigator.clipboard.writeText(display);
      toast.success(`"${display}" kopiert`);
    } catch {
      toast.error("Kopieren fehlgeschlagen");
    }
  }, []);

  const pushHistory = useCallback(
    (entry: HistoryEntry) => {
      setHistory((prev) => [...prev, entry].slice(-20));
    },
    []
  );

  const cycleLeftAlt = useCallback(() => {
    if (!currentPair || !visibleLeft || !visibleRight) return;
    const total = leftCandidates.length;
    const remaining = leftCandidates.filter(
      (c) => c.key !== visibleLeft.key && !dismissedLeftKeys.has(c.key) && !dailyDismissed.has(c.name)
    );
    if (remaining.length === 0) {
      toast("Keine weiteren Kandidaten links", { icon: "ℹ️" });
      return;
    }
    pushHistory({
      decisionId: null,
      pairKeys: [],
      sessionKey: "",
      pairIdxBefore: pairIdx,
      leftAltIdxBefore: leftAltIdx,
      rightAltIdxBefore: rightAltIdx,
      action: "alt-left" as const,
      leftName: visibleLeft.name,
      rightName: visibleRight.name,
      dismissedLeftAdded: [visibleLeft.key],
    });
    // Persistiert nur diese Karte (nicht den Chatter global) → Pair bleibt sichtbar
    setDismissedLeftKeys((prev) => {
      const n = new Set(prev);
      n.add(visibleLeft.key);
      return n;
    });
    setLeftAltIdx((i) => (i + 1) % Math.max(total, 1));
  }, [currentPair, visibleLeft, visibleRight, leftCandidates, dismissedLeftKeys, dailyDismissed, pairIdx, leftAltIdx, rightAltIdx, pushHistory]);

  const cycleRightAlt = useCallback(() => {
    if (!currentPair || !visibleLeft || !visibleRight) return;
    const total = rightCandidates.length;
    const remaining = rightCandidates.filter(
      (c) => c.key !== visibleRight.key && !dismissedRightKeys.has(c.key) && !dailyDismissed.has(c.name)
    );
    if (remaining.length === 0) {
      toast("Keine weiteren Kandidaten rechts", { icon: "ℹ️" });
      return;
    }
    pushHistory({
      decisionId: null,
      pairKeys: [],
      sessionKey: "",
      pairIdxBefore: pairIdx,
      leftAltIdxBefore: leftAltIdx,
      rightAltIdxBefore: rightAltIdx,
      action: "alt-right" as const,
      leftName: visibleLeft.name,
      rightName: visibleRight.name,
      dismissedRightAdded: [visibleRight.key],
    });
    setDismissedRightKeys((prev) => {
      const n = new Set(prev);
      n.add(visibleRight.key);
      return n;
    });
    setRightAltIdx((i) => (i + 1) % Math.max(total, 1));
  }, [currentPair, visibleLeft, visibleRight, rightCandidates, dismissedRightKeys, dailyDismissed, pairIdx, leftAltIdx, rightAltIdx, pushHistory]);

  /** Persistiert eine Decision in der DB. Returnt die DB-ID oder null bei Fehler. */
  const persistDecision = useCallback(
    async (
      left: SwapChatter,
      right: SwapChatter,
      status: "approved" | "rejected" | "snoozed",
      snoozeDays: number | null
    ): Promise<string | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Nicht angemeldet");
        return null;
      }
      const snoozedUntil =
        snoozeDays !== null
          ? new Date(Date.now() + snoozeDays * 24 * 60 * 60 * 1000).toISOString()
          : null;
      const { data, error } = await supabase.from("swap_decisions").insert({
        user_id: user.id,
        platform,
        chatter_a: left.name,
        chatter_b: right.name,
        model_a: left.account,
        model_b: right.account,
        status,
        snoozed_until: snoozedUntil,
      }).select("id").single();
      if (error || !data) {
        toast.error("Konnte Entscheidung nicht speichern");
        return null;
      }
      // Lokal cachen damit es sofort weg ist
      const keys = pairKeyVariants(left.name, left.account, right.name, right.account);
      setPersistedBlocked((prev) => {
        const n = new Set(prev);
        for (const k of keys) n.add(k);
        return n;
      });
      return data.id;
    },
    [platform, pairKeyVariants]
  );


  const approveSwap = useCallback(async () => {
    if (!visibleLeft || !visibleRight) return;
    const decisionId = await persistDecision(visibleLeft, visibleRight, "approved", null);
    if (!decisionId) return;
    const added = [visibleLeft.name, visibleRight.name];
    pushHistory({
      decisionId,
      pairKeys: pairKeyVariants(visibleLeft.name, visibleLeft.account, visibleRight.name, visibleRight.account),
      sessionKey: `${visibleLeft.key}::${visibleRight.key}`,
      pairIdxBefore: pairIdx,
      leftAltIdxBefore: leftAltIdx,
      rightAltIdxBefore: rightAltIdx,
      action: "approved",
      leftName: visibleLeft.name,
      rightName: visibleRight.name,
      dailyDismissedAdded: added,
    });
    setDailyDismissed((prev) => {
      const n = new Set(prev);
      for (const name of added) n.add(name);
      return n;
    });
    toast.success(`Tausch gespeichert: +${formatEur(visibleGain)}/Tag`);
    advancePair();
  }, [visibleLeft, visibleRight, visibleGain, advancePair, persistDecision, pushHistory, pairKeyVariants, pairIdx, leftAltIdx, rightAltIdx]);

  /** Skip → Pair für später in dieser Session zurückstellen (kein DB-Eintrag). */
  const skipPair = useCallback(() => {
    if (!visibleLeft || !visibleRight) return;
    const sessionKey = `${visibleLeft.key}::${visibleRight.key}`;
    pushHistory({
      decisionId: null,
      pairKeys: [],
      sessionKey,
      pairIdxBefore: pairIdx,
      leftAltIdxBefore: leftAltIdx,
      rightAltIdxBefore: rightAltIdx,
      action: "snoozed",
      leftName: visibleLeft.name,
      rightName: visibleRight.name,
    });
    setSkippedForLater((prev) => {
      const n = new Set(prev);
      n.add(sessionKey);
      return n;
    });
    setPairIdx((i) => i + 1);
    toast("Übersprungen — kommt später wieder", { icon: "⏭️" });
  }, [visibleLeft, visibleRight, pushHistory, pairIdx, leftAltIdx, rightAltIdx]);

  /** Roter X → öffnet Modal mit 1/7/30 Tage Auswahl */
  const openRejectModal = useCallback(() => {
    if (!visibleLeft || !visibleRight) return;
    setRejectModalOpen(true);
  }, [visibleLeft, visibleRight]);

  const confirmReject = useCallback(
    async (days: number) => {
      if (!visibleLeft || !visibleRight) return;
      const decisionId = await persistDecision(visibleLeft, visibleRight, "rejected", days);
      if (!decisionId) {
        setRejectModalOpen(false);
        return;
      }
      pushHistory({
        decisionId,
        pairKeys: pairKeyVariants(visibleLeft.name, visibleLeft.account, visibleRight.name, visibleRight.account),
        sessionKey: `${visibleLeft.key}::${visibleRight.key}`,
        pairIdxBefore: pairIdx,
        leftAltIdxBefore: leftAltIdx,
        rightAltIdxBefore: rightAltIdx,
        action: "rejected",
        leftName: visibleLeft.name,
        rightName: visibleRight.name,
      });
      const label = days === 1 ? "1 Tag" : `${days} Tage`;
      toast(`Später anzeigen (${label})`, { icon: "🕒" });
      setRejectModalOpen(false);
      removeFromStack(visibleLeft, visibleRight);
    },
    [visibleLeft, visibleRight, persistDecision, removeFromStack, pushHistory, pairKeyVariants, pairIdx, leftAltIdx, rightAltIdx]
  );

  /** Macht den letzten Swipe rückgängig: löscht DB-Eintrag + restored Index/Dismissed/Block-Cache */
  const undoLast = useCallback(async () => {
    if (history.length === 0) {
      toast("Nichts zum Rückgängig-Machen", { icon: "ℹ️" });
      return;
    }
    const last = history[history.length - 1];
    // DB-Eintrag löschen
    if (last.decisionId) {
      const { error } = await supabase.from("swap_decisions").delete().eq("id", last.decisionId);
      if (error) {
        toast.error("Konnte nicht rückgängig machen");
        return;
      }
    }
    // State zurücksetzen
    setPersistedBlocked((prev) => {
      const n = new Set(prev);
      for (const k of last.pairKeys) n.delete(k);
      return n;
    });
    setDismissed((prev) => {
      const n = new Set(prev);
      n.delete(last.sessionKey);
      return n;
    });
    setSkippedForLater((prev) => {
      if (!prev.has(last.sessionKey)) return prev;
      const n = new Set(prev);
      n.delete(last.sessionKey);
      return n;
    });
    if (last.dailyDismissedAdded && last.dailyDismissedAdded.length > 0) {
      setDailyDismissed((prev) => {
        const n = new Set(prev);
        for (const name of last.dailyDismissedAdded!) n.delete(name);
        return n;
      });
    }
    if (last.dismissedLeftAdded && last.dismissedLeftAdded.length > 0) {
      setDismissedLeftKeys((prev) => {
        const n = new Set(prev);
        for (const k of last.dismissedLeftAdded!) n.delete(k);
        return n;
      });
    }
    if (last.dismissedRightAdded && last.dismissedRightAdded.length > 0) {
      setDismissedRightKeys((prev) => {
        const n = new Set(prev);
        for (const k of last.dismissedRightAdded!) n.delete(k);
        return n;
      });
    }
    setPairIdx(last.pairIdxBefore);
    setLeftAltIdx(last.leftAltIdxBefore);
    setRightAltIdx(last.rightAltIdxBefore);
    setHistory((prev) => prev.slice(0, -1));
    const display = last.leftName.replace(/_/g, " ") + " ↔ " + last.rightName.replace(/_/g, " ");
    toast.success(`Rückgängig: ${display}`, { icon: "↩️" });
  }, [history]);




  const manualBanner = isManualMode && manualChatterName ? (
    <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03]">
      <div className="flex items-center gap-2 text-xs text-white/70">
        <UserPlus className="h-3.5 w-3.5 text-white/50" />
        <span className="uppercase tracking-wider text-[10px] text-white/45">Manuelle Auswahl:</span>
        <span className="font-semibold text-foreground capitalize">{manualChatterName.replace(/_/g, " ")}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => { setManualChatterName(null); setHistory([]); }}
        className="h-7 text-[11px] text-white/60 hover:text-white"
      >
        ← Zurück zu Auto-Vorschlägen
      </Button>
    </div>
  ) : null;

  const timeRangeBar = (
    <div className="mb-3 flex flex-wrap items-center gap-2 shrink-0">
      <span className="text-[9px] lg:text-[10px] uppercase tracking-[0.18em] text-white/35 font-medium mr-1">
        Zeitfenster
      </span>
      <TimeRangeToggle value={timeRange} onChange={setTimeRange} />
      <span className="text-[10px] text-white/35 ml-auto tabular-nums">
        Ø über {rangeDays(timeRange)} {rangeDays(timeRange) === 1 ? "Tag" : "Tage"}
      </span>
    </div>
  );

  if (allPairs.length === 0) {
    return (
      <div className="flex flex-col h-full min-h-0 px-3 sm:px-6 lg:px-10 pt-1.5 sm:pt-3 lg:pt-6">
        {timeRangeBar}
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center">
          <Sparkles className="h-8 w-8 text-white/30" />
          <p className="text-sm text-foreground font-medium">
            {isManualMode ? "Keine Tausch-Partner gefunden" : "Keine Tausch-Vorschläge"}
          </p>
          <p className="text-xs text-muted-foreground max-w-xs">
            {isManualMode
              ? `Für ${manualChatterName?.replace(/_/g, " ")} gibt es keine Chatter mit passender Skill-/Follower-Konstellation im gewählten Zeitfenster.`
              : "Im gewählten Zeitfenster gibt es keine deutlich über- oder unterperformenden Chatter. Probier ein größeres Fenster (z.B. 14T oder 30T) oder stell sicher, dass Models mit Follower-Zahlen gepflegt sind und ein aktueller Report vorliegt."}
          </p>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => setManualPickerOpen(true)}>
              <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Chatter manuell wählen
            </Button>
            {isManualMode && (
              <Button variant="ghost" size="sm" onClick={() => setManualChatterName(null)}>
                Zurück
              </Button>
            )}
          </div>
        </div>
        {renderManualPicker()}
      </div>
    );
  }

  if (!currentPair || !visibleLeft || !visibleRight) {
    return (
      <div className="flex flex-col h-full min-h-0 px-3 sm:px-6 lg:px-10 pt-1.5 sm:pt-3 lg:pt-6">
        {timeRangeBar}
        <div className="flex flex-col items-center justify-center flex-1 gap-3">
          <div className="text-4xl">✅</div>
          <p className="text-sm text-foreground font-medium">Alle Tausch-Vorschläge durch</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setPairIdx(0); setDismissed(new Set()); }}>
              Nochmal durchgehen
            </Button>
            <Button variant="outline" size="sm" onClick={() => setManualPickerOpen(true)}>
              <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Chatter manuell wählen
            </Button>
          </div>
        </div>
        {renderManualPicker()}
      </div>
    );
  }

  function renderManualPicker() {
    const filtered = uniqueChatterOptions.filter((c) =>
      c.name.toLowerCase().includes(manualSearch.toLowerCase())
    );
    return (
      <AnimatePresence>
        {manualPickerOpen && (
          <motion.div
            key="manual-picker"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setManualPickerOpen(false)}
          >
            <motion.div
              initial={{ y: 20, scale: 0.96, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 10, opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-zinc-950 p-5 shadow-2xl flex flex-col max-h-[80vh]"
            >
              <div className="flex items-center gap-2 mb-3">
                <UserPlus className="h-4 w-4 text-white/60" />
                <h3 className="text-sm font-semibold text-foreground">Chatter manuell wählen</h3>
              </div>
              <p className="text-xs text-white/55 mb-3">
                Wähle einen Chatter — Finne berechnet passende Tausch-Partner basierend auf seinen Skill-Daten.
              </p>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                <Input
                  autoFocus
                  placeholder="Chatter suchen…"
                  value={manualSearch}
                  onChange={(e) => setManualSearch(e.target.value)}
                  className="pl-9 h-9 bg-white/[0.03] border-white/[0.08] text-sm"
                />
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
                {filtered.length === 0 ? (
                  <p className="text-xs text-white/40 text-center py-6">Keine Chatter gefunden</p>
                ) : (
                  <div className="space-y-1">
                    {filtered.map((c) => (
                      <button
                        key={c.name}
                        onClick={() => {
                          setManualChatterName(c.name);
                          setManualPickerOpen(false);
                          setManualSearch("");
                          setHistory([]);
                        }}
                        className="w-full flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/[0.12] transition-colors px-3 py-2 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground capitalize truncate">
                            {c.name.replace(/_/g, " ")}
                          </p>
                          <p className="text-[10px] text-white/40 truncate">
                            {c.tier} · Skill {formatSkill(c.skillScore)}
                          </p>
                        </div>
                        <span
                          className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded border shrink-0"
                          style={{
                            color: `hsl(${tierColor(c.tier)})`,
                            borderColor: `hsl(${tierColor(c.tier)} / 0.35)`,
                            background: `hsl(${tierColor(c.tier)} / 0.08)`,
                          }}
                        >
                          {c.tier}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setManualPickerOpen(false)}
                className="w-full text-xs text-white/50 hover:text-white mt-3"
              >
                Abbrechen
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden relative">

      <div
        className="flex flex-col min-h-0 lg:h-full w-full max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-10 pt-1.5 sm:pt-3 lg:pt-6 pb-3 lg:pb-6 overflow-y-auto lg:overflow-hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
        {manualBanner}
        {/* Zeitfenster-Filter — analog zu Auffälligkeiten/Vergleich */}
        <div className="mb-2 lg:mb-3 flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-[9px] lg:text-[10px] uppercase tracking-[0.18em] text-white/35 font-medium mr-1">
            Zeitfenster
          </span>
          <TimeRangeToggle value={timeRange} onChange={setTimeRange} />
          <span className="text-[10px] text-white/35 ml-auto tabular-nums">
            Ø über {rangeDays(timeRange)} {rangeDays(timeRange) === 1 ? "Tag" : "Tage"}
          </span>
        </div>
        {/* Header — Mobile: zwei Reihen, Desktop: eine Reihe */}
        <div className="mb-2.5 lg:mb-6 flex shrink-0 flex-col lg:flex-row lg:items-center lg:justify-between gap-2 lg:gap-3">
          {/* Reihe 1: Label + Counter + +€/Tag (Hauptpill, rechts) */}
          <div className="flex items-center justify-between gap-2 lg:gap-3 flex-wrap">
            <div className="flex items-baseline gap-2 lg:gap-3 flex-wrap">
              <span className="text-[10px] lg:text-xs uppercase tracking-[0.22em] text-white/40 font-medium">
                {isManualMode ? "Manueller Vorschlag" : "Wechsel-Vorschlag"}
              </span>
              <span
                className="text-[9px] lg:text-[10px] uppercase tracking-wider font-semibold tabular-nums px-1.5 py-0.5 rounded-md border"
                style={{
                  color: "hsl(152 70% 60%)",
                  borderColor: "hsl(152 70% 45% / 0.35)",
                  background: "hsl(152 70% 45% / 0.08)",
                }}
                title="Underplaced Chatter (links)"
              >
                ↑ {visiblePairsInfo.underDone}/{visiblePairsInfo.underTotal}
              </span>
              <span
                className="text-[9px] lg:text-[10px] uppercase tracking-wider font-semibold tabular-nums px-1.5 py-0.5 rounded-md border"
                style={{
                  color: "hsl(0 84% 70%)",
                  borderColor: "hsl(0 84% 60% / 0.35)",
                  background: "hsl(0 84% 60% / 0.08)",
                }}
                title="Overplaced Chatter (rechts)"
              >
                ↓ {visiblePairsInfo.overDone}/{visiblePairsInfo.overTotal}
              </span>
            </div>
            <span
              className="inline-flex items-center gap-1 lg:gap-2 text-[11px] lg:text-sm font-bold px-2.5 lg:px-4 py-1 lg:py-2 rounded-full border tabular-nums shrink-0"
              style={{
                color: visibleGain > 0 ? "hsl(152 70% 60%)" : "hsl(0 0% 60%)",
                borderColor: visibleGain > 0 ? "hsl(152 70% 45% / 0.45)" : "hsl(0 0% 100% / 0.1)",
                background: visibleGain > 0 ? "hsl(152 70% 45% / 0.10)" : "transparent",
                boxShadow: visibleGain > 0 ? "0 4px 22px -8px hsl(152 70% 45% / 0.6)" : "none",
              }}
            >
              <TrendingUp className="h-3 w-3 lg:h-4 lg:w-4" />
              +{formatEur(visibleGain)} / Tag
            </span>
          </div>

          {/* Reihe 2 (nur Mobile): Follower-Ratio + Manuell-Button */}
          <div className="flex items-center justify-between gap-2 lg:gap-3">
            <span
              className="text-[9px] lg:text-[10px] uppercase tracking-wider font-semibold px-2 lg:px-3 py-1 lg:py-1.5 rounded-full border bg-white/[0.02]"
              style={{
                color: "hsl(200 60% 70%)",
                borderColor: "hsl(200 55% 55% / 0.3)",
              }}
              title="Wieviel mehr Follower der Ziel-Account hat"
            >
              {currentPair.followerRatio.toFixed(1)}× Follower
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManualPickerOpen(true)}
              className="h-8 text-[11px] border-white/10 text-white/70 hover:text-white hover:bg-white/5 shrink-0"
              title="Chatter manuell auswählen"
            >
              <UserPlus className="h-3.5 w-3.5 lg:mr-1.5" />
              <span className="hidden sm:inline">{isManualMode ? "Anderen wählen" : "Manuell wählen"}</span>
            </Button>
          </div>
        </div>

        {/* Cards stage */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 lg:gap-10 items-start lg:items-center relative overflow-visible lg:flex-1 lg:min-h-0">
          <AnimatePresence mode="popLayout">
            <motion.div
              key={`L-${currentPair.left.key}-${leftAltIdx}`}
              initial={{ opacity: 0, scale: 0.96, x: -24 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.22 }}
              className="w-full max-w-[520px] mx-auto lg:justify-self-end"
            >
              <SwapMiniCard
                chatter={visibleLeft}
                side="left"
                onSwipeLeft={cycleLeftAlt}
                onSwipeRight={cycleLeftAlt}
                onSwipeUp={cycleLeftAlt}
                onSingleClick={() => copyChatterName(visibleLeft.name)}
                onDoubleClick={() => setProfileOpen(true)}
              />
            </motion.div>
          </AnimatePresence>

          {/* Center swap badge — auf Mobile inline zwischen Karten, auf Desktop absolut zentriert */}
          <div className="lg:pointer-events-none lg:absolute lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:z-10 flex flex-col items-center gap-2 justify-self-center -my-1 lg:my-0">
            <div
              className="h-10 w-10 lg:h-16 lg:w-16 rounded-full flex items-center justify-center border-2"
              style={{
                background:
                  "radial-gradient(circle at 30% 30%, hsl(40 60% 60% / 0.35) 0%, hsl(40 45% 40% / 0.18) 60%, hsl(40 30% 20% / 0.05) 100%)",
                borderColor: "hsl(40 55% 55% / 0.45)",
                boxShadow:
                  "0 0 0 6px hsl(240 6% 6% / 0.85), 0 8px 30px -6px hsl(40 55% 50% / 0.55), inset 0 1px 0 hsl(40 80% 80% / 0.15)",
              }}
            >
              <ArrowLeftRight className="h-4 w-4 lg:h-7 lg:w-7 rotate-90 lg:rotate-0" style={{ color: "hsl(40 70% 75%)" }} />
            </div>
            <span
              className="hidden lg:block text-[10px] uppercase tracking-[0.22em] font-semibold px-2 py-0.5 rounded-full bg-zinc-950/80 border"
              style={{
                color: "hsl(40 55% 70%)",
                borderColor: "hsl(40 45% 55% / 0.3)",
              }}
            >
              Tausch
            </span>
          </div>

          <AnimatePresence mode="popLayout">
            <motion.div
              key={`R-${currentPair.right.key}-${rightAltIdx}`}
              initial={{ opacity: 0, scale: 0.96, x: 24 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.22 }}
              className="w-full max-w-[520px] mx-auto lg:justify-self-start"
            >
              <SwapMiniCard
                chatter={visibleRight}
                side="right"
                onSwipeLeft={cycleRightAlt}
                onSwipeRight={cycleRightAlt}
                onSwipeUp={cycleRightAlt}
                onSingleClick={() => copyChatterName(visibleRight.name)}
                onDoubleClick={() => setProfileOpen(true)}
              />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Hint row */}
        <div className="hidden lg:flex items-center justify-center mt-3 mb-1">
          <span className="text-[10px] uppercase tracking-[0.18em] text-white/30">
            Klick = Name kopieren · Doppelklick = Profil-Vergleich · ↑ nur diese Karte tauschen · ↑-Button Pair skippen · X Später anzeigen · ✓ Genehmigen · ↩ Rückgängig
          </span>
        </div>

        {/* Action buttons */}
        <div className="sticky bottom-0 z-20 -mx-3 mt-3 flex shrink-0 items-center justify-center gap-3 lg:static lg:mx-0 lg:gap-5 lg:mt-5 bg-background/92 px-3 py-2.5 backdrop-blur-xl border-t border-white/[0.06] lg:bg-transparent lg:p-0 lg:border-0 lg:backdrop-blur-0">
          <Button
            variant="outline"
            size="icon"
            onClick={undoLast}
            disabled={history.length === 0}
            className="h-10 w-10 lg:h-12 lg:w-12 rounded-full border-white/10 text-white/60 hover:bg-white/5 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            title={history.length === 0 ? "Nichts rückgängig zu machen" : `Letzte Aktion rückgängig (${history.length})`}
          >
            <Undo2 className="h-4 w-4 lg:h-5 lg:w-5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={openRejectModal}
            className="h-12 w-12 lg:h-14 lg:w-14 rounded-full border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            title="Pairing später anzeigen"
          >
            <X className="h-5 w-5 lg:h-6 lg:w-6" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={skipPair}
            className="h-10 w-10 lg:h-12 lg:w-12 rounded-full border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
            title="Überspringen — kommt später wieder"
          >
            <ChevronUp className="h-5 w-5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={approveSwap}
            className="h-12 w-12 lg:h-14 lg:w-14 rounded-full border-green-500/30 text-green-400 hover:bg-green-500/10 hover:text-green-300"
            title="Tausch genehmigen"
          >
            <Check className="h-5 w-5 lg:h-6 lg:w-6" />
          </Button>
        </div>
      </div>

      {/* Split-View Performance Profile Overlay */}
      <AnimatePresence>
        {profileOpen && (
          <motion.div
            key="swap-profile-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[200] bg-background/80 backdrop-blur-sm flex items-stretch justify-center p-0 sm:p-4"
            onClick={() => setProfileOpen(false)}
          >
            <motion.div
              initial={{ y: 30, scale: 0.98, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ duration: 0.22 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-[1400px] h-full bg-background sm:rounded-2xl border-x-0 sm:border-x border-y-0 sm:border-y border-border shadow-2xl overflow-hidden flex flex-col"
              style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 3.5rem)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/95 backdrop-blur-xl shrink-0">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="h-4 w-4" style={{ color: "hsl(40 50% 70%)" }} />
                  <span className="text-xs uppercase tracking-wider text-white/55 font-medium">Performance-Vergleich</span>
                </div>
                <button
                  onClick={() => setProfileOpen(false)}
                  className="h-11 w-11 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  aria-label="Schließen"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <button
                onClick={() => setProfileOpen(false)}
                aria-label="Performance-Vergleich schließen"
                className="md:hidden fixed right-4 z-[220] inline-flex h-11 items-center gap-1.5 rounded-full border border-border bg-background/95 px-4 text-xs font-medium text-foreground shadow-2xl backdrop-blur-xl active:scale-95 transition-transform"
                style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
              >
                <X className="h-4 w-4" />
                Schließen
              </button>
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.06] overflow-y-auto md:overflow-hidden">
                <div className="min-h-0 overflow-y-auto relative">
                  <div className="sticky top-0 z-10 px-4 py-2 bg-zinc-950/90 backdrop-blur border-b border-white/[0.06]">
                    <span
                      className="text-[9px] uppercase tracking-[0.18em] font-semibold px-2 py-1 rounded-full border"
                      style={{
                        color: "hsl(152 70% 55%)",
                        borderColor: "hsl(152 70% 45% / 0.35)",
                        background: "hsl(152 70% 45% / 0.08)",
                      }}
                    >
                      Underplaced · {visibleLeft.name.replace(/_/g, " ")}
                    </span>
                  </div>
                  <ChatterSlideOver
                    open={profileOpen}
                    onClose={() => setProfileOpen(false)}
                    chatterName={visibleLeft.name}
                    platform={platform}
                    inline
                  />
                </div>
                <div className="min-h-0 overflow-y-auto relative">
                  <div className="sticky top-0 z-10 px-4 py-2 bg-zinc-950/90 backdrop-blur border-b border-white/[0.06]">
                    <span
                      className="text-[9px] uppercase tracking-[0.18em] font-semibold px-2 py-1 rounded-full border"
                      style={{
                        color: "hsl(0 84% 65%)",
                        borderColor: "hsl(0 84% 60% / 0.35)",
                        background: "hsl(0 84% 60% / 0.08)",
                      }}
                    >
                      Overplaced · {visibleRight.name.replace(/_/g, " ")}
                    </span>
                  </div>
                  <ChatterSlideOver
                    open={profileOpen}
                    onClose={() => setProfileOpen(false)}
                    chatterName={visibleRight.name}
                    platform={platform}
                    inline
                  />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reject Modal — choose snooze duration */}
      <AnimatePresence>
        {rejectModalOpen && (
          <motion.div
            key="reject-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setRejectModalOpen(false)}
          >
            <motion.div
              initial={{ y: 20, scale: 0.96, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 10, opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-zinc-950 p-5 shadow-2xl"
            >
              <div className="flex items-center gap-2 mb-1">
                <X className="h-4 w-4 text-red-400" />
                <h3 className="text-sm font-semibold text-foreground">Später anzeigen</h3>
              </div>
              <p className="text-xs text-white/55 mb-4">
                Wann soll dieses Pairing wieder vorgeschlagen werden?
              </p>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  { days: 1, label: "1 Tag" },
                  { days: 7, label: "7 Tage" },
                  { days: 30, label: "30 Tage" },
                ].map((opt) => (
                  <button
                    key={opt.days}
                    onClick={() => confirmReject(opt.days)}
                    className="rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-300 transition-colors py-3 px-2 text-sm font-medium text-foreground"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRejectModalOpen(false)}
                className="w-full text-xs text-white/50 hover:text-white"
              >
                Abbrechen
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {renderManualPicker()}
    </div>
  );
}
