## Problem

In `src/pages/MonthlyGoals.tsx`:

1. **Flash beim Annehmen.** Sowohl Single-Accept als auch Bulk-Accept bumpen am Ende `reloadKey`, was den gesamten Lade-Block neu ausführt (alle Reports, Notes, 60-Tage-History, Vorschläge). Das fühlt sich nicht smooth an.
2. **Chatter taucht nicht zuverlässig in „Aktuelle Monatsziele" auf.** Nach Accept landet er zwar im `skipped`-Set (verschwindet aus Future), aber `rows` wird nur aktualisiert, wenn der Full-Reload sauber durchläuft. Bei Race-Conditions (Realtime-Event auf `chatter_history`, paralleler Reload, oder noch nicht propagierter Insert) bleibt die Current-Liste stale → Philipp S. ist „weg".

## Lösung — optimistisches Update statt Reload

### `acceptSuggestion(chatter, goal, opts)`
- Entferne den `setReloadKey((k) => k + 1)`-Aufruf am Ende.
- Neuer optionaler Callback `opts.onAccepted?(chatter, goal)` — wird nach erfolgreichem DB-Insert aufgerufen.
- Toast bleibt wie gehabt (außer `silentToast`).

### Single-Accept (SuggestionCard `onAccept`)
- Nach erfolgreichem `acceptSuggestion`:
  - **`setSkipped`**: Chatter raus aus Future (wie bisher).
  - **`setRows`** optimistisch: vorhandene Row updaten (`progress = computeGoalProgress(goal, s.monthRevenue, new Date())`, `noteText = "Monatsziel <Monat>: <€>"`, `noteDate = new Date().toISOString()`) ODER neue Row anhängen, falls noch nicht drin. `s.monthRevenue` ist bereits aus dem Suggestion-Pool bekannt — kein zusätzlicher Fetch.
  - **`setSuggestions`**: `currentGoal` der Suggestion auf das neue `goal` setzen (für den Fall, dass der User `skipped` resettet).

### Bulk-Accept (`BulkGoalMessagesDialog.onAccept`)
- Gleiche optimistische Logik pro Chatter.
- Beim Schließen des Bulk-Dialogs: **kein** automatischer `setReloadKey`-Bump mehr (aktuell in `onClose`). Optional: nur reloaden wenn der User explizit refresht.

### Helper
Eine kleine Funktion `applyAcceptedGoalToRows(chatter, goal, monthRevenue)` im Component-Scope, die das `setRows`-Update kapselt (Update-or-Insert), damit Single- und Bulk-Pfad denselben Code teilen.

### Realtime-Channel
Der `chatter_history`-Realtime-Listener (Zeile ~672) bumpt weiter `reloadKey` bei echten neuen Reports — das bleibt unverändert, weil das der einzige Trigger sein soll, der einen echten Refresh rechtfertigt.

## Technische Details

- `ChatterGoalRow` braucht: `chatter`, `noteText`, `noteDate`, `progress`. `computeGoalProgress(goal, monthRev, today)` liefert das `progress`-Objekt — bereits importiert.
- `monthRevenue` für Optimistic-Update kommt für Single aus `s.monthRevenue` der `SuggestionRow`. Für Bulk müssen wir die `monthRevenue` aus dem Suggestion-Pool nachschlagen (Map `chatter → monthRevenue` einmal im Closure bauen oder direkt aus `suggestions`-State per `find`).
- `monthLabel` für `noteText` analog zu `acceptSuggestion`: `today.toLocaleDateString("de-DE", { month: "long", year: "numeric" })`.

## Ergebnis

- Klick auf „Überschreiben" → Card verschwindet sofort aus Future, Chatter erscheint sofort in „Aktuelle Monatsziele" mit korrekter Progress-Bar, **kein** Full-Reload, **kein** Flash.
- Bulk-Annahme genauso — alle akzeptierten Chatter sind nach Schließen sofort in Current sichtbar.
- Reload nur noch bei echten neuen Reports via Realtime.
