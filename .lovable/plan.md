# Nachrichten-Tab: Suche + Fit-Analyse

Ziel: Auf einen Blick erkennen, welcher Chatter gut platziert ist und wer nicht — plus schnell nach Namen filtern.

## 1. Suchfeld nach Chatter-Name
- Schlankes Input-Feld oben, links neben den Sort-Controls
- Filtert die Liste live beim Tippen (case-insensitive, matched auf `chatter_name`)
- Kleines "×" zum Zurücksetzen wenn Text drin steht
- Ergebniszähler unauffällig rechts ("3 von 12")

## 2. Über-/Unterlast-Marker + Sparkline
Direkt in jeder Zeile sichtbar, kein Klick nötig:

- **Marker-Chip** links neben dem Namen:
  - `ÜBERLASTET` (rose) — Volumen im obersten Drittel, aber €/Msg im untersten Drittel → zu viele Accounts, Qualität leidet
  - `UNTERAUSGELASTET` (amber) — Volumen im untersten Drittel, aber €/Msg im obersten Drittel → hat Kapazität für mehr Accounts
  - `PASST` (dezent grün) — Volumen und €/Msg im mittleren/oberen Bereich, konsistent
  - kein Chip wenn nicht genug Datenlage
- **Sparkline** (7-Tage-Trend) rechts neben der Progress-Bar:
  - Zeigt Verlauf von `€/Msg` pro Tag
  - Farbe folgt dem Marker-Tone (rose/amber/emerald/neutral)
  - Kompakt (~60×20px), damit die Zeile ruhig bleibt

Datenquelle: aggregiert aus `chatter_incoming_stats` über die letzten 7 Tage pro Chatter.

## 3. Ausklappbare Modell-Aufteilung
- Ganze Zeile wird klickbar → sanftes Ausklappen nach unten
- Zeigt: welche Modelle der Chatter im gewählten Zeitraum bearbeitet hat, mit
  - Modell-Name
  - Anteil an seinem Volumen (%)
  - €/Msg pro Modell
  - Mini-Ampel pro Modell (grün/amber/rose vs. seinem eigenen Schnitt)
- Verrät konkret welche Modell↔Chatter-Zuordnung schlecht performt
- Datenquelle: `chatter_history` gefiltert auf `chatter_name` + Datumsrange, gruppiert nach `model_name`

## Reihenfolge im Layout (pro Zeile)
```text
[#Rank] [Marker] [Name]              [~msg count]
[============ progress bar ============]  [sparkline]
[€/msg]  [Umsatz]                    [aktiv vor Xmin]
  ↓ klick → aufgeklappt: Modell-Liste
```

## Technische Details

- **Suche**: reiner Frontend-Filter über `sorted`-Array in `Messages.tsx` — kein neuer Fetch
- **Über-/Unterlast-Berechnung**: Perzentile (33./66.) über die aktuell geladenen Rows für Volumen und €/Msg → Bucket-Zuordnung. Nur wenn `incoming_count ≥ 10` im Zeitraum, sonst kein Marker (zu wenig Daten)
- **Sparkline-Daten**: neuer Aggregat-Query beim Load, gruppiert nach `date` und `chatter_name`, mappt in `{date, eurPerMsg}[]` pro Chatter. Als kleine SVG-Line, keine Chart-Library nötig
- **Modell-Split (ausklappen)**: lazy — erst bei erstem Öffnen einer Zeile aus `chatter_history` nachladen und pro Chatter cachen. Vermeidet Extra-Payload beim initialen Load
- **Kein neues Schema**, keine Migrationen — alles rein aus vorhandenen Tabellen (`chatter_incoming_stats`, `chatter_history`)
- **Styling** bleibt in bestehendem Dark-Premium-Look: dünne Borders, `font-light`, `tabular-nums`, Emerald/Amber/Rose-Töne konsistent zur bestehenden €/Msg-Färbung

## Nicht Teil dieses Plans
- Peer-Vergleich-Badges (`+34% vs. Peer`) — auf später verschoben
- Gruppierung in Sektionen — Liste bleibt eine durchgehende Rangliste
