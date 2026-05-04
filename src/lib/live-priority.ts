// Priority scoring for live chatter activity.

export interface LiveRowLite {
  chatter_name: string;
  revenue: number;
  mass_dms: number;
  unread_chats: number;
  oldest_chat: number | null;
  updated_at: string;
}

export interface ChatterAvg {
  avgRevenue: number;
  avgMassDms: number;
  avgUnread: number;
}

export interface ScoredChatter {
  row: LiveRowLite;
  score: number;
  bucket: "now" | "watch" | "running";
  hotStreak: boolean;
  reasons: string[]; // human readable, ordered by importance
  expectedRevenueByNow: number;
  potentialLoss: number; // €, positive = behind
}

const W_ESCALATION = 35;
const W_LOST = 35;
const W_STAU = 15;
const W_AFK = 10;
const W_DM_GAP = 5;

export function computeScore(
  row: LiveRowLite,
  avg: ChatterAvg | undefined,
  now: Date = new Date(),
): ScoredChatter {
  const oldest = row.oldest_chat ?? 0;
  const escalation = Math.min(1, oldest / 4); // 0..1, ≥4h = full

  const avgRev = avg?.avgRevenue ?? 0;
  // Linear day-progress 0..1 (between 6:00 and 24:00 mostly active window)
  const hour = now.getHours() + now.getMinutes() / 60;
  const dayProgress = Math.max(0, Math.min(1, (hour - 6) / 18));
  const expectedRevenueByNow = avgRev * dayProgress;
  const todayRev = Number(row.revenue) || 0;
  const lostFraction = expectedRevenueByNow > 0
    ? Math.max(0, Math.min(1, (expectedRevenueByNow - todayRev) / expectedRevenueByNow))
    : 0;
  const potentialLoss = Math.max(0, expectedRevenueByNow - todayRev);

  const personalAvgUnread = Math.max(avg?.avgUnread ?? 0, 5);
  const stau = Math.min(1, (row.unread_chats ?? 0) / personalAvgUnread / 2);

  const minSinceUpdate = (Date.now() - new Date(row.updated_at).getTime()) / 60000;
  // Expectation: if normally active (avgRev > 0) and during day window, AFK weighs more
  const expectsActivity = avgRev > 0 && dayProgress > 0.05 && dayProgress < 0.95 ? 1 : 0.3;
  const afk = Math.min(1, (minSinceUpdate / 60) * expectsActivity); // 1h = full

  const dmGap = (avg?.avgMassDms ?? 0) >= 1 && (row.mass_dms ?? 0) === 0 ? 1 : 0;

  let score =
    W_ESCALATION * escalation +
    W_LOST * lostFraction +
    W_STAU * stau +
    W_AFK * afk +
    W_DM_GAP * dmGap;

  const hotStreak = avgRev > 0 && todayRev > 1.5 * avgRev;
  if (hotStreak) score = Math.min(score, 30);

  score = Math.round(Math.max(0, Math.min(100, score)));

  // Build reason chips, ordered by their weighted contribution
  const contributions: { weight: number; text: string }[] = [];
  if (oldest >= 1) contributions.push({
    weight: W_ESCALATION * escalation,
    text: `${oldest} Std Stau`,
  });
  if (potentialLoss >= 20) contributions.push({
    weight: W_LOST * lostFraction,
    text: `−${Math.round(potentialLoss)}€`,
  });
  if ((row.unread_chats ?? 0) >= Math.max(personalAvgUnread, 5)) contributions.push({
    weight: W_STAU * stau,
    text: `${row.unread_chats} ungelesen`,
  });
  if (afk >= 0.4) contributions.push({
    weight: W_AFK * afk,
    text: minSinceUpdate >= 60
      ? `AFK ${Math.round(minSinceUpdate / 60)}h`
      : `AFK ${Math.round(minSinceUpdate)}min`,
  });
  if (dmGap) contributions.push({
    weight: W_DM_GAP,
    text: `keine Mass-DMs`,
  });
  if (hotStreak) contributions.push({
    weight: 50,
    text: `läuft heiß · ${Math.round(todayRev)}€`,
  });

  const reasons = contributions
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((c) => c.text);

  const bucket: ScoredChatter["bucket"] =
    score >= 70 ? "now" : score >= 40 ? "watch" : "running";

  return { row, score, bucket, hotStreak, reasons, expectedRevenueByNow, potentialLoss };
}
