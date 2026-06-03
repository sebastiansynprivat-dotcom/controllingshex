## Ziel

Die Bottom-Filter-Bar (Heute-Tab) bekommt zusätzlich zwei Chips: **Talente** und **Account ungenutzt**. Damit ist das MatchBoard nicht mehr permanent oben sichtbar, sondern wird als eigene Filter-Ansicht behandelt — konsistent zum bestehenden Layout.

## Verhalten

Bottom-Bar Chips (von links nach rechts):
- `Alle` · `Talent` · `Account ungenutzt` · dann die bestehenden Kind-Chips (Chatter, Model, …)

Aktive Auswahl:
- **Alle** → wie heute: MatchBoard oben + gruppierte Cards darunter
- **Talent** → nur die linke MatchBoard-Spalte (Talente) als Full-Width-Liste, normale Cards ausgeblendet
- **Account ungenutzt** → nur die rechte MatchBoard-Spalte (Orphans) als Full-Width-Liste
- **Chatter / Model / …** → wie heute, MatchBoard ausgeblendet

Counts auf den neuen Chips: `talents.length` bzw. `mismatches.length` aus MatchBoard.

## Technische Umsetzung

`src/pages/Today.tsx`:
- `KindTab` Type erweitern um `"talent" | "orphan"`.
- MatchBoard liefert Counts nach oben via neuer optionaler Prop `onCountsChange?: (c: { talents: number; orphans: number }) => void`.
- Neuer State `boardCounts` in Today.
- MatchBoard bekommt neue Prop `view?: "full" | "talent-only" | "orphan-only"`:
  - `full` (Default) = heutige 2-Spalten-Ansicht
  - `talent-only` / `orphan-only` = nur eine Spalte, voller Breite, ohne Header-Titel "Talent ↔ Account-Board"
- Rendering-Logik in Today:
  - MatchBoard rendert immer (für Counts), aber Sichtbarkeit/Variant abhängig von `kindTab`:
    - `kindTab === "all"` → `view="full"` anzeigen
    - `kindTab === "talent"` → `view="talent-only"`, normale Card-Liste ausblenden
    - `kindTab === "orphan"` → `view="orphan-only"`, normale Card-Liste ausblenden
- Bottom-Bar Chips ergänzen (vor `availableKinds.map`):
  - Talent-Chip: Icon `Sparkles`, Accent `text-violet-300`, Count = `boardCounts.talents`
  - Orphan-Chip: Icon `AlertTriangle` (oder `UserX`), Accent `text-amber-300`, Count = `boardCounts.orphans`
  - Nur anzeigen wenn Count > 0
- `setStatus`-Reset von `kindTab` weiterhin auf `"all"`.

`src/components/today/MatchBoard.tsx`:
- Props erweitern: `view?: "full" | "talent-only" | "orphan-only"`, `onCountsChange?`.
- `useEffect` der Counts an Parent meldet nach jedem Load.
- Conditional Rendering der Spalten + Grid → bei `*-only` einspaltig (`grid-cols-1`), Header optional ausblenden.

## Out of Scope

- Keine Änderung an Card-Inhalten, Priorität-Markierung oder Drag-and-Drop-Logik.
- Keine Änderung an den Status-Pills (oben).
