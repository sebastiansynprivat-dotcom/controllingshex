## Push-Seite mit Fake Live-Countern

### Neue Route
- Neue Seite `src/pages/Push.tsx`, eingehängt in `src/App.tsx` unter `/push`.
- Eintrag im `AppSidebar` (Icon: `Radio` oder `Megaphone`) damit der Tab erreichbar ist.

### Layout (mobile-first, passt zum bestehenden Dark-Look)
- Header mit Titel „Push". Der Titel-Text ist der versteckte Settings-Trigger (Triple-Tap innerhalb 600ms öffnet ein Sheet). Keinerlei sichtbarer Hinweis.
- Zwei große Counter-Cards untereinander:
  1. **Chatter online** – grüner Akzent, Pulse-Dot
  2. **User auf der Plattform online** – pinker Akzent, Pulse-Dot
- Jede Card: große Zahl (animiert via vorhandener `CountUp`-Komponente), Sublabel, kleiner Sparkline-Verlauf der letzten ~60 Ticks (inline SVG, kein neues Package).

### Fake-Counter-Logik (lebhaft)
- Eigener Hook `usePushFakeCounter(config)` in `src/lib/push-fake-counter.ts`.
- Pro Counter eigene Config: `min`, `max`, `startValue`, `tickMinMs`, `tickMaxMs`, `stepMin`, `stepMax`, `trend` (-1..1, leichter Drift), `volatility` (0..1, Wahrscheinlichkeit für größere Sprünge).
- Defaults „lebhaft": Tick alle 1–4s, Schrittweite ±2–8, ~10% Chance auf Sprung ±10–20.
- Werte werden hart auf `[min, max]` geklemmt, Trend sorgt für sanftes Pendeln Richtung Mittelwert.
- Hält die letzten 60 Werte für Sparkline.

### Versteckte Settings
- Triple-Tap auf den Titel öffnet ein `Sheet` (shadcn) „Simulation".
- Felder pro Counter (Chatter / User): Start, Min, Max, Tick Min (ms), Tick Max (ms), Step Min, Step Max, Volatility (Slider 0–1), Trend (Slider −1..1), Pause-Toggle, „Reset auf Default", „Jetzt neu würfeln".
- Persistenz in `localStorage` unter `push.fake.config.v1`. Beim Mount Config laden, beim Speichern direkt anwenden (Hook neu initialisieren).
- Sheet enthält oben einen dezenten Warnhinweis „Nur Demo / Simulation – keine echten Daten".

### Technische Details
- Keine Backend-Änderungen, keine neuen Tabellen, keine neuen Packages.
- Tick via `setTimeout`-Rekursion (nicht `setInterval`), damit Tick-Intervalle pro Schritt zufällig sein können. Cleanup beim Unmount.
- Reduzierte Bewegung respektieren: bei `prefers-reduced-motion` längere Ticks (4–8s) und kleinere Steps.
- Sparkline: einfache `<svg>` mit `<polyline>`, normalisiert auf Card-Höhe.

### Dateien
- neu: `src/pages/Push.tsx`
- neu: `src/lib/push-fake-counter.ts` (Hook + Defaults + Types + Storage)
- neu: `src/components/push/PushCounterCard.tsx`
- neu: `src/components/push/PushSimulationSheet.tsx`
- bearbeitet: `src/App.tsx` (Route), `src/components/AppSidebar.tsx` (Nav-Eintrag)
