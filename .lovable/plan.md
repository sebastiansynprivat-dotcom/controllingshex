## Ziel

Im Push-Tab zwei Dinge verbessern:

1. **Neuer Signal-Typ:** Models, die heute noch 0 € gemacht haben, aber im 7-Tage-Schnitt > 10 €/Tag liegen. Immer sichtbar, damit du am Abend gezielt die verantwortlichen Chatter noch mal anhauen kannst.
2. **Layout des Push-Tabs neu gliedern**, damit die Sektionen abends auf einen Blick klar sind — statt einer langen Chip-Reihe echte visuelle Gruppen.

## Neuer Bucket: „Model schweigt"

- **Trigger:** Model hat heute (`chatter_history_live` oder `chatter_history` mit `analysis_date = today`) 0 € Umsatz UND im 7-Tage-Schnitt (ohne heute) > 10 €/Tag.
- **Rauschen-Filter:** Model muss in den letzten 7 Tagen an mind. 3 Tagen Umsatz > 0 gehabt haben (sonst tote Accounts).
- **Anzeige:** Model-Name + verantwortliche Chatter (heutige Zuordnung aus `chatter_history` `chatter_name → account`). Datazeile: `7T-Ø: 45 €/Tag · gestern: 62 € · heute: 0 €`.
- **Aktion pro Karte:** Klick auf Chatter-Name öffnet ChatterSlideOver wie gehabt; „Erledigt"/„Snooze 1h" wie bei den anderen Push-Karten.
- **Immer sichtbar** — kein Uhrzeit-Gate.

## Push-Tab Layout-Redesign

Statt einer flachen Chip-Filter-Reihe mit allen Buckets vermischt, drei klare visuelle Sektionen mit Sektions-Header + Karten darunter:

```text
┌─────────────────────────────────────────────┐
│ Header: „Wen pushst du jetzt?"              │
│         X offline · Y live · Z dringend     │
├─────────────────────────────────────────────┤
│ 🔥 JETZT LIVE                (3)            │
│    Rescue · Kick · Hot · Boost · Push       │
│    → Karten                                 │
├─────────────────────────────────────────────┤
│ 🌙 CHATTER OFFLINE           (5)            │
│    Schichtstart fällig · Abgetaucht · Offline│
│    → Karten                                 │
├─────────────────────────────────────────────┤
│ 📉 MODELS SCHWEIGEN          (4)            │
│    Heute 0 € trotz aktivem 7T-Schnitt       │
│    → Karten                                 │
└─────────────────────────────────────────────┘
```

- Jede Sektion collabsibel (Chevron), Standard: aufgeklappt wenn > 0 Karten.
- Innerhalb einer Sektion bleibt die bisherige Sortierung nach Bucket-Order + Score.
- Wenn eine Sektion leer ist: gar nicht rendern (kein „Alles klar"-Platzhalter pro Sektion, nur ein globaler wenn alle drei leer sind).
- Bucket-Filter-Chips **entfallen** — die Gruppierung ersetzt sie. Weniger Klicks, klareres Abend-Scanning.

## Technische Umsetzung

**`src/lib/push-buckets.ts`**
- Neuer `PushBucketId`: `"silent_model"` mit eigenem Look (z. B. `bg-slate-500/[0.06]`, `border-slate-400/25`, `text-slate-300`, Emoji 📉).
- Neues Feld `group` auf den Buckets nutzen: bereits vorhanden (`"live" | "offline"`) — dritte Gruppe `"silent_model"` hinzufügen.
- Neue Loader-Funktion oder Erweiterung von `loadPushCards`: lädt zusätzlich
  - `chatter_history` letzte 7 Tage inkl. `account`-Spalte
  - Aggregiert pro Model: `sum(revenue_today)/days` (7T-Ø ohne heute), heutiger Umsatz, Chatter der heute drauf sitzen
  - Filter: 7T-Ø > 10 €, aktive Tage ≥ 3, heute = 0 €
- Neue `PushCard`-Instanzen mit `chatterName` = Model-Name (für Anzeige), zusätzlichem Feld `assignedChatters?: string[]` für die Sub-Zeile.

**`src/components/today/PushSection.tsx`**
- Karten nach `bucket.group` in drei Arrays teilen: `liveCards`, `offlineCards`, `silentModelCards`.
- Chip-Filter-Block entfernen. Stattdessen drei `<SectionBlock>`-Komponenten rendern, jede mit eigenem Header (Emoji, Label, Count, Chevron) und eigenem Collapse-State (`useState<Record<"live"|"offline"|"silent","boolean">>`).
- `PushCardItem` erweitern: wenn `assignedChatters?.length`, kleine Zeile darunter mit Chatter-Chips, klickbar zum Öffnen des Slide-Overs.
- Global-Stats-Zeile im Header ergänzen um `silentModels`-Count.

**Keine DB-Änderungen nötig** — alle Daten sind schon da (`chatter_history` mit `account` + `revenue_today`, `chatter_history_live`).

## Nicht Teil dieses Plans

- Uhrzeit-Gate für Silent-Models (User will „immer sichtbar")
- Zusätzliche Filter-Optionen für andere Buckets
- Änderungen am ChatterSlideOver oder an anderen Heute-Tabs
