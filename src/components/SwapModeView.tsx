import { useEffect, useMemo, useState, useCallback } from "react";
import { motion, useMotionValue, useTransform, useAnimation, AnimatePresence, type PanInfo } from "framer-motion";
import { ArrowLeftRight, Check, X, ChevronUp, Users, TrendingUp, Sparkles, Zap, MessageSquare, Clock, Inbox, Undo2, UserPlus, Search } from "lucide-react";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  computeSwapCandidates,
  computeManualSwapCandidates,
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
import { findCluster } from "@/lib/peer-benchmarks";

interface Props {
  platform: string;
  chatters: SwapInput[];
  models: SwapModelInfo[];
  benchmarks?: BenchmarkBundle | null;
}

const SWIPE_THRESHOLD = 120; // gemäß Memory: nur Distanz, keine velocity

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
        className="p-5 lg:p-7 border border-white/[0.06] rounded-3xl"
        style={{
          background: `radial-gradient(140% 100% at 50% -20%, hsl(${accentHsl} / 0.07) 0%, transparent 55%), linear-gradient(180deg, hsl(240 6% 8%) 0%, hsl(240 6% 5%) 100%)`,
          minHeight: 320,
          boxShadow: `0 24px 60px -24px hsl(240 10% 0% / 0.7), inset 0 1px 0 hsl(0 0% 100% / 0.04)`,
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <span
            className="text-[9px] uppercase tracking-[0.18em] font-semibold px-2 py-1 rounded-full border"
            style={{
              color: `hsl(${accentHsl})`,
              borderColor: `hsl(${accentHsl} / 0.35)`,
              background: `hsl(${accentHsl} / 0.08)`,
            }}
          >
            {tag}
          </span>
          <span
            className="text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-md border"
            style={{
              color: `hsl(${tierColor(chatter.tier)})`,
              borderColor: `hsl(${tierColor(chatter.tier)} / 0.35)`,
              background: `hsl(${tierColor(chatter.tier)} / 0.08)`,
            }}
          >
            {chatter.tier}
          </span>
        </div>

        <h3 className="text-lg lg:text-2xl font-semibold text-foreground capitalize truncate mb-0.5">
          {chatter.name.replace(/_/g, " ")}
        </h3>
        <p className="text-xs lg:text-sm text-white/45 mb-1 truncate">@ {chatter.account}</p>
        <p className="text-[10px] lg:text-xs text-white/40 mb-3 lg:mb-5 inline-flex items-center gap-1">
          <Users className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
          {formatFollowers(chatter.followers)} Follower
        </p>

        {/* Skill-Score Bar */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 lg:p-4 mb-2.5 lg:mb-4">
          <div className="flex items-center justify-between mb-1.5 lg:mb-2">
            <span className="text-[9px] lg:text-[10px] uppercase tracking-wider text-white/45 inline-flex items-center gap-1">
              <Zap className="h-2.5 w-2.5 lg:h-3 lg:w-3" /> Skill-Score
            </span>
            <span className="text-sm lg:text-lg font-bold tabular-nums" style={{ color: `hsl(${accentHsl})` }}>
              {formatSkill(chatter.skillScore)}
            </span>
          </div>
          <div className="h-1.5 lg:h-2 rounded-full bg-white/[0.05] overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.round(chatter.skillScore * 100)}%`,
                background: `linear-gradient(90deg, hsl(${accentHsl} / 0.6), hsl(${accentHsl}))`,
              }}
            />
          </div>
        </div>

        {/* Skill-Breakdown Mini-Icons */}
        <div className="grid grid-cols-4 gap-1.5 lg:gap-2 mb-2.5 lg:mb-4">
          <SkillPill icon={MessageSquare} label="DMs" value={chatter.scoreBreakdown.massDms} accentHsl={accentHsl} />
          <SkillPill icon={Clock} label="Resp" value={chatter.scoreBreakdown.response} accentHsl={accentHsl} />
          <SkillPill icon={Inbox} label="Chat" value={chatter.scoreBreakdown.throughput} accentHsl={accentHsl} />
          <SkillPill icon={TrendingUp} label="€/F" value={chatter.scoreBreakdown.revenue} accentHsl={accentHsl} />
        </div>

        <div className="grid grid-cols-2 gap-2 lg:gap-3">
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 lg:p-3">
            <p className="text-[8px] lg:text-[10px] uppercase tracking-wider text-white/40">7T-Ø</p>
            <p className="text-xs lg:text-base font-semibold text-foreground tabular-nums">{formatEur(chatter.avgRevenue)}</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 lg:p-3">
            <p className="text-[8px] lg:text-[10px] uppercase tracking-wider text-white/40">Heute</p>
            <p className="text-xs lg:text-base font-semibold text-foreground tabular-nums">{formatEur(chatter.currentRevenue)}</p>
          </div>
        </div>

        <div className="mt-3 lg:mt-4 text-[10px] lg:text-[11px] text-white/35 text-center">
          ← anderer Kandidat &nbsp;·&nbsp; ↑ verwerfen &nbsp;·&nbsp; → genehmigen
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
  const allPairs = useMemo(
    () => computeSwapCandidates(chatters, models, benchmarks ?? null),
    [chatters, models, benchmarks]
  );

  const [pairIdx, setPairIdx] = useState(0);
  const [leftAltIdx, setLeftAltIdx] = useState(0);
  const [rightAltIdx, setRightAltIdx] = useState(0);
  /** Pair-Keys die in dieser Session lokal verworfen wurden (zusätzlich zu DB-Snoozes) */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
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

  // Reset alt-overrides when pair index changes
  useEffect(() => {
    setLeftAltIdx(0);
    setRightAltIdx(0);
  }, [pairIdx]);

  const currentPair: SwapPair | undefined = useMemo(() => {
    let i = pairIdx;
    while (i < allPairs.length) {
      const p = allPairs[i];
      const sessionKey = `${p.left.key}::${p.right.key}`;
      const dbKey = buildKey(p.left, p.right);
      if (!dismissed.has(sessionKey) && !persistedBlocked.has(dbKey)) return p;
      i++;
    }
    return undefined;
  }, [allPairs, pairIdx, dismissed, persistedBlocked, buildKey]);

  const visibleLeft: SwapChatter | undefined = useMemo(() => {
    if (!currentPair) return undefined;
    if (leftAltIdx === 0) return currentPair.left;
    return currentPair.leftAlternatives[leftAltIdx - 1] || currentPair.left;
  }, [currentPair, leftAltIdx]);

  const visibleRight: SwapChatter | undefined = useMemo(() => {
    if (!currentPair) return undefined;
    if (rightAltIdx === 0) return currentPair.right;
    return currentPair.rightAlternatives[rightAltIdx - 1] || currentPair.right;
  }, [currentPair, rightAltIdx]);

  const visibleGain = useMemo(() => {
    if (!visibleLeft || !visibleRight) return 0;
    const skillFactor = Math.max(0.3, visibleLeft.skillScore / 0.5);
    let baseExpected: number;
    const cluster = benchmarks ? findCluster(benchmarks, visibleRight.followers) : null;
    if (cluster && cluster.median > 0 && cluster.confidence !== "low") {
      baseExpected = cluster.median * skillFactor;
    } else {
      const ratio = Math.min(3, visibleRight.followers / Math.max(visibleLeft.followers, 1));
      baseExpected = visibleLeft.avgRevenue * ratio * skillFactor;
    }
    const current = visibleRight.avgRevenue || visibleRight.currentRevenue;
    return Math.max(0, baseExpected - current);
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

  const cycleLeftAlt = useCallback(() => {
    if (!currentPair || !visibleLeft || !visibleRight) return;
    const total = 1 + currentPair.leftAlternatives.length;
    if (total <= 1) {
      toast("Keine weiteren Kandidaten links", { icon: "ℹ️" });
      return;
    }
    setHistory((prev) => [
      ...prev,
      {
        decisionId: null,
        pairKeys: [],
        sessionKey: "",
        pairIdxBefore: pairIdx,
        leftAltIdxBefore: leftAltIdx,
        rightAltIdxBefore: rightAltIdx,
        action: "alt-left" as const,
        leftName: visibleLeft.name,
        rightName: visibleRight.name,
      },
    ].slice(-20));
    setLeftAltIdx((i) => (i + 1) % total);
  }, [currentPair, visibleLeft, visibleRight, pairIdx, leftAltIdx, rightAltIdx]);

  const cycleRightAlt = useCallback(() => {
    if (!currentPair || !visibleLeft || !visibleRight) return;
    const total = 1 + currentPair.rightAlternatives.length;
    if (total <= 1) {
      toast("Keine weiteren Kandidaten rechts", { icon: "ℹ️" });
      return;
    }
    setHistory((prev) => [
      ...prev,
      {
        decisionId: null,
        pairKeys: [],
        sessionKey: "",
        pairIdxBefore: pairIdx,
        leftAltIdxBefore: leftAltIdx,
        rightAltIdxBefore: rightAltIdx,
        action: "alt-right" as const,
        leftName: visibleLeft.name,
        rightName: visibleRight.name,
      },
    ].slice(-20));
    setRightAltIdx((i) => (i + 1) % total);
  }, [currentPair, visibleLeft, visibleRight, pairIdx, leftAltIdx, rightAltIdx]);

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

  const pushHistory = useCallback(
    (entry: HistoryEntry) => {
      setHistory((prev) => [...prev, entry].slice(-20));
    },
    []
  );

  const approveSwap = useCallback(async () => {
    if (!visibleLeft || !visibleRight) return;
    const decisionId = await persistDecision(visibleLeft, visibleRight, "approved", null);
    if (!decisionId) return;
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
    });
    toast.success(`Tausch gespeichert: +${formatEur(visibleGain)}/Tag`);
    advancePair();
  }, [visibleLeft, visibleRight, visibleGain, advancePair, persistDecision, pushHistory, pairKeyVariants, pairIdx, leftAltIdx, rightAltIdx]);

  /** Skip (↑ swipe) → automatisch 1 Tag snoozen */
  const skipPair = useCallback(async () => {
    if (!visibleLeft || !visibleRight) return;
    const decisionId = await persistDecision(visibleLeft, visibleRight, "snoozed", 1);
    if (!decisionId) return;
    pushHistory({
      decisionId,
      pairKeys: pairKeyVariants(visibleLeft.name, visibleLeft.account, visibleRight.name, visibleRight.account),
      sessionKey: `${visibleLeft.key}::${visibleRight.key}`,
      pairIdxBefore: pairIdx,
      leftAltIdxBefore: leftAltIdx,
      rightAltIdxBefore: rightAltIdx,
      action: "snoozed",
      leftName: visibleLeft.name,
      rightName: visibleRight.name,
    });
    toast("Für 1 Tag ausgeblendet", { icon: "🕒" });
    removeFromStack(visibleLeft, visibleRight);
  }, [visibleLeft, visibleRight, persistDecision, removeFromStack, pushHistory, pairKeyVariants, pairIdx, leftAltIdx, rightAltIdx]);

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
      toast(`Verworfen für ${label}`, { icon: "✗" });
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
    setPairIdx(last.pairIdxBefore);
    setLeftAltIdx(last.leftAltIdxBefore);
    setRightAltIdx(last.rightAltIdxBefore);
    setHistory((prev) => prev.slice(0, -1));
    const display = last.leftName.replace(/_/g, " ") + " ↔ " + last.rightName.replace(/_/g, " ");
    toast.success(`Rückgängig: ${display}`, { icon: "↩️" });
  }, [history]);




  if (allPairs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <Sparkles className="h-8 w-8 text-white/30" />
        <p className="text-sm text-foreground font-medium">Keine Tausch-Vorschläge</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Es wurden keine Chatter gefunden, die deutlich über- oder unterperformen relativ zu ihren Followern.
          Stelle sicher, dass Models mit Follower-Zahlen gepflegt sind und ein aktueller Report vorliegt.
        </p>
      </div>
    );
  }

  if (!currentPair || !visibleLeft || !visibleRight) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="text-4xl">✅</div>
        <p className="text-sm text-foreground font-medium">Alle Tausch-Vorschläge durch</p>
        <Button variant="outline" size="sm" onClick={() => { setPairIdx(0); setDismissed(new Set()); }}>
          Nochmal durchgehen
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden relative">

      <div className="flex flex-col h-full w-full max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-10 pt-3 lg:pt-6 pb-4 lg:pb-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 lg:mb-6 gap-3">
          <div className="flex items-baseline gap-2 lg:gap-3 shrink-0">
            <span className="text-[10px] lg:text-xs uppercase tracking-[0.22em] text-white/40 font-medium">
              Wechsel-Vorschlag
            </span>
            <span className="text-[10px] lg:text-xs text-white/35 tabular-nums">
              {pairIdx + 1} <span className="text-white/20">/ {allPairs.length}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 lg:gap-3">
            <span
              className="text-[9px] lg:text-[10px] uppercase tracking-wider font-semibold px-2.5 lg:px-3 py-1 lg:py-1.5 rounded-full border bg-white/[0.02]"
              style={{
                color: "hsl(200 60% 70%)",
                borderColor: "hsl(200 55% 55% / 0.3)",
              }}
              title="Wieviel mehr Follower der Ziel-Account hat"
            >
              {currentPair.followerRatio.toFixed(1)}× Follower
            </span>
            <span
              className="inline-flex items-center gap-1.5 lg:gap-2 text-xs lg:text-sm font-bold px-3 lg:px-4 py-1.5 lg:py-2 rounded-full border tabular-nums"
              style={{
                color: visibleGain > 0 ? "hsl(152 70% 60%)" : "hsl(0 0% 60%)",
                borderColor: visibleGain > 0 ? "hsl(152 70% 45% / 0.45)" : "hsl(0 0% 100% / 0.1)",
                background: visibleGain > 0 ? "hsl(152 70% 45% / 0.10)" : "transparent",
                boxShadow: visibleGain > 0 ? "0 4px 22px -8px hsl(152 70% 45% / 0.6)" : "none",
              }}
            >
              <TrendingUp className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              +{formatEur(visibleGain)} / Tag
            </span>
          </div>
        </div>

        {/* Cards stage */}
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-4 lg:gap-10 items-center relative">
          <AnimatePresence mode="popLayout">
            <motion.div
              key={`L-${currentPair.left.key}-${leftAltIdx}`}
              initial={{ opacity: 0, scale: 0.96, x: -24 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.22 }}
              className="w-full max-w-[520px] justify-self-end"
            >
              <SwapMiniCard
                chatter={visibleLeft}
                side="left"
                onSwipeLeft={cycleLeftAlt}
                onSwipeRight={approveSwap}
                onSwipeUp={skipPair}
                onSingleClick={() => copyChatterName(visibleLeft.name)}
                onDoubleClick={() => setProfileOpen(true)}
              />
            </motion.div>
          </AnimatePresence>

          {/* Center swap badge with arrow + gain */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-2">
            <div
              className="h-12 w-12 lg:h-16 lg:w-16 rounded-full flex items-center justify-center border-2"
              style={{
                background:
                  "radial-gradient(circle at 30% 30%, hsl(40 60% 60% / 0.35) 0%, hsl(40 45% 40% / 0.18) 60%, hsl(40 30% 20% / 0.05) 100%)",
                borderColor: "hsl(40 55% 55% / 0.45)",
                boxShadow:
                  "0 0 0 6px hsl(240 6% 6% / 0.85), 0 8px 30px -6px hsl(40 55% 50% / 0.55), inset 0 1px 0 hsl(40 80% 80% / 0.15)",
              }}
            >
              <ArrowLeftRight className="h-5 w-5 lg:h-7 lg:w-7" style={{ color: "hsl(40 70% 75%)" }} />
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
              className="w-full max-w-[520px] justify-self-start"
            >
              <SwapMiniCard
                chatter={visibleRight}
                side="right"
                onSwipeLeft={cycleRightAlt}
                onSwipeRight={approveSwap}
                onSwipeUp={skipPair}
                onSingleClick={() => copyChatterName(visibleRight.name)}
                onDoubleClick={() => setProfileOpen(true)}
              />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Hint row */}
        <div className="hidden lg:flex items-center justify-center mt-3 mb-1">
          <span className="text-[10px] uppercase tracking-[0.18em] text-white/30">
            Klick = Name kopieren · Doppelklick = Profil-Vergleich · ↑ Skip (1 Tag) · X Verwerfen · ✓ Genehmigen · ↩ Rückgängig
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-center gap-3 lg:gap-5 mt-4 lg:mt-5">
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
            title="Pairing verwerfen"
          >
            <X className="h-5 w-5 lg:h-6 lg:w-6" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={skipPair}
            className="h-10 w-10 lg:h-12 lg:w-12 rounded-full border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
            title="Überspringen"
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
            className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-stretch justify-center p-2 sm:p-4"
            onClick={() => setProfileOpen(false)}
          >
            <motion.div
              initial={{ y: 30, scale: 0.98, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ duration: 0.22 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-[1400px] h-full bg-zinc-950 rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-zinc-900/60">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="h-4 w-4" style={{ color: "hsl(40 50% 70%)" }} />
                  <span className="text-xs uppercase tracking-wider text-white/55 font-medium">Performance-Vergleich</span>
                </div>
                <button
                  onClick={() => setProfileOpen(false)}
                  className="h-8 w-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors"
                  aria-label="Schließen"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.06] overflow-hidden">
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
                <h3 className="text-sm font-semibold text-foreground">Pairing verwerfen</h3>
              </div>
              <p className="text-xs text-white/55 mb-4">
                Wie lange soll dieses Pairing nicht mehr vorgeschlagen werden?
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
    </div>
  );
}
