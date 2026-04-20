/**
 * Account-Tiers — Oberfilter nach Follower-Größe.
 *
 * Idee: Die bestehende Action-Kategorisierung (SOFORT EINGREIFEN, COACHING NÖTIG, ...)
 * bleibt 1:1 erhalten. Hier kommt nur ein **zusätzlicher Filter** drauf, der nach
 * Follower-Größe des Account-Tiers gruppiert. So vergleicht man Äpfel mit Äpfeln:
 * 30€/Tag auf nem Seed-Account ≠ 30€/Tag auf nem Top-Account.
 *
 * Schwellen sind auf die echte Maloum-Verteilung (205 Accounts, Max ~8k Follower)
 * abgestimmt — nicht auf abstrakte Annahmen.
 */

export type AccountTierId = "seed" | "starter" | "growth" | "top";

export interface AccountTier {
  id: AccountTierId;
  label: string;
  emoji: string;
  /** untere Grenze (inklusiv) */
  min: number;
  /** obere Grenze (exklusiv) — Infinity für letztes Tier */
  max: number;
  /** Tailwind-Token für Akzentfarbe */
  dotClass: string;
  borderAccent: string;
  activeBg: string;
  activeBorder: string;
  activeText: string;
  hoverBorder: string;
  description: string;
}

export const ACCOUNT_TIERS: readonly AccountTier[] = [
  {
    id: "seed",
    label: "Seed",
    emoji: "🌱",
    min: 0,
    max: 250,
    dotClass: "bg-zinc-400",
    borderAccent: "border-l-zinc-400/40",
    activeBg: "bg-zinc-500/10",
    activeBorder: "border-zinc-300/40",
    activeText: "text-zinc-200",
    hoverBorder: "hover:border-zinc-400/30",
    description: "0–250 Follower · Brandneu, kaum Traffic",
  },
  {
    id: "starter",
    label: "Starter",
    emoji: "🌿",
    min: 250,
    max: 1000,
    dotClass: "bg-emerald-400",
    borderAccent: "border-l-emerald-500/40",
    activeBg: "bg-emerald-500/10",
    activeBorder: "border-emerald-400/40",
    activeText: "text-emerald-300",
    hoverBorder: "hover:border-emerald-500/20",
    description: "250–1.000 Follower · Aufbau, erste Routine",
  },
  {
    id: "growth",
    label: "Growth",
    emoji: "🔥",
    min: 1000,
    max: 3000,
    dotClass: "bg-orange-400",
    borderAccent: "border-l-orange-500/40",
    activeBg: "bg-orange-500/10",
    activeBorder: "border-orange-400/40",
    activeText: "text-orange-300",
    hoverBorder: "hover:border-orange-500/20",
    description: "1.000–3.000 Follower · Skaliert, Conversion-Fokus",
  },
  {
    id: "top",
    label: "Top",
    emoji: "👑",
    min: 3000,
    max: Number.POSITIVE_INFINITY,
    dotClass: "bg-amber-400",
    borderAccent: "border-l-amber-500/40",
    activeBg: "bg-amber-500/10",
    activeBorder: "border-amber-400/40",
    activeText: "text-amber-300",
    hoverBorder: "hover:border-amber-500/20",
    description: "3.000+ Follower · Premium-Liga, höchste Erwartung",
  },
] as const;

const TIER_BY_ID = new Map<AccountTierId, AccountTier>(ACCOUNT_TIERS.map((t) => [t.id, t]));

export function getTierById(id: AccountTierId | null | undefined): AccountTier | null {
  if (!id) return null;
  return TIER_BY_ID.get(id) ?? null;
}

/**
 * Bestimmt das Tier eines Accounts basierend auf Follower-Anzahl.
 * Gibt null zurück, wenn keine Follower-Info vorhanden ist (z.B. Account
 * wurde nie in `models` angelegt).
 */
