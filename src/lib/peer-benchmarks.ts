/**
 * Peer-Benchmark Engine
 *
 * Vollautomatisch: Lädt chatter_history + models, gruppiert Accounts dynamisch nach
 * Follower-Größe, berechnet Median/P25/P75 €/Tag pro Cluster und liefert für jeden
 * Account einen passenden Peer-Benchmark mit Confidence-Score.
 *
 * Self-learning: Je mehr History, desto präziser. Cold-Start = "low" Confidence
 * → Edge Function fällt auf absolute Schwellen zurück.
 */

import { supabase } from "@/integrations/supabase/client";

export type Confidence = "low" | "medium" | "high";

export interface PeerCluster {
  /** untere Follower-Grenze (inklusiv) */
  minFollowers: number;
  /** obere Follower-Grenze (exklusiv, Infinity für letztes Cluster) */
  maxFollowers: number;
  /** unteres Quartil €/Tag */
  p25: number;
  /** Median €/Tag */
  median: number;
  /** oberes Quartil €/Tag */
  p75: number;
  /** Anzahl Datenpunkte (Tage*Accounts) */
  sampleSize: number;
  /** Anzahl unterschiedlicher Accounts in diesem Cluster */
  accountCount: number;
  confidence: Confidence;
  /** Menschenlesbares Label, z.B. "10K-30K Follower" */
  label: string;
}

export interface AccountBaseline {
  account: string;
  /** Schnitt €/Tag der letzten 30 Tage (ohne Tage mit 0€? nein — alle Tage) */
  avgRevenue: number;
  /** Anzahl Tage mit History */
  dayCount: number;
  followers: number;
}

export interface BenchmarkBundle {
  clusters: PeerCluster[];
  /** Map: account name (lowercase) → Baseline */
  accountBaselines: Map<string, AccountBaseline>;
  /** globaler Schnitt als ultimativer Fallback */
  globalMedian: number;
  globalP25: number;
  globalP75: number;
  globalConfidence: Confidence;
  totalAccounts: number;
  totalDataPoints: number;
}

export interface ChatterBenchmark {
  /** % vom Peer-Median (100 = exakt im Schnitt). null wenn kein Peer-Cluster vorhanden */
  pctOfPeerMedian: number | null;
  /** % vom Account-Baseline (überstimmt Peer wenn vorhanden) */
  pctOfAccountBaseline: number | null;
  /** Welcher Wert wird als Referenz genutzt? */
  source: "account-baseline" | "peer-cluster" | "global" | "none";
  /** Cluster info (für UI-Anzeige) */
  cluster: PeerCluster | null;
  /** Account-Baseline info */
  baseline: AccountBaseline | null;
  /** Confidence der genutzten Referenz */
  confidence: Confidence;
}

/* ------------------------------------------------------------------ */
/*  STATISTIK-HELFER                                                   */
/* ------------------------------------------------------------------ */

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function confidenceFor(sampleSize: number): Confidence {
  if (sampleSize >= 16) return "high";
  if (sampleSize >= 6) return "medium";
  return "low";
}

