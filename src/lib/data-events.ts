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

export interface AnomalyDismissedPayload {
  /** Eindeutige Source-ID der Instanz, die das Event ausgelöst hat — andere können dieses Event entsprechend ignorieren wenn sie es selbst gesendet haben. */
  sourceId?: string;
  /** Betroffene Chatter-Namen (für lokales Filtern ohne kompletten Refetch). */
  chatterName?: string;
  /** Wenn nur ein einzelner Alert-Typ entfernt wurde, sonst alle für den Chatter. */
  alertType?: string;
}

export function emitAnomalyDismissed(payload: AnomalyDismissedPayload = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ANOMALY_DISMISSED, { detail: payload }));
}

export function onAnomalyDismissed(
  handler: (payload: AnomalyDismissedPayload) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const wrapped = (e: Event) => {
    const detail = (e as CustomEvent<AnomalyDismissedPayload>).detail ?? {};
    handler(detail);
  };
  window.addEventListener(ANOMALY_DISMISSED, wrapped);
  return () => window.removeEventListener(ANOMALY_DISMISSED, wrapped);
}

/** Chatter-Labels Sync (SlideOver ↔ AnomalyPanel ↔ Today). */
export const CHATTER_LABELS_UPDATED = "chatter-labels-updated";

export interface ChatterLabelsUpdatedPayload {
  chatterName?: string;
}

export function emitChatterLabelsUpdated(payload: ChatterLabelsUpdatedPayload = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHATTER_LABELS_UPDATED, { detail: payload }));
}

export function onChatterLabelsUpdated(
  handler: (payload: ChatterLabelsUpdatedPayload) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const wrapped = (e: Event) => {
    const detail = (e as CustomEvent<ChatterLabelsUpdatedPayload>).detail ?? {};
    handler(detail);
  };
  window.addEventListener(CHATTER_LABELS_UPDATED, wrapped);
  return () => window.removeEventListener(CHATTER_LABELS_UPDATED, wrapped);
}
