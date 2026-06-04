## "Push"-Sektion im Heute-Tab — Aktivierung + Performance-Push in einem

Zweck: **Du siehst auf einen Blick, wem du jetzt was schreibst** — egal ob er heute schon live ist und gepusht/gelobt werden soll, oder ob er heute noch gar nicht angefangen hat und du ihn erstmal **online holen** musst.

### Wer taucht auf?

Basis = alle Chatter aus dem **neuesten `analysis_report`** der aktuellen Platform (gleiche Aktiv-Logik wie überall sonst).

Daraus werden **zwei Spalten / Stacks** gebildet, je nach Live-Status heute:

```text
OFFLINE HEUTE  ←──── noch nicht live ────│──── heute schon live ────→  AKTIV HEUTE
```

### Buckets

**Spalte 1 — Offline heute** (kein Live-Datensatz für heute, oder letzter Update > X Stunden alt):

```text
🌙 KOMPLETT OFFLINE      heute noch keine Zeile in chatter_history_live
😴 ABGETAUCHT            heute angefangen, aber > 2h kein Update
⏰ SCHICHTSTART FÄLLIG   normalerweise um diese Uhrzeit aktiv (Schnitt aus History), aber noch nicht da
```

**Spalte 2 — Heute live** (Live-Datensatz vorhanden, Update frisch):

```text
🔥 HOT          today ≥ 150% des Tages-Pace → loben, halten
🚀 BOOST        100–150% Pace → kurzes Schulterklopfen, Tempo halten
💪 PUSH         70–100% Pace → motivieren, Endspurt
⚡ KICK         < 70% Pace bei > 30% Tagesfortschritt → klare Ansage
🩹 RESCUE       Stau ≥ 2h ODER Unread weit über persönlichem Schnitt
```

Reihenfolge nach Dringlichkeit: RESCUE → KICK → KOMPLETT OFFLINE → SCHICHTSTART FÄLLIG → ABGETAUCHT → PUSH → BOOST → HOT.

### Karte pro Chatter

- Name, Bucket-Badge mit Farbe/Icon, optional kleine letzte-Aktivität-Zeit
- Eine knappe Datenzeile:
  - Live: `today 240€ / Pace 380€ · 63% · Stau 1h`
  - Offline: `zuletzt heute 09:14 · Tages-Ø 420€ · sonst aktiv ab ~10:00`
- **Ein konkreter Push-Vorschlag in Klartext** (kein KI-Call by default, sofort sichtbar), z. B.:
  - KOMPLETT OFFLINE: „Schreib ihn an — heute noch nichts gemacht, normalerweise schon 200€ um diese Zeit"
  - SCHICHTSTART FÄLLIG: „Erinnerung: er fängt sonst um 10 Uhr an, jetzt ist 10:40"
  - ABGETAUCHT: „2h kein Update — kurz nachhaken ob alles okay"
  - HOT: „Loben: 180% Pace, sag ihm explizit dass das stark ist"
  - KICK: „Klare Ansage: 40% unter Pace, frag was blockiert"
- Buttons: **KI-Nachricht** (optional, nutzt bestehende `generate-goal-message` mit neuem Scenario `push_<bucket>`) · **Erledigt** · **Snooze 1h**

### UI-Platzierung

Neue Sektion über „Daily Todos" auf dem Heute-Tab.

- `SectionHeader`: Eyebrow `LIVE · PUSH`, Title `Wen pushst du jetzt?`, Subtitle `X offline · Y live · Z brauchen sofort Reaktion`
- Zwei nebeneinander liegende Stacks („Offline heute" links, „Heute live" rechts), auf Mobile gestapelt
- Bucket-Filter-Chips wie schon auf dem Heute-Tab, drag-scrollbar
- Erledigt/Snooze pro Tag persistiert in bestehender `daily_todo_state` mit `todo_key = "push:<chatter>:<bucket>:<YYYY-MM-DD>"` — keine neue Tabelle

### Technische Bausteine (für später)

- `src/lib/push-buckets.ts` — kombiniert: Report-Chatter + `chatter_history_live` heute + Aktivitäts-Schnitte aus `chatter_history` / `chatter_activity_sessions` → `{ bucket, reasons, suggestionText }`. Nutzt bestehendes `computeScore` aus `live-priority.ts`.
- „Übliche Startzeit" pro Chatter = Median der frühesten Live-Updates der letzten 14 Tage aus `chatter_history_live` oder `chatter_hourly_stats`.
- `src/components/today/PushSection.tsx` — Zwei-Spalten-Liste, eigene States.
- `generate-goal-message` Edge Function: neue Scenarios in Enum + Default-Templates (passend zur Boss/Founder-Tonalität).
- Keine neue Tabelle, keine neuen Secrets.

### Offen — kurz bestätigen

1. **Zwei Spalten ok** (Offline | Live) oder lieber **eine Liste, sortiert nach Dringlichkeit**?
2. **Bucket-Schwellen** (70% / 100% / 150% Pace, 2h Stau, 2h kein Update) — passt das oder lockerer/strenger?
3. **„Schichtstart fällig"** — soll ich aus den letzten 14 Tagen die übliche Startzeit ableiten, oder eine feste Default-Uhrzeit (z. B. 10 Uhr) nehmen, solange du keine pro-Chatter-Zeit setzt?
