

## Vergleichs-Mode im Swipe-Mode

Neben **Swipe** und **Wechsel** kommt ein dritter Tab **Vergleich**. Du baust dir zwei Filter-Sets nebeneinander (Set A links, Set B rechts) und siehst sofort, wie sich beide Gruppen statistisch unterscheiden — plus die einzelnen Chatter pro Seite zum direkten Durchklicken.

### Was du siehst

**1. Drei-Tab-Toggle oben** (statt der bisherigen 2):
`Swipe | Wechsel | Vergleich`

**2. Im Vergleichs-Mode: zwei Spalten nebeneinander** (auf Mobile gestapelt, mit „Set A / Set B“-Switcher).

Pro Spalte ein **Filter-Panel** mit folgenden Kriterien (alle optional, kombinierbar):
- **Account-Tier** (Multi-Select: Seed / Starter / Growth / Top)
- **Umsatz-Range Heute** (€ Min – Max Slider)
- **Ø Umsatz im Zeitraum** (€ Min – Max, nutzt aktiven `TimeRange`)
- **Action-Kategorie** (Multi-Select: SOFORT EINGREIFEN, COACHING NÖTIG, …)
- **Response-Delay** (max. Tage)
- **Status** (Active / Inactive / Onboarding)
- **Label** (Multi-Select aus `chatter_labels`)
- **Alert-Status** (mit / ohne aktive Alerts)

Filter-Pills wie bestehend, kompaktes Layout damit beide Sets nebeneinander auf Desktop passen.

**3. Pro Set: Vergleichs-Karte mit Aggregat-Stats**

```text
┌── SET A ────────────┬── SET B ────────────┐
│ 12 Chatter          │ 8 Chatter           │
│ Ø 87 € / Tag        │ Ø 142 € / Tag       │
│ Σ 1.044 €           │ Σ 1.136 €           │
│ Null-Tage: 24%      │ Null-Tage: 8%       │
│ Trend: ↘ -12%       │ Trend: ↗ +18%       │
│ Top: niklas_la      │ Top: max_dr         │
└─────────────────────┴─────────────────────┘
        Δ Ø: +55 € (B besser)
        Δ Σ: +92 €
        Δ Null-Tage: -16pp
```

Darunter pro Spalte eine **kompakte Liste** der gematchten Chatter (Name · Tier · €/Tag · kleiner Trend-Pfeil) — scrollbar, klickbar → öffnet das bestehende `ChatterSlideOver`.

**4. Quick-Presets** über den Filtern (ein Tap = beide Filter setzen):
- `Top vs Seed`
- `Aktiv vs Inaktiv`
- `Mit Alert vs ohne`
- `SOFORT EINGREIFEN vs BELOHNEN`
- `Eigener Preset speichern…` (localStorage)

### Datenfluss

- Greift auf den **bereits geladenen Daten-Pool** zu (`rawChatters`, `rangeHistory`, `modelsList`, `benchmarkBundle`, `recategorizedMap`, `alertsByChatter`) — **kein zusätzlicher DB-Roundtrip**.
- Aggregate (Ø, Σ, Trend, Null-Tage, Top-Chatter) werden in einem `useMemo` pro Set berechnet, abhängig von den Filter-Werten + dem aktiven `timeRange`.
- Beim Wechsel des `TimeRange`-Toggles oben rekalkulieren beide Sets automatisch.

### Persistenz

`localStorage`-Key `tinder.compareFilters.v1` speichert beide Filter-Sets + custom Presets, damit du beim Wiederkommen direkt weiterarbeitest.

### Tagesabhaken / Swipen

Im Vergleichs-Mode wird **nicht geswiped** — das ist ein reiner Analyse-View. Klick auf einen Chatter öffnet das SlideOver (mit allen bestehenden Aktionen: Note, Coaching, Alert resolven, etc.).

### Technische Details

**Neue Dateien:**
- `src/components/CompareModeView.tsx` — Haupt-Layout (zwei Spalten, responsiv, Stats-Card, Liste, Preset-Bar)
- `src/components/CompareFilterPanel.tsx` — Filter-UI für ein Set (wiederverwendet für A & B)
- `src/lib/compare-filters.ts`:
  - `CompareFilter` Type + Zod-Schema
  - `applyCompareFilter(chatters, history, filter, range): SwapInput[]`
  - `computeCompareStats(filtered, history, range): { count, avgRev, sumRev, zeroRate, trend, topChatter }`
  - `loadComparePresets() / saveComparePresets()` (localStorage)
  - `DEFAULT_PRESETS` (Top vs Seed, etc.)

**Geänderte Dateien:**
- `src/pages/TinderMode.tsx`:
  - State `mode` von `"swipe" | "swap"` → `"swipe" | "swap" | "compare"`
  - Toggle-Bar auf 3 Buttons erweitern (gleicher Pill-Style)
  - Render-Block: `mode === "compare" ? <CompareModeView … /> : …` — bekommt `rawChatters`, `rangeHistory`, `modelsList`, `benchmarkBundle`, `recategorizedMap`, `alertsByChatter`, `timeRange`, `labelsByChatter` als Props
  - `TimeRangeToggle` bleibt sichtbar auch im Compare-Mode (wirkt auf beide Sets)

**Edge Cases:**
- Set leer (keine Matches) → „Keine Chatter im Filter“ + Hint zur Lockerung
- Beide Sets identisch → Δ-Zeile zeigt „Gleiche Auswahl“
- Mobile (< 768px): Sets gestapelt, mit `A / B`-Switch-Pill statt Side-by-Side, Δ-Box bleibt sichtbar zwischen beiden
- Filter-Werte mit Zod validiert, fehlerhafte localStorage-Daten → Defaults

