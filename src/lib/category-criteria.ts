/**
 * Menschenlesbare Sortier-Kriterien je Action-Kategorie.
 * Wird unter dem Filter-Trigger angezeigt, sobald eine Kategorie ausgewählt ist —
 * damit klar ist, NACH WELCHEN REGELN dieser Filter sortiert hat.
 *
 * Quelle der Wahrheit für die Logik: src/lib/categorize-v2.ts (decide()).
 */
import type { ActionCategoryName } from "@/lib/action-categories";

export interface CategoryCriteria {
  /** Kurzer Einzeiler für den Trigger */
  short: string;
  /** Aufzählung der harten Regeln (für Tooltip / Hint-Box) */
  rules: string[];
}

export function getCategoryCriteria(name: ActionCategoryName | string): CategoryCriteria {
  // Onboarding Tag 1..14
  const m = String(name).match(/^ONBOARDING TAG (\d{1,2})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    return {
      short: `Onboarding Tag ${day}/14 — Schonfrist, keine Performance-Bewertung`,
      rules: [
        `Chatter ist seit ${day} Tag${day === 1 ? "" : "en"} im Onboarding`,
        "In den ersten 14 Tagen wird NICHT nach Performance bewertet",
        "Überspringt SOFORT EINGREIFEN, COACHING, BELOHNEN etc.",
      ],
    };
  }

  switch (name) {
    case "SOFORT EINGREIFEN":
      return {
        short: "Kritisch: ≥80% 0€-Tage ODER aktueller Antwortverzug > 3 Tage",
        rules: [
          "≥ 80% der Tage im Zeitraum waren 0€",
          "ODER aktueller Antwortverzug > 3 Tage",
          "Peer-Schutz aktiv: ≥90% des Cluster-Medians schützt vor dieser Stufe",
        ],
      };
    case "COACHING NÖTIG":
      return {
        short: "Performance fällt: ≥50% 0€-Tage, Trend ≤ −30%, oder <50% Peer-Median",
        rules: [
          "≥ 50% der Tage waren 0€",
          "ODER 7-Tage-Median liegt ≥ 30% unter Baseline",
          "ODER nur <50% des Cluster-Medians",
          "Peer-Schutz: ≥90% Cluster-Median verhindert Coaching-Einstufung",
        ],
      };
    case "PUSHEN":
      return {
        short: "Aufwärtstrend ≥ +30% — aktiv pushen",
        rules: [
          "7-Tage-Median liegt ≥ 30% über Baseline",
          "Onboarding bereits abgeschlossen (Tag > 14)",
        ],
      };
    case "BELOHNEN":
      return {
        short: "Top-Form: +10% Trend, 5-Tage-Streak ≥ Median, oder Top-20% Umsatz",
        rules: [
          "7-Tage-Median liegt ≥ 10% über persönlicher Baseline",
          "ODER ≥ 5 Tage in Folge ≥ persönlicher Median",
          "ODER Top-20% Tagesumsatz im Zeitraum",
        ],
      };
    case "RE-ASSIGNEN":
      return {
        short: "Account-Match passt nicht (Follower vs. Performance)",
        rules: [
          "Follower-Zahl und Umsatz-Tier liegen weit auseinander",
          "Hinweis auf falschen Account-Match — Tausch prüfen",
        ],
      };
    case "BEOBACHTEN":
      return {
        short: "Stabil — kein Eingriff nötig",
        rules: [
          "Keine kritischen Signale (0€-Quote, Verzug, Trend) ausgelöst",
          "Kein Top-Performer-Signal aktiv",
          "Auffangkorb für alle, die in keine andere Stufe fallen",
        ],
      };
    default:
      return {
        short: "Stabil — kein Eingriff nötig",
        rules: ["Keine spezifischen Kriterien hinterlegt"],
      };
  }
}

/** Kriterien für Spezial-Filter (Alerts, Swap-Track etc.) */
export const SPECIAL_FILTER_CRITERIA: Record<string, CategoryCriteria> = {
  alerts: {
    short: "Aktive Anomalie-Alerts (Umsatz-Drop, Verzug-Spike)",
    rules: [
      "Anomaly-Detection hat heute ungewöhnliche Werte gemeldet",
      "Z. B. Umsatz-Einbruch ggü. eigener Baseline oder Verzug-Spike",
    ],
  },
  swap_track: {
    short: "Account-Tausch verfolgt — Performance vor/nach prüfen",
    rules: [
      "Chatter wurde kürzlich auf einen anderen Account umgesetzt",
      "Performance vor und nach Tausch wird beobachtet",
    ],
  },
  recovery: {
    short: "Recovery-Queue: war kritisch, ist auf dem Weg zurück",
    rules: [
      "Chatter war SOFORT EINGREIFEN oder COACHING und zeigt jetzt Besserung",
      "Wird begleitet, bis stabil zurück in BEOBACHTEN",
    ],
  },
};
