## Ziel

Die thematische Gruppierung in **Heute → Jetzt machen / Im Auge behalten** feiner aufteilen. Statt 3 Ober-Buckets (Eskalation / Account-Aktionen / Performance) bekommt jeder `ActionSourceKind` seine **eigene Sektion** mit eigenem Label, Icon und Farb-Akzent — so vermischen sich z. B. **Talent**, **Swap**, **Mismatch** und **Phase** nicht mehr in einem Topf.

## Neue Sektionen (1 pro Kind)

| Kind         | Label              | Icon            | Akzent       |
|--------------|--------------------|-----------------|--------------|
| `verzug`     | Verzug             | AlertTriangle   | red          |
| `recovery`   | Recovery           | LifeBuoy        | orange       |
| `swap`       | Account-Tausch     | ArrowLeftRight  | cyan         |
| `talent`     | Talent             | Sparkles        | violet       |
| `mismatch`   | Mismatch           | ShuffleIcon     | amber        |
| `phase`      | Phase              | Clock           | sky          |
| `revenue`    | Revenue            | TrendingUp      | emerald      |
| `activity`   | Aktivität          | Activity        | teal         |
| `model`      | Model              | Star            | fuchsia      |
| `slot`       | Slot / Schicht     | CalendarClock   | indigo       |
| `positive`   | Wins-Signal        | ThumbsUp        | lime         |

Reihenfolge = Priorität (oben kritisch, unten positiv). Leere Sektionen werden ausgeblendet.

## Render-Verhalten

- Jede Sektion zeigt: farbiger Dot, Icon, Label (uppercase, tracking-widest), Anzahl, und rechts `+X €/Wo` Summe.
- Cards bleiben unverändert (`PersonActionCard`).
- Greift nur in `section === "primary" | "watch"`. **Wins** und **Erledigt** bleiben flache Liste.
- Eine Card erscheint in der Sektion ihres `primaryKind` (genau einmal — kein Duplizieren).

## Technisch

- `src/pages/Today.tsx`:
  - `KIND_TO_GROUP` und `GROUP_DEFS` ersetzen durch **`KIND_DEFS`** (11 Einträge, eines pro `ActionSourceKind`).
  - `groupByTheme()` → `groupByKind()`: bucketet `UnifiedAction[]` direkt auf `primaryKind`, mappt durch `KIND_DEFS` in Reihenfolge, filtert leere.
  - Zusätzliche Lucide-Icons importieren (`LifeBuoy`, `Shuffle`, `Clock`, `TrendingUp`, `Activity`, `Star`, `CalendarClock`, `ThumbsUp`).
- Keine Änderungen an `today-engine.ts`, Card-Komponenten oder Datenmodell.

## Nicht im Scope

- Tab-Struktur (bleibt: Jetzt / Im Auge / Wins / Erledigt).
- Card-Inhalt / CTAs.
- Keine neuen Sortier-/Filter-Controls — Reihenfolge ist fix nach Priorität.
