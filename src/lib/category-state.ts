/**
 * Hysterese-Layer (Punkt 10).
 *
 * Verhindert „Whiplash": ein Chatter, dessen Status zwischen BEOBACHTEN und
 * COACHING / SOFORT EINGREIFEN hin- und herspringt, wird stabilisiert.
 *
 * Regeln:
 *  1. Wechsel rauf in höhere Severity → SOFORT (frühzeitiges Warnen ist wichtig).
 *  2. Wechsel runter in niedrigere Severity → erst nach DOWNGRADE_DAYS aufeinanderfolgenden
 *     Tagen mit dem besseren Signal.
 *  3. Onboarding-Wechsel (ONBOARDING TAG X) folgen immer dem Tageszähler — kein Hold.
 *  4. Wenn `since_date` < heute, aktualisiere `last_evaluation_date` aber lasse Kategorie stehen.
 *
 * Persistenz: Tabelle `chatter_category_state`.
 */
import type { ActionCategoryName } from "@/lib/action-categories";
import type { CategoryDecision } from "@/lib/categorize-v2";
import { supabase } from "@/integrations/supabase/client";

const DOWNGRADE_HOLD_DAYS = 2;

/** Severity-Rang: höher = ernster. */
const SEVERITY_RANK: Record<string, number> = {
  "SOFORT EINGREIFEN": 5,
  "COACHING NÖTIG": 4,
  "BEOBACHTEN": 3,
  "RE-ASSIGNEN": 3,
  "PUSHEN": 2,
  "BELOHNEN": 1,
};
function severity(name: ActionCategoryName): number {
  if (name.startsWith("ONBOARDING")) return 0; // separat behandelt
  return SEVERITY_RANK[name] ?? 3;
}
function isOnboarding(name: ActionCategoryName): boolean {
  return name.startsWith("ONBOARDING");
}

interface StateRow {
  chatter_name: string;
  current_category: string;
  since_date: string;
  last_evaluation_date: string;
}

export interface StabilizedDecision extends CategoryDecision {
  /** Tage, die diese Kategorie schon stabil ist */
  daysStable: number;
  /** True falls die Kategorie durch Hysterese (Hold) statt durch v2-Engine kommt */
  heldByHysteresis: boolean;
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}
function daysBetween(a: string, b: string): number {
  const ta = new Date(a + "T00:00:00Z").getTime();
  const tb = new Date(b + "T00:00:00Z").getTime();
  return Math.max(0, Math.floor((tb - ta) / 86400000));
}
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
}

async function loadStates(
  platform: string,
  userId: string
): Promise<Map<string, StateRow>> {
  const map = new Map<string, StateRow>();
  const { data, error } = await supabase
    .from("chatter_category_state")
    .select("chatter_name, current_category, since_date, last_evaluation_date")
    .eq("platform", platform)
    .eq("user_id", userId);
  if (error) {
    console.warn("loadStates:", error.message);
    return map;
  }
  for (const row of data || []) {
    map.set(normalizeName(row.chatter_name), row as StateRow);
  }
  return map;
}

/**
 * Wendet Hysterese auf die rohen Engine-Decisions an und persistiert den neuen State.
 *
 * Wichtig: Diese Funktion macht NUR den Apply für den heutigen Tag — sie soll
 * nicht für historische Fenster aufgerufen werden. Im Swipe-Mode wird sie nur
 * aufgerufen, wenn `timeRange.preset === "today"`.
 */
export async function stabilizeAndPersist(
  platform: string,
  userId: string,
  rawDecisions: Map<string, CategoryDecision>,
  /** Display-Names per key, damit wir beim Insert den richtigen Namen schreiben. */
  displayNames: Map<string, string>
): Promise<Map<string, StabilizedDecision>> {
  const result = new Map<string, StabilizedDecision>();
  const today = todayIso();
  const states = await loadStates(platform, userId);

  const upserts: any[] = [];

  for (const [key, dec] of rawDecisions) {
    const prev = states.get(key);
    const newName = dec.name;
    const decCopy: StabilizedDecision = {
      ...dec,
      reasons: [...dec.reasons],
      daysStable: 0,
      heldByHysteresis: false,
    };

    let finalName: ActionCategoryName = newName;
    let sinceDate = today;

    if (!prev) {
      // Brandneuer Chatter im State — direkt übernehmen
      sinceDate = today;
    } else {
      const prevName = prev.current_category as ActionCategoryName;
      if (prevName === newName) {
        sinceDate = prev.since_date;
      } else if (isOnboarding(newName) || isOnboarding(prevName)) {
        // Onboarding ignoriert Hysterese
        sinceDate = today;
      } else {
        const prevSev = severity(prevName);
        const newSev = severity(newName);
        if (newSev > prevSev) {
          // Upgrade in Severity → sofort wechseln
          sinceDate = today;
        } else {
          // Downgrade → nur wenn seit DOWNGRADE_HOLD_DAYS schon das bessere Signal
          // Heuristik: prev.last_evaluation_date sagt uns, wann zuletzt evaluiert wurde.
          // Wir tracken den „Verbesserungs-Streak" approximativ über last_evaluation_date.
          const stableDays = daysBetween(prev.last_evaluation_date, today);
          if (stableDays >= DOWNGRADE_HOLD_DAYS) {
            sinceDate = today;
          } else {
            // Halten
            finalName = prevName;
            sinceDate = prev.since_date;
            decCopy.heldByHysteresis = true;
            decCopy.reasons.unshift(
              `Hysterese-Hold: Kategorie bleibt ${prevName} für noch ${DOWNGRADE_HOLD_DAYS - stableDays} Tag(e)`
            );
          }
        }
      }
    }

    decCopy.name = finalName;
    decCopy.daysStable = daysBetween(sinceDate, today);

    if (decCopy.daysStable >= 1) {
      decCopy.reasons.push(`Stabil seit ${decCopy.daysStable} Tag${decCopy.daysStable === 1 ? "" : "en"}`);
    }

    result.set(key, decCopy);

    upserts.push({
      user_id: userId,
      platform,
      chatter_name: displayNames.get(key) || key,
      current_category: finalName,
      since_date: sinceDate,
      last_evaluation_date: today,
      last_signals: dec.signals as any,
    });
  }

  // Bulk-Upsert (best effort, nicht blockierend für UI)
  if (upserts.length > 0) {
    const { error } = await supabase
      .from("chatter_category_state")
      .upsert(upserts, { onConflict: "user_id,platform,chatter_name" });
    if (error) console.warn("stabilizeAndPersist upsert:", error.message);
  }

  return result;
}
