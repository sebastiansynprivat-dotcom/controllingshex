/**
 * Swap-Tracking — Performance-Effekt von Account-Wechseln messen.
 *
 * Idee: Wenn ein Chatter im Wechsel-Mode (swap_decisions, status='approved')
 * einen anderen Account zugewiesen bekommt (oder seinen abgegeben hat), wollen
 * wir sehen, ob sich seine Performance dadurch verändert hat.
 *
 * Voraussetzung: Der Chatter war VOR dem Swap schon aktiv (mind. 2 history-
 * Einträge vor Swap-Datum). Sonst gibt's keine sinnvolle Baseline und der
 * Chatter wird ignoriert (sonst würde jeder neue Chatter im Tracking auftauchen).
 *
 * Vergleich: Ø Tagesumsatz 3 Tage VOR Swap vs Ø 3 Tage NACH Swap.
 */
import { supabase } from "@/integrations/supabase/client";
import { tierForFollowers, ACCOUNT_TIERS, type AccountTierId } from "@/lib/account-tiers";

export type SwapSide = "received" | "gave";
export type TierDirection = "upgrade" | "downgrade" | "lateral" | "unknown";

export interface SwapTrackingEntry {
  /** Normalisierter Chatter-Name (key für Lookups) */
  chatterKey: string;
  /** Anzeige-Name */
  chatterName: string;
  /** ISO-Datum des Swaps (created_at, auf Tag gerundet) */
  swappedAt: string;
  /** Tage seit Swap (heute) */
  daysSince: number;
  /** Welche Rolle hatte der Chatter im Swap */
  side: SwapSide;
  /** Partner-Chatter im Swap (zur Anzeige) */
  partnerName: string;
  /** Account, den der Chatter VOR dem Swap hatte (jetzt abgegeben) */
  oldAccount: string | null;
  /** Account, den der Chatter NACH dem Swap hat (jetzt erhalten) */
  newAccount: string | null;
  /** Tier des alten Accounts (null wenn unbekannt) */
  oldTier: AccountTierId | null;
  /** Tier des neuen Accounts (null wenn unbekannt) */
  newTier: AccountTierId | null;
  /** Hat der Chatter ein größeres/kleineres Profil bekommen? */
  tierDirection: TierDirection;
  /** Ø Tagesumsatz 3 Tage VOR dem Swap-Tag (exklusiv Swap-Tag) */
  avgBefore: number;
  /** Ø Tagesumsatz 3 Tage AB Swap-Tag (inklusiv Swap-Tag, falls vorhanden) */
  avgAfter: number;
  /** Δ in % (avgAfter relativ zu avgBefore). null wenn avgBefore == 0 */
  deltaPct: number | null;
}

interface RawHistoryRow {
  chatter_name: string;
  analysis_date: string;
  revenue_today: number | string | null;
}

interface RawSwap {
  id: string;
  chatter_a: string;
  chatter_b: string;
  model_a: string | null;
  model_b: string | null;
  created_at: string;
  status: string;
}

interface RawModel {
  model_name: string;
  follower_count: number | null;
}

const WINDOW_DAYS = 3;
/** Mindestabstand seit Swap, damit ein Vergleich aussagekräftig ist (Tage). */
const MIN_DAYS_AFTER = 1;
/** Wie lange ein Swap überhaupt im Tracking-Bucket bleibt (Tage). */
const MAX_DAYS_AFTER = 21;
const HISTORY_PAGE_SIZE = 1000;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
}

function toIsoDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().split("T")[0];
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + "T00:00:00Z").getTime();
  const b = new Date(bIso + "T00:00:00Z").getTime();
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

async function loadHistoryWindow(platform: string, earliestHistoryIso: string): Promise<RawHistoryRow[]> {
  const allRows: RawHistoryRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("chatter_history")
      .select("chatter_name, analysis_date, revenue_today")
      .eq("platform", platform)
      .gte("analysis_date", earliestHistoryIso)
      .order("analysis_date", { ascending: true })
      .range(from, from + HISTORY_PAGE_SIZE - 1);

    if (error) throw error;

    const rows = (data || []) as RawHistoryRow[];
    allRows.push(...rows);

    if (rows.length < HISTORY_PAGE_SIZE) break;
    from += HISTORY_PAGE_SIZE;
  }

  return allRows;
}

/**
 * Lädt alle approved Swap-Decisions der letzten 30 Tage und berechnet pro
 * beteiligtem Chatter (beide Seiten!) den Performance-Delta.
 *
 * Gibt eine Map name→Entry zurück. Wenn ein Chatter MEHRERE Swaps hatte,
 * gewinnt der jüngste mit gültiger Baseline (>=2 history-Einträge davor).
 */
