/**
 * Model Performance Comparison
 * Compares current chatter's revenue on a model account vs. previous chatters on the same account.
 *
 * IMPORTANT: Das CSV liefert pro Chatter pro Tag nur den GESAMTUMSATZ (über alle Accounts).
 * Wenn ein Chatter an einem Tag mehrere Accounts gleichzeitig betreut hat, wird sein Umsatz
 * gewichtet nach Follower-Count auf die Accounts aufgeteilt — sowohl für ihn selbst als auch
 * für Vorgänger. Damit der Vergleich pro Model fair bleibt.
 */

import { supabase } from "@/integrations/supabase/client";

export interface ModelPerformance {
  account: string;
  followers: number;
  /** Previous chatter's avg daily revenue on this model (gewichtet) */
  previousAvgRevenue: number;
  /** Previous chatter's name */
  previousChatterName: string | null;
  /** Current chatter's avg daily revenue (gewichtet) */
  currentAvgRevenue: number;
  /** Percentage change vs previous chatter (positive = better) */
  percentChange: number | null;
  /** "better" | "worse" | "neutral" | "first" */
  status: "better" | "worse" | "neutral" | "first";
  /** Wurde der Umsatz gewichtet aufgeteilt, weil der Chatter mehrere Accounts betreute? */
  isSplitEstimate: boolean;
  /** Max. Anzahl an Accounts, die der current chatter an einem Tag gleichzeitig hatte */
  currentMaxAccountsPerDay: number;
  /** Max. Anzahl an Accounts, die der previous chatter an einem Tag gleichzeitig hatte */
  previousMaxAccountsPerDay: number;
}

export interface ModelInfo {
  model_name: string;
  follower_count: number;
}

/**
 * Load model performance comparisons for all chatters.
 * Returns a map: chatter_name → ModelPerformance
 */
