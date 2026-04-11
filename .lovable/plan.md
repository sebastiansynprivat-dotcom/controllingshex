

## Plan: Analyse-Vergleich & Zeitverlauf im Dashboard

### Was sich ändert

Oberhalb der Chatter-Karten kommt ein neuer Bereich mit zwei Funktionen:
1. **Analyse-Auswahl**: Dropdown, um zwischen vergangenen Analysen zu wechseln (nicht nur die letzte)
2. **Trend-Widget**: Kompakte Übersicht, wie sich Gesamtumsatz, Chatter-Anzahl und Warnungen über die letzten Analysen entwickelt haben — mit Mini-Sparklines

### Schritte

**1. Dashboard: Alle Analysen laden**
- Statt nur `limit(1)` werden alle Analysen für die Platform geladen (Datum + ID + `chatter_count`)
- Die neueste wird als Default angezeigt
- Ein `Select`-Dropdown zeigt alle verfügbaren Analysedaten zur Auswahl
- Bei Auswahl wird die jeweilige `result_json` nachgeladen

**2. Trend-Widget Komponente**
- Neue Komponente `src/components/TrendWidget.tsx`
- Zeigt 3-4 KPI-Karten nebeneinander (auf Mobile gestackt):
  - **Gesamt-Chatter** (Anzahl aus `chatter_count`)
  - **Warnungen** (Anzahl Chatters in Warn-Kategorien, berechnet aus `result_json`)
  - **0€-Accounts** (Anzahl aus 0€-Kategorien)
- Jede Karte zeigt den aktuellen Wert + Trend-Pfeil vs. vorherige Analyse
- Optional: Mini-Sparkline (via Recharts `<Sparkline>`) über die letzten 5-10 Analysen

**3. KPI-Extraktion aus result_json**
- Für jede gespeicherte Analyse werden die Aggregat-KPIs direkt aus den Kategorien im `result_json` berechnet (clientseitig)
- Keine DB-Änderung nötig — alles aus bestehenden Daten ableitbar

### Dateien

| Datei | Änderung |
|---|---|
| `src/pages/Dashboard.tsx` | Alle Analysen laden, Dropdown zur Auswahl, Trend-Widget einbinden |
| `src/components/TrendWidget.tsx` | Neu — KPI-Karten mit Trend-Pfeilen und optionalen Sparklines |

### Technische Details
- Recharts ist bereits installiert (via `chart.tsx`) — Sparklines nutzen `<LineChart>` mit minimaler Config
- Erste Query: `select id, analysis_date, chatter_count, result_json` für alle Reports der Platform
- Dropdown: `<Select>` mit Datum-Formatierung (`de-DE`)
- Trend-Berechnung: Vergleich aktuelle vs. vorherige Analyse (Delta + Pfeil)
- Mobile: KPI-Karten in 2x2 Grid, Dropdown volle Breite

