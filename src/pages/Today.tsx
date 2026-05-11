import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ListChecks, Gem, AlertTriangle, Activity, TrendingDown, Users, MessageSquare, Rocket, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlatform } from "@/contexts/PlatformContext";
import DailyTodoList from "@/components/DailyTodoList";
import RevenueTaskSection from "@/components/RevenueTaskSection";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import ModelPerformanceSlideOver from "@/components/ModelPerformanceSlideOver";
import type { TodoCategory } from "@/lib/daily-todos";

type TodayTab = "all" | TodoCategory | "revenue-lever";

export default function Today() {
  const { platform } = usePlatform();
  const [selectedChatter, setSelectedChatter] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<{ name: string; chatter: string | null } | null>(null);
  const [tab, setTab] = useState<TodayTab>("all");

  const todayLabel = new Date().toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const tabs: { id: TodayTab; label: string; icon: typeof ListChecks }[] = [
    { id: "all", label: "Alle", icon: ListChecks },
    { id: "verzug", label: "Verzug", icon: AlertTriangle },
    { id: "activity", label: "Aktivität", icon: Activity },
    { id: "revenue", label: "Umsatz", icon: TrendingDown },
    { id: "model", label: "Model", icon: Users },
    { id: "team", label: "Team", icon: MessageSquare },
    { id: "talent", label: "Talent", icon: Rocket },
    { id: "positive", label: "Wins", icon: Sparkles },
    { id: "revenue-lever", label: "Umsatz-Hebel", icon: Gem },
  ];

  return (
    <>
      <AnimatePresence mode="wait">
        <motion.div
          key={platform}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-3xl mx-auto space-y-6 sm:space-y-8"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extralight tracking-tight text-foreground">
                Heute
              </h1>
              <p className="text-[11px] text-white/30 mt-1.5 font-light tracking-wider uppercase">
                {todayLabel} · {platform}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 scrollbar-none">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "shrink-0 px-3.5 py-2 rounded-full text-[12px] font-light tracking-wide transition-all border flex items-center gap-1.5",
                    active
                      ? "bg-primary/15 border-primary/40 text-foreground"
                      : "bg-white/[0.02] border-white/10 text-white/45 hover:text-white/70 hover:border-white/20"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              {tab === "revenue-lever" ? (
                <RevenueTaskSection
                  platform={platform}
                  onChatterClick={(name) => setSelectedChatter(name)}
                  onModelClick={(name, chatter) => setSelectedModel({ name, chatter })}
                />
              ) : (
                <DailyTodoList
                  platform={platform}
                  categoryFilter={tab}
                  onChatterClick={(name) => setSelectedChatter(name)}
                  onModelClick={(name, chatter) => setSelectedModel({ name, chatter })}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>

      {selectedChatter && (
        <ChatterSlideOver
          open={!!selectedChatter}
          onClose={() => setSelectedChatter(null)}
          chatterName={selectedChatter}
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
