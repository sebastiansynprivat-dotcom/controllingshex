/**
 * Dedizierte Auffälligkeiten-Seite (Sidebar Tab).
 *
 * Premium Layout mit Hero-Header, Zeitraumfilter und voller Anomaly-Liste.
 * Synchron mit Dashboard und Swipe Mode (gleiche Lib + Dismissal-Sync).
 *
 * Zwei Ansichten:
 *  - "Einzeln" — klassischer Modus (Toggle Probleme/Highlights)
 *  - "Vergleich" — Split-Screen: rote Probleme links, grüne Highlights rechts,
 *    jede Seite unabhängig scrollbar.
 */
import { useMemo, useState } from "react";
import { usePlatform } from "@/contexts/PlatformContext";
import { AlertOctagon, Sparkles, Columns2, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import AnomalyPanel from "@/components/AnomalyPanel";
import AnomalyTray from "@/components/AnomalyTray";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import TimeRangeToggle from "@/components/TimeRangeToggle";
import { buildTimeRange, rangeLabel, type TimeRange } from "@/lib/timerange-categorize";

const RANGE_STORAGE_KEY = "anomalies-page-range-v1";
const VIEW_STORAGE_KEY = "anomalies-page-view-v1";

type ViewMode = "single" | "compare";

function loadPersistedRange(): TimeRange {
  if (typeof sessionStorage === "undefined") return buildTimeRange("7d");
  try {
    const raw = sessionStorage.getItem(RANGE_STORAGE_KEY);
    if (!raw) return buildTimeRange("7d");
    const parsed = JSON.parse(raw);
    if (parsed?.preset === "custom" && parsed.from && parsed.to) {
      return buildTimeRange("custom", parsed.from, parsed.to);
    }
    if (parsed?.preset) return buildTimeRange(parsed.preset);
  } catch { /* noop */ }
  return buildTimeRange("7d");
}

function loadPersistedView(): ViewMode {
  if (typeof sessionStorage === "undefined") return "single";
  try {
    const raw = sessionStorage.getItem(VIEW_STORAGE_KEY);
    return raw === "compare" ? "compare" : "single";
  } catch { return "single"; }
}

export default function Anomalies() {
  const { platform } = usePlatform();
  const [range, setRangeRaw] = useState<TimeRange>(() => loadPersistedRange());
  const setRange = (r: TimeRange) => {
    setRangeRaw(r);
    try {
      sessionStorage.setItem(
        RANGE_STORAGE_KEY,
        JSON.stringify({ preset: r.preset, from: r.from, to: r.to }),
      );
    } catch { /* noop */ }
  };
  const [view, setViewRaw] = useState<ViewMode>(() => loadPersistedView());
  const setView = (v: ViewMode) => {
    setViewRaw(v);
    try { sessionStorage.setItem(VIEW_STORAGE_KEY, v); } catch { /* noop */ }
  };
  const [selectedChatter, setSelectedChatter] = useState<string | null>(null);

  const subtitle = useMemo(
    () =>
      `Wer braucht jetzt deine Aufmerksamkeit? Berechnung im Zeitraum: ${rangeLabel(range)}.`,
    [range],
  );

  return (
    <div className="min-h-full bg-background -m-3 sm:m-0">
      <div
        className={cn(
          "mx-auto px-3 sm:px-6 py-3 sm:py-10 space-y-3 sm:space-y-6 pb-32 sm:pb-40",
          view === "compare" ? "max-w-[1600px]" : "max-w-5xl",
        )}
      >
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-white/[0.06] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-4 sm:p-8">
          <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-orange-500/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-red-500/[0.08] blur-3xl pointer-events-none" />
          <div className="relative flex items-start gap-3 sm:gap-4">
            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-orange-400/20 to-red-500/10 border border-orange-300/20 flex items-center justify-center shrink-0">
              <AlertOctagon className="h-4 w-4 sm:h-5 sm:w-5 text-orange-200" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-white/40 font-light">
                <Sparkles className="h-3 w-3" />
                Cockpit
              </div>
              <h1 className="text-xl sm:text-3xl font-semibold tracking-tight gold-text mt-0.5 sm:mt-1">
                Auffälligkeiten
              </h1>
              <p className="text-[12px] sm:text-sm text-white/55 font-light mt-1 sm:mt-1.5 max-w-2xl leading-relaxed">
                {subtitle}
              </p>
            </div>

            {/* View-Toggle: Einzeln vs. Vergleich */}
            <div className="hidden sm:flex items-center gap-1 p-1 rounded-xl border border-white/[0.06] bg-white/[0.02] shrink-0">
              <button
                type="button"
                onClick={() => setView("single")}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium uppercase tracking-wider transition-all",
                  view === "single"
                    ? "bg-white/[0.08] text-white/90"
                    : "text-white/45 hover:text-white/70",
                )}
              >
                <Square className="h-3 w-3" />
                Einzeln
              </button>
              <button
                type="button"
                onClick={() => setView("compare")}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium uppercase tracking-wider transition-all",
                  view === "compare"
                    ? "bg-gradient-to-br from-red-500/[0.12] to-emerald-500/[0.12] border border-white/[0.08] text-white/90"
                    : "text-white/45 hover:text-white/70",
                )}
              >
                <Columns2 className="h-3 w-3" />
                Vergleich
              </button>
            </div>
          </div>

          {/* Mobile View-Toggle */}
          <div className="sm:hidden mt-3 flex items-center gap-1 p-1 rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <button
              type="button"
              onClick={() => setView("single")}
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium uppercase tracking-wider transition-all",
                view === "single" ? "bg-white/[0.08] text-white/90" : "text-white/45",
              )}
            >
              <Square className="h-3 w-3" /> Einzeln
            </button>
            <button
              type="button"
              onClick={() => setView("compare")}
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium uppercase tracking-wider transition-all",
                view === "compare"
                  ? "bg-gradient-to-br from-red-500/[0.12] to-emerald-500/[0.12] border border-white/[0.08] text-white/90"
                  : "text-white/45",
              )}
            >
              <Columns2 className="h-3 w-3" /> Vergleich
            </button>
          </div>
        </div>

        {/* Panel(s) */}
        {view === "single" ? (
          <AnomalyPanel
            platform={platform}
            range={range}
            onRangeChange={setRange}
            variant="default"
            onChatterSelect={setSelectedChatter}
          />
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {/* Geteilter Zeitraum-Filter für beide Seiten */}
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 sm:px-4 sm:py-3">
              <span className="text-[11px] uppercase tracking-[0.2em] text-white/45 font-medium hidden sm:inline">
                Zeitraum
              </span>
              <div className="flex-1 sm:flex-none overflow-x-auto">
                <TimeRangeToggle value={range} onChange={setRange} />
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-5 items-start">
            {/* Probleme — rote Seite */}
            <div className="relative rounded-2xl sm:rounded-3xl border border-red-400/15 bg-gradient-to-b from-red-500/[0.04] to-transparent p-2 sm:p-3 min-w-0">
              <div className="flex items-center gap-2 px-2 pt-1 pb-2">
                <span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                <span className="text-[11px] uppercase tracking-[0.25em] text-red-200/80 font-medium">
                  Probleme
                </span>
              </div>
              <AnomalyPanel
                platform={platform}
                range={range}
                onRangeChange={setRange}
                variant="default"
                onChatterSelect={setSelectedChatter}
                hideTimeControls
                forcedMode="problems"
              />
            </div>

            {/* Highlights — grüne Seite */}
            <div className="relative rounded-2xl sm:rounded-3xl border border-emerald-400/15 bg-gradient-to-b from-emerald-500/[0.04] to-transparent p-2 sm:p-3 min-w-0">
              <div className="flex items-center gap-2 px-2 pt-1 pb-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span className="text-[11px] uppercase tracking-[0.25em] text-emerald-200/80 font-medium">
                  Highlights
                </span>
              </div>
              <AnomalyPanel
                platform={platform}
                range={range}
                onRangeChange={setRange}
                variant="default"
                onChatterSelect={setSelectedChatter}
                hideTimeControls
                forcedMode="highlights"
              />
            </div>
          </div>
          </div>
        )}

        {/* Erläuterung */}
        <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-4 sm:p-5 text-xs text-white/45 font-light leading-relaxed">
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

      <AnomalyTray />
    </div>
  );
}
