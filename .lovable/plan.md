

## Compare-Mode: Mobile Side-by-Side Layout

Aktuell stapelt der Compare-Mode auf Mobile beide Sets hinter einem A/B-Switcher. Du willst beide Karten **gleichzeitig nebeneinander** sehen — auch auf dem Handy. Das geht, braucht aber ein dichteres, scrollbares Layout damit's auf 360–440px sauber bleibt.

### Neues Layout-Konzept Mobile

**1. A/B-Switcher fliegt raus.** Stattdessen: zwei echte Spalten ab `grid-cols-2` (also immer, nicht erst ab `md`). Spacing wird kompakter (`gap-2` statt `gap-3`).

**2. Filter-Panel schrumpft auf Mobile** zu einem kollabierten "Chip-Header":

```text
┌──────── A ────────┐ ┌──────── B ────────┐
│ ● 3 Filter aktiv  │ │ ● 2 Filter aktiv  │
│ [Top][SOFORT][▾]  │ │ [Seed][▾]         │
├───────────────────┤ ├───────────────────┤
│   12 Chatter      │ │    8 Chatter      │
│   Ø 87 €          │ │    Ø 142 €        │
│   Σ 1.044 €       │ │    Σ 1.136 €      │
│   ⊘ 24% · ↘ -12%  │ │    ⊘ 8% · ↗ +18%  │
├───────────────────┤ ├───────────────────┤
│ niklas_la   87€   │ │ max_dr     142€   │
│ jana_mu     54€   │ │ tim_kr     128€   │
│ … (scroll)        │ │ … (scroll)        │
└───────────────────┘ └───────────────────┘

       Δ Ø: +55€  ·  Δ Σ: +92€  ·  Δ⊘: -16pp
```

- Header zeigt **nur die aktivsten Filter-Pills** (max 2-3) + Pfeil zum Aufklappen.
- Tap auf Header öffnet ein **Bottom-Sheet** (mobile) bzw. inline-Expand (desktop) mit dem vollen Filter-UI — so geht kein Filter-Feature verloren, aber die Karte bleibt schmal.
- Stats-Card kompakter: Ein-Zeilen-Stats statt Label+Value pro Row (z.B. `Ø 87€ · Σ 1.044€`, `⊘ 24% · ↘ -12%`).
- Chatter-Liste: Name darüber, €/Tag darunter (statt nebeneinander) — passt in schmale Spalte. Max-Höhe `40vh`, intern scrollbar.

**3. Δ-Box bleibt unten** als horizontale Pill-Reihe (kompakter als bisher), immer voll-breit unter beiden Spalten sichtbar.

**4. Preset-Bar bleibt** oben, horizontal scrollbar (`overflow-x-auto`) statt umbrechend — spart vertikalen Platz.

**5. Schriftgrößen-Anpassungen** für 360-440px:
- Stats-Zahlen `text-lg` statt `text-2xl`
- Chatter-Namen `text-[11px]` mit `truncate`
- Tier-/Kategorie-Pills im Filter-Sheet bleiben tappbar (min 28px Höhe)

### Was bleibt gleich

- Desktop-Layout (≥768px): unverändert side-by-side mit vollem Inline-Filter
- Alle Filter-Funktionen, Presets, Δ-Berechnung, Klick → SlideOver
- localStorage-Persistenz

### Geänderte Dateien

- `src/components/CompareModeView.tsx`
  - `activeMobile`-State + A/B-Switcher entfernen
  - Grid immer `grid-cols-2 gap-2 md:gap-3`
  - `StatsCard` & `ChatterList` kompaktere Mobile-Varianten
  - Δ-Box als horizontale Pill-Reihe
  - Preset-Bar auf `overflow-x-auto whitespace-nowrap`
- `src/components/CompareFilterPanel.tsx`
  - Neuer Mobile-Modus: Header mit aktiven Pills + Aufklapp-Button
  - Volles Filter-UI in Sheet (`@/components/ui/sheet`) auf Mobile, inline auf Desktop
  - Via `useIsMobile()` aus `src/hooks/use-mobile.tsx`

### Edge Cases

- 320px Geräte: Spalten werden eng aber lesbar (Stats einzeilig, Truncate auf Namen)
- Lange Chatter-Listen: Beide Spalten unabhängig scrollbar (`max-h-[40vh] overflow-y-auto`)
- Sheet überlagert preview-frame korrekt (z-index aus bestehender `sheet.tsx`)

