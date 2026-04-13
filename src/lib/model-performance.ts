/**
 * Model Performance Comparison
 * Compares current chatter's revenue on a model account vs. previous chatters on the same account.
 */

import { supabase } from "@/integrations/supabase/client";

export interface ModelPerformance {
  account: string;
  followers: number;
  /** Previous chatter's avg daily revenue on this model */
  previousAvgRevenue: number;
  /** Previous chatter's name */
  previousChatterName: string | null;
  /** Current chatter's avg daily revenue */
  currentAvgRevenue: number;
  /** Percentage change vs previous chatter (positive = better) */
  percentChange: number | null;
  /** "better" | "worse" | "neutral" | "first" */
  status: "better" | "worse" | "neutral" | "first";
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
  
  // Build follower lookup
  const followerMap = new Map<string, number>();
  for (const m of models) {
    followerMap.set(m.model_name.toLowerCase(), m.follower_count);
  }

  // Get unique accounts
  const accountSet = new Set<string>();
  const chatterAccountMap = new Map<string, string>(); // name → account
  for (const ch of currentChatters) {
    if (ch.account?.trim()) {
      accountSet.add(ch.account.trim());
      chatterAccountMap.set(ch.name, ch.account.trim());
    }
  }

  if (accountSet.size === 0) return result;

  // Load all history for these accounts (last 90 days)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  const { data: historyRows } = await supabase
    .from("chatter_history")
    .select("chatter_name, account, revenue_today, analysis_date")
    .eq("platform", platform)
    .in("account", Array.from(accountSet))
    .gte("analysis_date", ninetyDaysAgo.toISOString().split("T")[0])
    .order("analysis_date", { ascending: true });

  if (!historyRows || historyRows.length === 0) {
    // No history — all are "first"
    for (const ch of currentChatters) {
      if (ch.account?.trim()) {
        const followers = followerMap.get(ch.account.toLowerCase()) || 0;
        result[ch.name] = {
          account: ch.account,
          followers,
          previousAvgRevenue: 0,
          previousChatterName: null,
          currentAvgRevenue: 0,
          percentChange: null,
          status: "first",
        };
      }
    }
    return result;
  }

  // Group history by account → chatter_name → revenues
  const accountHistory = new Map<string, Map<string, number[]>>();
  for (const row of historyRows) {
    const acc = (row.account || "").trim();
    if (!acc) continue;
    if (!accountHistory.has(acc)) accountHistory.set(acc, new Map());
    const chatterMap = accountHistory.get(acc)!;
    const name = row.chatter_name;
    if (!chatterMap.has(name)) chatterMap.set(name, []);
    chatterMap.get(name)!.push(Number(row.revenue_today) || 0);
  }

  // For each current chatter, compare with previous chatters on the same account
  for (const ch of currentChatters) {
    const account = ch.account?.trim();
    if (!account) continue;

    const followers = followerMap.get(account.toLowerCase()) || 0;
    const chattersOnAccount = accountHistory.get(account);

    if (!chattersOnAccount || chattersOnAccount.size === 0) {
      result[ch.name] = {
        account,
        followers,
        previousAvgRevenue: 0,
        previousChatterName: null,
        currentAvgRevenue: 0,
        percentChange: null,
        status: "first",
      };
      continue;
    }

    // Current chatter's avg
    const currentRevenues = chattersOnAccount.get(ch.name) || [];
    const currentAvg = currentRevenues.length > 0
      ? currentRevenues.reduce((s, v) => s + v, 0) / currentRevenues.length
      : 0;

    // Find other chatters (not current) on this account
    let bestPrevName: string | null = null;
    let bestPrevAvg = 0;
    for (const [name, revenues] of chattersOnAccount) {
      if (name === ch.name) continue;
      const avg = revenues.reduce((s, v) => s + v, 0) / revenues.length;
      if (avg > bestPrevAvg) {
        bestPrevAvg = avg;
        bestPrevName = name;
      }
    }

    if (!bestPrevName || bestPrevAvg === 0) {
      result[ch.name] = {
        account,
        followers,
        previousAvgRevenue: 0,
        previousChatterName: null,
        currentAvgRevenue: currentAvg,
        percentChange: null,
        status: "first",
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
    };
  }

  return result;
}

/**
 * Format follower count: 1234 → "1.2K", 12345 → "12.3K"
 */
export function formatFollowers(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}
