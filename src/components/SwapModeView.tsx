import { useEffect, useMemo, useState, useCallback } from "react";
import { motion, useMotionValue, useTransform, useAnimation, AnimatePresence, type PanInfo } from "framer-motion";
import { ArrowLeftRight, Check, X, ChevronUp, Users, TrendingUp, Sparkles, Zap, MessageSquare, Clock, Inbox } from "lucide-react";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  computeSwapCandidates,
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
      className="relative w-full rounded-3xl overflow-hidden border select-none cursor-grab active:cursor-grabbing"
    >
      <div
        className="p-5"
        style={{
          background: `radial-gradient(120% 80% at 50% 0%, hsl(${accentHsl} / 0.18) 0%, transparent 60%), linear-gradient(180deg, hsl(240 6% 8%) 0%, hsl(240 6% 4%) 100%)`,
          borderColor: `hsl(${accentHsl} / 0.25)`,
          minHeight: 320,
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

        <h3 className="text-lg font-semibold text-foreground capitalize truncate mb-0.5">
          {chatter.name.replace(/_/g, " ")}
        </h3>
        <p className="text-xs text-white/40 mb-1 truncate">@ {chatter.account}</p>
        <p className="text-[10px] text-white/35 mb-3 inline-flex items-center gap-1">
          <Users className="h-3 w-3" />
          {formatFollowers(chatter.followers)} Follower
        </p>

        {/* Skill-Score Bar */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 mb-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] uppercase tracking-wider text-white/45 inline-flex items-center gap-1">
              <Zap className="h-2.5 w-2.5" /> Skill-Score
            </span>
            <span className="text-sm font-bold" style={{ color: `hsl(${accentHsl})` }}>
              {formatSkill(chatter.skillScore)}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
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
        <div className="grid grid-cols-4 gap-1.5 mb-2.5">
          <SkillPill icon={MessageSquare} label="DMs" value={chatter.scoreBreakdown.massDms} accentHsl={accentHsl} />
          <SkillPill icon={Clock} label="Resp" value={chatter.scoreBreakdown.response} accentHsl={accentHsl} />
          <SkillPill icon={Inbox} label="Chat" value={chatter.scoreBreakdown.throughput} accentHsl={accentHsl} />
          <SkillPill icon={TrendingUp} label="€/F" value={chatter.scoreBreakdown.revenue} accentHsl={accentHsl} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2">
            <p className="text-[8px] uppercase tracking-wider text-white/40">7T-Ø</p>
            <p className="text-xs font-semibold text-foreground">{formatEur(chatter.avgRevenue)}</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2">
            <p className="text-[8px] uppercase tracking-wider text-white/40">Heute</p>
            <p className="text-xs font-semibold text-foreground">{formatEur(chatter.currentRevenue)}</p>
          </div>
        </div>

        <div className="mt-3 text-[10px] text-white/35 text-center">
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
  // Override of left/right chatter within current pair (when user swipes one side)
  const [leftAltIdx, setLeftAltIdx] = useState(0);
  const [rightAltIdx, setRightAltIdx] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [profileOpen, setProfileOpen] = useState(false);

  // Reset when pair changes
  useEffect(() => {
    setLeftAltIdx(0);
    setRightAltIdx(0);
  }, [pairIdx]);

  const currentPair: SwapPair | undefined = useMemo(() => {
    let i = pairIdx;
    while (i < allPairs.length) {
      const p = allPairs[i];
      const key = `${p.left.key}::${p.right.key}`;
      if (!dismissed.has(key)) return p;
      i++;
    }
    return undefined;
  }, [allPairs, pairIdx, dismissed]);

  // Resolve current visible left/right with overrides
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

  // Recompute expected gain for the current visible combination using peer-cluster median × skill-factor
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

  const dismissCurrentPair = useCallback(() => {
    if (!currentPair) return;
    const key = `${currentPair.left.key}::${currentPair.right.key}`;
    setDismissed((prev) => {
      const n = new Set(prev);
      n.add(key);
      return n;
    });
    advancePair();
  }, [currentPair, advancePair]);

  const cycleLeftAlt = useCallback(() => {
    if (!currentPair) return;
    const total = 1 + currentPair.leftAlternatives.length;
    if (total <= 1) {
      toast("Keine weiteren Kandidaten links", { icon: "ℹ️" });
      return;
    }
    setLeftAltIdx((i) => (i + 1) % total);
  }, [currentPair]);

  const cycleRightAlt = useCallback(() => {
    if (!currentPair) return;
    const total = 1 + currentPair.rightAlternatives.length;
    if (total <= 1) {
      toast("Keine weiteren Kandidaten rechts", { icon: "ℹ️" });
      return;
    }
    setRightAltIdx((i) => (i + 1) % total);
  }, [currentPair]);

  const approveSwap = useCallback(async () => {
    if (!visibleLeft || !visibleRight) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Nicht angemeldet");
      return;
    }
    const { error } = await supabase.from("swap_decisions").insert({
      user_id: user.id,
      platform,
      chatter_a: visibleLeft.name,
      chatter_b: visibleRight.name,
      model_a: visibleLeft.account,
      model_b: visibleRight.account,
      status: "approved",
    });
    if (error) {
      toast.error("Konnte Tausch nicht speichern");
      return;
    }
    toast.success(`Tausch gespeichert: +${formatEur(visibleGain)}/Tag`);
    advancePair();
  }, [visibleLeft, visibleRight, platform, visibleGain, advancePair]);

  const rejectSwap = useCallback(async () => {
    if (!visibleLeft || !visibleRight) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("swap_decisions").insert({
        user_id: user.id,
        platform,
        chatter_a: visibleLeft.name,
        chatter_b: visibleRight.name,
        model_a: visibleLeft.account,
        model_b: visibleRight.account,
        status: "rejected",
      });
    }
    toast("Verworfen", { icon: "✗" });
    dismissCurrentPair();
  }, [visibleLeft, visibleRight, platform, dismissCurrentPair]);

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
    <div className="flex flex-col h-full px-2 pt-1 pb-3 overflow-hidden">
      {/* Header: pair counter & gain */}
      <div className="flex items-center justify-between mb-3 px-2 gap-2">
        <span className="text-[10px] text-muted-foreground shrink-0">
          Pair {pairIdx + 1} / {allPairs.length}
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className="text-[9px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full border bg-white/[0.02]"
            style={{
              color: "hsl(200 60% 70%)",
              borderColor: "hsl(200 55% 55% / 0.3)",
            }}
            title="Wieviel mehr Follower der Ziel-Account hat"
          >
            {currentPair.followerRatio.toFixed(1)}× Follower
          </span>
          <span
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border"
            style={{
              color: visibleGain > 0 ? "hsl(152 70% 55%)" : "hsl(0 0% 60%)",
              borderColor: visibleGain > 0 ? "hsl(152 70% 45% / 0.35)" : "hsl(0 0% 100% / 0.1)",
              background: visibleGain > 0 ? "hsl(152 70% 45% / 0.08)" : "transparent",
            }}
          >
            <TrendingUp className="h-3 w-3" />
            +{formatEur(visibleGain)}/Tag
          </span>
        </div>
      </div>

      {/* Two cards side-by-side */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-3 items-start relative">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={`L-${currentPair.left.key}-${leftAltIdx}`}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <SwapMiniCard
              chatter={visibleLeft}
              side="left"
              onSwipeLeft={cycleLeftAlt}
              onSwipeRight={approveSwap}
              onSwipeUp={dismissCurrentPair}
              onClick={() => setProfileOpen(true)}
            />
          </motion.div>
        </AnimatePresence>

        {/* Center swap icon (absolutely positioned, doesn't take grid space when small) */}
        <div className="pointer-events-none absolute left-1/2 top-12 -translate-x-1/2 z-10">
          <div
            className="h-10 w-10 rounded-full flex items-center justify-center border"
            style={{
              background: "linear-gradient(135deg, hsl(40 45% 55% / 0.25), hsl(40 45% 55% / 0.08))",
              borderColor: "hsl(40 45% 55% / 0.35)",
              boxShadow: "0 4px 18px -4px hsl(40 45% 55% / 0.4)",
            }}
          >
            <ArrowLeftRight className="h-4 w-4" style={{ color: "hsl(40 50% 70%)" }} />
          </div>
        </div>

        <AnimatePresence mode="popLayout">
          <motion.div
            key={`R-${currentPair.right.key}-${rightAltIdx}`}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <SwapMiniCard
              chatter={visibleRight}
              side="right"
              onSwipeLeft={cycleRightAlt}
              onSwipeRight={approveSwap}
              onSwipeUp={dismissCurrentPair}
              onClick={() => setProfileOpen(true)}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-3 mt-4">
        <Button
          variant="outline"
          size="icon"
          onClick={rejectSwap}
          className="h-12 w-12 rounded-full border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          title="Pairing verwerfen"
        >
          <X className="h-5 w-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={dismissCurrentPair}
          className="h-10 w-10 rounded-full border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
          title="Überspringen"
        >
          <ChevronUp className="h-5 w-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={approveSwap}
          className="h-12 w-12 rounded-full border-green-500/30 text-green-400 hover:bg-green-500/10 hover:text-green-300"
          title="Tausch genehmigen"
        >
          <Check className="h-5 w-5" />
        </Button>
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
    </div>
  );
}
