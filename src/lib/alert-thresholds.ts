/**
 * User-konfigurierbare Alert-Schwellen für den Swipe-Mode.
 * Persistiert in localStorage (gerätelokale Präferenz).
 */
import { z } from "zod";

export const STORAGE_KEY = "tinder.alertThresholds.v1";

export const alertThresholdsSchema = z.object({
  /** Mindestanteil Null-Tage im Fenster für "medium" (0.0–1.0) */
  zeroMedRate: z.number().min(0).max(1),
  /** Mindestanteil Null-Tage im Fenster für "high" (0.0–1.0) */
  zeroHighRate: z.number().min(0).max(1),
  /** Absoluter Floor an Null-Tagen für "medium" (1–60) */
  zeroMedFloor: z.number().int().min(1).max(60),
  /** Absoluter Floor an Null-Tagen für "high" (1–60) */
  zeroHighFloor: z.number().int().min(1).max(60),
  /** Aktueller Antwortverzug ab dem ein "medium" Alert ausgelöst wird (Tage) */
  delayMedDays: z.number().int().min(1).max(30),
  /** Aktueller Antwortverzug ab dem ein "high" Alert ausgelöst wird (Tage) */
  delayHighDays: z.number().int().min(1).max(30),
  /** Trend-Slope (negativ) ab dem ein "medium" Alert ausgelöst wird (-0.05 .. -1.0) */
  trendMedPct: z.number().min(-1).max(-0.05),
  /** Trend-Slope (negativ) ab dem ein "high" Alert ausgelöst wird (-0.1 .. -1.0) */
  trendHighPct: z.number().min(-1).max(-0.1),
});

export type AlertThresholds = z.infer<typeof alertThresholdsSchema>;

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  zeroMedRate: 0.3,
  zeroHighRate: 0.5,
  zeroMedFloor: 5,
  zeroHighFloor: 8,
  delayMedDays: 2,
  delayHighDays: 4,
  trendMedPct: -0.3,
  trendHighPct: -0.5,
};

export function loadAlertThresholds(): AlertThresholds {
  if (typeof window === "undefined") return DEFAULT_THRESHOLDS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THRESHOLDS;
    const parsed = alertThresholdsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_THRESHOLDS;
    return parsed.data;
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

export function saveAlertThresholds(t: AlertThresholds): void {
  if (typeof window === "undefined") return;
  const parsed = alertThresholdsSchema.safeParse(t);
  if (!parsed.success) throw new Error("Ungültige Schwellenwerte");
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed.data));
  // Notify other tabs / components in same tab
  window.dispatchEvent(new CustomEvent("alertThresholdsChanged", { detail: parsed.data }));
}

/**
 * Skaliere die User-Basis-Schwellen je nach Fenster-Länge.
 * Kleine Fenster: Floor zählt absoluter; große Fenster: Floor wird kleiner-relativ aber Rate bleibt.
 */
export function effectiveThresholds(base: AlertThresholds, days: number) {
  // Bei sehr kleinen Fenstern macht ein Floor von 8 keinen Sinn → cap auf days
  const cap = (n: number) => Math.min(n, Math.max(1, days));
  return {
    zeroMedRate: base.zeroMedRate,
    zeroHighRate: base.zeroHighRate,
    zeroMedFloor: cap(base.zeroMedFloor),
    zeroHighFloor: cap(base.zeroHighFloor),
    delayMedDays: base.delayMedDays,
    delayHighDays: base.delayHighDays,
    trendMedPct: base.trendMedPct,
    trendHighPct: base.trendHighPct,
  };
}
