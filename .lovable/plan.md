

## Plan: Single-Tap → Name kopieren, Double-Tap → Details öffnen

### Aktuell
- Tap auf den **Namen** kopiert den Namen
- Swipe nach oben öffnet Details
- Kein Double-Tap

### Änderung in `src/components/SwipeCard.tsx`

1. **Double-Tap-Detection** auf der gesamten Karte einbauen:
   - `useRef` für den letzten Tap-Zeitstempel
   - Im `onClick`-Handler der Karte: Wenn der letzte Tap < 300ms her ist → `onSwipeUp()` (Details öffnen). Sonst → Timer starten, der nach 300ms den Namen kopiert (Single-Tap).
   - Bei Double-Tap den Single-Tap-Timer canceln (`clearTimeout`)

2. **Name-Kopieren vom `<h2>` auf die Karte verschieben**:
   - Der bisherige `onClick` auf dem Namen-Element wird entfernt
   - Stattdessen wird der Single-Tap auf der Karte den Namen kopieren + Toast zeigen

3. **Drag vs. Tap unterscheiden**:
   - Ein `isDraggingRef` trackt, ob ein Drag stattgefunden hat (setzen in `onDrag`, prüfen in `onClick`)
   - Nur wenn kein Drag → Tap-Logik ausführen

### Resultat
- **1x Tap** irgendwo auf die Karte → Name wird kopiert
- **2x schnell Tap** → Detailansicht öffnet sich
- **Swipe** bleibt unverändert (hoch/rechts/links/runter)

