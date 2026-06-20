## Ziel
„Monatsziele" wird zu „**Ziele**" mit zwei Tabs: **Monatsziele** und **Wochenziele**. Wochenziele = voller Klon der Monatsziele-Logik auf Wochenbasis.

## UI / Navigation
- Sidebar: „Monatsziele" → „**Ziele**", Route `/monatsziele` → `/ziele` (alte Route bleibt als Redirect für Bookmarks)
- Neue Seite `src/pages/Goals.tsx`: Tabs „Monatsziele" / „Wochenziele" (shadcn `Tabs`, Persistenz via `localStorage`)
- Header „Monatsziele" innerhalb der Monats-Komponente entfernen (steht jetzt im Tab)

## Wochenziele — Logik (Parallel zu Monatsziele)
- Label-Name: `Wochenziel` (neues Label, automatisch angelegt wie „Monatsziel")
- Coaching-Note-Format: `Wochenziel KW <num> <Year>: <EUR>` — gespeichert in `coaching_notes` (kein neues Schema nötig dafür)
- Neue Tabelle `weekly_goal_skips` (analog `monthly_goal_skips`, mit `week_key` statt `month_key`, z.B. `2026-W25`)
- Neue Lib `src/lib/weekly-goals.ts`:
  - `parseGoalFromNote` (geteilt mit monthly)
  - `computeWeekProgress(goal, currentRevenue, today)` — Soll/Tag, erwartet, Status (Mo–So)
  - `suggestWeeklyGoal(avgDailyRevenue)` und `suggestWeeklyFromModels(roster, baselines, stretch=1.10)` — 7-Tage-Basis, runden auf 10 EUR
  - Hilfen: `weekKey(date)` (ISO `YYYY-Www`), `firstOfNextWeek`, `nextWeekLabel`
- Aktueller Wochenumsatz: Summe `revenue_today` aus `chatter_history` für Mo–So der laufenden bzw. Ziel-Woche

## Datei-Plan
- **Neu** `src/pages/Goals.tsx` — Tabs-Wrapper
- **Neu** `src/pages/WeeklyGoals.tsx` — Klon von `MonthlyGoals.tsx`, ersetzt: Label → „Wochenziel", Period-Math (Monat→ISO-Woche), Tabelle `monthly_goal_skips` → `weekly_goal_skips`, Suggestions auf Wochenbasis, Texte (de)
- **Neu** `src/lib/weekly-goals.ts`
- **Neu** Migration: Tabelle `weekly_goal_skips` (+ GRANTs + RLS-Policies analog `monthly_goal_skips`)
- **Edit** `src/components/AppSidebar.tsx` — Label „Ziele", URL `/ziele`
- **Edit** `src/App.tsx` — neue Route `/ziele` → `Goals`, alte `/monatsziele` → `Navigate to /ziele`
- **Edit** `src/pages/MonthlyGoals.tsx` — den großen `Monatsziele`-Header (Z. 1086) entfernen oder kleiner machen (steht jetzt im Tab)

## Hinweis
`BulkGoalMessagesDialog`/`GoalMessageDialog` bleiben unverändert — beide bekommen schon `proposedGoal` als Zahl, das funktioniert für Wochen- und Monatsziele gleich (Nachrichten-Templates erwähnen den Zeitraum generisch).
