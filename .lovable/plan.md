## Ziel

Das App-Gefühl am Desktop spürbar hochwertiger und lesbarer machen — ohne Layouts inhaltlich umzubauen. Apple-Pro-Stil: tiefere Glas-Effekte, feinere Borders, edle Schatten, klarere Hierarchie. Lesbarkeit moderat anheben (nur zu blasse Stellen). Inhalt auf großen Monitoren mit Maximalbreite ~1400 px zentrieren.

## Was du sehen wirst

- Auf großen Monitoren klebt nichts mehr am Rand — Inhalte sitzen in einem ruhigen, zentrierten Frame mit großzügigen Innenabständen.
- Karten wirken plastischer: feinere helle Innenkanten, weicherer Schatten-Falloff, leichter Tiefenverlauf, sauberer Hover-Lift.
- Alle „fast unsichtbaren" Texte (z. B. `text-white/30`, `text-white/40`, blasse Labels in Recovery/Leaderboard/Dashboard) sind klar lesbar — Headlines bleiben aber elegant dünn.
- Headlines bekommen am Desktop eine Stufe mehr Größe und engere Letterspacing-Werte → wirkt redaktioneller, weniger „Webapp".
- Goldener Akzent wird gezielter eingesetzt: nur für aktive Zustände, Top-Ranks und KPI-Highlights — wirkt dadurch wertvoller statt beliebig.

## Umfang (was ich anfasse)

1. **Design-Tokens** (`src/index.css`)
   - Neue Text-Stufen-Variablen: `--text-strong` (95%), `--text` (82%), `--text-muted` (62%), `--text-subtle` (44%) — ersetzt das wilde `text-white/30…/70`.
   - Verfeinerte Surface-Stufen + zwei neue Schatten-Tokens (`--shadow-card`, `--shadow-card-hover`) für konsistente Tiefe.
   - Neue Container-Variable `--content-max: 1400px` plus großzügigerer Desktop-Padding-Wert.

2. **Typografie-Pass** (`src/index.css`, `tailwind.config.ts`)
   - Heading-Skala für `lg`/`xl`-Breakpoints leicht anheben (h1/h2/h3), Letterspacing feiner.
   - Body-Default von `font-light` → `font-normal` (Headlines bleiben light, wie gewünscht).
   - Tabular-Nums-Utility für KPI-Zahlen (verhindert „springende" Ziffern).

3. **Container & Layout** (`src/components/Layout.tsx`)
   - `<main>` bekommt einen inneren Wrapper mit `max-w-[1400px] mx-auto w-full` und gestufftem Padding (`px-6 lg:px-10 xl:px-14`).
   - Header-Leiste folgt derselben Maximalbreite, damit Sidebar-Trigger und Inhalt visuell auf derselben Achse sitzen.

4. **Card-System aufwerten** (`src/index.css`)
   - `.premium-card`: feinere Innenkante (1 px helle Top-Linie via `::before` bleibt, aber sanfter), weicherer Mehrlagen-Schatten, leicht tieferer Backdrop-Blur (32 → 40 px) und +Saturation für edleren Glas-Look.
   - `.premium-card-interactive:hover`: dezenterer Lift (−1 px → −2 px), Schatten wechselt sauber, kein Gold-Glow im Default-Hover (nur bei aktiven Karten).
   - Neue Variante `.premium-card-flush` für dichte Datenblöcke (Leaderboard-Reihen) — gleiche Materialität, ohne extra Padding.

5. **Lesbarkeits-Refactor (gezielt, moderat)**
   - Nur Stellen mit `text-white/30`, `text-white/35`, `text-white/40`, `text-white/45` werden auf neue Skala (`text-muted` ~62 %) angehoben.
   - Betroffene Hot-Spots, die ich gesehen habe: `RecoveryQueueCard.tsx`, `Leaderboard.tsx`, `Dashboard.tsx`, `AppSidebar.tsx`, `RiskBadge.tsx`, `WeekTrendCard.tsx`, `TrendWidget.tsx`, `ForecastBanner.tsx`, `AnomalyPanel.tsx`.
   - Headlines / Brand-Schriftzug behalten ihr `font-light` / `font-semibold tracking-[0.2em]`.
   - `font-light` auf Body-Text (≤14 px) wird zu `font-normal` — auf Retina am PC dadurch deutlich klarer.

6. **Sidebar-Politur** (`src/components/AppSidebar.tsx`, `index.css`)
   - Inaktive Items von `text-white/40` → `text-white/55`, Hover auf `/90`.
   - Aktiver Zustand: stärkerer Gold-Drop-Shadow auf Icon, etwas kräftigerer linker Akzent-Strich.

## Technische Details

- Keine Routing- oder Datenflüsse berührt, rein visuell.
- `text-white/XX`-Klassen werden via projektweiter Suche & gezieltem Replace ersetzt (nur Werte ≤ /45). Klassen wie `/60`, `/70`, `/80` bleiben unangetastet.
- Tailwind-Config bekommt nur additive Erweiterungen (neue Schatten, neue `maxWidth.content`, `fontSize.display-*`). Keine Breaking Changes.
- `src/index.css`: bestehende Klassen (`.premium-card`, `.glass-card`, `.gold-text`) werden überschrieben, nicht entfernt → kein Cleanup-Risiko in Komponenten.
- Layout-Wrapper in `Layout.tsx` ist additiv — falls eine Seite den vollen Bleed braucht, kann sie per `className="-mx-6 lg:-mx-10"` ausbrechen.
- Mobile/iPhone-Look bleibt 1:1 erhalten: alle Änderungen greifen über `lg:`/`xl:`-Prefixes oder sind so dezent, dass sie auf kleinen Screens nicht stören.

## Reihenfolge

```text
1. Tokens & Typo (index.css, tailwind.config.ts)
2. Layout-Container (Layout.tsx)
3. Card-System Update (index.css)
4. Lesbarkeits-Sweep (RecoveryQueueCard, Leaderboard, Dashboard,
   AppSidebar, RiskBadge, WeekTrendCard, TrendWidget,
   ForecastBanner, AnomalyPanel)
5. Sidebar-Politur
```

## Außerhalb des Scopes

- Keine Komponenten-Restrukturierung, keine neuen Features, keine Inhaltsänderungen.
- Mobile-Layout bleibt unverändert.
- Leaderboard/Recovery-Logik bleibt unverändert (nur Optik der Reihen).

Nach Freigabe baue ich das in einem Durchgang.