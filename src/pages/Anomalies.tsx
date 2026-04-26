/**
 * Dedizierte Auffälligkeiten-Seite (Sidebar Tab).
 *
 * Premium Layout mit Hero-Header, Zeitraumfilter und voller Anomaly-Liste.
 * Synchron mit Dashboard und Swipe Mode (gleiche Lib + Dismissal-Sync).
 */
import { useMemo, useState } from "react";
import { usePlatform } from "@/contexts/PlatformContext";
import { AlertOctagon, Sparkles } from "lucide-react";
import AnomalyPanel from "@/components/AnomalyPanel";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { buildTimeRange, rangeLabel, type TimeRange } from "@/lib/timerange-categorize";

export default function Anomalies() {
  const { platform } = usePlatform();
  const [range, setRange] = useState<TimeRange>(() => buildTimeRange("7d"));
  const [selectedChatter, setSelectedChatter] = useState<string | null>(null);

  const subtitle = useMemo(
    () =>
      `Wer braucht jetzt deine Aufmerksamkeit? Berechnung im Zeitraum: ${rangeLabel(range)}.`,
    [range],
  );

  return (
    <div className="min-h-full bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-6 sm:p-8">
          <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-orange-500/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-red-500/[0.08] blur-3xl pointer-events-none" />
          <div className="relative flex items-start gap-4">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-orange-400/20 to-red-500/10 border border-orange-300/20 flex items-center justify-center shrink-0">
              <AlertOctagon className="h-5 w-5 text-orange-200" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-white/40 font-light">
                <Sparkles className="h-3 w-3" />
                Cockpit
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight gold-text mt-1">
                Auffälligkeiten
              </h1>
              <p className="text-sm text-white/55 font-light mt-1.5 max-w-2xl">
                {subtitle}
              </p>
            </div>
          </div>
        </div>

        {/* Panel */}
        <AnomalyPanel
          platform={platform}
          range={range}
          onRangeChange={setRange}
          variant="default"
          onChatterSelect={setSelectedChatter}
        />

        {/* Erläuterung */}
        <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-5 text-xs text-white/45 font-light leading-relaxed">
          <p className="text-white/65 mb-2 text-[11px] uppercase tracking-[0.2em]">Wie wird gezählt?</p>
          <ul className="space-y-1.5">
            <li>📉 <span className="text-white/70">Unter Peer-Schnitt</span> — Ø Tagesumsatz unter 50% des Schnitts aller Chatter im Zeitraum.</li>
            <li>⚠️ <span className="text-white/70">Eigener Schnitt gefallen</span> — Vergleich gegen 30 Tage VOR dem Fenster, ab −35%.</li>
            <li>🔥 <span className="text-white/70">Mehrtägige 0€-Serie</span> — 3+ Tage in Folge ohne Umsatz am Ende des Fensters.</li>
            <li>📨 <span className="text-white/70">MassDMs &lt; 6/Tag</span> — Hebel nicht genutzt; verschärft wenn auch der Umsatz fehlt.</li>
            <li>🚨 <span className="text-white/70">Keine MassDMs &amp; kein Umsatz</span> — Maximaler Trigger.</li>
          </ul>
          <p className="mt-3 text-white/35">Ein ✓ blendet die Auffälligkeit bis zum nächsten hochgeladenen Report aus.</p>
        </div>
      </div>

      <ChatterSlideOver
        open={!!selectedChatter}
        chatterName={selectedChatter ?? ""}
        platform={platform}
        onClose={() => setSelectedChatter(null)}
      />
    </div>
  );
}
