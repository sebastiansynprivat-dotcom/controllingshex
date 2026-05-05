## Ziel

In den Live-Karten klar zeigen, **wie lange der älteste Chat schon offen steht** (in Tagen und wenn Stunden dann die stunden Anzahl). Inaktiv-Filter bleibt strikt: jemand gilt nur als „inaktiv", wenn heute noch gar keine Aktivität (Umsatz, Mass-DM oder abgearbeitete Chats) erkannt wurde.

## Datenlage

`chatter_history_live.oldest_chat` ist die Anzahl Tage, die der älteste ungelesene Chat schon offen ist (aktuell bis zu 64 Tage). Wert wird vom Tracker geliefert.

## Änderungen

**Datei: `src/pages/LiveTracking.tsx**` (nur Karten-Renderer, keine Logik-Änderung)

1. Hourglass-Chip umbenennen — statt nur „64d" jetzt **„64d offen"**, damit die Bedeutung sofort klar ist.
2. Farbschwellen feiner stufen:
  - `≥7d` → rot (danger)
  - `≥3d` → amber (warn)
  - `≥1d` → blau/info
  - `<1d` oder fehlt → gedämpft
3. Chip nur einblenden, wenn `oldest_chat ≥ 1` (sonst kein Lärm).
4. Tooltip präzisieren: „Ältester ungelesener Chat".

## Bewusst unverändert

- `isActiveToday()` in `src/lib/live-activity.ts` bleibt wie es ist — Inaktiv = kein Umsatz, keine Mass-DM, kein Chat-Abbau.
- `oldest_chat` fließt **nicht** in die Aktiv-Bewertung ein, sonst würden Chatter mit alten Karteileichen fälschlich als „aktiv" markiert.
- Inaktiv-Bucket und Filter „Inaktiv" bleiben unangetastet.

## Aufwand

Eine kleine Änderung in einer Datei (~15 Zeilen).