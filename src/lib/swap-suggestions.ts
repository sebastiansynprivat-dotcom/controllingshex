/**
 * Swap Suggestions
 *
 * Schlägt Tausch-Pairings zwischen Chattern vor:
 *   - Underplaced: hohe Effizienz (Revenue/Follower) auf einem kleinen Model
 *   - Overplaced:  niedrige Effizienz auf einem großen Model
 *
 * Score-Formel:
 *   efficiency = avgRevenue / followers
 *
 * Schwellen (default):
 *   - Underplaced muss mindestens 3x effizienter sein als Overplaced
 *   - Ziel-Model muss mindestens 2x mehr Follower haben
 *
 * expectedGain = (underplaced.efficiency * overplaced.followers) - overplaced.currentRevenue
 */

export interface SwapChatter {
  name: string;
  account: string;
  followers: number;
  currentRevenue: number;
  efficiency: number; // revenue / followers
}

export interface SwapPair {
  left: SwapChatter; // underplaced (verdient Upgrade)
  right: SwapChatter; // overplaced (sitzt auf zu großem Model)
  expectedGain: number; // €/Tag prognostiziert
  /** Alternativen für die linke Karte (andere Underplaced-Kandidaten) */
  leftAlternatives: SwapChatter[];
  /** Alternativen für die rechte Karte (andere Overplaced-Kandidaten) */
  rightAlternatives: SwapChatter[];
}

export interface SwapInput {
  name: string;
  account?: string;
  /** Aktueller Tagesumsatz (z.B. aus den heutigen KPIs) */
  currentRevenue: number;
}

export interface SwapModelInfo {
  model_name: string;
  follower_count: number;
}

const MIN_EFFICIENCY_RATIO = 3; // underplaced.eff / overplaced.eff >= 3
const MIN_FOLLOWER_RATIO = 2;   // overplaced.followers / underplaced.followers >= 2

function buildEnriched(
  chatters: SwapInput[],
  models: SwapModelInfo[]
): SwapChatter[] {
  const followerLookup = new Map<string, number>();
  for (const m of models) {
    followerLookup.set((m.model_name || "").toLowerCase().trim(), m.follower_count || 0);
  }
  const out: SwapChatter[] = [];
  for (const c of chatters) {
    const account = (c.account || "").trim();
    if (!account) continue;
    const followers = followerLookup.get(account.toLowerCase()) || 0;
    if (followers <= 0) continue;
    const efficiency = c.currentRevenue / followers;
    out.push({
      name: c.name,
      account,
      followers,
      currentRevenue: c.currentRevenue,
      efficiency,
    });
  }
  return out;
}

export function computeSwapCandidates(
  chatters: SwapInput[],
  models: SwapModelInfo[]
): SwapPair[] {
  const enriched = buildEnriched(chatters, models);
  if (enriched.length < 2) return [];

  // Median follower count splits "small" vs "large"
  const sortedFollowers = [...enriched].map((c) => c.followers).sort((a, b) => a - b);
  const medianFollowers = sortedFollowers[Math.floor(sortedFollowers.length / 2)] || 0;

  const sortedByEff = [...enriched].sort((a, b) => b.efficiency - a.efficiency);

  const underplaced = sortedByEff.filter((c) => c.followers <= medianFollowers);
  const overplaced = sortedByEff
    .filter((c) => c.followers > medianFollowers)
    .reverse(); // niedrigste Effizienz zuerst

  if (underplaced.length === 0 || overplaced.length === 0) return [];

  const pairs: SwapPair[] = [];
  const usedRight = new Set<string>();

  for (const u of underplaced) {
    // Finde besten Overplaced-Partner (höchster expectedGain unter Constraints)
    let best: { chatter: SwapChatter; gain: number } | null = null;
    for (const o of overplaced) {
      if (usedRight.has(o.name)) continue;
      if (o.efficiency <= 0) continue;
      if (u.efficiency / Math.max(o.efficiency, 1e-9) < MIN_EFFICIENCY_RATIO) continue;
      if (o.followers / Math.max(u.followers, 1) < MIN_FOLLOWER_RATIO) continue;
      const gain = u.efficiency * o.followers - o.currentRevenue;
      if (gain <= 0) continue;
      if (!best || gain > best.gain) best = { chatter: o, gain };
    }
    if (!best) continue;
    usedRight.add(best.chatter.name);

    // Alternativen für rechte Karte: andere overplaced, die mit diesem u funktionieren
    const rightAlts = overplaced.filter(
      (o) =>
        o.name !== best!.chatter.name &&
        o.efficiency > 0 &&
        u.efficiency / Math.max(o.efficiency, 1e-9) >= MIN_EFFICIENCY_RATIO &&
        o.followers / Math.max(u.followers, 1) >= MIN_FOLLOWER_RATIO
    );
    // Alternativen für linke Karte: andere underplaced, die mit best.chatter funktionieren
    const leftAlts = underplaced.filter(
      (alt) =>
        alt.name !== u.name &&
        best!.chatter.efficiency > 0 &&
        alt.efficiency / Math.max(best!.chatter.efficiency, 1e-9) >= MIN_EFFICIENCY_RATIO &&
        best!.chatter.followers / Math.max(alt.followers, 1) >= MIN_FOLLOWER_RATIO
    );

    pairs.push({
      left: u,
      right: best.chatter,
      expectedGain: best.gain,
      leftAlternatives: leftAlts,
      rightAlternatives: rightAlts,
    });
  }

  pairs.sort((a, b) => b.expectedGain - a.expectedGain);
  return pairs;
}

export function formatEur(n: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Math.round(n)) + "€";
}

export function formatEfficiency(eff: number): string {
  // efficiency ist Revenue pro Follower → meist sehr klein, in ‰ darstellen
  return (eff * 1000).toFixed(2) + "‰";
}
