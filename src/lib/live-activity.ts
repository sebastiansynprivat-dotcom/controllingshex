// Activity detection + per-chatter hourly profile (Variante A: tagesschnitt × tageskurve).

export interface LiveRow {
  chatter_name: string;
  revenue: number;
  mass_dms: number;
  unread_chats: number;
  oldest_chat: number | null;
  updated_at: string;
}

export interface HistoryDay {
  revenue_today: number;
  mass_dms: number;
  open_chats: number;
  analysis_date: string;
}

export interface ChatterProfile {
  name: string;
  avgRevenue: number; // tagesschnitt
  avgMassDms: number;
  avgUnread: number;
  daysObserved: number;
}

export type ActivityStatus =
  | "active_strong"   // im typischen Fenster und auf/über pacing
  | "active_weak"     // im typischen Fenster, unter pacing
  | "active_idle"     // heute schon aktiv gewesen, gerade aber Pause
  | "inactive";       // heute noch gar nichts

export interface ChatterStatus {
  name: string;
  platform?: string;
  live: LiveRow | null;
  profile: ChatterProfile | null;
  isActiveToday: boolean;
  status: ActivityStatus;
  // pacing
  expectedRevenueByNow: number;
  pacingDelta: number; // €, positive = ahead, negative = behind
  reason: string;      // klartext für UI
  lastSeenSec: number | null;
}

const DAY_START = 6;
const DAY_END = 24;

function dayProgress(now: Date): number {
  const h = now.getHours() + now.getMinutes() / 60;
  return Math.max(0, Math.min(1, (h - DAY_START) / (DAY_END - DAY_START)));
}

export function buildProfile(name: string, days: HistoryDay[]): ChatterProfile {
  const valid = days.filter((d) => d.analysis_date);
  const sum = (arr: number[]) => arr.reduce((s, v) => s + (Number(v) || 0), 0);
  const avg = (arr: number[]) => (arr.length ? sum(arr) / arr.length : 0);
  return {
    name,
    avgRevenue: avg(valid.map((d) => d.revenue_today)),
    avgMassDms: avg(valid.map((d) => d.mass_dms)),
    avgUnread: avg(valid.map((d) => d.open_chats)),
    daysObserved: valid.length,
  };
}

/**
 * Aktiv heute = mindestens EINES davon:
 *  - Umsatz > 0
 *  - mass_dms >= 1
 *  - unread_chats spürbar unter persönlichem Schnitt (Chats abgearbeitet)
 *  - überhaupt ein Live-Eintrag mit Bewegung (oldest_chat oder unread > 0 + recent updated)
 */
export function isActiveToday(live: LiveRow | null, profile: ChatterProfile | null): boolean {
  if (!live) return false;
  if ((Number(live.revenue) || 0) > 0) return true;
  if ((live.mass_dms ?? 0) >= 1) return true;
  // chats abgearbeitet: aktueller unread deutlich unter persönlichem Schnitt
  if (profile && profile.avgUnread > 5 && (live.unread_chats ?? 0) < profile.avgUnread * 0.6) {
    return true;
  }
  return false;
}

function lastSeenSec(live: LiveRow | null): number | null {
  if (!live) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(live.updated_at).getTime()) / 1000));
}

export function computeStatus(
  name: string,
  live: LiveRow | null,
  profile: ChatterProfile | null,
  now: Date = new Date(),
): ChatterStatus {
  const active = isActiveToday(live, profile);
  const seen = lastSeenSec(live);
  const progress = dayProgress(now);
  const avgRev = profile?.avgRevenue ?? 0;
  const expected = avgRev * progress;
  const today = Number(live?.revenue) || 0;
  const delta = today - expected;

  let status: ActivityStatus;
  let reason = "";

  if (!active) {
    status = "inactive";
    if (avgRev >= 30) {
      reason = `heute noch nicht aktiv · sonst Ø ${Math.round(avgRev)}€/Tag`;
    } else {
      reason = "heute noch nicht aktiv";
    }
  } else {
    const recentlyOnline = seen !== null && seen < 30 * 60;
    if (!recentlyOnline) {
      status = "active_idle";
      const mins = seen ? Math.round(seen / 60) : 0;
      reason =
        mins >= 60
          ? `Pause · letzte Aktivität vor ${Math.round(mins / 60)}h`
          : `Pause · letzte Aktivität vor ${mins} min`;
    } else if (avgRev >= 30 && delta < -Math.max(20, avgRev * 0.15)) {
      status = "active_weak";
      reason = `${Math.round(today)}€ · sonst ${Math.round(expected)}€ um diese Zeit (${Math.round(delta)}€)`;
    } else {
      status = "active_strong";
      if (avgRev >= 30 && delta > avgRev * 0.1) {
        reason = `${Math.round(today)}€ · über Pacing (+${Math.round(delta)}€)`;
      } else {
        reason = `${Math.round(today)}€ heute · läuft`;
      }
    }
  }

  return {
    name,
    live,
    profile,
    isActiveToday: active,
    status,
    expectedRevenueByNow: expected,
    pacingDelta: delta,
    reason,
    lastSeenSec: seen,
  };
}

export function statusBucket(s: ChatterStatus): "strong" | "weak" | "idle" | "inactive" {
  if (s.status === "active_strong") return "strong";
  if (s.status === "active_weak") return "weak";
  if (s.status === "active_idle") return "idle";
  return "inactive";
}
