/**
 * Logistic Regression für Risk-Forecast
 *
 * Lernt aus eigener History, welche Signale tatsächlich Crashes vorhersagen.
 * Komplett client-side, kein Server, keine API-Kosten.
 *
 * Features (8): exakt die 8 Signal-Punkte aus der Heuristik (revenue, delay,
 * massdm, openchats, peer, onboarding, tier, absence) — wir lernen nur die
 * Gewichtung neu. So bleibt das Modell interpretierbar und vergleichbar.
 *
 * Label: 1 wenn in den nächsten 3 Tagen Revenue ≥30% gegenüber Baseline gefallen.
 *
 * Training: Gradient Descent mit L2-Regularisierung gegen Overfitting auf
 * kleinen Datensätzen (das ist bei <30 Tagen History essentiell!).
 */

import {
  computeRiskScore,
  type ForecastInput,
  type HistoryPoint,
  type SignalContribution,
} from "./risk-forecast";

export const FEATURE_KEYS = [
  "revenue", "delay", "massdm", "openchats", "peer", "onboarding", "tier", "absence",
] as const;
export type FeatureKey = typeof FEATURE_KEYS[number];

export interface MLModel {
  /** Gewichte pro Feature (in Punkte-Raum 0..maxWeight) */
  weights: Record<FeatureKey, number>;
  /** Bias-Term */
  bias: number;
  /** wieviele Trainings-Beispiele verwendet wurden */
  trainSamples: number;
  /** wie viele davon Crash=1 waren */
  positiveSamples: number;
  /** Trainings-Loss am Ende */
  trainLoss: number;
  /** ISO-Timestamp wann trainiert */
  trainedAt: string;
}

export interface TrainingSample {
  chatter: string;
  date: string;
  /** Punkte pro Signal (0..maxWeight, wie aus computeRiskScore) */
  features: Record<FeatureKey, number>;
  /** 1 = Crash kam in den nächsten 3 Tagen, 0 = nicht */
  label: 0 | 1;
  /** Roh-Heuristik-Score zum Vergleich */
  heuristicScore: number;
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function sigmoid(z: number): number {
  if (z > 35) return 1;
  if (z < -35) return 0;
  return 1 / (1 + Math.exp(-z));
}

function signalsToFeatures(signals: SignalContribution[]): Record<FeatureKey, number> {
  const f: Record<FeatureKey, number> = {
    revenue: 0, delay: 0, massdm: 0, openchats: 0, peer: 0, onboarding: 0, tier: 0, absence: 0,
  };
  for (const s of signals) f[s.key] = s.points;
  return f;
}

/* ------------------------------------------------------------------ */
/*  TRAININGS-SAMPLES AUS HISTORY                                      */
/* ------------------------------------------------------------------ */

export interface SamplingMeta {
  account: string | null;
  followers: number;
  daysSinceStart: number | null;
  peerMedian: number | null;
  peerP25: number | null;
}

/**
 * Erzeugt aus der gesamten Chatter-History Trainings-Samples.
 * Pro Pivot-Tag T: extrahiere Signal-Features mit Daten bis T-1, label mit
 * Crash-Outcome an T..T+2.
 */
export function buildTrainingSamples(
  fullHistoryByChatter: Map<string, HistoryPoint[]>,
  meta: Map<string, SamplingMeta>,
  dropThresholdPct: number = 30,
  includeAbsence: boolean = true,
): TrainingSample[] {
  const samples: TrainingSample[] = [];

  for (const [chatter, full] of fullHistoryByChatter) {
    if (full.length < 10) continue;
    const m = meta.get(chatter);
    if (!m) continue;

    for (let pivot = 7; pivot <= full.length - 3; pivot++) {
      const train = full.slice(Math.max(0, pivot - 7), pivot);
      const test = full.slice(pivot, pivot + 3);
      if (train.length < 5 || test.length < 2) continue;

      const baseline = average(train.slice(-3).map(h => h.revenue));
      if (baseline <= 0) continue;

      const input: ForecastInput = {
        chatter,
        account: m.account,
        followers: m.followers,
        history: train,
        fullHistory: includeAbsence ? full.slice(0, pivot) : undefined,
        daysSinceStart: m.daysSinceStart,
        peerMedian: m.peerMedian,
        peerP25: m.peerP25,
        includeAbsence,
      };
      const result = computeRiskScore(input);
      const features = signalsToFeatures(result.signals);

      const actualAvg = average(test.map(h => h.revenue));
      const dropPct = ((baseline - actualAvg) / baseline) * 100;
      const label: 0 | 1 = dropPct >= dropThresholdPct ? 1 : 0;

      samples.push({
        chatter,
        date: full[pivot].date,
        features,
        label,
        heuristicScore: result.score,
      });
    }
  }

  return samples;
}

/* ------------------------------------------------------------------ */
/*  TRAINING (Gradient Descent + L2)                                   */
/* ------------------------------------------------------------------ */

export interface TrainOptions {
  learningRate?: number;
  epochs?: number;
  /** L2-Regularisierung — höher = robuster gegen Overfitting (wichtig bei wenig Daten) */
  l2?: number;
}

const FEATURE_SCALE: Record<FeatureKey, number> = {
  // Wir normalisieren auf [0..1] indem wir durch max-Gewicht teilen, damit GD stabil ist.
  revenue: 30, delay: 25, massdm: 15, openchats: 10, peer: 10, onboarding: 5, tier: 5, absence: 15,
};

function normalize(features: Record<FeatureKey, number>): number[] {
  return FEATURE_KEYS.map(k => features[k] / FEATURE_SCALE[k]);
}

export function trainModel(
  samples: TrainingSample[],
  opts: TrainOptions = {},
): MLModel {
  const { learningRate = 0.3, epochs = 800, l2 = 0.05 } = opts;

  // Init: Gewichte = 0, Bias = 0
  let w = FEATURE_KEYS.map(() => 0);
  let b = 0;

  const X = samples.map(s => normalize(s.features));
  const y = samples.map(s => s.label);
  const n = samples.length;

  if (n === 0) {
    return emptyModel();
  }

  let loss = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    // Forward + Gradient
    const grads = w.map(() => 0);
    let gradB = 0;
    let l = 0;

    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < w.length; j++) z += w[j] * X[i][j];
      const p = sigmoid(z);
      const err = p - y[i];

