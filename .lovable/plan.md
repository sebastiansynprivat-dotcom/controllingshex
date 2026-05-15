## Problem
Karten basieren auf dem letzten Report-Snapshot (`chatter_history`) — Live-Daten (`chatter_history_live`) werden nur für „Wieder aktiv" genutzt. Folge:
- Recovery „−80 % Median" bleibt sichtbar, obwohl Chatter heute live wieder gut Umsatz macht
- „Sonja SCH entlasten — 79 offene Chats" bleibt, obwohl live nur noch 9 unread sind
- Verzug-Karten bleiben, obwohl live alles abgearbeitet wurde

## Fix
**Live-Snapshot als Suppress-Layer** zentral in `src/lib/today-engine.ts`. Direkt vor dem Bucket-Bauen jeden Signal gegen die Live-Werte des Chatters checken — wenn das Problem live nicht mehr existiert, Karte **droppen**. Wo sinnvoll, wird der angezeigte Wert (offene Chats, Heute-Umsatz) zusätzlich auf den Live-Stand aktualisiert.

### Architektur

In `buildTodayActions`:
1. Bereits existierende `liveRes` (Zeile ~508, holt `revenue, mass_dms, unread_chats`) hochziehen, sodass nicht nur `detectWakeups` sie sieht.
2. Eine `liveSnapshot: Map<chatterKey, { rev, dm, unread }>` aufbauen (aggregiert über alle Account-Zeilen pro Chatter, analog zu `liveToday` in `detectWakeups`).
3. Nach Signal-Generierung (vor `buckets`) Suppress-Filter laufen lassen.

### Suppress-Regeln (konkret)

Pro `signal.kind` und Chatter-Live-Werten:

| Kind | Suppress wenn … |
|---|---|
| `recovery` | `live.rev >= baseline * 0.7` (Chatter ist heute wieder ≥70 % des Medians) |
| `revenue` (Drop-Karte) | `live.rev >= meta.baselineRevenue * 0.7` |
| `verzug` | `live.unread <= max(5, baseline.openChats * 0.3)` UND `live.rev > 0` |
| `activity` (Jam, "X entlasten") | `live.unread <= max(10, meta.baselineOpenChats * 0.5)` |
| `activity` (Mass-DM-Drop) | `live.dm >= meta.baselineMassDms * 0.7` |
| `activity` (Inaktiv „fehlt im Report") | `live.rev > 0 OR live.dm > 0 OR live.unread > 0` |

Andere Kinds (`swap`, `mismatch`, `phase`, `slot`, `model`, `talent`, `potential`, `wakeup`, `positive`) bleiben unberührt — die hängen nicht an Tages-Snapshot-Werten.

### Wert-Refresh (zusätzlich zum Suppress)

Wenn Karte nicht gedroppt wird aber Live-Werte existieren, im `why`-Text die alte Snapshot-Zahl durch Live-Zahl ersetzen:
- „79 offene Chats" → „X offene Chats (live)" wenn `live.unread` vorhanden
- „Heute 12 €" → „Heute 12 € (live: Y €)" wenn deutlich abweichend

Konkret nur für `activity`-Jam und `revenue`-Drop — verhindert Verwirrung („live aktuell" als kleiner Tag im Why).

### Edge Cases
- Kein Live-Eintrag für den Chatter → Karte bleibt unverändert (kein Suppress)
- Live älter als Schwelle: Datenfrische über `updated_at` aus `chatter_history_live` checken — wenn > 60 min alt, Live ignorieren (sonst suppressen wir basierend auf veraltetem Live-Stand)

### Nicht geändert
- Keine Änderung an `daily-todos.ts` oder `revenue-tasks.ts` selbst — die generieren weiter auf Report-Basis. Nur das Merge-Layer in `today-engine.ts` filtert.
- Bucket-/Scoring-/Section-Logik bleibt
- Kein DB-Eingriff