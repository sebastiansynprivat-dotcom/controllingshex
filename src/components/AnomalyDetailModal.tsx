/**
 * Detail-Modal für eine einzelne Auffälligkeit.
 *
 * Zeigt:
 *  - Was wurde gemessen (Wert) und gegen was verglichen (Baseline / Schwelle)
 *  - Welcher Schwellenwert ausgelöst hat
 *  - Welcher Zeitraum vs. welcher Vergleichszeitraum verwendet wurde
 *  - Klartext-Erklärung der Berechnung
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ANOMALY_LABELS, SEVERITY_STYLE, type ChatterAnomaly, type AnomalyType } from "@/lib/anomaly-window";
import { rangeLabel, type TimeRange } from "@/lib/timerange-categorize";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anomaly: ChatterAnomaly | null;
  range: TimeRange;
  peerAvgRevenuePerDay: number;
}

interface Explanation {
  formula: string;
  threshold: string;
  comparePeriod: string;
  reasoning: string;
}

function explain(a: ChatterAnomaly, range: TimeRange, peerAvg: number): Explanation {
  const windowLabel = rangeLabel(range);
  switch (a.alert_type) {
    case "peer_underperform":
      return {
        formula: `Ø Tagesumsatz Chatter ÷ Ø Tagesumsatz aller Chatter`,
        threshold: `< 50% des Peer-Schnitts (Schwelle: ${(peerAvg * 0.5).toFixed(0)}€/Tag)`,
        comparePeriod: `Peer-Schnitt aller aktiven Chatter im Fenster (${windowLabel})`,
        reasoning: `Der Ø Tagesumsatz von ${a.metric_value.toFixed(0)}€ liegt ${Math.abs(a.delta_pct)}% unter dem Peer-Schnitt von ${a.baseline_value.toFixed(0)}€. Severity „Hoch" ab < 25% des Peer-Schnitts.`,
      };
    case "self_revenue_drop":
      return {
        formula: `(Baseline-Ø − Aktueller Ø) ÷ Baseline-Ø`,
        threshold: `Einbruch ≥ 35% (Hoch ≥ 55%, Kritisch ≥ 70%)`,
        comparePeriod: `Eigener Ø der letzten 30 Tage VOR dem Fenster (${windowLabel})`,
        reasoning: `Der eigene Schnitt war ${a.baseline_value.toFixed(0)}€/Tag, jetzt ${a.metric_value.toFixed(0)}€/Tag — ein Rückgang von ${Math.abs(a.delta_pct)}%. Mindestens 3 Tage Eigen-Historie & Baseline ≥ 30€ erforderlich.`,
      };
    case "persistent_zero":
      return {
        formula: `Längste 0€-Strecke am Ende des Fensters`,
        threshold: `≥ 3 Tage (Hoch ≥ 5, Kritisch ≥ 7)`,
        comparePeriod: `Aktueller Zeitraum (${windowLabel})`,
        reasoning: `${a.metric_value} aufeinanderfolgende Tage ohne Umsatz am Ende des Fensters. Stärkster Krisen-Indikator neben fehlenden MassDMs.`,
      };
    case "massdm_low":
      return {
        formula: `Σ MassDMs ÷ Tage im Fenster vs. Ziel 6/Tag`,
        threshold: `< 4 MassDMs/Tag — Severity dynamisch je nach Umsatzlage`,
        comparePeriod: `Aktueller Zeitraum (${windowLabel}); Umsatz-Kontext via Peer-Schnitt`,
        reasoning: `Ø ${a.metric_value.toFixed(1)} MassDMs/Tag (Ziel: 6). Severity steigt wenn auch der Umsatz fehlt: „Kritisch" wenn < 2/Tag UND kein Umsatz, „Hoch" bei keinem Umsatz oder schwachem Umsatz + < 2/Tag.`,
      };
    case "massdm_zero_no_rev":
      return {
        formula: `Σ MassDMs ÷ Tage im Fenster (mit Umsatzcheck)`,
        threshold: `< 1 MassDM/Tag UND Ø Umsatz < 5€/Tag`,
        comparePeriod: `Aktueller Zeitraum (${windowLabel})`,
        reasoning: `Maximaler Trigger: Praktisch keine MassDMs (${a.metric_value.toFixed(1)}/Tag) und parallel kein Umsatz. Hebel wird nicht genutzt — direkter Handlungsbedarf.`,
      };
  }
}

export default function AnomalyDetailModal({ open, onOpenChange, anomaly, range, peerAvgRevenuePerDay }: Props) {
  if (!anomaly) return null;
  const meta = ANOMALY_LABELS[anomaly.alert_type];
  const sev = SEVERITY_STYLE[anomaly.severity];
  const exp = explain(anomaly, range, peerAvgRevenuePerDay);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-background border-white/10">
        <DialogHeader>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/40 font-light">
            <span className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} />
            {sev.label} · {anomaly.chatter_name}
          </div>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span>{meta.emoji}</span>
            <span>{meta.label}</span>
          </DialogTitle>
          <DialogDescription className="text-white/55 font-light">
            {anomaly.message}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Werte-Block */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="text-[10px] uppercase tracking-wider text-white/40 font-light">Gemessen</div>
              <div className={`text-lg font-medium mt-1 ${sev.text}`}>
                {anomaly.alert_type === "persistent_zero"
                  ? `${anomaly.metric_value} Tage`
                  : anomaly.alert_type.startsWith("massdm")
                  ? `${anomaly.metric_value.toFixed(1)}/Tag`
                  : `${anomaly.metric_value.toFixed(0)}€/Tag`}
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="text-[10px] uppercase tracking-wider text-white/40 font-light">Vergleich</div>
              <div className="text-lg font-medium mt-1 text-white/80">
                {anomaly.alert_type === "persistent_zero"
                  ? "—"
                  : anomaly.alert_type.startsWith("massdm")
                  ? `${anomaly.baseline_value}/Tag (Ziel)`
                  : `${anomaly.baseline_value.toFixed(0)}€/Tag`}
              </div>
              {anomaly.delta_pct !== 0 && (
                <div className={`text-[11px] font-light mt-0.5 ${anomaly.delta_pct < 0 ? "text-red-300/80" : "text-emerald-300/80"}`}>
                  {anomaly.delta_pct > 0 ? "+" : ""}{anomaly.delta_pct}%
                </div>
              )}
            </div>
          </div>

          {/* Schwelle */}
          <div className="rounded-lg border border-white/[0.05] bg-white/[0.01] p-3 space-y-2.5">
            <Row label="Schwelle" value={exp.threshold} />
            <Row label="Berechnung" value={exp.formula} mono />
            <Row label="Vergleichszeitraum" value={exp.comparePeriod} />
          </div>

          {/* Reasoning */}
          <div className="rounded-lg border border-white/[0.05] bg-white/[0.015] p-3">
            <div className="text-[10px] uppercase tracking-wider text-white/40 font-light mb-1.5">
              Warum dieser Alarm?
            </div>
            <p className="text-sm text-white/70 font-light leading-relaxed">
              {exp.reasoning}
            </p>
          </div>

          <p className="text-[10px] text-white/30 font-light">
            Sortier-Score: {anomaly.score.toFixed(1)} · Aktiver Zeitraum: {rangeLabel(range)}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="text-[10px] uppercase tracking-wider text-white/35 font-light shrink-0 w-32">{label}</div>
      <div className={`text-xs text-white/75 font-light flex-1 ${mono ? "font-mono text-[11px]" : ""}`}>
        {value}
      </div>
    </div>
  );
}
