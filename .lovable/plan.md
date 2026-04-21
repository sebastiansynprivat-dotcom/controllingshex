

# Premium-Polish für den Swipe-Mode

Ziel: Das Swipe-Erlebnis unter `/tinder` soll sich noch smoother anfühlen (Gesten, Übergänge zwischen Karten) und visuell auf dasselbe Premium-Niveau wie die Forecast-Karten gehoben werden — ohne die feste 120px-Swipe-Schwelle anzutasten (Memory-Constraint) und ohne Logik-Änderungen.

## Was sich ändert (haptisch / Handling)

**Smoother Gesten**
- Drag-Physik entspannter: `dragElastic` von 0.2 → 0.32, sodass die Karte beim Ziehen weicher mitwippt statt hart zu enden
- Spring-Snapback feiner abgestimmt (`stiffness: 320, damping: 32, mass: 0.8`) — fühlt sich „teurer" an, weniger digital-zackig
- Rotation-Mapping sanfter: `[-200, 200] → [-12°, 12°]` statt 15° (weniger nervös bei kleinen Bewegungen)
- `whileDrag`-Scale von 1.02 → 1.035 + leichter `boxShadow`-Lift, damit die Karte beim Greifen physisch „abhebt"
- Edge-Glows reagieren früher und smoother (Mapping `[0, 100]` statt `[0, 140]`) → unmittelbares visuelles Feedback während der Bewegung
- Fly-off-Animation beim Right-Swipe mit `cubic-bezier(0.32, 0, 0.67, 0)` statt `easeIn` → fühlt sich beschleunigend an wie iOS-Karten-Dismiss

**Übergang zur nächsten Karte**
- Neue Top-Card faded + skaliert sanft hoch (von 0.96 → 1, Opacity 0 → 1) statt einfach „da zu sein" — Stagger 80ms nach Fly-off der vorigen Karte
- Hintere Stack-Karten werden wieder leicht sichtbar (statt komplett opacity:0): Karte #2 mit `scale: 0.95, opacity: 0.4, y: 8` als Tiefen-Hint → echtes „Stapel-Gefühl" statt einer einsamen Karte
- Beim Drag der Top-Card skaliert die zweite Karte synchron leicht hoch (parallax-artig)

**Mikro-Polish**
- Tap-Feedback: kurzer `scale(0.99)`-Pulse beim Single-Tap (160ms)
- Haptische Vibration beim Überschreiten der 120px-Schwelle (in `handleDrag`) — User spürt physisch, dass jetzt losgelassen werden kann (statt erst nach dem Loslassen)
- Edge-Glow-Labels (`✓ OK`, `✗ Aktion`, `↑ Details`, `↓ Skip`) bekommen eine sanfte Scale-Up-Animation ab 60% Drag-Distance (akustisch-visueller „Lock-in"-Moment)

## Was sich ändert (visuell)

**Karten-Material**
- Stack-Hintergrund-Gradient kräftiger schichten: zusätzliche Highlight-Linie oben (1px-Lichtkante via `::before` wie bei `.premium-card`) → echte Glas-Materialität
- Aktiver Border-Glow in Kategorie-Farbe verstärkt (`hsl(${accent.hue} / 0.18)` → `0.28`) für mehr Tiefe
- Top-Accent-Linie wird zu einem feinen Verlauf mit zusätzlichem Innen-Glow (statt nur 1px hairline)

**Hero-KPI**
- Hintergrund-Sweep (Shine) deutlich subtiler und nur alle 12s statt 7s — weniger ablenkend, mehr „Premium-Detail"
- Zahl in `font-extralight` mit feinem `tracking-tighter` (wie Forecast-KPIs) statt `font-bold` → eleganter
- Optionaler Gold-Gradient-Text bei Top-Werten

**Avatar & Badges**
- Avatar bekommt subtilen Inset-Highlight (1px oben weiß/8%) + verstärkten Akzent-Glow
- Category-Badge oben links wird zu echtem „Chip" mit Inset-Shadow + Outline-Glow (analog `.premium-chip` aus der Forecast-Polish)

**KPI-Grid**
- 4 KPI-Tiles nutzen `.premium-stat`-Style (Gradient + 1px-Highlight) statt flachem `bg-white/[0.025]`
- Hover/Active-Subtle-Highlight bei Tap

**Severity-Pulse**
- Critical-Pulse atmet smoother (3.4s statt 2.8s) und mit weicherer Easing-Kurve — weniger „alarm", mehr „aufmerksam"

## Technisch

**Editierte Dateien**
- `src/components/SwipeCard.tsx` — alle Anpassungen oben (Drag-Physik, Übergänge, Material, Stack-Sichtbarkeit, Threshold-Haptic)
- `src/pages/TinderMode.tsx` — minimal: AnimatePresence-`mode` und Initial-/Exit-Varianten für die neue Karten-Übergangs-Animation; Stack-Index-Logik anpassen, sodass zweite Karte sichtbar bleibt
- ggf. kleiner Helper in `SwipeCard.tsx` für `useTransform`-basierten Threshold-Trigger (Haptic bei x=120 Crossing)

**Was nicht passiert (wichtig)**
- Keine velocity-basierten Swipe-Schwellen (Memory-Constraint bleibt: feste 120px)
- Keine Logik-Änderung an Swipe-Aktionen (Right/Left/Up/Down-Handler bleiben 1:1)
- Keine neue Lib, kein neues Dependency (`framer-motion` ist schon da)
- Keine Performance-Regression (alle Animationen via Transform/Opacity, GPU-beschleunigt)
- Keine Änderungen am Action-Panel, Slide-Over oder Login-Picker