      for (let j = 0; j < w.length; j++) grads[j] += err * X[i][j];
      gradB += err;

      // Cross-Entropy Loss
      const eps = 1e-12;
      l += -(y[i] * Math.log(p + eps) + (1 - y[i]) * Math.log(1 - p + eps));
    }

    // Update mit L2-Regularisierung
    for (let j = 0; j < w.length; j++) {
      w[j] -= learningRate * (grads[j] / n + l2 * w[j]);
    }
    b -= learningRate * (gradB / n);

    loss = l / n;
  }

  // Rückskalieren auf Punkte-Raum (für Interpretierbarkeit & Anzeige)
  const weights: Record<FeatureKey, number> = {} as Record<FeatureKey, number>;
  FEATURE_KEYS.forEach((k, j) => {
    weights[k] = w[j] / FEATURE_SCALE[k];
  });

  return {
    weights,
    bias: b,
    trainSamples: n,
    positiveSamples: y.filter(v => v === 1).length,
    trainLoss: loss,
    trainedAt: new Date().toISOString(),
  };
}

function emptyModel(): MLModel {
  const weights: Record<FeatureKey, number> = {} as Record<FeatureKey, number>;
  for (const k of FEATURE_KEYS) weights[k] = 0;
  return { weights, bias: 0, trainSamples: 0, positiveSamples: 0, trainLoss: 0, trainedAt: new Date().toISOString() };
}

/* ------------------------------------------------------------------ */
/*  PREDICTION                                                         */
/* ------------------------------------------------------------------ */

/** Wahrscheinlichkeit (0..1) dass es zum Crash kommt */
export function predictProbability(model: MLModel, features: Record<FeatureKey, number>): number {
  let z = model.bias;
  for (const k of FEATURE_KEYS) {
    z += model.weights[k] * features[k];
  }
  return sigmoid(z);
}

/** Wandelt Probability in 0..100-Score um, damit es konsistent mit Heuristik bleibt */
export function predictScore(model: MLModel, features: Record<FeatureKey, number>): number {
  return Math.round(predictProbability(model, features) * 100);
}

/* ------------------------------------------------------------------ */
/*  EVAL                                                               */
/* ------------------------------------------------------------------ */

export interface EvalResult {
  /** Threshold der für die Quote benutzt wurde (in 0..100) */
  threshold: number;
  totalPredictions: number;
  hits: number;
  hitRate: number;
  /** Detail-Liste */
  details: { chatter: string; date: string; predictedScore: number; actualLabel: 0 | 1; hit: boolean }[];
}

export function evaluateModel(
  model: MLModel,
  samples: TrainingSample[],
  threshold: number = 60,
): EvalResult {
  let total = 0;
  let hits = 0;
  const details: EvalResult["details"] = [];

  for (const s of samples) {
    const score = predictScore(model, s.features);
    if (score < threshold) continue;
    total++;
    const hit = s.label === 1;
    if (hit) hits++;
    details.push({
      chatter: s.chatter,
      date: s.date,
      predictedScore: score,
      actualLabel: s.label,
      hit,
    });
  }

  return {
    threshold,
    totalPredictions: total,
    hits,
    hitRate: total > 0 ? hits / total : 0,
    details: details.sort((a, b) => b.predictedScore - a.predictedScore),
  };
}

/** Heuristik-Eval (gleiche Sample-Basis) — für fairen A/B-Vergleich */
export function evaluateHeuristic(
  samples: TrainingSample[],
  threshold: number = 60,
): EvalResult {
  let total = 0;
  let hits = 0;
  const details: EvalResult["details"] = [];

  for (const s of samples) {
    if (s.heuristicScore < threshold) continue;
    total++;
    const hit = s.label === 1;
    if (hit) hits++;
    details.push({
      chatter: s.chatter,
      date: s.date,
      predictedScore: s.heuristicScore,
      actualLabel: s.label,
      hit,
    });
  }

  return {
    threshold,
    totalPredictions: total,
    hits,
    hitRate: total > 0 ? hits / total : 0,
    details: details.sort((a, b) => b.predictedScore - a.predictedScore),
  };
}

/** Kombi: trainiert + evaluiert in einem Rutsch */
export interface TrainAndEvalResult {
  model: MLModel;
  ml: EvalResult;
  heuristic: EvalResult;
  /** Anzahl Crashes / Anzahl Samples gesamt — zeigt ob Datenbasis ausreicht */
  baseRate: number;
}

export function trainAndEvaluate(
  samples: TrainingSample[],
  threshold: number = 60,
  trainOpts?: TrainOptions,
): TrainAndEvalResult {
  const model = trainModel(samples, trainOpts);
  const ml = evaluateModel(model, samples, threshold);
  const heuristic = evaluateHeuristic(samples, threshold);
  const baseRate = samples.length > 0 ? samples.filter(s => s.label === 1).length / samples.length : 0;
  return { model, ml, heuristic, baseRate };
}
