## Ziel

Match Board komplett entfernen. Stattdessen im Heute-Tab zwei neue Filter:
- **Onboarding** — alle Chatter ab Onboarding-Tag 5, gruppiert nach Tag, zum sequenziellen Durchgehen
- **Labels** (eine Pill mit Custom-Auswahl) — zeigt gelabelte Chatter als normale abhakbare Karten

Labels bleiben am Chatter kleben. Nach „Abschließen" verschwindet die Karte heute, taucht beim nächsten Report wieder auf — solange das Label gesetzt ist.

## Label-Set (fix, vorgeseedet pro User & Platform)

| Emoji | Name | Farbe |
|---|---|---|
| 🟢 | Upgrade | emerald |
| 💛 | Premium Upgrade | amber |
| ❌ | Kein Upgrade | rose |
| ⬇️ | Downgrade | slate |

Bestehende `chatter_labels`-Tabelle wird verwendet. Beim ersten Today-Open werden die 4 Labels pro User/Platform geseedet falls fehlend. User darf weitere Custom-Labels über die bestehende Label-UI (TinderMode / ChatterSlideOver) anlegen — die tauchen dann auch im Label-Filter auf.

## Onboarding-Filter

- Filter-Pill „🌱 Onboarding" in der unteren Filterleiste
- Quelle: `get_chatter_onboarding` RPC (existiert), `daysSince ≥ 5`
- Optional Cut-Off: bis Tag X konfigurierbar — Vorschlag fix bei 14 Tagen (klärbar später)
- Gruppiert nach Onboarding-Tag absteigend: „Tag 14", „Tag 13", …, „Tag 5"
- Jede Zeile = kompakte Karte mit Chatter-Name, Account, aktuell zugewiesene Labels als Badges, Quick-Action: Label setzen/wechseln (Bottom-Sheet mit den 4 Buttons + Custom-Liste)
- Klick auf Karte öffnet bestehenden ChatterSlideOver
- Chatter mit irgendeinem Label gesetzt → fallen aus dem Onboarding-Filter raus (sind „durchgearbeitet")

## Label-Filter

- Eine Pill „🏷 Labels (N)" mit Dropdown/Sheet zum Custom-Auswählen welche Labels aktiv gezeigt werden (Multi-Select, persistent in localStorage)
- Inhalt: für jeden Chatter mit aktivem ausgewähltem Label eine reguläre Action-Karte im gleichen Layout wie Verzug/Recovery/etc.
- Karte zeigt: Chatter-Name, Account, Label-Badge(s), wichtigste Live-Metriken (offene Chats, ältester Chat) + Heute-Umsatz
- „Abschließen"-Button setzt nur `daily_todo_state` (key z.B. `label:${labelName}:${chatter}`) auf done für heute
- Beim nächsten Tag/Report (neuer `todayISO`) erscheinen sie wieder, solange das Label am Chatter dranhängt
- Label entfernen → Karte verschwindet dauerhaft aus diesem Filter

## Match Board entfernen

- `MatchBoard.tsx` Component und Filter-Pill aus `Today.tsx` raus
- KindTab-Typ: `"board"` entfernen
- `talent-scout.ts` darf bleiben (wird ggf. später wiederverwendet), wird aber nicht mehr im UI gemounted
- `boardCounts` State raus

## Technische Details

**Neue Helpers in `src/lib/`:**
- `onboarding-filter.ts` — lädt Chatter mit Onboarding-Tag ≥5 und ohne gesetztes Label, gruppiert nach Tag
- `label-tasks.ts` — lädt alle Chatter mit aktivem Label-Assignment, baut Karten-Payload, prüft `daily_todo_state` für „heute schon abgehakt"

**Seed-Logik:**
- Auf Today-Mount: `ensureSystemLabels(platform)` — prüft `chatter_labels` für User/Platform auf die 4 Namen, fügt fehlende ein

**Today.tsx Änderungen:**
- KIND_DEFS um `onboarding` + `label` erweitern (eigene Icons/Farben)
- Filter-Leiste: nach den existierenden Kind-Pills die zwei neuen Pills anhängen
- Label-Pill: Click öffnet Multi-Select-Sheet (shadcn `Sheet`) mit Liste aller `chatter_labels` für User/Platform, Auswahl in localStorage `today.activeLabelFilters`
- Content-Bereich rendert Onboarding-Gruppen bzw. Label-Karten in Eigenkomponenten (`OnboardingGroupedList`, `LabelChatterCard`)
- Abhaken nutzt bestehende `daily_todo_state`-Logik mit eigenem `todo_key`-Schema

**Status-Pills (Offen/Wins/Erledigt):** funktionieren mit den neuen Filtern automatisch via daily_todo_state.

## Aus-Scope

- Keine neuen DB-Migrations nötig — `chatter_labels` + `chatter_label_assignments` existieren bereits
- Keine Änderung an bestehenden Verzug/Recovery/Wakeup-Karten
- Keine Änderung an Label-Management-UI in TinderMode/ChatterSlideOver
