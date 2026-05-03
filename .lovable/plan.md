# Model Performance Tracking

Ziel: Jedes Model soll eine fortlaufende Umsatz-Historie haben, die zeigt **wann welcher Chatter dran war** und **wie sich der Umsatz dadurch verändert hat**. Damit erkennst du sofort: "Model X lief unter Chatter A super, ist seit Wechsel zu Chatter B am absaufen."

## Wo das landet

Neuer Tab **"Performance"** auf der `/models` Seite (zusätzlich zur bestehenden Liste). Dazu pro Model-Karte eine kleine Trend-Mini-Anzeige + Klick öffnet Detail-Slide-Over.

## Was du siehst

### 1. Model-Liste mit Trend-Indikator (Übersicht)
Pro Model-Karte zusätzlich:
- **Trend-Badge**: ↑ Steigend / → Stabil / ↓ Fallend (basiert auf letzte 7T vs. davor 7T)
- **Aktueller Chatter** + seit wann er das Model hat
- **Status-Dot**: Grün (läuft besser als Vorgänger), Rot (läuft schlechter), Grau (erster Chatter / neutral)

### 2. Detail-Ansicht pro Model (Slide-Over bei Klick)

**a) Revenue-Timeline (Chart)**
- Linien-Chart: täglicher Umsatz über Zeitraum (7T/14T/30T/90T/Custom)
- Farbige Hintergrund-Bänder markieren, welcher Chatter wann dran war
- Vertikale Linien an Chatter-Wechsel-Tagen mit Label "→ Wechsel zu [Name]"

**b) Chatter-History-Tabelle** (alle Chatter die das Model je hatten)
| Chatter | Zeitraum | Tage | Ø Umsatz/Tag | Gesamtumsatz | vs. Vorgänger |
|---|---|---|---|---|---|
| Lisa | 12.04 – heute | 21 | 142 € | 2.982 € | −18 % |
| Max  | 01.03 – 11.04 | 42 | 173 € | 7.266 € | +24 % |
| Tom  | 15.01 – 28.02 | 45 | 139 € | 6.255 € | — (erster) |

**c) Krisen-Alarm** (oben prominent wenn zutreffend)
- "🔻 Seit Wechsel zu [Chatter] vor X Tagen: −Y % Umsatz vs. vorherige Periode"
- "📉 Letzte 7 Tage deutlich unter eigenem 30T-Schnitt"

### 3. Globaler "Models in Trouble"-Block (oben auf Performance-Tab)
Liste aller Models, bei denen mind. einer dieser Trigger feuert:
- Aktueller Chatter macht ≥20 % weniger als letzter Vorgänger (gleicher Vergleichszeitraum)
- Letzte 7T unter 60 % des 30T-Schnitts des Models
- 3+ Tage in Folge Umsatz = 0 obwohl davor regelmäßig Umsatz lief

So siehst du ohne klicken sofort, wo du eingreifen musst.

## Technische Umsetzung

### Datenquelle
Alles existiert bereits in `chatter_history` (account, chatter_name, revenue_today, analysis_date). Keine neue Tabelle nötig. Wir leiten "Chatter-Wechsel" aus den Daten ab: pro Model die Tage gruppieren, jeder Chatter-Name = eine "Phase".

### Gewichtete Aufteilung
Wiederverwenden der Logik aus `src/lib/model-performance.ts` (Umsatz wird gewichtet aufgeteilt wenn ein Chatter mehrere Accounts gleichzeitig hatte). Für die Timeline: pro Tag pro Model den gewichteten Anteil berechnen.

### Neue Files
- `src/lib/model-tracking.ts` — Funktionen:
  - `loadModelTimeline(platform, modelName, fromDate, toDate)` → tägliche Datenpunkte mit Chatter-Zuordnung
  - `loadModelChatterPhases(platform, modelName)` → Phasen pro Chatter mit Aggregaten
  - `detectModelTroubles(platform, allModels)` → Liste der Krisen-Models
- `src/components/ModelPerformanceSlideOver.tsx` — Detail-Ansicht (Chart + Tabelle + Alarm)
- `src/components/ModelsInTroubleCard.tsx` — Block oben

### Modifikationen
- `src/pages/Models.tsx`: Tabs ("Übersicht" / "Performance") einbauen, Trend-Badge + Status-Dot in bestehende Karten, Klick öffnet Slide-Over.

### Chart
Recharts `LineChart` (bereits via shadcn `chart.tsx` verfügbar) mit `ReferenceArea` für Chatter-Phasen-Bänder und `ReferenceLine` für Wechsel-Tage.

### Zeitraumfilter
Wiederverwendung von `TimeRangeToggle` mit Optionen 7T / 14T / 30T / 90T / Custom (entspricht Memory-Regel).

## Was nicht passiert
- Keine DB-Änderungen
- Keine Edge-Function (alles client-side aus vorhandenen Daten)
- Keine Änderung an Upload/Pipeline

Sag Bescheid wenn du loslegen sollen oder etwas anders haben willst (z.B. Performance-Block direkt aufs Dashboard statt in `/models`).