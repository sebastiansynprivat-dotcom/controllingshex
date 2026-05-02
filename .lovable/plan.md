# Auffälligkeiten-Karten: All-Time vs. Zeitraum-Vergleich

Im aktuellen Zahlen-Trio jeder Listenkarte (`AnomalyPanel.tsx`) steht:
`Ø €/Tag` (Zeitraum) · `vs. Vorperiode (%)` · `0€-Tage`.

Ziel: Den Vergleich auf **All-Time** umstellen, damit man sofort sieht, wie stark der aktuell gewählte Zeitraum vom langfristigen Niveau abweicht.

## Neue Karten-Struktur (3 Spalten)

```text
| Ø €/Tag (All-Time) | Ø €/Tag (Zeitraum)  | Abfall %       |
|  124 €             |  48 €               |  −61 %         |
|  alle Reports      |  letzte 7 Tage      |  vs. All-Time  |
```

- **Spalte 1 — All-Time Ø/Tag**: Summe aller `revenue_today` aus `chatter_history` für diesen Chatter (gesamte Workspace-Historie), geteilt durch Anzahl Tage mit Eintrag. Wert ist unabhängig vom Filter und ändert sich nicht beim Umschalten.
- **Spalte 2 — Zeitraum Ø/Tag**: Bisheriger `currentAvg` (Summe im aktuell gewählten Range / Tage).
- **Spalte 3 — Abfall %**: `(zeitraumAvg − allTimeAvg) / allTimeAvg × 100`. Farbcodes wie bisher: <−10% rot, <0% amber, ≥0% grün. Tooltip zeigt beide Rohwerte und den Zeitraum.

Die `0€-Tage`-Info wandert in einen kleinen Footer-Chip oder Tooltip auf Spalte 2 — bleibt sichtbar, blockiert aber keine Spalte mehr.

## Implementierung

**Datenladen** (`AnomalyPanel.tsx`, Block ab Zeile ~155):
- Neue Supabase-Query parallel zu den bestehenden:
  ```ts
  supabase.from("chatter_history")
    .select("chatter_name, revenue_today, analysis_date")
    .eq("user_id", user.id).eq("platform", platform)
    .limit(50000)
  ```
- Aggregation analog zu `prevAgg`: `Map<chatter, { sum, days }>` → `allTimeAvg`-Map.
- Im `Snapshot`-Type + sessionStorage-Cache neues Feld `allTimeAvg: [string, number][]` ergänzen.

**Render-Logik** (Block ab Zeile ~681):
- `const allTimeAvg = allTimeAvgMap.get(group.name) ?? 0;`
- `const dropPct = allTimeAvg > 0 ? Math.round(((currentAvg - allTimeAvg) / allTimeAvg) * 100) : null;`
- `prevWindowAvg` + `prevPeriodLabel/Tooltip` bleiben im Code (für ggf. spätere Re-Use), werden in der UI aber durch den All-Time-Vergleich ersetzt.

**JSX** (Zeilen ~813–845): Die drei `<div>`-Spalten werden ausgetauscht gegen All-Time / Zeitraum / Drop%. Tooltip auf der Drop-Spalte: „Ø {currentAvg}€/Tag im Zeitraum {rangeLabel} vs. Ø {allTimeAvg}€/Tag über alle bisherigen Reports".

## Außer Reichweite

- Detail-Modal bleibt unverändert.
- Sortier-Reihenfolge der Liste bleibt (weiterhin nach `impactPerDay`).
- `prevWindowAvg`-Query bleibt vorerst im Code, wird nur nicht mehr angezeigt — falls du Vorperiode später zurück willst, ist's ein One-Liner.