import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ListChecks } from "lucide-react";
import { usePlatform } from "@/contexts/PlatformContext";
import DailyTodoList from "@/components/DailyTodoList";
import ChatterSlideOver from "@/components/ChatterSlideOver";

export default function Today() {
  const { platform } = usePlatform();
  const [selectedChatter, setSelectedChatter] = useState<string | null>(null);

  const todayLabel = new Date().toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

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
              <h1 className="text-2xl font-extralight tracking-tight text-foreground flex items-center gap-2.5">
                <ListChecks className="h-5 w-5 text-primary/70" />
                Heute zu tun
              </h1>
              <p className="text-[11px] text-white/30 mt-1.5 font-light tracking-wider uppercase">
                {todayLabel} · {platform}
              </p>
            </div>
          </div>

          <DailyTodoList
            platform={platform}
            onChatterClick={(name) => setSelectedChatter(name)}
          />
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
    </>
  );
}
