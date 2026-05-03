import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { detectModelTroubles, type ModelTrouble } from "@/lib/model-tracking";
import { cn } from "@/lib/utils";

interface Props {
  platform: string;
  modelNames: string[];
  onSelectModel: (name: string) => void;
}

export default function ModelsInTroubleCard({ platform, modelNames, onSelectModel }: Props) {
  const [troubles, setTroubles] = useState<ModelTrouble[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (modelNames.length === 0) {
      setTroubles([]);
      return;
    }
    setLoading(true);
    detectModelTroubles(platform, modelNames)
      .then(setTroubles)
      .finally(() => setLoading(false));
  }, [platform, modelNames.join("|")]);

  if (loading) {
    return (
      <div className="premium-card rounded-2xl p-5 text-center text-white/25 text-xs font-light">
        Analysiere Models …
      </div>
    );
  }

  if (troubles.length === 0) {
    return (
      <div className="premium-card rounded-2xl p-5 flex items-center gap-3">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="text-[12px] text-white/55 font-light">Keine Models in kritischem Zustand.</span>
      </div>
    );
  }

  return (
    <div className="premium-card rounded-2xl overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-white/[0.05] flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
        <span className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase">
          Models in Trouble · {troubles.length}
        </span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {troubles.map((t) => (
          <button
            key={t.modelName}
            onClick={() => onSelectModel(t.modelName)}
            className="w-full p-4 sm:p-5 flex items-center gap-3 hover:bg-white/[0.02] transition-colors text-left"
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full shrink-0",
                t.severity === "high" ? "bg-red-500" : "bg-amber-400"
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-foreground/85 font-light">{t.modelName}</div>
              <div className="text-[11px] text-white/40 font-light mt-0.5 truncate">{t.reason}</div>
            </div>
            {t.deltaPct !== null && (
              <div className="text-[12px] font-light text-red-400 tabular-nums">{t.deltaPct}%</div>
            )}
            <ChevronRight className="h-4 w-4 text-white/20" />
          </button>
        ))}
      </div>
    </div>
  );
}
