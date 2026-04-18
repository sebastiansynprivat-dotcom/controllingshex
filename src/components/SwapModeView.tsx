import { useEffect, useMemo, useState, useCallback } from "react";
import { motion, useMotionValue, useTransform, useAnimation, AnimatePresence, type PanInfo } from "framer-motion";
import { ArrowLeftRight, Check, X, ChevronUp, Users, TrendingUp, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  computeSwapCandidates,
  formatEur,
  formatEfficiency,
  type SwapPair,
  type SwapChatter,
  type SwapInput,
  type SwapModelInfo,
} from "@/lib/swap-suggestions";
import { formatFollowers } from "@/lib/model-performance";

interface Props {
  platform: string;
  chatters: SwapInput[];
  models: SwapModelInfo[];
}

const SWIPE_THRESHOLD = 120; // gemäß Memory: nur Distanz, keine velocity

type Side = "left" | "right";

interface MiniCardProps {
  chatter: SwapChatter;
  side: Side;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onSwipeUp: () => void;
}

function SwapMiniCard({ chatter, side, onSwipeLeft, onSwipeRight, onSwipeUp }: MiniCardProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-8, 0, 8]);
  const controls = useAnimation();

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

  return (
    <motion.div
      drag
      dragElastic={0.18}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      animate={controls}
      style={{ x, y, rotate, touchAction: "none" }}
      className="relative w-full rounded-3xl overflow-hidden border select-none cursor-grab active:cursor-grabbing"
    >
      <div
        className="p-5"
        style={{
          background: `radial-gradient(120% 80% at 50% 0%, hsl(${accentHsl} / 0.18) 0%, transparent 60%), linear-gradient(180deg, hsl(240 6% 8%) 0%, hsl(240 6% 4%) 100%)`,
          borderColor: `hsl(${accentHsl} / 0.25)`,
          minHeight: 280,
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
          <div className="flex items-center gap-1 text-[10px] text-white/40">
            <Users className="h-3 w-3" />
            {formatFollowers(chatter.followers)}
          </div>
        </div>

        <h3 className="text-lg font-semibold text-foreground capitalize truncate mb-0.5">
          {chatter.name.replace(/_/g, " ")}
        </h3>
        <p className="text-xs text-white/40 mb-4 truncate">@ {chatter.account}</p>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
            <p className="text-[9px] uppercase tracking-wider text-white/40 mb-1">Heute</p>
            <p className="text-base font-bold text-foreground">{formatEur(chatter.currentRevenue)}</p>
          </div>
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
            <p className="text-[9px] uppercase tracking-wider text-white/40 mb-1">Effizienz</p>
            <p className="text-base font-bold" style={{ color: `hsl(${accentHsl})` }}>
              {formatEfficiency(chatter.efficiency)}
            </p>
          </div>
        </div>

        <div className="mt-4 text-[10px] text-white/35 text-center">
          ← anderer Kandidat &nbsp;·&nbsp; ↑ verwerfen &nbsp;·&nbsp; → genehmigen
        </div>
      </div>
    </motion.div>
  );
}

export default function SwapModeView({ platform, chatters, models }: Props) {
  const allPairs = useMemo(() => computeSwapCandidates(chatters, models), [chatters, models]);

  const [pairIdx, setPairIdx] = useState(0);
  // Override of left/right chatter within current pair (when user swipes one side)
  const [leftAltIdx, setLeftAltIdx] = useState(0);
  const [rightAltIdx, setRightAltIdx] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Reset when pair changes
  useEffect(() => {
    setLeftAltIdx(0);
    setRightAltIdx(0);
  }, [pairIdx]);

  const currentPair: SwapPair | undefined = useMemo(() => {
    let i = pairIdx;
    while (i < allPairs.length) {
      const p = allPairs[i];
      const key = `${p.left.name}::${p.right.name}`;
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

  // Recompute expected gain for the current visible combination
  const visibleGain = useMemo(() => {
    if (!visibleLeft || !visibleRight) return 0;
    return Math.max(0, visibleLeft.efficiency * visibleRight.followers - visibleRight.currentRevenue);
  }, [visibleLeft, visibleRight]);

  const advancePair = useCallback(() => {
    setPairIdx((i) => i + 1);
  }, []);

  const dismissCurrentPair = useCallback(() => {
    if (!currentPair) return;
    const key = `${currentPair.left.name}::${currentPair.right.name}`;
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
      <div className="flex items-center justify-between mb-3 px-2">
        <span className="text-[10px] text-muted-foreground">
          Pair {pairIdx + 1} / {allPairs.length}
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

      {/* Two cards side-by-side */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-3 items-start relative">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={`L-${currentPair.left.name}-${leftAltIdx}`}
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
            key={`R-${currentPair.right.name}-${rightAltIdx}`}
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
    </div>
  );
}
