/**
 * Action-Helpers für Auffälligkeiten:
 *  - Geschätzter Umsatz-Impact (€ Verlust pro Tag)
 *  - Vorformulierte Nachrichten zum Copy-Paste an den Chatter
 *
 * Sprache: locker-direktes Du, klar im Anliegen, immer mit konkreter
 * Erwartung & nächstem Schritt. Keine Drohung, kein Smalltalk.
 */
import type { ChatterAnomaly, AnomalyType } from "@/lib/anomaly-window";

/**
 * Geschätzter Umsatz-Verlust pro Tag in € für eine Gruppe von Anomalies.
 * Nimmt das stärkste umsatzbezogene Signal (peer_underperform / self_revenue_drop / persistent_zero).
 */
export function estimateDailyImpactEur(items: ChatterAnomaly[]): number {
  let best = 0;
  for (const a of items) {
    let gap = 0;
    if (a.alert_type === "peer_underperform" || a.alert_type === "self_revenue_drop") {
      gap = Math.max(0, (a.baseline_value ?? 0) - (a.metric_value ?? 0));
    } else if (a.alert_type === "persistent_zero") {
      // Hier kennen wir keine Baseline — schätzen konservativ über andere Signale.
      gap = 0;
    }
    if (gap > best) best = gap;
  }
  return Math.round(best);
}

/**
 * Hochrechnung Impact über Fenster (z.B. 7T) — Anzeige-Zahl.
 */
export function estimateWindowImpactEur(items: ChatterAnomaly[], windowDays: number): number {
  const perDay = estimateDailyImpactEur(items);
  return Math.round(perDay * Math.max(1, windowDays));
}

/**
 * Liefert ein "Was steht an?"-Mini-Briefing pro Anomaly-Typ.
 */
export function actionLabelFor(type: AnomalyType): string {
  switch (type) {
    case "peer_underperform":   return "Push auf Peer-Niveau";
    case "self_revenue_drop":   return "Comeback einleiten";
    case "persistent_zero":     return "Sofort-Intervention";
    case "massdm_low":          return "MassDMs hochfahren";
    case "massdm_zero_no_rev":  return "Hardes Coaching nötig";
    case "high_effort_no_rev":  return "Bestätigen & dranbleiben";
    case "peer_overperform":    return "Anerkennen & Konstanz halten";
    case "self_revenue_spike":  return "Erfolg verstärken";
    case "comeback":            return "Turnaround feiern";
  }
}

interface MessageContext {
  chatterName: string;
  items: ChatterAnomaly[];
  windowLabel: string;       // z.B. "7T"
  windowDays: number;
}

/**
 * Erzeugt eine vorformulierte Nachricht, die direkt an den Chatter gesendet werden kann.
 * Wählt den Top-Trigger und liefert eine Variante passend zum Schweregrad.
 */
export function buildChatterMessage(ctx: MessageContext): string {
  const { chatterName, items, windowLabel, windowDays } = ctx;
  if (items.length === 0) return "";

  // Top-Item nach Score
  const top = [...items].sort((a, b) => b.score - a.score)[0];
  const name = firstName(chatterName);
  const impactDay = estimateDailyImpactEur(items);
  const impactWin = impactDay * Math.max(1, windowDays);

  switch (top.alert_type) {
    case "persistent_zero": {
      const days = Math.round(top.metric_value);
      return `Hey ${name}, mir ist aufgefallen dass du jetzt ${days} Tage in Folge bei 0€ stehst — alles ok bei dir? Lass uns kurz schauen was los ist und wie wir morgen wieder reinkommen. Schreib mir kurz wann's bei dir passt. 💪`;
    }

    case "massdm_zero_no_rev": {
      return `Hey ${name}, kurzer Check-in: in den letzten ${windowLabel} sind die MassDMs fast bei null und auch beim Umsatz tut sich nix. Lass uns das gemeinsam angehen — Ziel sind 6 MassDMs am Tag, das ist dein größter Hebel. Sag Bescheid wenn du Templates oder Support brauchst, ich helfe dir gern. 🙌`;
    }

    case "massdm_low": {
      const dms = top.metric_value.toFixed(1);
      return `Hey ${name}, du fährst gerade nur ${dms} MassDMs am Tag — Ziel sind 6. Wenn wir das hochkriegen, zieht der Umsatz erfahrungsgemäß direkt mit. Lass uns morgen einfach mal konsequent durchziehen, ja? Brauchst du Hilfe bei Templates? 💪`;
    }

    case "self_revenue_drop": {
      const drop = Math.abs(top.delta_pct);
      const before = Math.round(top.baseline_value);
      const now = Math.round(top.metric_value);
      const impactPart = impactWin > 50
        ? ` Auf den ${windowLabel} hochgerechnet sind das schon ~${impactWin}€, die wir wieder reinholen können.`
        : "";
      return `Hey ${name}, dein Schnitt ist in den letzten ${windowLabel} um ${drop}% runter (von ${before}€ auf ${now}€/Tag). Hat sich was verändert oder hängst du grad an was Bestimmtem fest? Lass uns kurz drüber reden, dann finden wir den Hebel.${impactPart} 🙌`;
    }

    case "peer_underperform": {
      const expected = Math.round(top.baseline_value);
      const actual = Math.round(top.metric_value);
      return `Hey ${name}, bei deinen Accounts wären eigentlich so ~${expected}€/Tag drin — du liegst grad bei ${actual}€. Da ist noch richtig Luft nach oben! Hast du Bock dass wir uns kurz die MassDMs und Templates anschauen? Da holen wir locker was raus. 💪`;
    }

    case "high_effort_no_rev": {
      return `Hey ${name}, wollte dir nur kurz sagen: ich seh wie du gerade Gas gibst mit den MassDMs — stark! Der Umsatz folgt da meist mit ein paar Tagen Verzögerung, also bleib genau so dran. 🙌`;
    }
  }
}

function firstName(full: string): string {
  const cleaned = full.replace(/[_\-]+/g, " ").trim();
  const first = cleaned.split(" ")[0] ?? cleaned;
  return first.charAt(0).toUpperCase() + first.slice(1);
}
