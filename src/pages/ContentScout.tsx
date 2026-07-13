import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { usePlatform } from "@/contexts/PlatformContext";
import TimeRangeToggle from "@/components/TimeRangeToggle";
import { buildTimeRange, type TimeRange } from "@/lib/timerange-categorize";
import { loadModelContentScores, type ModelContentScore } from "@/lib/content-scout";
import HiddenGemCard from "@/components/content-scout/HiddenGemCard";
import ModelScoreRow from "@/components/content-scout/ModelScoreRow";
import ModelPerformanceSlideOver from "@/components/ModelPerformanceSlideOver";

export default function ContentScout() {
  const { platform } = usePlatform();
  const [range, setRange] = useState<TimeRange>(() => buildTimeRange("30d"));
  const [items, setItems] = useState<ModelContentScore[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [openModel, setOpenModel] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadModelContentScores(platform, range)
      .then((res) => { if (alive) setItems(res); })
      .catch((err) => {
        console.error("[ContentScout] load failed", err);
        if (alive) setItems([]);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [platform, range]);

  const gems = useMemo(() => (items ?? []).filter((i) => i.hiddenGem).slice(0, 12), [items]);
  const ranking = useMemo(() => items ?? [], [items]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-6 pb-24">
        <header className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4 text-amber-300" />
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Content Scout</h1>
          </div>
          <p className="text-[12px] text-foreground/55 font-light max-w-xl">
            Wer hat wirklich guten Content? Score kombiniert Einzelverkäufe, Umsatz, Chat-Pull und Konsistenz.
            Unterschätzte Perlen sind mit <Sparkles className="inline h-3 w-3 text-amber-300" /> markiert.
          </p>
          <div className="mt-4">
            <TimeRangeToggle value={range} onChange={setRange} />
          </div>
        </header>

        {loading && items === null && (
          <div className="text-[12px] text-foreground/50 font-light">Lade Content-Signale…</div>
        )}

        {items !== null && items.length === 0 && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
            <div className="text-[13px] text-foreground/60 font-light">
              Keine Daten im gewählten Zeitraum.
            </div>
          </div>
        )}

        {gems.length > 0 && (
          <section className="mb-8">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-[13px] font-medium text-foreground/85 tracking-wide">Hidden Gems</h2>
              <span className="text-[11px] text-foreground/40 font-light">{gems.length}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {gems.map((g) => (
                <HiddenGemCard key={g.model} item={g} onClick={() => setOpenModel(g.model)} />
              ))}
            </div>
          </section>
        )}

        {ranking.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-[13px] font-medium text-foreground/85 tracking-wide">Ranking · alle Models</h2>
              <span className="text-[11px] text-foreground/40 font-light">{ranking.length}</span>
            </div>
            <div className="space-y-2">
              {ranking.map((r, idx) => (
                <ModelScoreRow key={r.model} item={r} rank={idx + 1} onClick={() => setOpenModel(r.model)} />
              ))}
            </div>
          </section>
        )}
      </div>

      <ModelPerformanceSlideOver
        open={openModel !== null}
        onClose={() => setOpenModel(null)}
        modelName={openModel}
        platform={platform}
      />
    </div>
  );
}
