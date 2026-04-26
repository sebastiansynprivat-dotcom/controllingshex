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
 * Peer-Ø = Cluster-Median nach Account-Größe (Follower-Bucket) — so wie überall
 * sonst im System. Persönliche Account-Baselines fließen NICHT in den Peer-Ø
 * ein (das wäre kein Peer-Vergleich, sondern eine Selbst-Referenz).
 *
 * Priorität:
 *  1. Peer-Cluster-Median (Account-Größen-Bucket) × 1.0
 *  2. Globaler Median × 1.0   — wenn kein Cluster vorhanden
 *  3. Cold-Start → null
 */
export function suggestDailyGoal(bm: ChatterBenchmark | undefined | null): GoalSuggestion | null {
  if (!bm) return null;

  // 1. Peer-Cluster nach Account-Größe (= echter Peer-Ø)
  if (bm.cluster && bm.cluster.median > 0) {
    return {
      eur: roundGoal(bm.cluster.median),
      source: "peer-cluster",
      rationale: `Cluster-Median ${bm.cluster.label} (${bm.cluster.accountCount} Accounts)`,
      peerAvgEur: bm.cluster.median,
      peerLabel: bm.cluster.label,
    };
  }

  // 2. Globaler Median (Fallback wenn Account keine Follower-Zuordnung hat)
  // Indirekt über pctOfPeerMedian erkennbar: source === "global" trägt globalen Wert
  // Hier haben wir aber keinen direkten Zugriff auf bundle.globalMedian → nichts vorschlagen,
  // damit der UI-Fallback "manuell setzen" greift.

  // 3. Cold-Start → kein Vorschlag
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
