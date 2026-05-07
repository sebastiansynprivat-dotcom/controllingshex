## Ziel
Das "Potenzial" oben in der To-Do-Liste soll realistisch zeigen, **was am ganzen Tag möglich wäre, wenn alle Chatter aus der Liste normal online wären** — nicht nur die aktuell schon entstandene Lücke bis jetzt.

## Aktuelles Verhalten (Problem)
`impactEur` pro Eintrag ist gemischt:
- `inactive_push`: `avgRev` (ganzer Tag) — okay
- `weak_pacing`, `pause_long`: `lostRevenue` — nur Rückstand **bis jetzt** (zeitanteilig über `dayProgress`)
- `dms_low_rev_low`: `avgRev - today` — nur was bis jetzt fehlt
- `chats_pile`: heuristischer Wert, nicht Tages-Potenzial
- `praise`: Surplus, zählt fälschlich ins "Potenzial"

→ Summe oben ist deutlich zu klein und inkonsistent (Mix aus "bis jetzt" und "ganzer Tag").

## Änderung

**1. Neues Feld `dayPotentialEur` pro Todo-Eintrag** = realistisch erreichbares €-Volumen für den **ganzen Schicht-Tag**, wenn der Chatter ab jetzt normal weiterarbeitet:

- `inactive_push`: `avgRev` (kompletter Tagesschnitt)
- `pause_long` / `weak_pacing` / `dms_low_rev_low`:  
  `max(0, avgRev − today)` — was vom Tagesschnitt bis Tagesende noch fehlt
- `chats_pile`: `max(0, avgRev − today)` (gleiche Logik, gekappt)
- `praise`: `0` — Lob hat kein "fehlendes Potenzial"

**2. Top-Summe oben** zeigt `Σ dayPotentialEur` statt `impactEur`.  
Label-Update: **"Potenzial heute"** mit Subtext **"wenn alle bis Tagesende ihren Schnitt erreichen"**.

**3. Per-Row-Pill** rechts behält den €-Wert, zeigt aber ebenfalls `dayPotentialEur` (statt `impactEur`) — so ist's konsistent zur Top-Summe. Bei `praise` wird stattdessen ein dezenter "+X € über Schnitt"-Pill in Grün gezeigt.

**4. Sortierung innerhalb einer Kategorie** weiter nach `dayPotentialEur` (statt `impactEur`).

## Out of scope
- Keine Änderung an Kategorisierungs-Schwellen oder neuen Kategorien.
- Kein Eingriff in `live-activity.ts` oder `effort-potential.ts`.
- Kein Settings/Persistenz.

## Datei
- `src/pages/LiveTracking.tsx` — `TodoEntry` + `todoMap`-Builder + `TodoSections` Header & Pill.
