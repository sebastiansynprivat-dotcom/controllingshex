## Was schiefläuft

In `src/pages/MonthlyGoals.tsx` (Zeile 392) wird der Monatsanfang für die "bisher gemacht"-Summe falsch gesetzt:

```ts
const reportStart = new Date(today.getFullYear(), today.getMonth(), 2);
```

Das `2` heißt: nur Reports mit `analysis_date >= 2. des Monats` werden in `monthRevByChatter` eingerechnet. Der **1. des Monats fehlt komplett** in der Summe.

Gleichzeitig nutzt `computeGoalProgress` in `src/lib/monthly-goals.ts`:
```ts
const daysPassed = Math.max(0, today.getDate() - 1);
```
…also "alle Tage bis gestern inkl." Auf den 5. eines Monats: `daysPassed = 4`, erwartet werden Tage 1–4 in der Summe — aber Tag 1 ist rausgefiltert. → "bisher gemacht" zu niedrig, `pacePct` zu niedrig, `requiredPerRemainingDay` zu hoch, Status fälschlich `off_track`.

Vermutlich war der Gedanke „Report von gestern liegt erst heute vor, also Vormonats-Last-Day rausfiltern". Aber `analysis_date` ist das **Datum auf das sich der Report bezieht**, nicht der Upload-Tag. Der Vormonats-Last-Day hat `analysis_date = letzter Tag Vormonat` und wird durch `>= Monatsanfang` ohnehin schon ausgeschlossen.

## Fix

Eine Zeile in `src/pages/MonthlyGoals.tsx`:

```ts
// vorher
const reportStart = new Date(today.getFullYear(), today.getMonth(), 2);
// nachher
const reportStart = new Date(today.getFullYear(), today.getMonth(), 1);
```

Damit deckt der Query-Range `analysis_date >= 1. des Monats` ab → Tag 1 wird in `monthRevByChatter` mitsummiert, konsistent mit `daysPassed`-Logik in `computeGoalProgress`.

## Was nicht geändert wird

- `computeGoalProgress` bleibt — Logik passt.
- 60-Tage-Fenster für Model-Baseline + Roster bleibt unverändert.
- Keine DB-Änderung, keine UI-Änderung.

## Verifikation nach dem Fix

Stichprobe per Chatter: `SUM(revenue_today)` aus `chatter_history` für Monatsanfang…heute mit dem im UI angezeigten "Monat bisher" vergleichen — muss übereinstimmen.
