# Monatsziel = Model-Potenzial × 1.10

## Idee
Statt aus Chatter-Anwesenheitstagen wird das Ziel aus der **realen Model-Performance** abgeleitet. So zählen 0-€-Tage des Chatters nicht mehr gegen ihn — das Ziel hängt daran, was seine Models normalerweise abwerfen.

## Datenquelle
`chatter_history.account` enthält die Models eines Chatters (oft komma-separiert, z. B. `mandyrosee, candyxx, lolahorny`). Wir aggregieren pro **einzelnem Model** (Account-String aufsplitten) über die letzten 60 Tage.

## Berechnung pro Chatter

**Schritt 1 — Aktuelle Model-Zuordnung des Chatters**
Aus den letzten 14 Tagen `chatter_history` für den Chatter: alle vorkommenden Model-Slugs sammeln (Set). Das ist sein „aktueller Roster".

**Schritt 2 — Baseline pro Model**
Pro Model über alle Chatter, letzte 60 Tage:
- `model_avg_per_day` = `SUM(revenue_today_anteilig) / COUNT(DISTINCT analysis_date mit dieser Model-Erwähnung)`
- Wenn eine Row mehrere Models hat → Revenue gleichmäßig auf die genannten Models splitten (z. B. 3 Models in einem `account`-String → je 1/3).
- Tage mit 0 € zählen mit (drücken den Schnitt – realistisch).

**Schritt 3 — Chatter-Ziel**
```
monthGoal = Σ(model_avg_per_day) × daysInMonth × 1.10
```
gerundet auf 50 €. Ergibt: starke Model-Mappe → höheres Ziel, schwache → niedrigeres. Komplett unabhängig von Chatter-Anwesenheit.

## Fallback
- Chatter ohne erkennbares Model in den letzten 14 Tagen → alte Logik (avgDaily × Tage × 1.10) als Backup.
- Model ohne Historie → wird mit 0 € gewichtet (gibt nur, was die anderen Models tragen).

## UI-Änderungen (`MonthlyGoals.tsx`)
- `SuggestionRow` bekommt zwei neue Felder: `models: string[]` und `basis: "model" | "fallback"`.
- Im SuggestionCard kleines Sublabel: „basiert auf 3 Models · Ø 145 €/Tag" — der User sieht woraus das Ziel berechnet wurde.
- Wenn Fallback aktiv: Badge „kein Model-Match" damit klar ist warum.

## Edge Function `generate-goal-message`
Der Goal-Message-Generator bekommt zusätzlich:
- `roster: string[]` — die Models des Chatters
- `model_baseline_eur_per_day` — Summe der Model-Schnitte
Im Prompt kurz erwähnen: „Ziel basiert auf der normalen Performance deiner Models (X €/Tag-Potenzial)." Das macht die Nachricht für den Chatter nachvollziehbarer.

## Geltungsbereich
- `src/lib/monthly-goals.ts`: neue Funktion `suggestFromModels(roster, modelBaselines, today)`.
- `src/pages/MonthlyGoals.tsx`: zusätzliche Aggregation pro Model + Anwendung der neuen Logik in der SuggestionRow-Erzeugung. UI-Sublabel + Badge.
- `supabase/functions/generate-goal-message/index.ts`: Roster + Model-Baseline berechnen, in Prompt einbauen.
- Kein DB-Schema-Change.

## Was nicht ändert
- Schon gesetzte/in Notizen gespeicherte Ziele bleiben unverändert (nur Vorschläge nutzen die neue Logik).
- 0-€-Tage in der Nachrichten-Analyse bleiben weiterhin transparent („X Nullrunden") — der User sieht das im Kontext-Bar.
