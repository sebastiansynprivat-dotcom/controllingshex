

## Compare-Mode: Echte Swipe-Karten nebeneinander (A vs B)

Statt aggregierter Stats-Karten ("12 Chatter, Ø 87€") zeigt der Vergleichs-Mode jetzt **zwei echte Chatter-Karten Seite an Seite** — links der aktuelle Chatter aus Set A, rechts aus Set B. Du wischst beide unabhängig durch, um Person für Person zu vergleichen.

### Layout

```text
┌──────── A ────────┐ ┌──────── B ────────┐
│ ● 2 Filter   [▾] │ │ ● 1 Filter   [▾] │   ← Filter-Chip-Header
└───────────────────┘ └───────────────────┘

┌──────── A ────────┐ ┌──────── B ────────┐
│ [emerald accent]  │ │ [sky accent]      │
│ TOP · GOLD        │ │ SEED · SILVER     │
│                   │ │                   │
│ niklas_la         │ │ max_dr            │
│ @ model_x         │ │ @ model_y         │
│ 12.4k follower    │ │ 8.1k follower     │
│                   │ │                   │
│ ── Skill 0.78 ──  │ │ ── Skill 0.52 ──  │
│ ▓▓▓▓▓▓▓░░         │ │ ▓▓▓▓▓░░░░         │
│                   │ │                   │
│ 7T-Ø    Heute     │ │ 7T-Ø    Heute     │
│  87€    142€      │ │  54€     38€      │
│                   │ │                   │
│ seit 12. Apr 25   │ │ seit 03. Mai 25   │
└───────────────────┘ └───────────────────┘
   ← swipe →            ← swipe →
        1 / 12               1 / 8

       Δ Ø: +33€ · Δ Skill: +0.26
```

### Was sich konkret ändert

**1. Statt einer aggregierten `CompareCard` pro Set → eine echte Swipe-Karte pro Chatter:**
- Visuell identisch zum bestehenden `SwapMiniCard` (gleiche Glas-Optik, gleiche Felder: Tier-Pill, Name, @account, Followers, Skill-Bar, 7T-Ø, Heute, "seit"-Datum)
- Akzentfarbe: Set A = emerald (`152 70% 45%`), Set B = sky (`200 90% 55%`)
- **Beide Karten identische Höhe** (fixe Min-Height) — perfekt symmetrisch zum direkten Augen-Vergleich

**2. Wisch-Mechanik (gemäß Memory: nur 120px Distanz, keine Velocity):**
- Wisch links/rechts → nächster Chatter im jeweiligen Set
- Wisch hoch → ans Ende verschieben (skip)
- Tap → öffnet `ChatterSlideOver` mit vollen Details
- Doppel-Tap → reserviert für später (vorerst no-op)
- Beide Stacks unabhängig: A-Wisch beeinflusst B nicht

**3. Stack-Navigation:**
- Pro Seite: Index-Anzeige unten klein (`3 / 12`)
- Am Ende: "Alle durch" + Reset-Button pro Seite
- Set-Wechsel via Filter setzt den jeweiligen Index automatisch zurück

**4. Δ-Live-Vergleich unten** (zwischen aktuellen sichtbaren Chattern, nicht Set-Aggregate):
- `Δ Ø`: 7T-Ø-Differenz (B − A)
- `Δ Skill`: Skill-Score-Differenz
- `Δ Heute`: aktuelle Tagesleistung
- Pills wie bisher (grün = B besser, rot = B schlechter)

**5. Filter-Chip-Header bleibt** wie aktuell (Tap → Bottom-Sheet, alle bestehenden Filter inkl. Tenure).

**6. Preset-Bar oben bleibt** (horizontal scrollbar).

### Mobile (440px und runter)

- Karten **immer side-by-side** (`grid-cols-2 gap-2`)
- Karten-Innenpadding `p-2.5` mobile / `p-4` desktop
- Skill-Breakdown-Pills (DMs/Resp/Chat/€/F) **versteckt auf Mobile** (wie schon im SwapMiniCard) — spart Höhe
- Name/Account `truncate`, Zahlen tabular-nums
- Wisch-Threshold 120px (Memory-konform)
- Δ-Pills darunter wickeln auf 2 Reihen wenn nötig

### Edge Cases

- **Set leer**: "Keine Treffer · Filter lockern" als Karte mit gleicher Höhe (kein Layout-Shift)
- **Set hat nur 1 Chatter**: Karte wird nach Wisch zu "Alle durch" + Reset
- **Beide Sets identisch befüllt**: Δ-Pills zeigen "0" (neutral grau), darüber Hinweis "Gleiche Auswahl"
- **Sortierung**: Beide Stacks nach `avgRevWindow` desc (höchster Umsatz zuerst) — Top-Chatter direkt sichtbar
- **Klick öffnet SlideOver**: nutzt bestehenden `onChatterClick(name)` Callback

### Geänderte Dateien

- **`src/components/CompareModeView.tsx`**:
  - `CompareCard`-Komponente (aggregierte Hero-Karte) entfernen
  - Neue `CompareSwipeCard`-Komponente: portiert das Look&Feel von `SwapMiniCard` aus `SwapModeView.tsx`, akzeptiert aber `accent`-Prop ("emerald" | "sky") statt `side`
  - State pro Seite: `idxA`, `idxB`, `skippedA[]`, `skippedB[]`
  - Sort filtered items nach `avgRevWindow` desc, dann `[...visible, ...skipped]` als Render-Stack
  - Δ-Box neu: vergleicht `filteredA[idxA]` vs `filteredB[idxB]` (Live-KPIs), nicht mehr Set-Aggregate
  - Empty-State + "Alle durch"-State pro Seite
- **`src/lib/compare-filters.ts`**: `FilteredChatter` muss `skillScore`, `currentRevenue`, `tier`, `account`, `followers`, `firstSeen` enthalten — falls noch nicht vorhanden, ergänzen (aus `chatters[].kpis` / vorhandener Daten ableiten)
- **`src/pages/TinderMode.tsx`**: ggf. zusätzliche Felder an `chatters` durchreichen, falls `CompareModeView` sie noch nicht bekommt

### Was bleibt gleich

- Filter-Panel (Chip-Header + Sheet), Presets, Tenure-Filter, localStorage-Persistenz
- `ChatterSlideOver` als Detail-Ansicht bei Tap
- Memory-Constraint: nur Distanz-Schwelle 120px, keine Velocity

