import { useEffect, useState } from "react";
import { Sliders, RotateCcw, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  findTalentMatchesDetailed,
  loadThresholdOverride,
  saveThresholdOverride,
  type AdaptiveThresholds,
  type TalentDiagnostics,
} from "@/lib/talent-scout";

interface Props {
  platform: string;
  /** Wird gerufen, wenn der User Schwellen ändert — Parent sollte die Liste neu laden */
  onChange?: () => void;
}

const PRESSURE_META: Record<TalentDiagnostics["pressure"], { label: string; color: string }> = {
  low: { label: "niedrig", color: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" },
  medium: { label: "mittel", color: "text-amber-300 border-amber-500/30 bg-amber-500/10" },
  high: { label: "hoch", color: "text-red-300 border-red-500/30 bg-red-500/10" },
};

export default function TalentScoutPanel({ platform, onChange }: Props) {
  const [diag, setDiag] = useState<TalentDiagnostics | null>(null);
  const [override, setOverride] = useState<AdaptiveThresholds | null>(loadThresholdOverride());
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    findTalentMatchesDetailed(platform)
      .then((r) => { if (!cancel) setDiag(r.diagnostics); })
      .catch((e) => console.error("[TalentScoutPanel]", e))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [platform]);

  const apply = (next: AdaptiveThresholds | null) => {
    setOverride(next);
    saveThresholdOverride(next);
    onChange?.();
    // Diagnostik mit neuen Werten neu rechnen lassen
    findTalentMatchesDetailed(platform).then((r) => setDiag(r.diagnostics));
  };

  if (loading || !diag) {
    return (
      <div className="premium-card rounded-xl px-3 py-2 text-[11px] text-white/30 font-light">
        Schwellen werden berechnet …
      </div>
    );
  }

  const t = override ?? diag.thresholds;
  const pm = PRESSURE_META[diag.pressure];

  return (
    <div className="premium-card rounded-xl border border-white/5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Sliders className="h-3.5 w-3.5 text-fuchsia-300/80 shrink-0" />
          <span className="text-[11px] text-white/55 font-light">Talent-Schwellen</span>
          <span className="text-[10px] text-foreground/80 font-mono tabular-nums">
            DM ≥ {t.minMass} · Sess ≥ {t.minSessions} · Kons ≥ {t.minConsistency.toFixed(2)}
          </span>
          <span className={cn("text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border", pm.color)}>
            Druck: {pm.label}
          </span>
          {override && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300">
              manuell
            </span>
          )}
        </div>
        <ChevronDown className={cn("h-3.5 w-3.5 text-white/40 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-white/5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-white/55 font-light">
            <div>Underuser im Pool: <span className="text-foreground/80 tabular-nums">{diag.underuserCount}</span></div>
            <div>Starke Lecks (≥40): <span className="text-foreground/80 tabular-nums">{diag.strongLeakCount}</span></div>
            <div>Top-Leak-Score: <span className="text-foreground/80 tabular-nums">{Math.round(diag.topLeakScore)}</span></div>
            <div>Riser-Kandidaten: <span className="text-foreground/80 tabular-nums">{diag.riserCandidateCount}</span></div>
            <div className="col-span-2">Vorschläge aktuell: <span className="text-foreground/80 tabular-nums">{diag.totalMatches}</span></div>
          </div>

          <div className="space-y-2.5 pt-1">
            <Slider
              label="Min. MassDMs/Tag"
              value={t.minMass}
              min={1}
              max={8}
              step={1}
              onChange={(v) => apply({ ...t, minMass: v })}
            />
            <Slider
              label="Min. Sessions / 7T"
              value={t.minSessions}
              min={1}
              max={10}
              step={1}
              onChange={(v) => apply({ ...t, minSessions: v })}
            />
            <Slider
              label="Min. Konsistenz"
              value={t.minConsistency}
              min={0.1}
              max={1}
              step={0.05}
              onChange={(v) => apply({ ...t, minConsistency: Math.round(v * 100) / 100 })}
              format={(v) => v.toFixed(2)}
            />
          </div>

          {override && (
            <button
              onClick={() => apply(null)}
              className="flex items-center gap-1.5 text-[10px] text-white/45 hover:text-fuchsia-300 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Auto-Schwellen wiederherstellen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-[10px] text-white/50 font-light mb-1">
        <span>{label}</span>
        <span className="text-foreground/85 tabular-nums">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 accent-fuchsia-400 bg-white/10 rounded-full appearance-none cursor-pointer"
      />
    </label>
  );
}
