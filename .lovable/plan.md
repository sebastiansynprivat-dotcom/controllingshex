## Problem

Reports werden mit 1 Tag Verzögerung hochgeladen. Heute (2. Mai) liegt erst der Report vom 1. Mai vor. Das Dashboard rechnet aber so, als wäre heute schon erfasst — dadurch erscheinen alle Chatter künstlich „im Rückstand".

## Lösung

Den effektiven Stichtag um einen Tag zurücksetzen: Statt `today` als Berechnungsbasis nutzen wir `effectiveDay = today - 1` (= letzter Tag mit vorhandenen Daten).

### Änderungen in `src/lib/monthly-goals.ts`

`computeGoalProgress` bekommt einen zweiten Parameter (oder die Logik wird intern angepasst), sodass:

- `daysPassed` = `effectiveDay.getDate()` (= 1 am 2. Mai, nicht 2)
- `daysRemaining` = `daysInMonth - daysPassed` (Tage ab inkl. heute, an denen noch Umsatz gemacht werden kann — heute zählt als verbleibender Tag, weil dessen Umsatz noch entsteht)
- `expectedSoFar` = `dailyTarget * daysPassed` (Soll bis Ende des letzten erfassten Tages)
- `requiredPerRemainingDay` = `(goal - currentRevenue) / daysRemaining`

Edge Case: Am 1. eines Monats gibt es noch keine erfassten Tage → `daysPassed = 0`, `expectedSoFar = 0`, `pacePct` = 100 (nichts erwartet, nichts geliefert → on track). Wird sauber behandelt.

### Änderungen in `src/pages/MonthlyGoals.tsx`

- Beim Laden der `chatter_history` den Bereich nur bis `effectiveDay` (gestern) abfragen statt bis `today` — verhindert, dass ein versehentlich vorhandener Heute-Eintrag mitgezählt wird und die Berechnung inkonsistent macht.
- Im UI-Header / Card-Footer kleinen Hinweis ergänzen: „Stand: <gestriges Datum>" (dezent, in `text-white/35`), damit transparent ist, worauf sich „Soll heute" / „Pace" beziehen.

### Daten-Check

Kurz per `read_query` verifizieren, dass für den aktuellen Monat tatsächlich keine Einträge mit `analysis_date = today` existieren (nur bis gestern). Falls doch, bleibt die Logik trotzdem korrekt — der Lag-Shift ist konservativ.

## Betroffene Dateien

- `src/lib/monthly-goals.ts` — `computeGoalProgress` um Lag-Tag verschieben
- `src/pages/MonthlyGoals.tsx` — `todayIso` → `yesterdayIso` für History-Query, kleiner „Stand"-Hinweis im UI
