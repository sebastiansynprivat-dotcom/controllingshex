## Problem

Aktuell verschwindet eine Label-Karte für immer, sobald sie einmal mit „Abschließen" abgehakt wurde. Grund: Der Todo-Key (`label:<labelId>:<chatter>`) hat **kein Datum**, und `daily_todo_state` speichert pro Key genau einen Done-Status. Einmal done → für alle Zukunft ausgeblendet, obwohl das Label noch am Chatter hängt.

## Ziel

Solange ein Label an einem Chatter klebt, soll die Karte **jeden Tag wieder** im Heute-Tab erscheinen — egal ob gestern abgehakt. Erst wenn das Label entfernt wird (X-Button „Label" oder über die Label-UI), verschwindet die Karte dauerhaft. Gilt für Maloum, Brezzels und 4Based gleichermaßen (Logik ist platform-agnostisch).

## Änderung

Eine Datei: `src/lib/label-tasks.ts`

- `labelTodoKey(labelId, chatterName)` → zusätzliches Argument `dateStr` (heutiges Datum, `YYYY-MM-DD`).
- Neuer Key: `label:<labelId>:<chatter>:<YYYY-MM-DD>`
- In `loadLabelCards` wird das heutige Datum beim Erzeugen jeder Karte mitgegeben.

Effekt: Beim Tageswechsel ändert sich der Key → `daily_todo_state` kennt ihn noch nicht → Karte ist wieder „offen". Alte Done-Einträge bleiben harmlos in der DB liegen (kein Cleanup nötig, da sie nie wieder referenziert werden — bei Bedarf später per Cron aufräumbar).

Keine Schema-Änderung, keine Migration, keine UI-Änderung. Onboarding-Verhalten und Wins/Push/andere Filter bleiben unberührt.

## Edge Cases

- **Heute schon abgehakt + Page-Reload am selben Tag**: Key enthält heutiges Datum → bleibt korrekt als „done" ausgeblendet bis Mitternacht.
- **Label heute entfernt**: `removeLabelFromChatter` löscht Assignment → Karte fällt sofort raus (unverändert).
- **Mehrere Labels am selben Chatter**: Jedes Label hat eigenen Key inkl. Datum → unabhängig abhakbar (unverändert).
