import type { ModelOverviewRow, TrendDirection } from "@/lib/model-tracking-overview";

export const NEW_CHATTER_THRESHOLD_DAYS = 30;

export interface BucketDefinition {
  key: string;
  label: string;
  description: string;
  tone: "down" | "warn" | "neutral" | "up";
  models: ModelOverviewRow[];
}

function isNewChatter(row: ModelOverviewRow): boolean {
  if (row.currentPhaseDays == null) return false;
  return row.currentPhaseDays < NEW_CHATTER_THRESHOLD_DAYS;
}

function isOldChatter(row: ModelOverviewRow): boolean {
  if (row.currentPhaseDays == null) return false;
  return row.currentPhaseDays >= NEW_CHATTER_THRESHOLD_DAYS;
}

/**
 * Sortiert Rows in Buckets nach Chatter-Alter, abhängig von der Trend-Direction.
 * Jedes Model landet in genau einem Bucket.
 */
export function categorizeRowsByChatterAge(
  rows: ModelOverviewRow[],
  direction: TrendDirection,
): BucketDefinition[] {
  const sorted = (list: ModelOverviewRow[]) =>
    [...list].sort((a, b) => b.totalRevenue - a.totalRevenue);

  // Rows ohne belastbares Umsatz-Signal werden aus up/down komplett rausgehalten
  // und landen in einem eigenen "Zu wenig Signal"-Bucket unter flat.
  const noSignal = rows.filter((r) => !r.hasSignal);
  const signalRows = rows.filter((r) => r.hasSignal);
  const rowsForDirection = direction === "flat" ? signalRows : (direction === "up" || direction === "down" ? signalRows : rows);

  if (direction === "down") {
    const switchNoHelp: ModelOverviewRow[] = [];
    const newChatter: ModelOverviewRow[] = [];
    const oldChatter: ModelOverviewRow[] = [];
    const unknown: ModelOverviewRow[] = [];
    for (const r of rows) {
      if (r.currentPhaseDays == null) { unknown.push(r); continue; }
      if (isNewChatter(r) && r.previousPhaseExisted && r.previousPhaseTrendDown) {
        switchNoHelp.push(r);
      } else if (isNewChatter(r)) {
        newChatter.push(r);
      } else {
        oldChatter.push(r);
      }
    }
    const buckets: BucketDefinition[] = [
      {
        key: "down-old",
        label: "Alter Chatter — echtes Problem",
        description: `Chatter ist ≥ ${NEW_CHATTER_THRESHOLD_DAYS} Tage drauf, Model fällt. Coaching-Signal 🏻`,
        tone: "down",
        models: sorted(oldChatter),
      },
      {
        key: "down-switch-no-help",
        label: "Wechsel hat nicht geholfen",
        description: "Vorgänger fiel schon, der neue Chatter dreht es nicht.",
        tone: "warn",
        models: sorted(switchNoHelp),
      },
      {
        key: "down-new",
        label: "Neuer Chatter — Einarbeitung",
        description: `Chatter ist < ${NEW_CHATTER_THRESHOLD_DAYS} Tage drauf. Noch beobachten.`,
        tone: "warn",
        models: sorted(newChatter),
      },
    ];
    if (unknown.length > 0) {
      buckets.push({
        key: "down-unknown",
        label: "Ohne aktive Chatter-Phase",
        description: "Kein klar zugeordneter Chatter erkennbar.",
        tone: "neutral",
        models: sorted(unknown),
      });
    }
    return buckets;
  }

  if (direction === "up") {
    const newC: ModelOverviewRow[] = [];
    const oldC: ModelOverviewRow[] = [];
    const unknown: ModelOverviewRow[] = [];
    for (const r of rows) {
      if (r.currentPhaseDays == null) unknown.push(r);
      else if (isNewChatter(r)) newC.push(r);
      else oldC.push(r);
    }
    const buckets: BucketDefinition[] = [
      {
        key: "up-new",
        label: "Neuer Chatter hebt das Model",
        description: `Wechsel < ${NEW_CHATTER_THRESHOLD_DAYS} Tage her — gute Entscheidung.`,
        tone: "up",
        models: sorted(newC),
      },
      {
        key: "up-old",
        label: "Alter Chatter zieht konstant",
        description: `Chatter ist ≥ ${NEW_CHATTER_THRESHOLD_DAYS} Tage drauf und liefert.`,
        tone: "up",
        models: sorted(oldC),
      },
    ];
    if (unknown.length > 0) {
      buckets.push({
        key: "up-unknown",
        label: "Ohne aktive Chatter-Phase",
        description: "Kein klar zugeordneter Chatter.",
        tone: "neutral",
        models: sorted(unknown),
      });
    }
    return buckets;
  }

  if (direction === "flat") {
    const newC: ModelOverviewRow[] = [];
    const oldC: ModelOverviewRow[] = [];
    const unknown: ModelOverviewRow[] = [];
    for (const r of rows) {
      if (r.currentPhaseDays == null) unknown.push(r);
      else if (isNewChatter(r)) newC.push(r);
      else oldC.push(r);
    }
    const buckets: BucketDefinition[] = [
      {
        key: "flat-old",
        label: "Stabil unter altem Chatter",
        description: `≥ ${NEW_CHATTER_THRESHOLD_DAYS} Tage Phase, konstanter Umsatz.`,
        tone: "neutral",
        models: sorted(oldC),
      },
      {
        key: "flat-new",
        label: "Stabil unter neuem Chatter",
        description: `< ${NEW_CHATTER_THRESHOLD_DAYS} Tage Phase, läuft ohne Ausschlag.`,
        tone: "neutral",
        models: sorted(newC),
      },
    ];
    if (unknown.length > 0) {
      buckets.push({
        key: "flat-unknown",
        label: "Ohne aktive Chatter-Phase",
        description: "Kein klar zugeordneter Chatter.",
        tone: "neutral",
        models: sorted(unknown),
      });
    }
    return buckets;
  }

  return [
    {
      key: "none",
      label: "Keine Daten",
      description: "Zu wenig Datenpunkte für eine Trend-Aussage.",
      tone: "neutral",
      models: sorted(rows),
    },
  ];
}

/**
 * Aggregiert daily.revenue über alle übergebenen Models pro Datum.
 * Lücken in einzelnen Models werden als 0 gezählt.
 */
export function aggregateDaily(rows: ModelOverviewRow[]): { date: string; revenue: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    for (const p of r.daily) {
      map.set(p.date, (map.get(p.date) ?? 0) + p.revenue);
    }
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, revenue]) => ({ date, revenue }));
}

/**
 * Pro Tag: wie viele der übergebenen Models hatten an dem Tag Umsatz > 0.
 */
export function aggregateModelCountDaily(rows: ModelOverviewRow[]): { date: string; count: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    for (const p of r.daily) {
      if (p.revenue > 0) map.set(p.date, (map.get(p.date) ?? 0) + 1);
    }
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));
}

/**
 * Pro Tag: wie viele Models lagen an dem Tag unter ihrem eigenen Schnitt
 * der aktiven Tage (= "im Rückgang" an dem Tag).
 * Tage ohne Daten zählen nicht als Rückgang.
 */
export function aggregateModelsInDeclineDaily(rows: ModelOverviewRow[]): { date: string; count: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const active = r.daily.filter((p) => p.revenue > 0);
    if (active.length === 0) continue;
    const avgActive = active.reduce((s, p) => s + p.revenue, 0) / active.length;
    for (const p of r.daily) {
      if (p.revenue < avgActive) {
        map.set(p.date, (map.get(p.date) ?? 0) + 1);
      }
    }
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));
}
