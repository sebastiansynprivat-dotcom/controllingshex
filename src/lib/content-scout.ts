/**
 * Model Scout — identifiziert Models mit Potenzial anhand
 *  (a) historischer Einzelverkäufe (aus chatter_history_live.revenue_details)
 *  (b) Chat-Pull (offene Chats / Aktivität aus chatter_history)
 *
 * Kein neues Schema — nutzt ausschließlich vorhandene Tabellen.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPaged } from "@/lib/paged";
import { tierForFollowers, type AccountTier } from "@/lib/account-tiers";
import type { TimeRange } from "@/lib/timerange-categorize";

export interface ModelContentScore {
  model: string;
  followers: number;
  tier: AccountTier | null;
  /** Einzelverkäufe im Zeitraum insgesamt */
  totalSales: number;
  avgSalesPerDay: number;
  /** € Umsatz gesamt (aus chatter_history.revenue_today, aggregiert je Account) */
  totalRevenue: number;
  avgRevenuePerDay: number;
  /** Ø offene Chats/Tag als Chat-Pull-Proxy */
  avgOpenChats: number;
  /** Anteil Tage mit ≥1 Sale */
  consistency: number;
  /** 0..100 gewichteter Score */
  score: number;
  salesSignal: number;
  revenueSignal: number;
  chatSignal: number;
  consistencySignal: number;
  /** vs. vorherige gleich lange Periode: +% (positiv) / -% */
  revenueDeltaPct: number | null;
  hiddenGem: boolean;
}

interface LiveRow {
  date: string;
  revenue_details: Record<string, Array<{ amount?: number }>> | null;
}
interface HistoryRow {
  account: string | null;
  analysis_date: string;
  revenue_today: number | null;
  open_chats: number | null;
}
interface ModelRow {
  model_name: string;
  follower_count: number;
}

const norm = (s: string) => s.trim().toLowerCase();

