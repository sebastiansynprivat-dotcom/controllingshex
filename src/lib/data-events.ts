/**
 * Globaler Event-Bus für Daten-Refreshes nach Upload eines neuen Berichts.
 *
 * - `chatter-history-updated` wird gefeuert, sobald ein Upload `chatter_history`
 *   erfolgreich geschrieben hat. Konsumenten (z.B. ChatterSlideOver, Dashboard,
 *   Forecast, TinderMode) re-fetchen ihre Daten ohne harten Reload.
 *
 * Das Event ist eine simple `CustomEvent` ohne Payload — Empfänger kennen ihre
 * eigene Query-Logik und laden frisch.
 */

export const CHATTER_DATA_UPDATED = "chatter-history-updated";

export function emitChatterDataUpdated(reason: string = "upload") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHATTER_DATA_UPDATED, { detail: { reason } }));
}

export function onChatterDataUpdated(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const wrapped = () => handler();
  window.addEventListener(CHATTER_DATA_UPDATED, wrapped);
  return () => window.removeEventListener(CHATTER_DATA_UPDATED, wrapped);
}

/** Auffälligkeiten-Dismissal Sync (Dashboard ↔ Auffälligkeiten-Page ↔ Swipe Mode). */
export const ANOMALY_DISMISSED = "anomaly-dismissed";

export function emitAnomalyDismissed() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ANOMALY_DISMISSED));
}

export function onAnomalyDismissed(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const wrapped = () => handler();
  window.addEventListener(ANOMALY_DISMISSED, wrapped);
  return () => window.removeEventListener(ANOMALY_DISMISSED, wrapped);
}
