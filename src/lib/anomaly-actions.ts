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
  const greet = `Hey ${firstName(chatterName)},`;

  const impactDay = estimateDailyImpactEur(items);
  const impactWin = impactDay * Math.max(1, windowDays);

  switch (top.alert_type) {
    case "persistent_zero": {
      const days = Math.round(top.metric_value);
      return [
        greet,
        ``,
        `mir ist aufgefallen, dass du jetzt **${days} Tage in Folge bei 0€** stehst — das müssen wir uns dringend gemeinsam anschauen.`,
        ``,
        `Lass mich kurz wissen:`,
        `1. Ist alles okay bei dir? Gibt's etwas, das gerade blockiert?`,
        `2. Wie sieht dein Plan für die nächsten 48h aus?`,
        ``,
        `Ich helfe dir gern beim Setup — Hauptsache wir kriegen morgen wieder ein Lebenszeichen rein. 💪`,
      ].join("\n");
    }

    case "massdm_zero_no_rev": {
      return [
        greet,
        ``,
        `kurzer Reality-Check: in den letzten ${windowLabel} habe ich von dir **kaum MassDMs und keinen Umsatz** gesehen. Das ist genau die Kombi, die wir nicht wollen.`,
        ``,
        `Bitte ab morgen:`,
        `• **6 MassDMs/Tag minimum** — auch wenn das Setup noch nicht perfekt ist`,
        `• Schreib mir kurz, wenn du Hilfe bei Templates brauchst`,
        ``,
        `MassDMs sind dein wichtigster Hebel. Ohne die passiert nichts.`,
      ].join("\n");
    }

    case "massdm_low": {
      const dms = top.metric_value.toFixed(1);
      return [
        greet,
        ``,
        `du fährst aktuell nur **${dms} MassDMs/Tag** — Ziel sind 6. Das erklärt auch warum der Umsatz hinterherhinkt.`,
        ``,
        `Mein Vorschlag: ab morgen konsequent **6 MassDMs/Tag**, gerne auch mehr. Schick mir bitte heute Abend einen kurzen Status, ob das machbar ist und ob du Templates oder Support brauchst.`,
      ].join("\n");
    }

    case "self_revenue_drop": {
      const drop = Math.abs(top.delta_pct);
      const before = Math.round(top.baseline_value);
      const now = Math.round(top.metric_value);
      return [
        greet,
        ``,
        `dein Schnitt ist in den letzten ${windowLabel} um **${drop}% eingebrochen** (von ${before}€/Tag auf ${now}€/Tag). Das ist signifikant — was ist passiert?`,
        ``,
        `Lass uns kurz zusammen schauen:`,
        `• Hat sich was am Setup oder an den Accounts geändert?`,
        `• Brauchst du neue Mass-DM-Templates?`,
        `• Gibt's Probleme mit bestimmten Models/Subs?`,
        ``,
        impactWin > 50
          ? `Wenn wir das nicht drehen, reden wir über ca. **${impactWin}€ Verlust** alleine im aktuellen ${windowLabel}-Fenster. Lass uns das angehen. 💪`
          : `Schreib mir, wann wir kurz drüber sprechen können.`,
      ].join("\n");
    }

    case "peer_underperform": {
      const expected = Math.round(top.baseline_value);
      const actual = Math.round(top.metric_value);
      const pct = Math.abs(top.delta_pct);
      return [
        greet,
        ``,
        `kurzer Check-in: bei deinen Accounts wären auf Basis der Follower-Zahlen ungefähr **${expected}€/Tag** drin — du liegst gerade bei ${actual}€/Tag, also **${pct}% darunter**.`,
        ``,
        `Das ist Potenzial, das du liegen lässt. Bitte schau dir bis Ende der Woche an:`,
        `1. Sind deine MassDMs wirklich auf 6+/Tag?`,
        `2. Wann hast du zuletzt deine Templates aktualisiert?`,
        `3. Gibt es Fans, die du gerade vernachlässigst?`,
        ``,
        `Sag Bescheid, wenn du Sparring brauchst.`,
      ].join("\n");
    }

    case "high_effort_no_rev": {
      return [
        greet,
        ``,
        `wollte dir nur kurz sagen: ich sehe dass du **voll Gas gibst mit den MassDMs** in den letzten ${windowLabel}. Der Umsatz folgt da erfahrungsgemäß mit ein paar Tagen Verzögerung — bleib genau so dran.`,
        ``,
        `Stark. 🙌`,
      ].join("\n");
    }
  }
}

function firstName(full: string): string {
  const cleaned = full.replace(/[_\-]+/g, " ").trim();
  const first = cleaned.split(" ")[0] ?? cleaned;
  return first.charAt(0).toUpperCase() + first.slice(1);
}