function daysInRange(from: string, to: string): number {
  const a = new Date(from + "T00:00:00").getTime();
  const b = new Date(to + "T00:00:00").getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function shiftIso(iso: string, deltaDays: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Perzentil-Rank innerhalb eines Zahlen-Arrays. Gibt 0..1 zurück. */
function percentileRankMap(values: number[]): Map<number, number> {
  const sorted = [...values].sort((a, b) => a - b);
  const m = new Map<number, number>();
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    if (m.has(v)) continue;
    // Anteil Werte < v
    let lt = 0;
    for (const x of sorted) if (x < v) lt++; else break;
    m.set(v, sorted.length <= 1 ? 1 : lt / (sorted.length - 1));
  }
  return m;
}

interface Buckets {
  salesByAccount: Map<string, { total: number; dayset: Set<string> }>;
  histByAccount: Map<string, { revenue: number; openChatsSum: number; days: Set<string> }>;
}

async function loadBuckets(platform: string, userId: string, from: string, to: string): Promise<Buckets> {
  const [live, hist] = await Promise.all([
    fetchAllPaged<LiveRow>((f, t) =>
      supabase
        .from("chatter_history_live")
        .select("date, revenue_details")
        .ilike("platform", platform)
        .gte("date", from)
        .lte("date", to)
        .range(f, t) as unknown as PromiseLike<{ data: LiveRow[] | null; error: unknown }>
    ),
    fetchAllPaged<HistoryRow>((f, t) =>
      supabase
        .from("chatter_history")
        .select("account, analysis_date, revenue_today, open_chats")
        .eq("user_id", userId)
        .ilike("platform", platform)
        .gte("analysis_date", from)
        .lte("analysis_date", to)
        .range(f, t) as unknown as PromiseLike<{ data: HistoryRow[] | null; error: unknown }>
    ),
  ]);

  const salesByAccount = new Map<string, { total: number; dayset: Set<string> }>();
  for (const row of live) {
    const details = row.revenue_details;
    if (!details || typeof details !== "object") continue;
    for (const [account, sales] of Object.entries(details)) {
      if (!Array.isArray(sales) || sales.length === 0) continue;
      const key = norm(account);
      if (!key) continue;
      const bucket = salesByAccount.get(key) ?? { total: 0, dayset: new Set<string>() };
      bucket.total += sales.length;
      bucket.dayset.add(row.date);
      salesByAccount.set(key, bucket);
    }
  }

  const histByAccount = new Map<string, { revenue: number; openChatsSum: number; days: Set<string> }>();
  for (const row of hist) {
    if (!row.account) continue;
    // account-Feld kann kommagetrennt sein
    const accounts = row.account.split(",").map((s) => norm(s)).filter(Boolean);
    if (accounts.length === 0) continue;
    const rev = Number(row.revenue_today ?? 0);
    const chats = Number(row.open_chats ?? 0);
    // Falls Chatter mehrere Accounts betreut, teilen wir Revenue anteilig auf.
    const revShare = rev / accounts.length;
    for (const acc of accounts) {
      const b = histByAccount.get(acc) ?? { revenue: 0, openChatsSum: 0, days: new Set<string>() };
      b.revenue += revShare;
      b.openChatsSum += chats;
      b.days.add(row.analysis_date);
      histByAccount.set(acc, b);
    }
  }

  return { salesByAccount, histByAccount };
}

export async function loadModelContentScores(
  platform: string,
  range: TimeRange,
): Promise<ModelContentScore[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const days = daysInRange(range.from, range.to);
  const prevTo = shiftIso(range.from, -1);
  const prevFrom = shiftIso(prevTo, -(days - 1));

  const [current, previous, modelsRes] = await Promise.all([
    loadBuckets(platform, user.id, range.from, range.to),
    loadBuckets(platform, user.id, prevFrom, prevTo),
    supabase
      .from("models")
      .select("model_name, follower_count")
      .eq("user_id", user.id)
      .ilike("platform", platform),
  ]);

  const models = (modelsRes.data ?? []) as ModelRow[];
  const followersByModel = new Map<string, number>();
  for (const m of models) followersByModel.set(norm(m.model_name), Number(m.follower_count) || 0);

  // Union aller Accounts, die im aktuellen Zeitraum irgendwo Signal hatten,
  // ergänzt um alle Models der Plattform (damit Ranking vollständig ist).
  const accountKeys = new Set<string>();
  for (const k of current.salesByAccount.keys()) accountKeys.add(k);
  for (const k of current.histByAccount.keys()) accountKeys.add(k);
  for (const k of followersByModel.keys()) accountKeys.add(k);

  interface Raw {
    key: string;
    totalSales: number;
    totalRevenue: number;
    openChatsSum: number;
    activeDays: number;
    salesDays: number;
    prevRevenue: number;
  }
  const raws: Raw[] = [];
  for (const key of accountKeys) {
    const s = current.salesByAccount.get(key);
    const h = current.histByAccount.get(key);
    const p = current.histByAccount.get(key); // used later
    const prev = previous.histByAccount.get(key);
    const totalSales = s?.total ?? 0;
    const salesDays = s?.dayset.size ?? 0;
    const totalRevenue = h?.revenue ?? 0;
    const openChatsSum = h?.openChatsSum ?? 0;
    const activeDays = h?.days.size ?? 0;
    if (totalSales === 0 && totalRevenue === 0 && activeDays === 0) continue;
    raws.push({
      key,
      totalSales,
      totalRevenue,
      openChatsSum,
      activeDays,
      salesDays,
      prevRevenue: prev?.revenue ?? 0,
    });
  }

  // Perzentil-Ranks pro Signal (plattform-relativ)
  const salesArr = raws.map((r) => r.totalSales / days);
  const revenueArr = raws.map((r) => r.totalRevenue / days);
  const chatsArr = raws.map((r) => (r.activeDays > 0 ? r.openChatsSum / r.activeDays : 0));
  const consistencyArr = raws.map((r) => r.salesDays / days);

  const salesPct = percentileRankMap(salesArr);
  const revenuePct = percentileRankMap(revenueArr);
  const chatsPct = percentileRankMap(chatsArr);

  // Follower-Verteilung — untere 33% für Hidden-Gem-Check
  const followerValues = [...followersByModel.values()].sort((a, b) => a - b);
  const followerLowerThirdCutoff = followerValues.length > 0
    ? followerValues[Math.floor(followerValues.length / 3)]
    : 0;

  const scored: ModelContentScore[] = raws.map((r, i) => {
    const salesPerDay = salesArr[i];
    const revenuePerDay = revenueArr[i];
    const avgOpenChats = chatsArr[i];
    const consistency = consistencyArr[i];

    const salesSignal = salesPct.get(salesPerDay) ?? 0;
    const revenueSignal = revenuePct.get(revenuePerDay) ?? 0;
    const chatSignal = chatsPct.get(avgOpenChats) ?? 0;
    const consistencySignal = consistency;

    const score = Math.round(
      (0.4 * salesSignal + 0.25 * revenueSignal + 0.25 * chatSignal + 0.1 * consistencySignal) * 100,
    );

    const followers = followersByModel.get(r.key) ?? 0;
    const tier = tierForFollowers(followers);

    const revenueDeltaPct = r.prevRevenue > 0
      ? Math.round(((r.totalRevenue - r.prevRevenue) / r.prevRevenue) * 100)
      : (r.totalRevenue > 0 ? null : null);

    return {
      model: r.key,
      followers,
      tier,
      totalSales: r.totalSales,
      avgSalesPerDay: salesPerDay,
      totalRevenue: r.totalRevenue,
      avgRevenuePerDay: revenuePerDay,
      avgOpenChats,
      consistency,
      score,
      salesSignal,
      revenueSignal,
      chatSignal,
      consistencySignal,
      revenueDeltaPct,
      hiddenGem: false,
    };
  });

  // Hidden Gem: Score im Top-Quartil UND Follower im unteren Drittel
  const sortedScores = [...scored].map((s) => s.score).sort((a, b) => a - b);
  const topQuartileCutoff = sortedScores.length > 0
    ? sortedScores[Math.floor(sortedScores.length * 0.75)]
    : 0;
  for (const s of scored) {
    if (s.score >= topQuartileCutoff && s.score > 0 && s.followers > 0 && s.followers <= followerLowerThirdCutoff) {
      s.hiddenGem = true;
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
