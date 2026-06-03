## Ziel

Die App ist schon dunkel mit Gold-Akzent — aber visuell „gleichförmig", flach und ohne Hierarchie. Ich hebe sie auf editorial Noir & Gold an: schärferer Kontrast, klare Typo-Hierarchie, edlere Cards, gezielte Motion (Level 3), keine Funktionsänderungen.

## 1. Design-Tokens schärfen (`src/index.css` + `tailwind.config.ts`)

- **Hintergrund tiefer:** `--background` von `240 6% 4%` → `0 0% 3%` (echtes Noir, weniger Blau-Stich).
- **Gold-Skala** auf Editorial-Werte: `--gold 40 55% 58%`, `--gold-light 42 70% 72%`, `--gold-dark 38 45% 38%` + neue Tokens `--gold-deep` (38 50% 28%) und `--gold-foil` (linear-gradient für Headlines).
- **Surface-Stack** in 4 klar trennbaren Stufen (`surface-0/1/2/3`) statt aktuell 3 fast identischen → echte Tiefe.
- **Typo-Pair:** Display = **Fraunces** (Serif, optical-size) für H1/H2 + große KPI-Zahlen, Body bleibt **Inter**. Google-Fonts-Import erweitern. Headlines bekommen `font-feature-settings: 'ss01'` und negative letter-spacing nur ab 32px.
- **Tabular-Nums + Slashed-Zero** als Default für alle `.kpi`-Klassen.

## 2. Card- & Surface-System neu

- `premium-card` bekommt: Foil-Edge (1px Gold-Top-Highlight nur on hover), feiner Noise-Layer (8% opacity SVG, einmal global) gegen Banding, abgestufte Innen-Glows.
- Neue Variante `editorial-card`: schwarz-matt, 1px Gold-Hairline links, große Display-Zahl rechts — für KPI-Kacheln auf Dashboard, Forecast, MonthlyGoals.
- Buttons: Primary = Gold-Foil-Gradient + sehr dezenter Shimmer beim Hover (Level 3, kein Dauer-Loop).

## 3. Layout & Hierarchie

- **Dashboard, Forecast, MonthlyGoals, Models, Leaderboard:** einheitlicher Page-Header mit Eyebrow (Mono-Klein-Caps, gold), Display-H1, Sub-Linie. Aktuell sind Headers überall unterschiedlich groß/leer.
- **Mehr Weißraum oben**, klare Section-Trennung mit `<hr class="hairline-gold" />` (1px Gradient, fadet zu transparent).
- KPI-Reihen: von 3-spaltigen flachen Kacheln → 1 große „Hero-KPI" + 3 kleine Support-KPIs (Bento-Style).

## 4. Micro-Motion (Level 3 = spürbar, nicht laut)

- Page-Mount: `reveal-stagger` bereits da — Timing-Kurve auf `cubic-bezier(0.22, 1, 0.36, 1)`, Stagger 60ms.
- KPI-Zahlen: `CountUp` mit ease-out-quart, 700ms.
- Card-Hover: bestehend OK, dazu Foil-Edge-Sweep (200ms, einmalig).
- Tab-/Route-Wechsel: 180ms Fade+8px-Lift via `AnimatePresence`.
- Sidebar-Active: bestehender Gold-Bar bleibt, bekommt sanftes Atmen (4s, opacity 0.85↔1).

## 5. Komponenten-Pass (Prio-Reihenfolge)

1. `Layout.tsx` + `AppSidebar.tsx` — Header/Sidebar Tokens & Typo
2. `Dashboard.tsx` — neue KPI-Bento + Page-Header
3. `MonthlyGoals.tsx` + `Forecast.tsx` — Editorial-Cards für Ziele/Forecast
4. `Models.tsx` + `Leaderboard.tsx` — Listen mit row-accent Gold-Hairline
5. `Auth.tsx` — Hero-Treatment mit Foil-H1
6. Restliche Seiten erben automatisch durch Token-Änderungen

## Technische Details

- Keine neuen Libraries. Framer Motion ist bereits drin, nur gezielter einsetzen.
- Alle Farben bleiben HSL in `index.css` — keine hartkodierten Hex/Tailwind-Farben in Components.
- Keine Logik/Daten/Routen-Änderungen. Reiner Frontend/Presentation-Pass.
- Build-Verifikation am Ende.

## Außerhalb Scope

- Keine neuen Features
- Keine Charts-Library-Wechsel
- Kein Light-Mode (bleibt Dark only)
- Frühwarnung bleibt entfernt (wie zuletzt entschieden)

Soll ich so loslegen, oder willst du eine Sektion (z. B. nur Dashboard zuerst als Pilot) priorisieren?