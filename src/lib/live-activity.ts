// Activity detection + per-chatter hourly profile + money-priority scoring.

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
  avgRevenue: number;
  avgMassDms: number;
  avgUnread: number;
  daysObserved: number;
  recentRevenues: number[]; // chronologisch, letzte ≤14 Tage
}

export type ActivityStatus =
  | "active_strong"
  | "active_weak"
  | "active_idle"
  | "inactive";

export interface ChatterStatus {
  name: string;
  platform?: string;
  live: LiveRow | null;
  profile: ChatterProfile | null;
  isActiveToday: boolean;
  status: ActivityStatus;
  expectedRevenueByNow: number;
  pacingDelta: number;
  lostRevenue: number;     // €, Betrag wenn delta < 0, sonst 0
  surplusRevenue: number;  // €, Betrag wenn delta > 0
  priorityScore: number;   // 0-100, "wo verliere ich gerade am meisten Geld"
  actionText: string;      // kurzer Imperativ
  reason: string;          // legacy/fallback
  lastSeenSec: number | null;
}

export const SHIFT_CUTOFF_HOUR = 4;

export function shiftDate(now: Date = new Date()): string {
  const d = new Date(now);
  if (d.getHours() < SHIFT_CUTOFF_HOUR) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayProgress(now: Date): number {
  const h = now.getHours() + now.getMinutes() / 60;
  const elapsed = (h - SHIFT_CUTOFF_HOUR + 24) % 24;
  return Math.max(0, Math.min(1, elapsed / 24));
}

export function buildProfile(name: string, days: HistoryDay[]): ChatterProfile {
  const valid = days.filter((d) => d.analysis_date);
  const sum = (arr: number[]) => arr.reduce((s, v) => s + (Number(v) || 0), 0);
  const avg = (arr: number[]) => (arr.length ? sum(arr) / arr.length : 0);
  // chronologisch sortiert (älteste zuerst), letzte 14 für Sparkline
  const sorted = [...valid].sort((a, b) =>
    a.analysis_date.localeCompare(b.analysis_date),
  );
  const recentRevenues = sorted.slice(-14).map((d) => Number(d.revenue_today) || 0);
  return {
    name,
    avgRevenue: avg(valid.map((d) => d.revenue_today)),
    avgMassDms: avg(valid.map((d) => d.mass_dms)),
    avgUnread: avg(valid.map((d) => d.open_chats)),
    daysObserved: valid.length,
    recentRevenues,
  };
}

export function isActiveToday(
  live: LiveRow | null,
  profile: ChatterProfile | null,
): boolean {
  if (!live) return false;
  if ((Number(live.revenue) || 0) > 0) return true;
  if ((live.mass_dms ?? 0) >= 1) return true;
  if (
    profile &&
    profile.avgUnread > 5 &&
    (live.unread_chats ?? 0) < profile.avgUnread * 0.6
  ) {
    return true;
  }
  return false;
}

function lastSeenSec(live: LiveRow | null): number | null {
  if (!live) return null;
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(live.updated_at).getTime()) / 1000),
  );
}

function fmtEur(n: number): string {
  return `${Math.round(n)} €`;
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
  const lost = delta < 0 ? -delta : 0;
  const surplus = delta > 0 ? delta : 0;
  const unread = live?.unread_chats ?? 0;
  const dms = live?.mass_dms ?? 0;
  const oldestDays = live?.oldest_chat != null ? Number(live.oldest_chat) : 0;
  const hoursSinceSeen = seen != null ? seen / 3600 : 24;

  let status: ActivityStatus;
  let reason = "";
  let actionText = "";

  if (!active) {
    status = "inactive";
    if (avgRev >= 5) {
      reason = `Ø ${Math.round(avgRev)} €/Tag · heute fehlen ~${Math.round(avgRev)} €`;
      actionText = `Heute online holen — sonst ~${fmtEur(avgRev)} weg`;
    } else {
      reason = "heute noch nicht aktiv";
      actionText = "Heute noch nicht aktiv";
    }
  } else {
    const recentlyOnline = seen !== null && seen < 30 * 60;
    if (!recentlyOnline) {
      status = "active_idle";
      const mins = seen ? Math.round(seen / 60) : 0;
      const since =
        mins >= 60
          ? `${Math.round(mins / 60)}h`
          : `${mins} min`;
      reason = `Pause · letzte Aktivität vor ${since}`;
      if (lost >= 30) actionText = `Anstoßen — ${fmtEur(lost)} Rückstand · Pause ${since}`;
      else actionText = `Pause seit ${since}`;
    } else if (avgRev >= 30 && delta < -Math.max(20, avgRev * 0.15)) {
      status = "active_weak";
      reason = `unter Pacing · ${unread} ungelesen · ${dms} DM`;
      actionText = `Anstoßen — ${fmtEur(lost)} Rückstand`;
    } else {
      status = "active_strong";
      reason = `aktiv · ${unread} ungelesen · ${dms} DM`;
      if (surplus >= Math.max(20, avgRev * 0.15)) {
        actionText = `Top heute · +${fmtEur(surplus)}`;
      } else if (unread >= 20) {
        actionText = `Chats abarbeiten · ${unread} offen`;
      } else if (oldestDays >= 3) {
        actionText = `Alte Chats reaktivieren · ${Math.round(oldestDays)}d offen`;
      } else {
        actionText = "Läuft sauber";
      }
    }
  }

  // Priority Score (rohe Punkte, dann gekappt 0-100)
  let raw =
    lost * 1.0 +
    avgRev * 0.3 +
    unread * 1.5 +
    oldestDays * 5.0 +
    (active ? hoursSinceSeen * 2 : 0);
  // Inaktive mit hohem Avg: zusätzlich gewichten (großer Tagesausfall droht)
  if (!active && avgRev >= 30) raw += avgRev * 0.5;
  const priorityScore = Math.max(0, Math.min(100, Math.round(raw / 4)));

  return {
    name,
    live,
    profile,
    isActiveToday: active,
    status,
    expectedRevenueByNow: expected,
    pacingDelta: delta,
    lostRevenue: lost,
    surplusRevenue: surplus,
    priorityScore,
    actionText,
    reason,
    lastSeenSec: seen,
  };
}

export function statusBucket(
  s: ChatterStatus,
): "strong" | "weak" | "idle" | "inactive" {
  if (s.status === "active_strong") return "strong";
  if (s.status === "active_weak") return "weak";
  if (s.status === "active_idle") return "idle";
  return "inactive";
}
