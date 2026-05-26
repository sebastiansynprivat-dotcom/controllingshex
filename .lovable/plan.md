## Ziel

Im "Models im Rückgang"-Sheet pro Tag zusätzlich zur Anzahl die prozentuale Veränderung zum Vortag anzeigen (↑/↓/=), farblich kodiert.

## Änderungen

**Datei:** `src/components/today/TrendCategoryDetailSheet.tsx`

1. `aggregated`-useMemo erweitern um `deltaPct: number | null` pro Tag (Tag 1 = null, sonst `((count - prev)/prev)*100`, gerundet; prev=0 & count>0 → als "neu" markiert).

2. Tooltip ergänzen: zeigt zusätzlich "± X % ggü. Vortag", farbig (rot wenn Rückgang-Anzahl steigt, grün wenn sie sinkt — invers bei "aktiv"-Variante).

3. Neue Tages-Strip-Komponente unterhalb des Charts: kleine Pills (eine pro Tag) mit ▲/▼/–, %-Wert und Datum. Horizontal scrollbar bei langem Zeitraum.

4. Farb-Logik direction-aware: bei `direction === "down"` ist Anstieg = rot, Abfall = grün; sonst umgekehrt.

5. Tag 1 / Edge Cases: bei < 2 Datenpunkten Strip ausblenden, weiterhin "Zu wenig Datenpunkte"-Fallback.

## Nicht Teil

- Keine DB-Änderungen.
- Keine Änderungen an `aggregateModelsInDeclineDaily` — Delta nur im Component.