function formatFollowerRange(min: number, max: number): string {
  const fmt = (n: number) => {
    if (n === Infinity) return "∞";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1000)}K`;
    return String(n);
  };
  return `${fmt(min)}–${fmt(max)} Follower`;
}

/* ------------------------------------------------------------------ */
/*  CLUSTERING (dynamisch nach Datenmenge)                             */
/* ------------------------------------------------------------------ */

interface AccountStat {
  account: string;
  followers: number;
  /** alle Tagesumsätze für dieses Account aus dem History-Window */
  revenues: number[];
}

function buildClusters(accountStats: AccountStat[]): PeerCluster[] {
  // Nur Accounts mit Followers > 0 berücksichtigen
  const valid = accountStats.filter(a => a.followers > 0 && a.revenues.length > 0);
  if (valid.length === 0) return [];

  // Sortiere nach Follower-Größe
  valid.sort((a, b) => a.followers - b.followers);

  // Wieviele Cluster?
  let clusterCount: number;
  if (valid.length < 10) clusterCount = 1;
  else if (valid.length < 30) clusterCount = 3;
  else clusterCount = 5;

  // Quantile-basiertes Splitting der Follower-Werte
  const followerVals = valid.map(a => a.followers);
  const cutoffs: number[] = [];
  for (let i = 1; i < clusterCount; i++) {
    cutoffs.push(quantile(followerVals, i / clusterCount));
  }

  // Bilde Cluster-Buckets
  const buckets: AccountStat[][] = Array.from({ length: clusterCount }, () => []);
  for (const acc of valid) {
    let bucketIdx = 0;
    for (let i = 0; i < cutoffs.length; i++) {
      if (acc.followers > cutoffs[i]) bucketIdx = i + 1;
    }
    buckets[bucketIdx].push(acc);
  }

  // Berechne Stats pro Bucket
  const clusters: PeerCluster[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i];
    if (bucket.length === 0) continue;

    const allRevenues: number[] = [];
    for (const acc of bucket) allRevenues.push(...acc.revenues);
    allRevenues.sort((a, b) => a - b);

    const minF = bucket[0].followers;
    const maxF = i === buckets.length - 1 ? Infinity : (buckets[i + 1]?.[0]?.followers ?? Infinity);

    clusters.push({
      minFollowers: minF,
      maxFollowers: maxF,
      p25: quantile(allRevenues, 0.25),
      median: quantile(allRevenues, 0.5),
      p75: quantile(allRevenues, 0.75),
      sampleSize: allRevenues.length,
      accountCount: bucket.length,
      confidence: confidenceFor(allRevenues.length),
      label: formatFollowerRange(minF, maxF),
    });
  }

  return clusters;
}

/* ------------------------------------------------------------------ */
/*  HAUPT-LOADER                                                       */
/* ------------------------------------------------------------------ */

/**
 * Lädt alle nötigen Daten und baut die Benchmark-Bundle.
 * Window: letzte `historyDays` Tage (Default 30).
 */
export async function loadBenchmarks(
  platform: string,
  historyDays: number = 30
): Promise<BenchmarkBundle> {
  // 1. Models (für Follower-Lookup)
  const { data: models } = await supabase
    .from("models")
    .select("model_name, follower_count")
    .eq("platform", platform);

  const followerMap = new Map<string, number>();
  for (const m of models || []) {
    followerMap.set(m.model_name.toLowerCase().trim(), m.follower_count);
  }

  // 2. History (letzte N Tage)
  const since = new Date();
  since.setDate(since.getDate() - historyDays);
  const sinceStr = since.toISOString().split("T")[0];

  const { data: historyRows } = await supabase
    .from("chatter_history")
    .select("account, revenue_today, analysis_date")
    .eq("platform", platform)
    .gte("analysis_date", sinceStr)
    .not("account", "is", null);

  // 3. Gruppiere History nach Account → Revenue-Liste + Account-Baseline
  const byAccount = new Map<string, number[]>();
  for (const row of historyRows || []) {
    const acc = (row.account || "").toLowerCase().trim();
    if (!acc) continue;
    const rev = Number(row.revenue_today) || 0;
    if (!byAccount.has(acc)) byAccount.set(acc, []);
    byAccount.get(acc)!.push(rev);
  }

  // 4. Account-Baselines + AccountStats für Clustering
  const accountBaselines = new Map<string, AccountBaseline>();
  const accountStats: AccountStat[] = [];
  for (const [acc, revenues] of byAccount) {
    const followers = followerMap.get(acc) || 0;
    const avg = revenues.length > 0 ? revenues.reduce((s, v) => s + v, 0) / revenues.length : 0;
    accountBaselines.set(acc, {
      account: acc,
      avgRevenue: avg,
      dayCount: revenues.length,
      followers,
    });
    if (followers > 0) {
      accountStats.push({ account: acc, followers, revenues });
    }
  }

  // 5. Cluster bauen
  const clusters = buildClusters(accountStats);

  // 6. Globale Stats (Fallback)
  const allRevs: number[] = [];
  for (const [, revs] of byAccount) allRevs.push(...revs);
  allRevs.sort((a, b) => a - b);

  return {
    clusters,
    accountBaselines,
    globalMedian: quantile(allRevs, 0.5),
    globalP25: quantile(allRevs, 0.25),
    globalP75: quantile(allRevs, 0.75),
    globalConfidence: confidenceFor(allRevs.length),
    totalAccounts: byAccount.size,
    totalDataPoints: allRevs.length,
  };
}

/* ------------------------------------------------------------------ */
/*  LOOKUP-FUNKTIONEN                                                  */
/* ------------------------------------------------------------------ */

/**
 * Findet das passende Cluster für eine Follower-Anzahl.
 */
export function findCluster(bundle: BenchmarkBundle, followers: number): PeerCluster | null {
  for (const cluster of bundle.clusters) {
    if (followers >= cluster.minFollowers && followers < cluster.maxFollowers) {
      return cluster;
    }
  }
  return null;
}

/**
 * Berechnet einen Benchmark für einen einzelnen Chatter/Account.
 *
 * Priorität:
 * 1. Account-Baseline (wenn ≥7 Tage History für diesen Account)
 * 2. Peer-Cluster (wenn confidence ≥ medium)
 * 3. Globaler Schnitt (Fallback)
 * 4. None (Cold-Start, AI fällt auf absolute Schwellen)
 */
export function getChatterBenchmark(
  bundle: BenchmarkBundle,
  account: string,
  followers: number,
  todaysRevenue: number
): ChatterBenchmark {
  const accLower = account.toLowerCase().trim();
  const baseline = accLower ? bundle.accountBaselines.get(accLower) ?? null : null;
  const cluster = findCluster(bundle, followers);

  // Priorität 1: Per-Account-Baseline (≥7 Tage History)
  if (baseline && baseline.dayCount >= 7 && baseline.avgRevenue > 0) {
    return {
      pctOfPeerMedian: cluster && cluster.median > 0 ? Math.round((todaysRevenue / cluster.median) * 100) : null,
      pctOfAccountBaseline: Math.round((todaysRevenue / baseline.avgRevenue) * 100),
      source: "account-baseline",
      cluster,
      baseline,
      confidence: baseline.dayCount >= 14 ? "high" : "medium",
    };
  }

  // Priorität 2: Peer-Cluster
  if (cluster && cluster.confidence !== "low" && cluster.median > 0) {
    return {
      pctOfPeerMedian: Math.round((todaysRevenue / cluster.median) * 100),
      pctOfAccountBaseline: baseline && baseline.avgRevenue > 0
        ? Math.round((todaysRevenue / baseline.avgRevenue) * 100)
        : null,
      source: "peer-cluster",
      cluster,
      baseline,
      confidence: cluster.confidence,
    };
  }

  // Priorität 3: Globaler Schnitt
  if (bundle.globalConfidence !== "low" && bundle.globalMedian > 0) {
    return {
      pctOfPeerMedian: Math.round((todaysRevenue / bundle.globalMedian) * 100),
      pctOfAccountBaseline: null,
      source: "global",
      cluster: null,
      baseline,
      confidence: bundle.globalConfidence,
    };
  }

  // Cold-Start
  return {
    pctOfPeerMedian: null,
    pctOfAccountBaseline: null,
    source: "none",
    cluster,
    baseline,
    confidence: "low",
  };
}

/**
 * Format helper für UI: "47% vom Peer" oder "+180% vs. Baseline"
 */
export function formatBenchmarkLabel(bm: ChatterBenchmark): string | null {
  if (bm.source === "account-baseline" && bm.pctOfAccountBaseline !== null) {
    const delta = bm.pctOfAccountBaseline - 100;
    const sign = delta >= 0 ? "+" : "";
    return `${sign}${delta}% vs. Account-Ø`;
  }
  if ((bm.source === "peer-cluster" || bm.source === "global") && bm.pctOfPeerMedian !== null) {
    return `${bm.pctOfPeerMedian}% vom Peer-Ø`;
  }
  return null;
}

/**
 * Tone für UI-Pill: positiv/neutral/negativ
 */
export function getBenchmarkTone(bm: ChatterBenchmark): "positive" | "neutral" | "negative" | "muted" {
  if (bm.source === "none") return "muted";
  const pct = bm.source === "account-baseline" ? bm.pctOfAccountBaseline : bm.pctOfPeerMedian;
  if (pct === null) return "muted";
  if (pct >= 130) return "positive";
  if (pct >= 80) return "neutral";
  return "negative";
}
