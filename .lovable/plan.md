

## Tinder Mode für Chatter-Controlling

Eine neue Seite/Modus, in der du alle Chatter als Karten-Stack siehst und per Swipe (oder Buttons auf Desktop) schnell durchgehst.

---

### So funktioniert's

```text
┌─────────────────────────┐
│   🔵 ONBOARDING TAG 3   │
│                         │
│     chatter_name        │
│   Revenue: 45,00 €      │
│   MassDMs: 120          │
│   Delay: 0 Tage         │
│                         │
│   "Guter Start, weiter  │
│    so monitoren"        │
│                         │
└─────────────────────────┘
  ← AKTION NÖTIG    OK ✓ →
```

- **Swipe rechts (oder ✓ Button)** → Chatter als "gecheckt" markieren, nächste Karte
- **Swipe links (oder ✗ Button)** → Öffnet kurzes Action-Panel: Notiz schreiben, Label setzen, oder "Coaching nötig" markieren
- **Swipe nach oben** → Öffnet das volle ChatterSlideOver mit History/Charts
- Fortschrittsbalken oben: "12/34 Chatter gecheckt"

### Karten-Inhalt (pro Chatter)
- Kategorie-Emoji + Name
- Alle KPIs aus dem aktuellen Report
- Recommendation-Text
- Mini-Sparkline (Revenue der letzten 7 Tage aus `chatter_history`)

---

### Technische Umsetzung

**Neue Dateien:**
1. **`src/pages/TinderMode.tsx`** — Hauptseite mit Swipe-Karten-Stack. Nutzt `framer-motion` für drag/swipe-Gesten (`drag="x"`, `onDragEnd` → Richtung erkennen). Lädt Daten aus dem aktuellsten `analysis_reports` Report (gleiche Query wie Dashboard).

2. **`src/components/SwipeCard.tsx`** — Einzelne Chatter-Karte mit allen KPIs, Recommendation, Mini-Chart. Framer-motion `motion.div` mit `drag`, `dragConstraints`, Rotation bei Drag, farbiges Overlay (grün rechts, rot links).

3. **`src/components/SwipeActionPanel.tsx`** — Slide-up Panel bei Links-Swipe: Schnell-Notiz eingeben, Label wählen, speichern → `coaching_notes` / `chatter_labels`.

**Geänderte Dateien:**
4. **`src/App.tsx`** — Neue Route `/tinder` hinzufügen
5. **`src/components/AppSidebar.tsx`** — Neuer Nav-Link "Tinder Mode" mit passendem Icon

**Dependencies:** Keine neuen — `framer-motion` ist bereits installiert und bietet `drag`, `useMotionValue`, `useTransform` für die Swipe-Mechanik.

**Mobile-optimiert:** Touch-Swipe funktioniert nativ über framer-motion drag. Desktop bekommt zusätzlich Buttons und Keyboard-Shortcuts (←/→/↑).

