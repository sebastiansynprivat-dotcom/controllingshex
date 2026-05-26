## Ziel

Die drei Übersichtskarten oben im Model-Tracking (**Wachstum**, **Stabil**, **Rückgang**) werden klickbar. Pro Karte öffnet sich ein Slide-Over/Modal mit:

1. **Aggregiertem Umsatzgraph** über den aktuell gewählten Zeitraum (alle Models dieser Kategorie zusammenaddiert pro Tag).
2. **Buckets nach Chatter-Alter** (alt = ≥ 30 Tage auf diesem Model, neu = < 30 Tage).
3. **Model-Liste pro Bucket** mit Mini-Sparkline, Chatter-Name, Umsatz und Trend-%.

## Bucket-Logik

Bezugspunkt = aktuelle Chatter-Phase des Models (letzte zusammenhängende Phase bis heute). Dauer wird aus den bestehenden Phasen in `model-tracking.ts` berechnet.

**Rückgang** (3 Buckets):
- **Alter Chatter** → aktuelle Phase ≥ 30 Tage. Echtes Coaching-Signal.
- **Neuer Chatter** → aktuelle Phase < 30 Tage. Einarbeitung, weniger dramatisch.
- **Wechsel hat nicht geholfen** → aktuelle Phase < 30 Tage UND vorherige Phase existiert UND Model fiel schon vorher. Wechsel war Reaktion auf Rückgang, hat aber nichts gebracht.

Ein Model landet in genau einem Bucket. Priorität: „Wechsel hat nicht geholfen" > „Neuer Chatter" > „Alter Chatter".

**Wachstum** (2 Buckets):
- **Alter Chatter zieht** → Phase ≥ 30 Tage. Konstante Leistung.
- **Neuer Chatter hebt das Model** → Phase < 30 Tage. Wechsel war gute Entscheidung.

**Stabil** (2 Buckets, gleiche Logik wie Wachstum):
- **Stabil unter altem Chatter**
- **Stabil unter neuem Chatter**

## UI / Interaktion

- `TrendSummary`-Karten bekommen `onClick` und werden zu `<button>` mit Hover-State.
- Neuer Slide-Over `TrendCategoryDetailSheet` (rechts, gleiche Optik wie `ModelPerformanceSlideOver`).
- Header: Kategoriename + Gesamtzahl + Gesamt-Umsatz im Zeitraum.
- **Graph**: aggregierter Tagesumsatz als Area/Line-Chart. Bei Rückgang in Rot, Stabil neutral, Wachstum grün (semantische Tokens).
- Darunter: Tabs/Akkordeons pro Bucket mit Header (Bucket-Name + Count + Bucket-Umsatz) und einer kompakten Liste der Models (Name, Chatter, Sparkline, Umsatz, Trend-%). Klick auf ein Model öffnet das bestehende `ModelPerformanceSlideOver`.
- Filter (Suche, Labels, TimeRange) aus dem Tracking-Tab werden respektiert — der Pop-Up nutzt dieselbe gefilterte Liste, die der Tab gerade anzeigt.

## Technische Umsetzung

**Neue Datei** `src/lib/model-tracking-buckets.ts`:
- `categorizeRowsByChatterAge(rows, currentPhaseByModel)` → liefert pro `TrendDirection` ein Array von Buckets `{ key, label, models }`.
- Benötigt aktuelle Chatter-Phase pro Model. Quelle: bereits in `ModelOverviewRow` vorhanden (`currentChatter`) — wir brauchen aber zusätzlich die **Dauer der aktuellen Phase**. Erweitern: `loadModelOverview` gibt `currentPhaseDays` und `hadPreviousPhase` mit zurück (kommt aus den daily-Daten, die schon geladen werden).
- `aggregateDaily(rows)` → addiert `daily[].revenue` pro Datum über alle übergebenen Models.

**Erweiterung** `src/lib/model-tracking-overview.ts`:
- `ModelOverviewRow` bekommt: `currentPhaseDays: number | null`, `previousPhaseExisted: boolean`, `previousPhaseTrendDown: boolean`.
- Berechnung in `loadModelOverview` aus den bereits durchlaufenen Phasen.

**Neue Komponente** `src/components/today/TrendCategoryDetailSheet.tsx`:
- Props: `open`, `onClose`, `direction: TrendDirection`, `models: ModelOverviewRow[]`, `range`, `platform`, `onSelectModel`.
- Recharts `AreaChart` für aggregierten Verlauf.
- Bucket-Sektionen via `categorizeRowsByChatterAge`.

**Änderungen** `src/components/today/ModelTrackingView.tsx`:
- `TrendSummary`-Items klickbar machen (`onClick(direction)`).
- State `detailDirection: TrendDirection | null`.
- Sheet rendern; übergebene Models = **gefilterte** Liste (`filtered`), damit Suche/Labels respektiert werden — aber nach `direction` zusätzlich gefiltert.

## Out of scope

- Keine neuen DB-Tabellen, keine Migration.
- Keine Änderung am Alerts-Tab — der bleibt wie er ist (eigener Workflow).
- Keine Persistenz der „neuer/alter Chatter"-Schwelle als User-Setting — fest 30 Tage.
