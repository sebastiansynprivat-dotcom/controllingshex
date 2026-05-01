## Ziel

Apple-feines Premium-Gefühl überall, ohne Layout-Bruch. Subtile Mount-Reveals, butterweiche Hover-States, animierte KPI-Counter, kritischer Puls — und eine schärfere Typo-Hierarchie, damit die Wichtigkeit auf einen Blick sichtbar ist.

## Was du sehen wirst

- **Beim Seitenwechsel** gleitet der Inhalt wie aus einer leichten Tiefenunschärfe sanft nach oben rein (Fade + Slide + Blur-Out, ~480 ms, Apple-Easing).
- **Listen/Karten erscheinen gestaffelt** (60–80 ms Versatz pro Element). Das Auge bekommt Rhythmus statt eines harten Knalls.
- **KPI-Zahlen zählen hoch**, sobald sie sichtbar werden oder sich ändern — z. B. „127 Chatter analysiert", „4.820 € Recovery". Tabular-Nums verhindern Springen.
- **Hover auf Karten** lupft sie nur 1,5 px an mit weichem Schatten-Übergang — fast unsichtbar, aber spürbar.
- **Kritische Karten** (Risk-Band „critical") bekommen einen dezent pulsierenden, dunkelroten Akzent am linken Rand.
- **KPIs werden visuell groß**, Labels schrumpfen auf Mini-Caps. Du erkennst sofort, wo die Hauptzahl ist.
- Alles respektiert `prefers-reduced-motion` — wer in System-Settings Animationen aus hat, bekommt keine.

## Umfang

### 1. Globale Animations-Schicht (`src/index.css`)
Neue Utilities am Ende des `@layer utilities`-Blocks:

- `@keyframes reveal-up` — Fade + Slide-up + Blur-out (480 ms, Apple-Easing).
- `.reveal` — einzelne Element-Reveals.
- `.reveal-stagger > *` — automatischer Stagger (20 → 680 ms) für bis zu 12+ Kinder. Ein Container-Klassen-Switch reicht.
- `.soft-lift` — Hover-Lift (−1,5 px) mit weichem Schatten-Crossfade. Universell auf Karten/Listenitems.
- `@keyframes critical-pulse` + `.critical-pulse` — atmender roter Akzent am linken Karten-Rand.
- `.nums-anim` — `font-variant-numeric: tabular-nums` (Counter springen nicht).
- `@media (prefers-reduced-motion: reduce)` — schaltet alles ab.

### 2. Reusable Komponenten

**`src/components/CountUp.tsx`** — animierte Zahl. Props: `value: number`, `decimals?: number`, `prefix?: string`, `suffix?: string`, `duration?: number` (default 900 ms). Easing `easeOutCubic`. Zählt von altem auf neuen Wert hoch (auch bei Re-Render). Respektiert reduced-motion (springt direkt).

**`src/components/SectionHeader.tsx`** — kleines Eyebrow-Label + großer Titel + optionaler rechter Status-Chip. Damit kann jede Sektion in 1 Zeile auf das neue Hierarchie-Schema umgestellt werden.

### 3. Anwendung auf Hero-Seiten

- **`Layout.tsx`** — die bestehende `motion.div`-Page-Transition bekommt einen `reveal-stagger`-Wrapper als Default für direkte Hauptkinder.
- **`Dashboard.tsx`** — Header bekommt `<SectionHeader>`; Kategorie-Karten-Grid bekommt `reveal-stagger`; Recovery-Total nutzt `<CountUp>`.
- **`Leaderboard.tsx`** — Top-3-Podest-Zahlen via `<CountUp>`, Tabellen-Reihen `reveal-stagger`, kritische Drop-Reihen ggf. `critical-pulse`.
- **`RecoveryQueueCard.tsx`** — Total-Eur via `<CountUp>`, Liste `reveal-stagger`.
- **`Forecast.tsx`** — Risk-Karten mit Band „critical" bekommen `critical-pulse`. „Geld-Risiko"-Wert via `<CountUp>`.
- **Karten allgemein**: `.premium-card-interactive` bekommt zusätzlich `.soft-lift` als Default-Klasse (in `index.css` direkt mitgeliefert), damit überall ein konsistenter Hover wirkt.

### 4. Typo-Hierarchie-Schärfung

Im `@layer base` (oder in der Sektion „Apple-Pro readability"):
- Neue Helper-Klassen `.kpi-xl` (text-3xl/4xl, font-medium, tracking-tight, nums-anim) und `.kpi-label` (text-[10px], uppercase, tracking-[0.18em], font-medium, text-white/55).
- Diese werden gezielt in den drei Hero-Seiten eingesetzt — keine globale Typo-Änderung, damit Risiko klein bleibt.

## Technische Details

- Reine CSS-Animationen wo möglich (kein JS-Re-Render-Overhead). `<CountUp>` nutzt `requestAnimationFrame` mit Cleanup und `easeOutCubic`.
- `reveal-stagger` ist content-agnostisch — wer 30 Items hat, bekommt ab dem 13. konstant 680 ms (alles danach „schon sichtbar wirkend"). Vermeidet endlose Wartezeit auf langen Listen.
- `soft-lift` nutzt `will-change: transform` nur am Element selbst, kein Compositing-Layer-Spam.
- Keine Library-Dependencies neu — Framer ist schon da, wir nutzen aber meist CSS für Performance auf Mobil.
- Alle Änderungen sind additiv: bestehende Klassen wie `.premium-card`, `.glow-band-critical`, `.gold-text` bleiben unangetastet.

## Reihenfolge

```text
1. CSS-Utilities + Keyframes (index.css)
2. CountUp + SectionHeader Komponenten
3. Layout.tsx wrap
4. Dashboard / Leaderboard / Recovery / Forecast verkabeln
```

## Außerhalb des Scopes

- Keine Library-Installs (kein react-spring, kein react-countup — wir bauen 30-Zeiler).
- Keine inhaltliche Restrukturierung der Seiten.
- Keine Änderung der Daten-Logik (Recovery, ML, Leaderboard).

Nach Freigabe baue ich das in einem Rutsch.