## Ziel

Die Mobile-Erfahrung soll sich anfühlen wie eine Premium-iOS-App (Linear / Things 3 / Arc-Niveau) — ruhiger, präziser, hochwertiger. Aktuell ist die Basis schon sehr gut (Glass, Gold-Akzente, dezente Typo), aber es fehlen die Details, die "luxuriös" ausmachen: feinere Typografie, weichere Übergänge, taktiles Feedback, ein eigener Mobile-Header und ein richtiges Bottom-Navigation-Erlebnis.

## Was sich konkret ändert

### 1. Typografie-Upgrade (der größte sichtbare Hebel)
- **Display-Font** für Überschriften: `Fraunces` (variable serif) oder `Instrument Serif` als Headline-Font, Inter bleibt für Body. Das hebt sich sofort von "generischer SaaS-App" ab und wirkt editorial/luxuriös.
- Engere `letter-spacing` auf großen Headlines (-0.04em), `font-weight: 200` für Hero-Zahlen mit Tabular-Nums.
- Kleine Caps-Labels mit erhöhtem `letter-spacing` und Gold-Tönung für Sektions-Header.

### 2. Eigener Mobile-Header (statt aktuellem 56px Hamburger-Header)
- Größerer, transparenter Header mit Blur und feinem Gradient-Fade nach unten.
- Aktueller Seitenname als großer Titel (Apple "Large Title"-Stil) der beim Scrollen elegant zur Toolbar zusammenschrumpft.
- Plattform-Switcher (OnlyFans / Fansly) als pill-shaped Toggle direkt im Header — luxuriös statt versteckt.
- Sanfter Schatten und Border erscheinen erst beim Scroll.

### 3. Bottom-Navigation für Mobile (Tab-Bar)
- Statt Sidebar auf Mobile: floating Bottom-Tab-Bar mit Glass-Effekt, abgerundet, schwebt 12px über dem unteren Rand.
- 5 Haupt-Tabs (Dashboard / Auffälligkeiten / Upload / Forecast / Mehr) mit feinen Icons und dezentem Gold-Glow auf aktivem Tab.
- Sidebar bleibt für Tablet/Desktop unverändert.

### 4. Bewegung & Übergänge
- Page-Transitions: sanftes 250ms Cross-Fade + 4px Y-Slide zwischen Routen.
- Card-Reveal: Staggered Fade-In (40ms zwischen Karten) beim ersten Render.
- Spring-basierte Hover/Tap-States statt linearer Transitions.
- "Spotlight"-Highlight wenn man auf einen Chatter aus der Suche springt: kurzer Gold-Pulse statt nur Border.

### 5. Haptisches Feedback (iOS PWA)
- `navigator.vibrate(8)` bei wichtigen Aktionen (Tab-Wechsel, Swipe-Action, Card-Open).
- Dezent, nur auf erfolgreichen Interaktionen.

### 6. Pull-to-Refresh (Mobile)
- Eigener, premium gestalteter Pull-to-Refresh: Gold-Punkte-Spinner statt nativem Browser-Indikator.
- Lädt aktuelle Daten vom Backend neu.

### 7. Dezente Tiefen-Effekte
- Sehr subtiler animierter Noise/Grain-Overlay (opacity 0.015) über dem Hintergrund — gibt ein analoges, hochwertiges Gefühl.
- Radial-Gradient hinter Hero-Bereichen mit ganz dezentem Gold-Schimmer (atmet langsam, 8s Cycle).
- Karten bekommen einen sehr feinen Inner-Glow am oberen Rand (existiert bereits via `premium-card`, wird auf weitere Komponenten ausgeweitet).

### 8. Form-Inputs & Buttons
- Inputs: sanfter Focus-Ring mit Gold-Glow statt hartem Border.
- Buttons: sanfter Inner-Highlight, Spring-Press (scale 0.97), kein flacher Look.

### 9. Status-Bar Integration (PWA)
- `apple-mobile-web-app-status-bar-style: black-translucent` (bereits gesetzt) bleibt — wichtig: Content respektiert weiter `safe-area-inset-top` (bereits korrekt).

### 10. Kleine Polish-Details
- Zahlen mit `font-variant-numeric: tabular-nums` damit nichts springt.
- Skeleton-Loading-States bekommen den existierenden Shimmer auch in mehr Komponenten (Dashboard-Cards, Trend-Widget).
- Modals/Sheets: iOS-typischer Drag-Handle oben.

## Was NICHT geändert wird

- Farbschema bleibt (Dark + Gold).
- Funktionalität / Datenfluss bleibt unverändert.
- Desktop-Layout bleibt wie es ist (nur Mobile-spezifische Verbesserungen).

## Technische Umsetzung (kurz)

- `index.css`: neue Display-Font einbinden, Noise-Overlay-Utility, Spring-Easings, Gold-Pulse-Keyframe.
- `Layout.tsx`: Mobile-Detection → eigener Mobile-Header + Bottom-Nav statt Sidebar.
- Neue Komponenten: `MobileHeader.tsx`, `MobileBottomNav.tsx`, `PullToRefresh.tsx`, `useHaptic.ts` Hook.
- `Dashboard.tsx` und andere Pages: Stagger-Animations für Card-Listen.
- Tailwind-Config: neue `font-display`-Family.

## Offene Fragen

Falls du eine bestimmte Richtung bevorzugst, sag Bescheid — sonst gehe ich mit allen 10 Punkten oben. Insbesondere:
- **Display-Font:** Fraunces (warme Serif, sehr edel) oder Instrument Serif (klassischer, editorial)? Default: **Fraunces**.
- **Bottom-Nav:** Soll sie immer sichtbar bleiben, oder beim Runter-Scrollen verstecken (wie Safari)? Default: **immer sichtbar**.
