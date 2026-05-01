/**
 * SmartForecastPanel
 *
 * Trainiert client-side eine Logistic Regression auf der eigenen History
 * und zeigt:
 *  - aktuelle Risk-Liste mit ML-Score (0..100) statt Heuristik-Score
 *  - gelernte Coefficients (welches Signal zählt wirklich?)
 *  - A/B-Vergleich Heuristik vs. ML mit Trefferquoten
 *
 * Komplett ohne Server, ohne API-Cost, ohne neue Tabelle.
 */

import { useEffect, useMemo, useState } from "react";
import { Brain, CheckCircle2, XCircle, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import { loadBenchmarks, findCluster } from "@/lib/peer-benchmarks";
import {
  computeRiskScore,
  type ForecastInput,
  type HistoryPoint,
} from "@/lib/risk-forecast";
import {
  buildTrainingSamples,
  trainAndEvaluate,
  predictScore,
  FEATURE_KEYS,
  type TrainAndEvalResult,
  type SamplingMeta,
  type FeatureKey,
} from "@/lib/risk-ml";
import { cn } from "@/lib/utils";

interface AnalysisChatter { name: string; startDate?: string; account?: string }
interface AnalysisCategory { chatters: AnalysisChatter[] }
interface AnalysisResult { categories: AnalysisCategory[] }
function isAnalysisResult(v: unknown): v is AnalysisResult {
  return !!v && typeof v === "object" && Array.isArray((v as AnalysisResult).categories);
}
interface HistRow {
  chatter_name: string; account: string | null; analysis_date: string;
  revenue_today: number | null; response_delay_days: number | null;
  mass_dms: number | null; open_chats: number | null;
}

function daysBetween(start: string | undefined, today: Date): number | null {
  if (!start) return null;
  const d = new Date(start);
  if (isNaN(d.getTime())) return null;
  return Math.floor((today.getTime() - d.getTime()) / 86_400_000);
}

interface MLData {
  result: TrainAndEvalResult;
  livePredictions: { chatter: string; account: string | null; mlScore: number; heuristicScore: number }[];
}

function useMLData(): { loading: boolean; data: MLData | null; error: string | null } {
  const { platform } = usePlatform();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<MLData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true); setError(null);
      try {
        const { data: reportRows } = await supabase
          .from("analysis_reports").select("result_json")
          .eq("platform", platform).not("result_json", "is", null)
          .order("analysis_date", { ascending: false }).limit(1);

        const result = reportRows?.[0]?.result_json;
        const activeChatters: { name: string; account: string | null; daysSinceStart: number | null }[] = [];
        const today = new Date();
        if (isAnalysisResult(result)) {
          for (const cat of result.categories) {
            for (const ch of cat.chatters) {
              activeChatters.push({
                name: ch.name,
                account: ch.account?.trim() || null,
                daysSinceStart: daysBetween(ch.startDate, today),
              });
            }
          }
        }

        const since = new Date();
        since.setDate(since.getDate() - 30);
        const sinceStr = since.toISOString().split("T")[0];

        const { data: histRows } = await supabase
          .from("chatter_history")
          .select("chatter_name, account, analysis_date, revenue_today, response_delay_days, mass_dms, open_chats")
          .eq("platform", platform).gte("analysis_date", sinceStr)
          .order("analysis_date", { ascending: true });

        const bm = await loadBenchmarks(platform, 30);

        const byChatter = new Map<string, Map<string, HistoryPoint>>();
        for (const r of (histRows || []) as HistRow[]) {
          const k = r.chatter_name;
          if (!byChatter.has(k)) byChatter.set(k, new Map());
          const dayMap = byChatter.get(k)!;
          const existing = dayMap.get(r.analysis_date);
          const rev = Number(r.revenue_today) || 0;
          if (existing) {
            existing.revenue = Math.max(existing.revenue, rev);
            existing.responseDelay = Math.max(existing.responseDelay, Number(r.response_delay_days) || 0);
            existing.massDms = Math.max(existing.massDms, Number(r.mass_dms) || 0);
            existing.openChats = Math.max(existing.openChats, Number(r.open_chats) || 0);
          } else {
            dayMap.set(r.analysis_date, {
              date: r.analysis_date,
              revenue: rev,
              responseDelay: Number(r.response_delay_days) || 0,
              massDms: Number(r.mass_dms) || 0,
              openChats: Number(r.open_chats) || 0,
            });
          }
        }

        const fullHistMap = new Map<string, HistoryPoint[]>();
        for (const [name, dayMap] of byChatter) {
          fullHistMap.set(name, [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)));
        }

        const meta = new Map<string, SamplingMeta>();
        for (const ch of activeChatters) {
          const followers = ch.account
            ? bm.accountBaselines.get(ch.account.toLowerCase().trim())?.followers ?? 0
            : 0;
          const cluster = findCluster(bm, followers);
          meta.set(ch.name, {
            account: ch.account, followers,
            daysSinceStart: ch.daysSinceStart,
            peerMedian: cluster?.median ?? bm.globalMedian ?? null,
            peerP25: cluster?.p25 ?? bm.globalP25 ?? null,
          });
        }

        // Fallback: für alle History-Chatter, die NICHT im aktuellen Report stehen,
        // trotzdem leere Meta anlegen — sonst werden sie aus dem Training gefiltert.
        for (const name of fullHistMap.keys()) {
          if (!meta.has(name)) {
            meta.set(name, {
              account: null,
              followers: 0,
              daysSinceStart: null,
              peerMedian: bm.globalMedian ?? null,
              peerP25: bm.globalP25 ?? null,
            });
          }
        }

        // Diagnose
        const chattersWithEnoughHistory = [...fullHistMap.values()].filter(h => h.length >= 10).length;
        console.info("[ML] history chatters total:", fullHistMap.size,
          "| ≥10 days:", chattersWithEnoughHistory,
          "| active in report:", activeChatters.length);

        // 1) Training-Samples bauen
        const samples = buildTrainingSamples(fullHistMap, meta, 30, true);
        console.info("[ML] samples built:", samples.length,
          "| positives:", samples.filter(s => s.label === 1).length);

        if (samples.length === 0) {
          if (!cancelled) {
            const maxDays = Math.max(0, ...[...fullHistMap.values()].map(h => h.length));
            setError(
              `Noch zu wenig History für ML-Training. ` +
              `Längste Chatter-History: ${maxDays} Tage (mindestens 10 nötig). ` +
              `Chatter mit ≥10 Tagen: ${chattersWithEnoughHistory}.`
            );
            setLoading(false);
          }
          return;
        }

        // 2) Trainieren + evaluieren
        const trainResult = trainAndEvaluate(samples, 60);

        // 3) Live-Predictions auf aktuelle Daten (letzte 7 Tage als Input)
        const livePredictions: MLData["livePredictions"] = [];
        for (const ch of activeChatters) {
          const dayMap = byChatter.get(ch.name);
          if (!dayMap || dayMap.size < 3) continue;
          const sortedDays = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
          const last7 = sortedDays.slice(-7);
          const m = meta.get(ch.name);
          if (!m) continue;
          const input: ForecastInput = {
            chatter: ch.name, account: ch.account, followers: m.followers,
            history: last7,
            fullHistory: sortedDays,
            daysSinceStart: m.daysSinceStart,
            peerMedian: m.peerMedian, peerP25: m.peerP25,
            includeAbsence: true,
          };
          const heur = computeRiskScore(input);
          const features: Record<FeatureKey, number> = {
            revenue: 0, delay: 0, massdm: 0, openchats: 0, peer: 0, onboarding: 0, tier: 0, absence: 0,
          };
          for (const s of heur.signals) features[s.key] = s.points;
          const mlScore = predictScore(trainResult.model, features);
          livePredictions.push({
            chatter: ch.name, account: ch.account,
            mlScore, heuristicScore: heur.score,
          });
        }
        livePredictions.sort((a, b) => b.mlScore - a.mlScore);

        if (cancelled) return;
        setData({ result: trainResult, livePredictions });
        setLoading(false);
      } catch (e) {
        console.error("MLData error", e);
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Unbekannter Fehler");
          setLoading(false);
        }
      }
    };
    run();
    return () => { cancelled = true; };
  }, [platform]);

  return { loading, data, error };
}

