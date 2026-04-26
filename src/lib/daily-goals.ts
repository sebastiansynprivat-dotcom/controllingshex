/**
 * Daily Goals — Tagesziele pro Chatter
 *
 * Schlägt Tagesziele basierend auf Peer-Benchmarks vor und persistiert sie
 * in `chatter_daily_goals`. Pro Tag/Chatter/User existiert max. 1 Eintrag.
 */

import { supabase } from "@/integrations/supabase/client";
import type { ChatterBenchmark } from "@/lib/peer-benchmarks";

export type GoalSource = "account-baseline" | "peer-cluster" | "global" | "manual";

export interface DailyGoal {
  id: string;
  chatter_name: string;
  goal_date: string;
  goal_eur: number;
  suggested_eur: number | null;
  source: GoalSource;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoalSuggestion {
  /** Vorgeschlagenes Tagesziel in € */
  eur: number;
  /** Quelle der Berechnung */
  source: GoalSource;
  /** Anzeigetext für UI */
  rationale: string;
  /** Peer-Ø in €/Tag (egal welche Quelle), falls verfügbar */
  peerAvgEur: number | null;
  /** Label des Peer-Clusters / Account-Baseline */
  peerLabel: string | null;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
}

/** Smart-Rundung: kleine Werte 5er, mittlere 10er, große 25er */
function roundGoal(eur: number): number {
  if (eur <= 0) return 0;
  if (eur < 100) return Math.round(eur / 5) * 5;
  if (eur < 500) return Math.round(eur / 10) * 10;
  return Math.round(eur / 25) * 25;
}

/**
 * Berechnet einen Tagesziel-Vorschlag aus dem Peer-Benchmark des Chatters.
 *
 * Priorität:
 *  1. Account-Baseline (avg × 1.10 Stretch)  — wenn ≥7 Tage History vorhanden
 *  2. Peer-Cluster-Median × 1.0
 *  3. Globaler Median × 1.0
 *  4. Cold-Start → null
 */
export function suggestDailyGoal(bm: ChatterBenchmark | undefined | null): GoalSuggestion | null {
  if (!bm) return null;

  // 1. Account-Baseline (persönlich, +10% Stretch)
  if (bm.source === "account-baseline" && bm.baseline && bm.baseline.avgRevenue > 0) {
    const avg = bm.baseline.avgRevenue;
    const stretch = avg * 1.10;
    return {
      eur: roundGoal(stretch),
      source: "account-baseline",
      rationale: `Persönlicher Ø + 10% Stretch (${bm.baseline.dayCount} Tage History)`,
      peerAvgEur: avg,
      peerLabel: `Account-Ø · ${bm.baseline.dayCount} Tage`,
    };
  }

  // 2. Peer-Cluster
  if (bm.cluster && bm.cluster.median > 0 && bm.confidence !== "low") {
    return {
      eur: roundGoal(bm.cluster.median),
      source: "peer-cluster",
      rationale: `Cluster-Median ${bm.cluster.label} (${bm.cluster.accountCount} Accounts)`,
      peerAvgEur: bm.cluster.median,
      peerLabel: bm.cluster.label,
    };
  }

  // 3. Account-Baseline (auch wenn primary source = peer-cluster, aber baseline existiert)
  if (bm.baseline && bm.baseline.avgRevenue > 0 && bm.baseline.dayCount >= 3) {
    const avg = bm.baseline.avgRevenue;
    return {
      eur: roundGoal(avg * 1.10),
      source: "account-baseline",
      rationale: `Persönlicher Ø + 10% Stretch (${bm.baseline.dayCount} Tage History)`,
      peerAvgEur: avg,
      peerLabel: `Account-Ø · ${bm.baseline.dayCount} Tage`,
    };
  }

  // 4. Cold-Start → kein Vorschlag
  return null;
}

/**
 * Lädt alle Tagesziele für heute auf der angegebenen Plattform.
 * Map-Key = normalisierter Chatter-Name.
 */
export async function loadTodayGoals(platform: string): Promise<Map<string, DailyGoal>> {
  const map = new Map<string, DailyGoal>();
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("chatter_daily_goals")
    .select("*")
    .eq("platform", platform)
    .eq("goal_date", today);

  if (error || !data) return map;

  for (const row of data as DailyGoal[]) {
    map.set(normalize(row.chatter_name), row);
  }
  return map;
}

/**
 * Schreibt/aktualisiert ein Tagesziel für heute. Upsert über Unique-Index
 * (user_id, platform, chatter_name, goal_date).
 */
export async function upsertDailyGoal(
  platform: string,
  chatterName: string,
  goalEur: number,
  suggestedEur: number | null,
  source: GoalSource,
  note?: string | null,
): Promise<DailyGoal | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("chatter_daily_goals")
    .upsert(
      {
        user_id: user.id,
        platform,
        chatter_name: chatterName,
        goal_date: today,
        goal_eur: goalEur,
        suggested_eur: suggestedEur,
        source,
        note: note ?? null,
      },
      { onConflict: "user_id,platform,chatter_name,goal_date" },
    )
    .select()
    .single();

  if (error) {
    console.warn("upsertDailyGoal failed:", error);
    return null;
  }
  return data as DailyGoal;
}

export function normalizeChatterKey(name: string): string {
  return normalize(name);
}

export function formatEur(eur: number): string {
  return `${Math.round(eur).toLocaleString("de-DE")} €`;
}