export function tierForFollowers(followers: number | null | undefined): AccountTier | null {
  if (followers == null || followers < 0) return null;
  for (const tier of ACCOUNT_TIERS) {
    if (followers >= tier.min && followers < tier.max) return tier;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  TIER-RELATIVE STATUS-BERECHNUNG                                    */
/* ------------------------------------------------------------------ */

export type TierStatus =
  | "overperformer"
  | "solide"
  | "underperformer"
  | "risiko"
  | "kritisch"
  | "onboarding";

export interface TierStatusInfo {
  status: TierStatus;
  emoji: string;
  label: string;
  /** Kurzbegründung für Tooltip */
  reason: string;
}

const STATUS_META: Record<TierStatus, { emoji: string; label: string }> = {
  overperformer: { emoji: "🟢", label: "Overperformer" },
  solide: { emoji: "🔵", label: "Solide" },
  underperformer: { emoji: "🟡", label: "Underperformer" },
  risiko: { emoji: "🟠", label: "Risiko" },
  kritisch: { emoji: "🔴", label: "Kritisch" },
  onboarding: { emoji: "🆕", label: "Onboarding" },
};

export interface TierStatusInput {
  /** Heutiger Tagesumsatz auf dem Account */
  todaysRevenue: number;
  /** Tier-Median (€/Tag) — aus Peer-Benchmarks */
  tierMedian: number;
  /** Anzahl Tage in Folge ohne Umsatz (0 = heute hat Umsatz) */
  zeroRevenueStreak?: number;
  /** Antwortverzug in Tagen */
  responseDelayDays?: number;
  /** Tage seit Onboarding-Start (null wenn unbekannt) */
  daysSinceStart?: number | null;
}

/**
 * Berechnet einen tier-relativen Status für einen Chatter.
 * Reihenfolge der Checks (höchste Priorität zuerst):
 *  1. Onboarding (<14 Tage)
 *  2. Kritisch (0€ ≥3 Tage oder Delay >3)
 *  3. Risiko (<50% vom Tier-Median oder Delay >2)
 *  4. Overperformer (≥130% vom Tier-Median)
 *  5. Underperformer (<70% vom Tier-Median)
 *  6. Solide (alles andere)
 */
export function computeTierStatus(input: TierStatusInput): TierStatusInfo {
  const {
    todaysRevenue,
    tierMedian,
    zeroRevenueStreak = 0,
    responseDelayDays = 0,
    daysSinceStart = null,
  } = input;

  if (daysSinceStart != null && daysSinceStart < 14) {
    return {
      status: "onboarding",
      ...STATUS_META.onboarding,
      reason: `Tag ${daysSinceStart + 1} im Onboarding`,
    };
  }

  if (zeroRevenueStreak >= 3 || responseDelayDays > 3) {
    return {
      status: "kritisch",
      ...STATUS_META.kritisch,
      reason:
        zeroRevenueStreak >= 3
          ? `${zeroRevenueStreak} Tage ohne Umsatz`
          : `Antwortverzug ${responseDelayDays} Tage`,
    };
  }

  const pct = tierMedian > 0 ? (todaysRevenue / tierMedian) * 100 : null;

  if (pct !== null && pct < 50) {
    return {
      status: "risiko",
      ...STATUS_META.risiko,
      reason: `nur ${Math.round(pct)}% vom Tier-Schnitt`,
    };
  }
  if (responseDelayDays > 2) {
    return {
      status: "risiko",
      ...STATUS_META.risiko,
      reason: `Antwortverzug ${responseDelayDays} Tage`,
    };
  }

  if (pct === null) {
    return {
      status: "solide",
      ...STATUS_META.solide,
      reason: "noch keine Tier-Vergleichsdaten",
    };
  }
  if (pct >= 130) {
    return {
      status: "overperformer",
      ...STATUS_META.overperformer,
      reason: `${Math.round(pct)}% vom Tier-Schnitt`,
    };
  }
  if (pct < 70) {
    return {
      status: "underperformer",
      ...STATUS_META.underperformer,
      reason: `nur ${Math.round(pct)}% vom Tier-Schnitt`,
    };
  }
  return {
    status: "solide",
    ...STATUS_META.solide,
    reason: `${Math.round(pct)}% vom Tier-Schnitt`,
  };
}