const FEATURE_LABEL: Record<FeatureKey, string> = {
  revenue: "Revenue-Slope",
  delay: "Verzug-Drift",
  massdm: "Mass-DM-Verfall",
  openchats: "Chat-Stau",
  peer: "Peer-Gap",
  onboarding: "Onboarding",
  tier: "Tier-Mismatch",
  absence: "Abwesenheits-Muster",
};

/* ───────── HAUPT-PANEL ───────── */
export function MLForecastPanel() {
  const { loading, data, error } = useMLData();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="premium-spinner"><span /><span /><span /></div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="premium-card rounded-xl p-6 text-center border-amber-500/20">
        <Info className="h-6 w-6 text-amber-400/80 mx-auto mb-2" />
        <p className="text-foreground/80 font-light">{error || "Keine Daten."}</p>
      </div>
    );
  }

  const { result, livePredictions } = data;
  const { model } = result;

  return (
    <div className="space-y-6">
      {/* Status-Karten */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Trainings-Tage" value={`${model.trainSamples}`} hint={`davon ${model.positiveSamples} Crashes`} />
        <StatCard label="Crash-Quote (Basis)" value={`${Math.round(result.baseRate * 100)}%`} hint="im History-Datensatz" />
        <StatCard label="Heuristik-Treffer" value={`${Math.round(result.heuristic.hitRate * 100)}%`} hint={`${result.heuristic.hits} / ${result.heuristic.totalPredictions}`} accent="muted" />
        <StatCard label="ML-Treffer" value={`${Math.round(result.ml.hitRate * 100)}%`} hint={`${result.ml.hits} / ${result.ml.totalPredictions}`} accent={result.ml.hitRate >= result.heuristic.hitRate ? "good" : "warn"} />
      </div>

      {/* Verdict */}
      <VerdictBanner result={result} />

      {/* Gelernte Gewichte */}
      <div className="premium-card rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/[0.04] flex items-center gap-2">
          <Brain className="h-3.5 w-3.5 text-primary/80" />
          <p className="text-[11px] font-medium tracking-wider uppercase gold-text-subtle">
            Gelernte Signal-Gewichte
          </p>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {FEATURE_KEYS
            .map(k => ({ k, w: model.weights[k] }))
            .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
            .map(({ k, w }) => (
              <WeightRow key={k} label={FEATURE_LABEL[k]} weight={w} />
            ))}
        </div>
        <div className="px-4 py-2 border-t border-white/[0.04] text-[11px] text-white/30 font-light">
          Positiv = treibt Risk hoch · Negativ = senkt Risk · Bias {model.bias.toFixed(2)}
        </div>
      </div>

      {/* Live-Predictions */}
      <div className="premium-card rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/[0.04]">
          <p className="text-[11px] font-medium tracking-wider uppercase gold-text-subtle">
            Aktuelle ML-Prognose · Top 20
          </p>
        </div>
        <div className="divide-y divide-white/[0.04] max-h-96 overflow-y-auto">
          {livePredictions.slice(0, 20).map((p, i) => {
            const diff = p.mlScore - p.heuristicScore;
            return (
              <div key={i} className="row-accent flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className={cn(
                  "tabular-nums w-10 text-right font-medium",
                  p.mlScore >= 80 ? "text-red-400" :
                  p.mlScore >= 60 ? "text-orange-400" :
                  p.mlScore >= 35 ? "text-amber-400" : "text-emerald-400/80",
                )}>{p.mlScore}</span>
                <span className="text-foreground/70 font-light truncate flex-1">{p.chatter}</span>
                {p.account && <span className="text-white/30 text-xs font-light truncate">@{p.account}</span>}
                <span className="text-white/30 text-xs tabular-nums">Heur. {p.heuristicScore}</span>
                <span className={cn(
                  "text-xs tabular-nums w-12 text-right",
                  diff > 0 ? "text-orange-400/70" : diff < 0 ? "text-emerald-400/70" : "text-white/30",
                )}>{diff > 0 ? "+" : ""}{diff}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Predictions im Backtest */}
      <div className="premium-card rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/[0.04]">
          <p className="text-[11px] font-medium tracking-wider uppercase gold-text-subtle">
            ML-Backtest · Treffer/Misses
          </p>
        </div>
        <div className="divide-y divide-white/[0.04] max-h-80 overflow-y-auto">
          {result.ml.details.slice(0, 50).map((d, i) => (
            <div key={i} className="row-accent flex items-center gap-3 px-4 py-2.5 text-sm">
              {d.hit ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400/80 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-white/20 shrink-0" />
              )}
              <span className="text-foreground/70 font-light truncate flex-1">{d.chatter}</span>
              <span className="text-white/30 text-xs tabular-nums">{d.date}</span>
              <span className="text-orange-400/60 text-xs tabular-nums w-12 text-right">ML {d.predictedScore}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-white/30 text-[11px] font-light text-center">
        Modell trainiert {new Date(model.trainedAt).toLocaleString("de-DE")} · L2-Regularisierung schützt vor Overfitting
      </p>
    </div>
  );
}

/* ───────── HELPERS ───────── */

function StatCard({ label, value, hint, accent = "neutral" }: { label: string; value: string; hint?: string; accent?: "neutral" | "good" | "warn" | "muted" }) {
  const extra = accent === "good" ? "border-emerald-500/20" : accent === "warn" ? "border-amber-500/20" : "";
  const valCls = accent === "good" ? "text-emerald-300" : accent === "warn" ? "text-amber-300" : "gold-text";
  return (
    <div className={cn("premium-card rounded-xl px-4 py-3", extra)}>
      <p className="text-white/40 text-[11px] font-medium tracking-wider uppercase gold-text-subtle">{label}</p>
      <p className={cn("text-3xl font-extralight tabular-nums mt-1", valCls)}>{value}</p>
      {hint && <p className="text-white/30 text-[11px] font-light mt-0.5">{hint}</p>}
    </div>
  );
}

function WeightRow({ label, weight }: { label: string; weight: number }) {
  const maxShown = 0.15;
  const pct = Math.min(100, (Math.abs(weight) / maxShown) * 100);
  const positive = weight >= 0;
  return (
    <div className="row-accent flex items-center gap-3 px-4 py-2.5">
      <span className="text-foreground/70 text-sm font-light w-44 truncate">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-white/[0.04] overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", positive ? "ml-bar" : "ml-bar-neg")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn(
        "text-xs tabular-nums w-16 text-right",
        positive ? "text-orange-400/90" : "text-emerald-400/90",
      )}>{weight >= 0 ? "+" : ""}{weight.toFixed(3)}</span>
    </div>
  );
}

function VerdictBanner({ result }: { result: TrainAndEvalResult }) {
  const { model, ml, heuristic, baseRate } = result;
  const enoughData = model.trainSamples >= 80 && model.positiveSamples >= 10;
  const mlBetter = ml.hitRate > heuristic.hitRate + 0.05;
  const mlWorse = ml.hitRate < heuristic.hitRate - 0.05;

  let tone: "good" | "warn" | "neutral" = "neutral";
  let title = "Modell-Status";
  let body = "";

  if (!enoughData) {
    tone = "warn";
    title = "Datenbasis noch klein";
    body = `Nur ${model.trainSamples} Trainings-Beispiele (davon ${model.positiveSamples} Crashes). Aussagen werden ab ~30 Tagen History deutlich verlässlicher. Bis dahin ist die Heuristik wahrscheinlich gleichwertig oder besser.`;
  } else if (mlBetter) {
    tone = "good";
    title = "ML schlägt Heuristik";
    body = `Logistic Regression trifft ${Math.round(ml.hitRate * 100)}% vs. Heuristik ${Math.round(heuristic.hitRate * 100)}%. Modell hat aus deiner History gelernt was wirklich Crashes vorhersagt.`;
  } else if (mlWorse) {
    tone = "warn";
    title = "Heuristik aktuell besser";
    body = `Heuristik trifft ${Math.round(heuristic.hitRate * 100)}% vs. ML ${Math.round(ml.hitRate * 100)}%. Möglicherweise zu wenig Crashes (${model.positiveSamples}) für ein stabiles Modell.`;
  } else {
    title = "Beide Modelle ähnlich gut";
    body = `Heuristik ${Math.round(heuristic.hitRate * 100)}% · ML ${Math.round(ml.hitRate * 100)}%. Mit mehr History sollte ML überholen. Crash-Quote im Datensatz: ${Math.round(baseRate * 100)}%.`;
  }

  const extra = tone === "good" ? "border-emerald-500/25 glow-band-warning" : tone === "warn" ? "border-amber-500/25" : "";

  return (
    <div className={cn("premium-card rounded-xl px-4 py-3 space-y-1", extra)}>
      <p className="text-foreground/90 text-sm font-medium">{title}</p>
      <p className="text-white/60 text-xs font-light leading-relaxed">{body}</p>
    </div>
  );
}
