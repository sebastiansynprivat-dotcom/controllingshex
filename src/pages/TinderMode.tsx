import { useState, useEffect, useCallback, useMemo } from "react";
import { usePlatform } from "@/contexts/PlatformContext";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence, motion } from "framer-motion";
import SwipeCard from "@/components/SwipeCard";
import SwipeActionPanel from "@/components/SwipeActionPanel";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Check, X, ChevronUp, RotateCcw, Undo2 } from "lucide-react";

interface ChatterData {
  name: string;
  kpis: Record<string, string>;
  recommendation?: string;
  categoryEmoji?: string;
  categoryName?: string;
  revenueHistory?: { date: string; revenue: number }[];
}

interface AnalysisCategory {
  emoji: string;
  categoryName: string;
  chatters: {
    name: string;
    kpis: Record<string, string>;
    recommendation?: string;
  }[];
}

interface AnalysisResult {
  categories: AnalysisCategory[];
}

export default function TinderMode() {
  const { platform } = usePlatform();
  const [chatters, setChatters] = useState<ChatterData[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionPanel, setActionPanel] = useState(false);
  const [slideOver, setSlideOver] = useState(false);
  const [checkedNames, setCheckedNames] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      // Get latest report
      const { data: report } = await supabase
        .from("analysis_reports")
        .select("result_json")
        .eq("platform", platform)
        .not("result_json", "is", null)
        .order("analysis_date", { ascending: false })
        .limit(1)
        .single();

      if (!report?.result_json) {
        setChatters([]);
        setLoading(false);
        return;
      }

      const result = report.result_json as unknown as AnalysisResult;
      if (!result?.categories) {
        setChatters([]);
        setLoading(false);
        return;
      }

      // Flatten categories into chatter list
      const allChatters: ChatterData[] = [];
      for (const cat of result.categories) {
        for (const ch of cat.chatters) {
          allChatters.push({
            name: ch.name,
            kpis: ch.kpis,
            recommendation: ch.recommendation,
            categoryEmoji: cat.emoji,
            categoryName: cat.categoryName,
          });
        }
      }

      // Load revenue history for sparklines
      const names = allChatters.map((c) => c.name);
      const { data: history } = await supabase
        .from("chatter_history")
        .select("chatter_name, analysis_date, revenue_today")
        .eq("platform", platform)
        .in("chatter_name", names)
        .order("analysis_date", { ascending: true });

      if (history) {
        const histMap = new Map<string, { date: string; revenue: number }[]>();
        for (const h of history) {
          if (!histMap.has(h.chatter_name)) histMap.set(h.chatter_name, []);
          histMap.get(h.chatter_name)!.push({
            date: h.analysis_date,
            revenue: Number(h.revenue_today) || 0,
          });
        }
        for (const ch of allChatters) {
          ch.revenueHistory = histMap.get(ch.name)?.slice(-7);
        }
      }

      // Load today's checks
      const today = new Date().toISOString().split("T")[0];
      const { data: checks } = await supabase
        .from("daily_chatter_checks")
        .select("chatter_name")
        .eq("platform", platform)
        .eq("check_date", today);

      if (checks) {
        setCheckedNames(new Set(checks.map((c) => c.chatter_name)));
      }

      setChatters(allChatters);
      
      setUndoStack([]);
      setLoading(false);
    };
    load();
  }, [platform]);
  // Filter out already-checked chatters for swipe stack
  const uncheckedChatters = useMemo(
    () => chatters.filter((c) => !checkedNames.has(c.name)),
    [chatters, checkedNames]
  );

  const currentChatter = uncheckedChatters[0];
  const totalCount = chatters.length;
  const checkedCount = checkedNames.size;
  const progress = totalCount > 0 ? (checkedCount / totalCount) * 100 : 0;

  const markChecked = useCallback(async (name: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const today = new Date().toISOString().split("T")[0];

    await supabase.from("daily_chatter_checks").upsert(
      { chatter_name: name, platform, user_id: user.id, check_date: today },
      { onConflict: "user_id,chatter_name,check_date,platform", ignoreDuplicates: true }
    );

    setCheckedNames((prev) => new Set(prev).add(name));
  }, [platform]);

  const goNext = useCallback(() => {
    setActionPanel(false);
    // uncheckedChatters auto-updates, so index stays at 0 for next card
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const lastName = prev[prev.length - 1];
      setCheckedNames((s) => {
        const next = new Set(s);
        next.delete(lastName);
        return next;
      });
      return prev.slice(0, -1);
    });
    setActionPanel(false);
  }, []);

  const handleSwipeRight = useCallback(() => {
    if (!currentChatter) return;
    setUndoStack((prev) => [...prev, currentChatter.name]);
    markChecked(currentChatter.name);
    goNext();
  }, [currentChatter, markChecked, goNext]);

  const handleSwipeLeft = useCallback(() => {
    setActionPanel(true);
  }, []);

  const handleSwipeUp = useCallback(() => {
    setSlideOver(true);
  }, []);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (actionPanel || slideOver) return;
      if (e.key === "ArrowRight") handleSwipeRight();
      if (e.key === "ArrowLeft") handleSwipeLeft();
      if (e.key === "ArrowUp") handleSwipeUp();
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); handleUndo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actionPanel, slideOver, handleSwipeRight, handleSwipeLeft, handleSwipeUp, handleUndo]);

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

  const isDone = uncheckedChatters.length === 0;

  return (
    <div className="flex flex-col h-full max-w-md mx-auto px-4 py-6">
      {/* Progress header */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground font-medium">
            {checkedCount}/{totalCount} gecheckt
          </span>
          <span className="text-xs text-muted-foreground">
            {uncheckedChatters.length} übrig
          </span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      {/* Card stack */}
      <div className="relative flex-1 min-h-0">
        {isDone ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center h-full gap-4"
          >
            <div className="text-5xl">🎉</div>
            <p className="text-foreground font-medium">Alle Chatter durchgegangen!</p>
            <p className="text-sm text-muted-foreground">{checkedCount} von {totalCount} gecheckt</p>
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Nochmal durchgehen
            </Button>
          </motion.div>
        ) : (
          <>
            <AnimatePresence mode="popLayout">
              {/* Show next card behind */}
              {uncheckedChatters.length > 1 && (
                <SwipeCard
                  key={uncheckedChatters[1].name + "-bg"}
                  chatter={uncheckedChatters[1]}
                  onSwipeRight={() => {}}
                  onSwipeLeft={() => {}}
                  onSwipeUp={() => {}}
                  isTop={false}
                />
              )}
              {/* Current card */}
              {currentChatter && (
                <SwipeCard
                  key={currentChatter.name + "-top"}
                  chatter={currentChatter}
                  onSwipeRight={handleSwipeRight}
                  onSwipeLeft={handleSwipeLeft}
                  onSwipeUp={handleSwipeUp}
                  isTop={true}
                />
              )}
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
          </>
        )}
      </div>

      {/* Bottom buttons (desktop) */}
      {!isDone && currentChatter && (
        <div className="flex items-center justify-center gap-3 mt-5">
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
        </div>
      )}

      {/* Chatter SlideOver */}
      {currentChatter && (
        <ChatterSlideOver
          open={slideOver}
          onClose={() => setSlideOver(false)}
          chatterName={currentChatter.name}
          platform={platform}
        />
      )}
    </div>
  );
}
