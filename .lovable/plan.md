## Ziel

Der Model-Tab im Heute-Tab soll (a) mehr Models zeigen und (b) nur noch dann "im Rückgang" markieren, wenn das Model wirklich signifikanten Umsatz hat und die aktuelle Performance klar unter der eigenen Lifetime-Baseline liegt — nicht mehr, weil ein Chatter mal 5 € gemacht hat und sonst 0 €.

## Was heute schiefläuft

1. **Trend rechnet gegen die falsche Basis.** In `model-tracking-overview.ts` wird der Trend aus "Ø/Tag im gewählten Range" vs. "Ø/Tag der restlichen 365 T ohne den Range" gerechnet, aber schon ab **3 Baseline-Tagen** und **ohne Mindestumsatz**. Ergebnis: ein Model, das lifetime nur einmal 5 € gemacht hat und im Range 0 €, kommt als "-100 % / Rückgang" raus.
2. **Alerts triggern auf Winz-Umsätze.** `detectRelevantModelAlerts` filtert nur mit `totalRevenue30d ≥ 100 €`. Ein Model mit 5 €-Ausreißer + Wechsel produziert trotzdem einen "Wechsel = Rückgang"-Alert, weil keine absolute Schwelle für die verglichenen Phasen-Durchschnitte greift.
3. **Model-Kategorie wirkt leer.** Die Trend-Buckets teilen alle Models auf `up/flat/down/none` auf. Weil "none" (keine Regressions-Daten) hart auf "flat" gemappt wird und Micro-Models trotzdem "down" bekommen, sieht die Verteilung schräg aus und die relevanten Kategorien wirken zu klein.

## Was gebaut wird

### 1) Lifetime-Baseline als einzige Vergleichsbasis
- In `model-tracking-overview.ts` die Trend-Berechnung umstellen auf:
  - **Baseline** = Ø €/Tag über **alle aktiven Tage seit dem ersten Report** dieses Models (aus dem 365-T-Pool, ohne den aktuellen Range).
  - **Current** = Ø €/Tag über aktive Tage im gewählten Range.
  - Mindest-Anforderungen anheben: Baseline braucht **≥ 14 aktive Tage** und Current **≥ 5 aktive Tage**, sonst → `trend = "flat"` mit `trendPct = null` (keine falsche Rückgangs-Anzeige).
- Damit ist der Vergleich immer "gesamte Zeit, die das Model bei uns ist" — wie vom User gewünscht.

### 2) Harte Umsatz-Relevanz-Schwelle
- **Neue Konstante `MIN_LIFETIME_AVG_EUR_PER_DAY = 5`** (vom User bestätigt).
- Ein Model darf **nur dann `trend = "down"` oder `"up"` bekommen**, wenn seine Lifetime-Baseline **> 5 €/Tag** ist. Sonst wird der Trend zu `"flat"` gezwungen. → Ein Model mit einmaligem 5 €-Umsatz landet nie mehr in der Rückgangs-Kategorie.
- Zusätzlich fließt derselbe Filter in `TopUnderperformers` ein.

### 3) Alerts entschärfen
- `detectRelevantModelAlerts`:
  - Relevance-Gate anheben: **Baseline (Lifetime) ≥ 5 €/Tag UND letzte 30 T Gesamtumsatz ≥ 150 €**.
  - Für Alert 1 ("Seit Wechsel im Rückgang"): **absolute** Schwellen zusätzlich zu %: `previousPhase.avgPerDay ≥ 20 €` und `currentPhase.avgPerDay < previousPhase.avgPerDay − 10 €`. Kein Alert für Mini-Beträge.
  - Für Alert 2 ("7T unter 30T-Schnitt"): Vergleich statt 30-T-Schnitt gegen **Lifetime-Baseline**, Mindest-Baseline **≥ 10 €/Tag**.
  - Alert-Text zeigt konkret "Lifetime Ø X €/Tag → aktuell Y €/Tag (−Z %)".

### 4) Mehr Models in der Kategorie sichtbar
- Bucket-Logik (`model-tracking-buckets.ts`) bleibt strukturell, aber:
  - Alle Models, die den Relevanz-Filter nicht schaffen (`baselineAvg ≤ 5 €/Tag` oder zu wenig Daten), landen in einem neuen Bucket **"Zu wenig Signal"** unter `flat`, statt aus Versehen als "down" oder "up" zu erscheinen.
  - Das entlastet die Rückgangs-Kategorie visuell und macht Wachstum/Stabil klarer.
- Damit werden in `TrendSummary` und den Kacheln endlich alle Models sichtbar zugeordnet — nicht mehr das Gefühl, dass die Kategorie leer ist.

## Betroffene Dateien

- `src/lib/model-tracking-overview.ts` — Trend-Umbau, Relevanz-Konstante, Alert-Schwellen.
- `src/lib/model-tracking-buckets.ts` — neuer "Zu wenig Signal"-Bucket, Filter respektieren.
- `src/components/today/ModelTrackingView.tsx` — nur kleine Anpassung: neuen Bucket rendern, Alert-Text-Format übernehmen, `TopUnderperformers` Filter mit Mindest-Baseline.

## Was nicht geändert wird

- Layout, Farb-System, Filter-Chips, Label-System, Detail-Slideover — alles bleibt.
- Andere Tabs (Live, Ziele, Push …) sind nicht betroffen.
- Keine DB-Migration nötig.

## Ergebnis für dich

- "Model X ist zu 100 % im Rückgang" auf Basis eines 5-€-Ausreißers → weg.
- Warnung nur wenn: Model macht lifetime ≥ 5 €/Tag **und** hat aktuell einen echten Einbruch gegen die eigene komplette Historie.
- Model-Kategorie zeigt alle Models, korrekt in Wachstum / Stabil / Rückgang / Zu wenig Signal einsortiert.
