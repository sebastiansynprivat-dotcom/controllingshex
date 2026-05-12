## Ziele

1. Talent-Karten öffnen direkt die Vergleichsansicht beider Chatter (Riser ↔ Underuser).
2. Vergleichsansicht auf Mobile spürbar besser: kein gestauchtes 50/50-Stacking, klares Wechseln zwischen beiden Personen.
3. Reset aller "Heute"-Status-Einträge im Workspace **Brezzels** (213 done-Einträge → wieder offen).

---

## 1. Talent → Vergleich öffnet sich direkt

Die Daten sind schon da: jede `UnifiedAction` trägt `secondaryChatter` (für Talent: der Underuser, dessen verwaister Account hochgezogen werden soll). Das wird heute beim Klick ignoriert.

**Änderungen**
- `ChatterSlideOver.tsx` bekommt neuen optionalen Prop `initialCompareWith?: string | null`. Wenn gesetzt, startet der Slide-Over direkt im Vergleichsmodus mit diesem zweiten Chatter (interner `compareWith`-State wird beim Öffnen damit initialisiert; bleibt anschließend per Compare-Button änderbar / abschaltbar).
- `Today.tsx` reicht beim Öffnen des Slide-Overs `action.secondaryChatter` als `initialCompareWith` durch. Dafür wird der `onChatterClick`-Callback in `PersonActionCard` von `(name)` auf `(name, compareWith?)` erweitert; Card ruft mit `action.secondaryChatter` auf.
- Wenn nur ein einzelnes Talent-Signal in einer Bündel-Karte steckt, öffnet ein Klick auf "Details ansehen" sofort den Vergleich. Bei Bündeln mit mehreren Signalen bleibt das Verhalten wie aktuell (erst aufklappen); jedes Talent-Sub-Item im Aufklapper bekommt einen "Vergleich öffnen"-Affordance.

---

## 2. Vergleichsansicht auf Mobile aufpolieren

Heutiger Zustand mobile: zwei Panes übereinander (`max-h-[50vh]` + `max-h-[50vh]`). Beide gleichzeitig sichtbar, aber jeder gefühlt halb abgeschnitten — viel Scrollen, keine klare Trennung.

**Neues Mobile-Layout (sm-Breakpoint und kleiner)**
- Statt 50/50-Split: **Segmented Switcher** oben unter dem Header — zwei Pills mit den Namen (Initialen + Vorname) und Mini-Revenue-Indikator. Aktive Pill = sichtbares Pane in voller Höhe.
- Wechsel per Tap auf Pill **oder** horizontalem Swipe zwischen den Panes (nutzt feste 120px-Distanz, kein Velocity-Schwellwert — Memory: swipe constraints).
- Beim Wechsel sanfte Cross-Fade + 8px X-Slide-Animation (Framer-Motion, ~250ms ease-out).
- Header bleibt sticky; Compare-Button im Header zeigt jetzt "Vergleich aus" (X) statt nur Toggle, da das Picker-Affordance unten ans Switcher-Element wandert (Plus-Pill am Ende erlaubt Wechsel des zweiten Chatters).
- Mini-KPI-Strip pro Pane direkt unter dem Switcher (heute · 7T · 30T-Trend) damit Vergleich auf einen Blick funktioniert, ohne erst scrollen zu müssen.

**Desktop (sm+)** bleibt wie heute: Side-by-Side mit `divide-x`. Nur kleine Politur — Compare-Pane bekommt eigenen Mini-Hero (Name + Initials + Trend-Chip) statt komplett verschachteltem Slide-Over-Header.

**Implementierung**
- Neue lokale Komponente `CompareSwitcher` in `ChatterSlideOver.tsx` (mobile-only, gated per `useMediaQuery("(max-width: 640px)")` oder Tailwind-`sm:hidden`-Klassen mit zwei parallelen Render-Pfaden).
- Aktive-Pane-State (`"primary" | "compare"`) ergänzt; Swipe via existierender Pointer-Handler-Pattern (siehe `handleDoubleTapClose`).
- Compare-Pane wird auf Mobile nicht mehr unter dem Hauptpane gerendert, sondern in einem `motion.div` mit `display`-Toggle, damit Scroll-Position pro Pane erhalten bleibt.

---

## 3. Reset "Heute" für Brezzels

Direkter Daten-Wipe: alle Statuszeilen für Workspace Brezzels löschen. Snoozed gibt es dort keine, nur 213 done-Einträge.

```sql
DELETE FROM daily_todo_state WHERE platform = 'Brezzels';
```

Ausgeführt als Daten-Operation (insert tool, kein Schema-Migration). Nach Reload zeigt der Heute-Tab in Brezzels alle Aufgaben wieder als offen.

---

## Technik-Details

**Geänderte Dateien**
- `src/components/ChatterSlideOver.tsx` — neuer Prop `initialCompareWith`, Mobile-Switcher-Layout, Pane-Wechsel-State, optionaler Mini-Hero im Compare-Pane.
- `src/components/PersonActionCard.tsx` — Callback-Signatur `onChatterClick(name, compareWith?)`, Übergabe von `action.secondaryChatter`.
- `src/pages/Today.tsx` — State `selectedChatter` von `string` auf `{ name: string; compareWith: string | null }`, Prop-Durchreichung an `ChatterSlideOver`.
- DB: `DELETE` auf `daily_todo_state` für `platform='Brezzels'`.

**Bewusst ausgelassen**
- Keine Änderung an Talent-Engine, Match-Logik oder €-Hebel-Berechnung.
- Kein neuer Picker/Workflow für Compare auf Desktop.
- Keine Änderung an `inline`-Mode (Compare-Pane rendert weiter via `inline=true`-Subinstanz).
- Velocity-basierte Swipe-Schwellen werden bewusst vermieden (nur 120px-Distanz, gemäß Memory).