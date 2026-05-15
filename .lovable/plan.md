## Problem
Recovery-Karten zeigen „Ø X €/Tag", aber der Wert ist der **Median nur über aktive Tage** (Tage mit Umsatz > 0). Beispiel Bianka BA: Tagesschnitt gefühlt ~20 €, Card zeigt 32 € — weil Null-Tage ignoriert werden. Mathematisch sinnvoll für Recovery-Erkennung, Wording aber irreführend.

## Fix
Wording in Recovery-Cards anpassen, damit klar wird, dass es der Median über **aktive Tage** ist. Logik bleibt unverändert.

### Änderungen in `src/lib/revenue-tasks.ts` (Recovery-`why`-Text, ~Zeile 376)

Vorher:
```
Ø 32/Tag aktuell vs. Ø 18/Tag Median (30T). …
```

Nachher:
```
Aktive-Tage-Median 32 €/Tag (30T) vs. zuletzt 18 €/Tag. …
```

Konkret: in der `why`-Zeile der Recovery-Tasks
- `currentAvg` → Label „zuletzt" (Schnitt der letzten 3 Tage)
- `baseline` → Label „Aktive-Tage-Median (30T)"
- Kein „Ø" mehr für Median-Werte

### Optional: gleiche Korrektur in PersonActionCard

Prüfen, ob `PersonActionCard` / Today-Engine ebenfalls „Ø" für `medianRevenue` nutzt (Zeilen 396, 442, 769 in `today-engine.ts`) — dort identisch umformulieren („Median aktiver Tage" statt „Ø"), damit die ganze Today-Ansicht konsistent ist.

## Nicht geändert
- Recovery-Berechnung (Median nonZero, gap × 7 × confidence) bleibt
- Reihenfolge / Scoring / Filterung bleibt
- Keine DB-Änderungen