export async function loadSwapTracking(
  platform: string
): Promise<Map<string, SwapTrackingEntry>> {
  const result = new Map<string, SwapTrackingEntry>();

  // Range: betrachte Swaps der letzten MAX_DAYS_AFTER Tage. Für Baseline
  // brauchen wir History bis WINDOW_DAYS davor.
  const earliestSwapDate = new Date();
  earliestSwapDate.setDate(earliestSwapDate.getDate() - MAX_DAYS_AFTER);
  const earliestHistoryDate = new Date(earliestSwapDate);
  earliestHistoryDate.setDate(earliestHistoryDate.getDate() - (WINDOW_DAYS + 2));

  let swapsRes;
  let history: RawHistoryRow[];

  try {
    [swapsRes, history] = await Promise.all([
      supabase
        .from("swap_decisions")
        .select("id, chatter_a, chatter_b, model_a, model_b, created_at, status")
        .eq("platform", platform)
        .eq("status", "approved")
        .gte("created_at", earliestSwapDate.toISOString())
        .order("created_at", { ascending: false }),
      loadHistoryWindow(platform, toIsoDate(earliestHistoryDate)),
    ]);
  } catch (error) {
    console.warn("loadSwapTracking history:", error);
    return result;
  }

  if (swapsRes.error) {
    console.warn("loadSwapTracking swaps:", swapsRes.error.message);
    return result;
  }

  const swaps = (swapsRes.data || []) as RawSwap[];

  // history per normalisiertem Namen → sortierte Liste
  const histByChatter = new Map<string, { date: string; rev: number }[]>();
  for (const h of history) {
    const key = normalizeName(h.chatter_name);
    if (!histByChatter.has(key)) histByChatter.set(key, []);
    histByChatter.get(key)!.push({
      date: h.analysis_date,
      rev: Number(h.revenue_today) || 0,
    });
  }

  const todayIso = toIsoDate(new Date());

  // Helper: berechne Entry für einen Chatter+Swap. Returns null wenn ungültig.
  const computeEntry = (
    chatterDisplay: string,
    swap: RawSwap,
    side: SwapSide,
    partner: string,
    accountInvolved: string | null
  ): SwapTrackingEntry | null => {
    const key = normalizeName(chatterDisplay);
    const hist = histByChatter.get(key);
    if (!hist || hist.length === 0) return null;

    const swapIso = toIsoDate(swap.created_at);
    const daysSince = daysBetween(swapIso, todayIso);
    if (daysSince < MIN_DAYS_AFTER || daysSince > MAX_DAYS_AFTER) return null;

    // Baseline: Tage strikt vor Swap-Datum, max. WINDOW_DAYS jüngste
    const before = hist
      .filter((h) => h.date < swapIso)
      .slice(-WINDOW_DAYS);
    if (before.length < 2) return null; // zu wenig Vorgeschichte → ignorieren

    // After: Tage ab Swap-Datum (inklusiv), max. WINDOW_DAYS älteste
    const after = hist
      .filter((h) => h.date >= swapIso)
      .slice(0, WINDOW_DAYS);
    if (after.length === 0) return null;

    const avgBefore = avg(before.map((h) => h.rev));
    const avgAfter = avg(after.map((h) => h.rev));
    const deltaPct = avgBefore > 0 ? ((avgAfter - avgBefore) / avgBefore) * 100 : null;

    return {
      chatterKey: key,
      chatterName: chatterDisplay,
      swappedAt: swapIso,
      daysSince,
      side,
      partnerName: partner,
      accountInvolved,
      avgBefore,
      avgAfter,
      deltaPct,
    };
  };

  // Iteriere absteigend (jüngster zuerst); wer schon im result ist, wird
  // nicht überschrieben → wir behalten den jüngsten gültigen Swap pro Chatter.
  for (const swap of swaps) {
    // Seite A: gibt model_a ab, bekommt evtl. model_b
    const entryA = computeEntry(swap.chatter_a, swap, "gave", swap.chatter_b, swap.model_a);
    if (entryA && !result.has(entryA.chatterKey)) {
      result.set(entryA.chatterKey, entryA);
    }
    // Seite B: bekommt model_a (klassischer "Empfänger" im Wechsel-Mode)
    const entryB = computeEntry(swap.chatter_b, swap, "received", swap.chatter_a, swap.model_a);
    if (entryB && !result.has(entryB.chatterKey)) {
      result.set(entryB.chatterKey, entryB);
    }
  }

  return result;
}

/** Formatiert Δ% kompakt für Badge: "+18%", "-7%", "·" wenn null */
export function formatDelta(deltaPct: number | null): string {
  if (deltaPct === null) return "·";
  const sign = deltaPct > 0 ? "+" : "";
  return `${sign}${Math.round(deltaPct)}%`;
}

/** Tone für Badge je nach Δ. */
export function deltaTone(deltaPct: number | null): "pos" | "neg" | "neutral" {
  if (deltaPct === null) return "neutral";
  if (deltaPct >= 10) return "pos";
  if (deltaPct <= -10) return "neg";
  return "neutral";
}
