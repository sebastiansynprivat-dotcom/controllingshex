/**
 * Anomaly-Tray: persistente Ablage für Auffälligkeiten-Karten.
 *
 * Karten können per Drag in die Ablage gezogen werden und verschwinden
 * dadurch aus der Übersicht. Persistiert in localStorage, synchronisiert
 * über window-Events zwischen mehreren `AnomalyPanel`-Instanzen (z. B.
 * Vergleichs-Modus mit links/rechts) und über Tabs (storage-Event).
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "anomaly-tray-v1";
const EVENT_NAME = "anomaly-tray-changed";

export interface TrayItem {
  /** Eindeutiger Schlüssel = Chatter-Name (alle Signale pro Chatter werden gruppiert). */
  name: string;
  kind: "problem" | "highlight";
  severity: string;
  message: string;
  impactPerDay: number;
  addedAt: number;
}

function loadFromStorage(): TrayItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is TrayItem => x && typeof x.name === "string");
  } catch {
    return [];
  }
}

function saveToStorage(items: TrayItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota / unavailable */
  }
}

function emitChange() {
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {
    /* noop */
  }
}

export function useAnomalyTray() {
  const [items, setItems] = useState<TrayItem[]>(() => loadFromStorage());

  useEffect(() => {
    const sync = () => setItems(loadFromStorage());
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY) sync();
    });
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
    };
  }, []);

  const add = useCallback((item: Omit<TrayItem, "addedAt">) => {
    const next = loadFromStorage().filter((x) => x.name !== item.name);
    next.unshift({ ...item, addedAt: Date.now() });
    saveToStorage(next);
    setItems(next);
    emitChange();
  }, []);

  const remove = useCallback((name: string) => {
    const next = loadFromStorage().filter((x) => x.name !== name);
    saveToStorage(next);
    setItems(next);
    emitChange();
  }, []);

  const clear = useCallback(() => {
    saveToStorage([]);
    setItems([]);
    emitChange();
  }, []);

  const has = useCallback(
    (name: string) => items.some((x) => x.name === name),
    [items],
  );

  return { items, add, remove, clear, has };
}

export const TRAY_DRAG_MIME = "application/x-anomaly-tray-item";
