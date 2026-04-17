
Der User will den Swipe Mode visuell aufwerten. Ich kenne SwipeCard.tsx schon gut. Lass mich kurz checken, wie der Rest der Page aussieht, um eine kohärente Vision zu entwickeln.

Aktueller Stand:
- Karte: dunkler Gradient, KPI-Grid 2x3, Alerts, Trend
- Funktional sauber, aber visuell etwas "flat" und uniform — alle KPIs gleich, kein Hero-Element, Hintergrund statisch

## Visuelle Verbesserungen — Vorschlag

### 1. Hero-KPI mit Glow
- Top-KPI (z.B. "Umsatz heute") groß als Hero anzeigen mit subtilem Farb-Glow
- Restliche KPIs kleiner darunter im 2x2 Grid statt 2x3
- Schafft visuelle Hierarchie statt "Wand aus Zahlen"

### 2. Lebendiger Karten-Hintergrund
- Aurora/Mesh-Gradient passend zur Kategorie (z.B. grün für Top-Performer, amber für Risk)
- Subtiler animierter Schimmer beim Erscheinen
- Statt aktuellem statischen Gradient

### 3. Avatar/Initial-Badge
- Großer Initial-Kreis links neben dem Namen mit Kategorie-Farbe
- Macht jede Karte einzigartiger erkennbar

### 4. Bessere Swipe-Indikatoren
- Aktuell: Vollflächige Overlay-Boxen mit Riesen-Text — wirkt grob
- Neu: Edge-Glow (leuchtende Kante in Richtung Swipe) + kleiner Icon-Hint in der Ecke
- Eleganter, weniger aufdringlich

### 5. Trend-Karte aufgewertet
- Mini-Header mit Trend-Pfeil (↗ +12% diese Woche) statt nur Sparklines
- Trennlinie oben mit Gradient statt harter Border

### 6. Stack-Effekt sichtbar machen
- Aktuell sind hintere Karten unsichtbar (opacity 0)
- Zeig 1-2 Karten dahinter leicht versetzt + skaliert → "Tinder-Feel"

### 7. Card-Border mit Severity
- Wenn kritischer Alert vorhanden: subtiler roter Glow am Karten-Rand
- Macht dringende Karten sofort erkennbar ohne extra Text

## Vorgehen
Ich würde **alle 7** zusammen umsetzen — sie greifen ineinander und ergeben gemeinsam den "Premium-Feel". Einzeln wirkt jede Änderung nur marginal.

## Betroffene Dateien
- `src/components/SwipeCard.tsx` (Haupt-Refactor: Hero-KPI, Avatar, Background, Edge-Indikatoren, Severity-Glow, Stack)
- `src/components/WeekTrendCard.tsx` (Mini-Trend-Header mit Delta)
- `src/pages/TinderMode.tsx` (Stack-Rendering: 2 Karten dahinter sichtbar machen)

## Frage an dich

<lov-actions>
<lov-suggestion message="Setz alle 7 visuellen Verbesserungen um (Hero-KPI, Avatar, lebendiger Background, Edge-Glow Swipe-Indikatoren, Trend-Header, sichtbarer Stack, Severity-Glow)">Alle 7 umsetzen — full Premium-Look</lov-suggestion>
<lov-suggestion message="Setz nur die Top 3 um: Hero-KPI mit Glow, sichtbarer Karten-Stack dahinter, und elegantere Edge-Glow Swipe-Indikatoren">Nur Top 3 (Hero + Stack + Edge-Glow)</lov-suggestion>
<lov-suggestion message="Mach erst mal nur den Karten-Stack sichtbar (1-2 Karten dahinter versetzt) — das ist der größte 'Wow'-Effekt">Nur Stack-Effekt (Tinder-Feel)</lov-suggestion>
<lov-suggestion message="Zeig mir erst Mockups/Prototypen der Optionen bevor wir was umsetzen">Erst Prototypen zeigen</lov-suggestion>
</lov-actions>
