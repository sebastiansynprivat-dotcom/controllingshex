# Heute-Tab Redesign — nur Optik & UX

Ziel: gleiche Logik, gleiches Daten-Modell, gleiche Filter — aber der Tab fühlt sich schneller, klarer und „premium" an. Keine Änderungen an `today-engine`, `label-tasks`, `anomaly-*`, `revenue-tasks` etc.

## 1. Neuer Header „Command Bar"
Statt der reinen Section-Überschrift oben ein kompakter, sticky Command-Streifen:
- Links: dynamisches Datum + Begrüßung („Montag · 13. Juli — 47 offene Aktionen").
- Mitte: Live-Progress-Ring (erledigt / gesamt heute) mit sanftem gold-to-emerald Verlauf.
- Rechts: 3 „Jump"-Chips (Verzug ↑, Umsatz ↓, Neu heute) die zu den bereits existierenden Filtern springen.
- Sticky mit `backdrop-blur-2xl` und dünner Bottom-Border, verschmilzt mit der bestehenden Header-Leiste.

## 2. Filter-Bar unten aufwerten
Die untere Portal-Filterleiste (Zeile 1368+) bleibt funktional identisch, wird aber:
- kompakter (32px statt 36px), pill-groups mit segmentiertem Look (wie iOS Segmented Control).
- Aktive Chips bekommen einen subtilen Glow (`shadow-[0_0_20px_-4px_hsl(var(--primary)/0.4)]`) statt reiner Fläche.
- Badges (Zahlen) tabular, monospace, in `bg-white/[0.06]` Pills — heute mal groß, mal klein.
- Divider zwischen Extra-Filter (Push/Anomalies) und Kind-Tabs, damit Gruppen klar getrennt sind.
- Horizontale Scroll-Fade-Masks links/rechts, damit klar ist dass mehr Chips scrollbar sind.

## 3. Karten-Look vereinheitlichen
Aktuell mixen sich `premium-card rounded-2xl p-4` in vielen Varianten. Ein einheitliches „Action-Card"-Muster:
- Konsistenter Padding-Rhythmus (`p-4`), 12px Icon-Slot links, Titel/Meta-Block, Actions rechts.
- Hover: leichte `translate-y-[-1px]` + border → primary/20.
- Category-Farbe nur als 3px linker Akzent-Balken statt vollflächigem Badge → weniger visuelles Rauschen.
- Erledigt-Animation: statt reinem exit → kurzer green flash + slide-right (schon vorhanden, aber verstärken auf 0.35s).

## 4. Gruppierungs-Kopfzeilen (schon in LabelCardList vorhanden) auf alle Sektionen ausweiten
- Anomalien, Push, Onboarding, Verzug etc. bekommen alle den gleichen dezenten „Chip + Divider-Linie + Chevron"-Header.
- Standardmäßig collapsed sobald >8 Items in einer Gruppe, damit die Seite nicht endlos scrollt.
- Anzahl-Badge in Label-Farbe, wie bereits bei Labels.

## 5. Empty & Done-States mit Charakter
- Wenn alles erledigt: großer, ruhiger „Inbox Zero"-State (bereits vorhanden) — aber mit sanfter Ambient-Animation (pulsierender Ring, kein Bling).
- Pro Sektion mini Empty-Zeile („Verzug — keine offen 🏻") statt kompletter leerer Container.

## 6. Micro-Interactions
- Zahlen in Badges: `CountUp` (Komponente existiert bereits) beim ersten Mount.
- Filter-Wechsel: content-Container bekommt kurzen `blur(4px) → 0` + fade (150ms), damit Wechsel „premium" wirkt.
- Beim Abhaken: haptisches Feedback (navigator.vibrate 8ms) auf Mobile.

## 7. Keyboard-Shortcuts (Desktop-Bonus)
- `1`–`5` springt zwischen den Kind-Tabs.
- `f` fokussiert Filter-Bar.
- `j`/`k` navigiert durch Karten, `Enter` = erledigt, `s` = snooze.
- Kleiner „?" Button unten rechts zeigt Overlay mit Shortcuts.

## 8. Sektions-Reihenfolge nach Priorität
Rein visuelle Umsortierung (Daten unverändert): Verzug → Umsatz-Risiko → Anomalien-Highlights → Push → Onboarding → Rest. Sanfte trennende Dividers mit Uhrzeit-Label („Jetzt / Heute / Später diese Woche") wo sinnvoll.

## Technische Notizen
- Alle Änderungen bleiben in `src/pages/Today.tsx`, `src/components/today/*`, `src/index.css` (nur neue Utility-Klassen).
- Keine Änderungen an: `today-engine.ts`, `daily-todos.ts`, `label-tasks.ts`, `anomaly-*`, `revenue-tasks.ts`, DB, Edge Functions.
- Neue kleine Komponenten: `TodayCommandBar.tsx`, `TodayProgressRing.tsx`, `SectionGroupHeader.tsx` (aus LabelCardList extrahiert für Reuse).
- Design-Tokens (Farben, Shadows) über `index.css` HSL-Variablen — keine hardcoded Farben.

## Was ich als nächstes brauche
Sag mir welche der 8 Blöcke ich angehen soll — ich würde als Minimum-Set **1 (Command Bar) + 2 (Filter-Bar) + 3 (Karten-Look) + 4 (Gruppierungs-Header)** empfehlen. Das gibt den größten optischen Sprung ohne Overengineering. 5–8 sind Bonus-Layer die wir danach modular draufsetzen können.