export async function loadModelPerformances(
  platform: string,
  currentChatters: { name: string; account?: string }[],
  models: ModelInfo[]
): Promise<Record<string, ModelPerformance>> {
  const result: Record<string, ModelPerformance> = {};

  // Build follower lookup (lowercase)
  const followerMap = new Map<string, number>();
  for (const m of models) {
    followerMap.set(m.model_name.toLowerCase(), m.follower_count);
  }

  // Get unique accounts current chatters care about
  const accountSet = new Set<string>();
  for (const ch of currentChatters) {
    if (ch.account?.trim()) accountSet.add(ch.account.trim());
  }
  if (accountSet.size === 0) return result;

  // Load 90 days of history. Wir brauchen ALLE Zeilen für jeden Chatter, der je
  // einen der relevanten Accounts hatte — denn er kann am gleichen Tag auch
  // andere Accounts betreut haben (für die gewichtete Aufteilung).
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const sinceDate = ninetyDaysAgo.toISOString().split("T")[0];

  // 1) Erst: alle Chatter-Namen ermitteln, die in den 90 Tagen JE einen
  //    der gesuchten Accounts hatten.
  const { data: relevantRows } = await supabase
    .from("chatter_history")
    .select("chatter_name")
    .eq("platform", platform)
    .in("account", Array.from(accountSet))
    .gte("analysis_date", sinceDate);

  const relevantChatters = new Set<string>();
  for (const r of relevantRows || []) {
    if (r.chatter_name) relevantChatters.add(r.chatter_name);
  }
  // Aktuelle Chatter immer mit aufnehmen
  for (const ch of currentChatters) relevantChatters.add(ch.name);

  if (relevantChatters.size === 0) {
    // Niemand hatte je diese Accounts — alle aktuellen sind "first"
    for (const ch of currentChatters) {
      const account = ch.account?.trim();
      if (!account) continue;
      result[ch.name] = makeFirst(account, followerMap.get(account.toLowerCase()) || 0);
    }
    return result;
  }

  // 2) Alle Zeilen dieser Chatter laden — auch für Accounts außerhalb des Sets,
  //    damit wir wissen, wieviele Accounts sie pro Tag insgesamt hatten.
  const { data: historyRows } = await supabase
    .from("chatter_history")
    .select("chatter_name, account, revenue_today, analysis_date")
    .eq("platform", platform)
    .in("chatter_name", Array.from(relevantChatters))
    .gte("analysis_date", sinceDate);

  // Struktur: chatter -> date -> Array von { account, revenue }
  type DayRow = { account: string; revenue: number };
  const byChatterDay = new Map<string, Map<string, DayRow[]>>();

  for (const row of historyRows || []) {
    const name = row.chatter_name;
    const acc = (row.account || "").trim();
    const date = row.analysis_date;
    if (!name || !acc || !date) continue;

    if (!byChatterDay.has(name)) byChatterDay.set(name, new Map());
    const dayMap = byChatterDay.get(name)!;
    if (!dayMap.has(date)) dayMap.set(date, []);
    dayMap.get(date)!.push({ account: acc, revenue: Number(row.revenue_today) || 0 });
  }

  /**
   * Gewichtete Umsatz-Zuordnung pro Account für einen Chatter über alle Tage.
   * Annahme: revenue_today ist der Gesamtumsatz des Chatters an dem Tag,
   * der in jeder Zeile (pro Account) identisch wiederholt wird.
   *
   * Wir nehmen pro Tag: total = max(revenue_today der Zeilen) — falls die Zeilen
   * widersprüchlich sind oder der Umsatz pro Account einzeln steht.
   * Dann teilen wir total nach Follower-Gewicht auf die Accounts auf.
   */
  function weightedRevenuePerAccount(chatterName: string): {
    perAccount: Map<string, { sum: number; days: number }>;
    maxAccountsPerDay: number;
    daysWithMultipleAccounts: number;
  } {
    const perAccount = new Map<string, { sum: number; days: number }>();
    let maxAccountsPerDay = 0;
    let daysWithMultipleAccounts = 0;

    const dayMap = byChatterDay.get(chatterName);
    if (!dayMap) return { perAccount, maxAccountsPerDay, daysWithMultipleAccounts };

    for (const [, rows] of dayMap) {
      // Eindeutige Accounts an diesem Tag
      const uniqAccountRev = new Map<string, number>();
      for (const r of rows) {
        // Falls mehrere Zeilen pro Account → nimm max (sollte selten sein)
        const prev = uniqAccountRev.get(r.account) ?? 0;
        if (r.revenue > prev) uniqAccountRev.set(r.account, r.revenue);
      }
      const accounts = Array.from(uniqAccountRev.keys());
      const accountCount = accounts.length;
      if (accountCount === 0) continue;
      if (accountCount > maxAccountsPerDay) maxAccountsPerDay = accountCount;
      if (accountCount > 1) daysWithMultipleAccounts++;

      // Gesamtumsatz an dem Tag = MAX der Zeilenwerte (CSV repliziert ihn meist)
      const totalDay = Math.max(...uniqAccountRev.values());

      if (accountCount === 1) {
        const acc = accounts[0];
        const slot = perAccount.get(acc) ?? { sum: 0, days: 0 };
        slot.sum += totalDay;
        slot.days += 1;
        perAccount.set(acc, slot);
        continue;
      }

      // Gewichtung nach Followern; Fallback: gleichmäßig
      const weights = accounts.map((a) => Math.max(0, followerMap.get(a.toLowerCase()) || 0));
      const weightSum = weights.reduce((s, w) => s + w, 0);
      for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const share =
          weightSum > 0 ? totalDay * (weights[i] / weightSum) : totalDay / accountCount;
        const slot = perAccount.get(acc) ?? { sum: 0, days: 0 };
        slot.sum += share;
        slot.days += 1;
        perAccount.set(acc, slot);
      }
    }

    return { perAccount, maxAccountsPerDay, daysWithMultipleAccounts };
  }

  // Cache pro Chatter
  const cache = new Map<string, ReturnType<typeof weightedRevenuePerAccount>>();
  function getWeighted(name: string) {
    if (!cache.has(name)) cache.set(name, weightedRevenuePerAccount(name));
    return cache.get(name)!;
  }

  // 3) Für jeden current chatter: Vergleich auf seinem Account
  for (const ch of currentChatters) {
    const account = ch.account?.trim();
    if (!account) continue;
    const followers = followerMap.get(account.toLowerCase()) || 0;

    const currentWeighted = getWeighted(ch.name);
    const currentSlot = currentWeighted.perAccount.get(account);
    const currentAvg =
      currentSlot && currentSlot.days > 0 ? currentSlot.sum / currentSlot.days : 0;

    // Bester Vorgänger (anderer Chatter, der diesen Account hatte)
    let bestPrevName: string | null = null;
    let bestPrevAvg = 0;
    let bestPrevMaxAccounts = 0;

    for (const otherName of relevantChatters) {
      if (otherName === ch.name) continue;
      const w = getWeighted(otherName);
      const slot = w.perAccount.get(account);
      if (!slot || slot.days === 0) continue;
      const avg = slot.sum / slot.days;
      if (avg > bestPrevAvg) {
        bestPrevAvg = avg;
        bestPrevName = otherName;
        bestPrevMaxAccounts = w.maxAccountsPerDay;
      }
    }

    const isSplitEstimate =
      currentWeighted.daysWithMultipleAccounts > 0 ||
      (bestPrevName !== null && bestPrevMaxAccounts > 1);

    if (!bestPrevName || bestPrevAvg === 0) {
      result[ch.name] = {
        account,
        followers,
        previousAvgRevenue: 0,
        previousChatterName: null,
        currentAvgRevenue: currentAvg,
        percentChange: null,
        status: "first",
        isSplitEstimate,
        currentMaxAccountsPerDay: currentWeighted.maxAccountsPerDay,
        previousMaxAccountsPerDay: 0,
      };
      continue;
    }

    const pctChange = Math.round(((currentAvg - bestPrevAvg) / bestPrevAvg) * 100);
    let status: ModelPerformance["status"] = "neutral";
    if (pctChange > 10) status = "better";
    else if (pctChange < -10) status = "worse";

    result[ch.name] = {
      account,
      followers,
      previousAvgRevenue: bestPrevAvg,
      previousChatterName: bestPrevName,
      currentAvgRevenue: currentAvg,
      percentChange: pctChange,
      status,
      isSplitEstimate,
      currentMaxAccountsPerDay: currentWeighted.maxAccountsPerDay,
      previousMaxAccountsPerDay: bestPrevMaxAccounts,
    };
  }

  return result;
}

function makeFirst(account: string, followers: number): ModelPerformance {
  return {
    account,
    followers,
    previousAvgRevenue: 0,
    previousChatterName: null,
    currentAvgRevenue: 0,
    percentChange: null,
    status: "first",
    isSplitEstimate: false,
    currentMaxAccountsPerDay: 1,
    previousMaxAccountsPerDay: 0,
  };
}

/**
 * Format follower count: 1234 → "1.2K", 12345 → "12.3K"
 */
export function formatFollowers(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}
