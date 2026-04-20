

## Compare-Mode: Zwei Vergleichs-Karten nebeneinander

Aktuell zeigt der Compare-Mode oben kompakte Stats-Cards + lange Listen. Du willst stattdessen **eine prominente Vergleichs-Karte pro Set** nebeneinander — sauber wie SwipeCards, mit allen wichtigen Daten **auf einen Blick**, ohne zu scrollen oder Filter aufklappen zu müssen.

### Neues Layout

```text
┌─────── A ──────┐ ┌─────── B ──────┐
│ ● 2 Filter     │ │ ● 1 Filter     │   ← Filter-Chip-Header (klein, tap = Sheet)
│ [Top][Aktiv]   │ │ [Seed]         │
└────────────────┘ └────────────────┘

┌─────── A ──────┐ ┌─────── B ──────┐
│   12 CHATTER   │ │    8 CHATTER   │   ← Vergleichs-Karte (Hero)
│                │ │                │
│   Ø 87 €/Tag   │ │   Ø 142 €/Tag  │   ← Hero-Zahl, groß
│   Σ 1.044 €    │ │   Σ 1.136 €    │
│                │ │                │
│   ⊘ 24%        │ │   ⊘ 8%         │
│   ↘ -12%       │ │   ↗ +18%       │
│                │ │                │
│   👑 niklas_la │ │   👑 max_dr    │
│      87 €      │ │      142 €     │
│                │ │                │
│   ── Rest ──   │ │   ── Rest ──   │
│   jana_mu  54€ │ │   tim_kr  128€ │
│   leo_st   42€ │ │   ana_we   98€ │
│   +9 weitere ▾ │ │   +5 weitere ▾ │
└────────────────┘ └────────────────┘

       Δ Ø: +55€  ·  Δ Σ: +92€  ·  Δ⊘: -16pp
```

### Was sich konkret ändert

**1. Eine einzige Vergleichs-Karte pro Set** (ersetzt `StatsCard` + separate `ChatterList`):
- Akzentfarbe: Set A = emerald, Set B = sky (wie bisher)
- Glas-Effekt + dezenter Gradient wie SwipeCards (kein full SwipeCard-Look — bleibt statisch, nicht swipebar)
- **Hero-Zahlen-Block oben**: Chatter-Count groß, dann Ø €/Tag als Haupt-KPI
- **Sekundär-KPIs**: Σ €, Null-Rate ⊘, Trend-Pfeil — kompakt darunter
- **Top-Chatter prominent**: Krone 👑 + Name + €/Tag (klickbar → SlideOver)
- **Top 3 weitere Chatter** direkt sichtbar (Name + €), Rest collapsed mit "+N weitere ▾" → expandiert inline

**2. Filter-Chip-Header bleibt schlank oben** (wie schon implementiert), tap → Bottom-Sheet.

**3. Δ-Box bleibt unten** als horizontale Pill-Reihe (unverändert).

**4. Preset-Bar ganz oben** bleibt horizontal-scrollbar (unverändert).

### Warum das besser ist

- **Auf den ersten Blick alles Wichtige sichtbar**: Count, Ø, Σ, Null-Rate, Trend, Top-Chatter — ohne scrollen.
- **Echte Symmetrie**: Beide Karten exakt gleich aufgebaut, Auge vergleicht direkt zeilenweise links↔rechts.
- **Kein hin-und-her-scrollen**: Lange Listen gibt's nicht mehr im Hauptview — nur Top 3 + Expand-Button für Rest.
- **App-Feeling**: Eine Karte = eine Aussage, statt drei gestapelte Sub-Boxen.

### Mobile (440px und runter)

- Karten bleiben **immer side-by-side** (`grid-cols-2 gap-2`).
- Hero-Zahl `text-xl` auf Mobile, `text-3xl` auf Desktop.
- Top-Chatter-Block: Name truncate, € rechts ausgerichtet.
- "Weitere Chatter"-Liste expandiert inline mit `max-h-[35vh] overflow-y-auto`.
- Filter-Chip-Header darüber bleibt unverändert (Sheet-Pattern funktioniert schon).

### Geänderte Dateien

- **`src/components/CompareModeView.tsx`**:
  - `StatsCard` und `ChatterList` zu **einer neuen Komponente `CompareCard`** mergen
  - `CompareCard` erhält: `stats`, `items`, `accent`, `onChatterClick`
  - Layout: Hero-Block (Count + Ø) → Sekundär-KPIs (Σ, ⊘, Trend) → Top-Chatter-Highlight → Top-3-Liste → Expand-Toggle für Rest
  - Akzentfarbe als Gradient-Tint im Karten-Background
  - Empty-State innerhalb der Karte (statt separate Box)
- Δ-Box, Preset-Bar, Filter-Header bleiben unverändert.

### Edge Cases

- **Leeres Set**: Karte zeigt grauen "Keine Treffer"-Hero mit Hinweis "Filter lockern" — gleiche Höhe wie volle Karte (kein Layout-Shift).
- **Nur 1 Chatter**: Top-Chatter-Block sichtbar, "weitere"-Liste entfällt.
- **Beide Sets identisch**: Δ-Box zeigt "Gleiche Auswahl" (unverändert).
- **Sehr lange Namen**: `truncate` auf Chatter-Namen, € bleibt rechts sichtbar.

