# Smart Daily To-Do — auto-generierte Aufgabenliste

Ziel: Beim Öffnen der App siehst du eine **priorisierte Liste konkreter Aktionen für heute**, automatisch berechnet aus heutigem Report + Historie. Keine Datenwand, sondern "Mach das, dann das, dann das".

## Wo das landet

Neue Seite **`/today`** als erster Eintrag in der Sidebar (Icon: ListChecks). Zusätzlich kompaktes **"Heute zu tun"-Widget** ganz oben auf dem Dashboard mit Top-3 + Link zur Vollansicht.

## Wie eine Aufgabe aussieht

Jede To-Do hat:
- **Titel** (action-orientiert): z.B. *"Lisa pushen — Mass-DMs auf 6 hochziehen"*
- **Warum** (1 Satz Beleg aus Daten): *"Heute nur 1 Mass-DM (Ø 4,5 / Tag, −78%)"*
- **Chatter** (chip, klickbar → öffnet ChatterSlideOver)
- **Priority-Score** 0–100 (treibt Sortierung)
- **Kategorie-Tag**: Umsatz / Aktivität / Verzug / Model / Recovery
- **Aktionen rechts**: ✓ Erledigt · ⏰ Snooze (heute / morgen) · ✕ Heute irrelevant

Layout ähnlich `RecoveryQueueCard` aber als eigenständige sortierte Liste.

## Wie die To-Dos generiert werden

Reine Client-Side Aggregation aus existierenden Daten — **keine neue Edge Function**. Quellen:
1. `chatter_history` (heute + 14T Baseline)
2. `anomaly_alerts` (status = new/seen)
3. `model-tracking` Trouble-Detector (bereits gebaut)
4. `chatter_daily_goals` (heutige Ziele)
5. `recovery-queue` (bereits vorhanden)

### Regeln (jede produziert max. 1 To-Do pro Chatter/Model):

| Regel | Score | Beispiel |
|---|---|---|
| Verzug ≥ 3 Tage | 90 + (Tage·5) | "Sarah dringend — 5 Tage Verzug" |
| Mass-DM Drop ≥ 50% | 70 + drop% | "Tom Mass-DMs auf Soll bringen (1 statt Ø 5)" |
| Revenue-Drop ≥ 40% (heute vs. 14T-Median) | 75 + drop% | "Max checken — Umsatz −60%" |
| Chat-Jam (offene > 1.5× Ø, ≥ 30 abs.) | 65 | "Lisa entlasten — 47 offene Chats" |
| Model in Trouble (aus model-tracking) | 80 | "Account 'Mia' absäuft seit Wechsel zu Tom (−35%)" |
| Inaktivität (chatter fehlt heute aber Vortage da) | 60 | "Anna fehlt im Report — Status klären" |
| Positive Outlier (Revenue ≥ 1.8× Ø) | 40 | "Was läuft bei Jana richtig? (+120%) — fragen" |
| Tagesziel verfehlt > 30% | 55 | "Max: 80€ statt Ziel 200€" |
| Recovery-Queue Top-Eintrag | 50 | "Recovery: Account X reaktivieren" |
| Mass-DMs Team-Total < 70% Ø | 35 | "Team-MassDMs heute nur 18 (Ø 32)" |

Score wird zum Sortieren benutzt; Top 10 fett angezeigt, Rest collapsable.

### Snooze / Done Tracking

Neue Tabelle `daily_todo_state` (klein):
- `user_id`, `platform`, `todo_key` (z.B. `"verzug:Sarah:2026-05-03"`)
- `status` (`done` | `snoozed` | `dismissed`)
- `snoozed_until`, `acted_at`

So bleibt eine erledigte To-Do heute weg, taucht aber morgen ggf. wieder auf wenn das Problem persistiert. `todo_key` enthält das Datum → automatisches Reset jeden Tag (außer du dismisst explizit).

## Tech / Files

**Neu:**
- `src/lib/daily-todos.ts` — `generateDailyTodos(platform, userId)` + Regel-Engine
- `src/pages/Today.tsx` — die Seite
- `src/components/DailyTodoList.tsx` — die Liste (wiederverwendbar fürs Dashboard-Widget)
- `src/components/DailyTodoWidget.tsx` — kompakte Top-3 Variante

**Modifikationen:**
- `src/App.tsx` — Route `/today`
- `src/components/AppSidebar.tsx` — Sidebar-Eintrag oben
- `src/pages/Dashboard.tsx` — Widget oben einfügen

**DB-Migration:**
- Tabelle `daily_todo_state` mit RLS (user_id basiert, wie alle anderen Tabellen)

## Was nicht passiert
- Keine Edge Function (Client reicht — Daten sind eh schon im Browser)
- Kein KI-Call (Regeln sind deterministisch, schnell, transparent)
- Keine Push-Notifications (kann später kommen)

Sag Bescheid wenn ich loslegen soll, oder ob du Regeln streichen / ergänzen willst (z.B. eigene Regel "alle Models mit Tier-A in Trouble priorisieren").