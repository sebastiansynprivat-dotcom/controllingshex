# Drag-to-Scroll für Filter-Leiste (Heute-Tab)

## Ziel
Die horizontale Filter-Leiste im Heute-Tab (`src/pages/Today.tsx`, Zeile ~646) soll am Desktop mit gedrückter Maus „gegrabbt" und gescrollt werden können — mit weichem Momentum-Auslauf und magnetischem Einrasten auf den nächstgelegenen Filter-Chip, damit es sich premium anfühlt.

## Umsetzung

1. **Neuer Hook** `src/hooks/use-drag-scroll.ts`
   - Bindet `pointerdown` / `pointermove` / `pointerup` an einen Ref-Container.
   - Aktiv nur bei `pointerType === "mouse"` (Touch nutzt natives Scrollen weiter).
   - Während Drag: `scrollLeft -= deltaX`, Cursor `grabbing`, Text-Selektion unterdrückt, Klicks ab >4px Bewegung blockiert (capture-Phase `click`-Handler), damit ein Filter nicht versehentlich aktiviert wird.
   - Beim Loslassen: Momentum via `requestAnimationFrame` (exponentielles Decay), danach **Snap** auf den horizontal nächstgelegenen Kind-Knoten mit `data-snap="true"` per `scrollTo({ left, behavior: "smooth" })`.

2. **Integration in `src/pages/Today.tsx`**
   - Hook auf den vorhandenen Scroll-Container in Zeile ~646 anwenden.
   - Jeder Filter-Chip-Button bekommt `data-snap="true"` (kein Stil-Eingriff, nur Marker).
   - `cursor-grab` Klasse am Container; während Drag wechselt der Hook auf `grabbing`.
   - Bestehendes `snap-x snap-proximity` bleibt — der JS-Snap übersteuert nur beim Loslassen nach Drag.

3. **Keine Änderungen** an Touch-Verhalten, Layout, Farben oder bestehender Filter-Logik.

## Technische Details
- Hook gibt `{ ref, isDragging }` zurück; `ref` wird zusätzlich zu evtl. vorhandenem Container-Ref via `useCallback`-Merge gesetzt (oder direkt verwendet, falls aktuell kein Ref existiert).
- Momentum-Decay: `velocity *= 0.92` pro Frame, Abbruch bei `|v| < 0.4 px/frame`.
- Snap-Auswahl: Mittelpunkt des Containers vs. Mittelpunkte der `data-snap`-Kinder, minimale Distanz gewinnt.
- Click-Suppression: nach `pointerup` mit Bewegung >4px einmaliger `click`-Listener im Capture stoppt das nächste Klick-Event.
