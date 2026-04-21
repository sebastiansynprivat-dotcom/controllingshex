

# Premium-Polish für die Frühwarnungs-Karten

Ziel: Alle Karten unter `/forecast` (Frühwarnung, Abwesenheit, Smart-Modell, Treffer-Quote) sollen sich optisch und haptisch wie eine echte Premium-Software anfühlen — nicht wie ein Standard-Tailwind-Dashboard. Es geht um Tiefe, Materialität, Mikro-Animationen und subtile Gold-Akzente, die bereits im Design-System (`index.css` → `glass-card`, `gold-glow`, `bg-depth`) angelegt aber bisher nicht genutzt werden.

## Was sich ändert (visuell)

**Tiefe & Material**
- Karten bekommen echte Glass-Optik: `backdrop-blur(32px)` + dezenter Innen-Glow + 1px-Highlight oben (simuliert Lichtkante)
- Statt flachem `bg-white/[0.02]` → **Gradient-Layer**: oben heller, unten tiefer schwarz (verleiht physikalisches Gewicht)
- Kritische/Akute Karten bekommen einen sanft pulsierenden Rand-Glow in der jeweiligen Band-Farbe (rot/orange) — kein hektisches Blinken, sondern atmend (3s)

**Hierarchie**
- Score-Badges (`RiskBadge`, Abwesenheits-%) werden zu echten "Chips" mit Tiefe: Inset-Shadow + Outline-Glow in Bandfarbe statt flacher Border
- Sparklines bekommen einen weichen Verlauf (Fill unter der Linie mit 8 % Opacity in Bandfarbe) statt nur 1.5px Stroke
- Tabellen-Header (`uppercase`-Labels) in Gold-Subtle statt Weiß-70

**Hover & Mikro-Interaktion**
- Karten heben sich beim Hover leicht an: `translateY(-1px)` + verstärkter Glow + Border-Color geht 200 ms zur Bandfarbe
- Klick auf Karte: kurzer Scale-Pulse (0.98 → 1) als haptisches Feedback (160 ms, ease-out)
- Chevron rotiert mit `cubic-bezier(0.16, 1, 0.3, 1)` statt linear → fühlt sich teurer an
- Expand-Bereich (Signal-Breakdown) faltet sich mit `framer-motion` `AnimatePresence` smooth auf — heute springt er einfach rein
- Signal-Pills im aufgeklappten Bereich: Stagger-Animation (jede Pill fadet 30 ms versetzt ein)

**Premium-Details**
- Tabs (Frühwarnung / Abwesenheit / Smart-Modell / Treffer-Quote): aktiver Tab bekommt Gold-Underline statt graues Background — wie iOS Settings
- KPI-Stat-Karten (Vorhersagen / Treffer / Trefferquote): Zahlen in `font-extralight` mit leichtem Gold-Gradient-Text bei "Trefferquote", Icon oben rechts in Glas-Pill
- Presence-Strip (21-Tage-Anwesenheit): aus harten Blöcken werden abgerundete "Pillen" mit dezentem Gradient (anwesend = emerald-Verlauf, Aussetzer = matte schwarze Glaspille)
- Live-Predictions / Backtest-Listen: Zeilen bekommen Hover-State mit Gold-Akzent-Linie links (3px, scale-y 0 → 1)
- ML-Weight-Bars: aus flachem `bg-orange-400/70` wird ein Gradient (orange-400 → orange-500) mit 12 % Glow rechts vom Bar-Ende

**Loading-State**
- Spinner ersetzt durch ein dezentes 3-Punkt-Pulsing (Apple-Style) in Gold
- Skeleton-Karten beim ersten Lade-Vorgang statt leerer Spinner-Fläche → fühlt sich sofort lebendig an

## Technisch

**Neue Tailwind-Utilities** in `src/index.css`:
- `.premium-card` — Glas-Layer + oberes 1px-Highlight + sanfter Inset-Shadow
- `.premium-card-hover` — `translateY(-1px) + box-shadow` Übergang
- `.glow-band-{critical,warning,low,...}` — atmender Rand-Glow per `@keyframes`
- `.gold-underline` — Tab-Active-Indicator
- `@keyframes breathe` — 3s ease-in-out infinite für die Glow-Pulse

**Editierte Dateien**:
- `src/index.css` — neue Utilities + Keyframes (`breathe`, `gold-underline-grow`, `pulse-dot`)
- `src/components/RiskBadge.tsx` — Inset-Shadow, Bandfarben-Glow, optional `pulse` für critical
- `src/components/AbsencePanel.tsx` — Premium-Karten, neue Presence-Pillen, Stagger-Expand, KPI-Karten mit Gradient-Zahlen
- `src/components/MLForecastPanel.tsx` — Premium-StatCards, Weight-Bar-Gradient, Tabellen-Hover-Akzent
- `src/pages/Forecast.tsx` — Premium-Karten in Risk-Liste, Tab-Underline-Style, Sparkline mit Fill, AnimatePresence für Expand, Stat-Banner mit Gold-Gradient
- Sparkline-Komponente um optionales `<linearGradient>` + `<polygon>`-Fill ergänzen

**Was nicht passiert**
- Keine Logik-Änderung (Risk-Engine, ML, Abwesenheits-Forecast bleiben 1:1)
- Keine neuen Datenfelder, keine DB-Migration
- Keine Performance-Regression (alle Animationen via CSS-Transform / Opacity → GPU-beschleunigt)
- Keine erhöhte Render-Komplexität (`framer-motion` ist schon im Projekt)

