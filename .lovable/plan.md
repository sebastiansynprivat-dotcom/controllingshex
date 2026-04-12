

## Swipe Mode UI-Verbesserungen

### Zwei Änderungen:

**1. Label & Notizen als runde Buttons in der Action-Leiste**
Die Label- und Notizen-Buttons werden aus der separaten Zeile entfernt und stattdessen als runde Icon-Buttons (gleicher Stil wie Undo, Like, Dislike, Details) in die Hauptreihe integriert. Beim Klick fährt ein Panel von unten hoch (wie das bestehende SwipeActionPanel), statt sich inline aufzuklappen.

**2. Empfehlung auf der Karte nicht mehr abgeschnitten**
Die `line-clamp-3` Begrenzung auf der SwipeCard wird entfernt bzw. erweitert, und die Karte wird scrollbar gemacht, damit lange AI-Empfehlungen vollständig lesbar sind.

### Technische Umsetzung

**`src/pages/TinderMode.tsx`:**
- Label-Button (`Tag` Icon) und Notizen-Button (`StickyNote` Icon) als `h-10 w-10 rounded-full` Buttons links und rechts neben der bestehenden Action-Leiste platzieren (Undo | Label | ✗ | ↑ | ✓ | Notiz)
- Badge-Counter als kleines absolut positioniertes Element auf den Buttons
- Die inline-expandierenden Panels (AnimatePresence mit height-Animation) durch Bottom-Sheet-Panels ersetzen (gleicher Stil wie SwipeActionPanel — von unten einfahrend mit Overlay)

**`src/components/SwipeCard.tsx`:**
- `line-clamp-3` von der Empfehlung entfernen
- Die Karte mit `overflow-y-auto` versehen, damit bei langen Inhalten gescrollt werden kann (Touch-scroll muss vom Drag-Gesture getrennt bleiben)

