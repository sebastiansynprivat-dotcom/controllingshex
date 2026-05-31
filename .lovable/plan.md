## Ziel

Im Dialog „Nachrichten für alle generieren" soll beim Kopieren einer Nachricht das vorgeschlagene Monatsziel direkt mitgesetzt werden – sowohl beim einzelnen „Kopieren"-Button als auch bei „Alle kopieren". So spart man sich das separate „Annehmen" pro Karte.

## Änderungen

### `src/components/BulkGoalMessagesDialog.tsx`
- Neue Prop `onAccept(chatter: string, goal: number): Promise<void>` (vom Parent durchgereicht).
- Neuer State `acceptedSet: Set<string>` + `acceptingSet: Set<string>` für UI-Feedback.
- Optionaler Toggle oben im Dialog: **„Ziel beim Kopieren übernehmen"** (default: an), per `localStorage` gemerkt. So bleibt das alte Verhalten verfügbar, falls man nur Text will.
- `copyOne(idx, text)`: nach erfolgreichem Clipboard-Write zusätzlich `onAccept(chatter, goal)` aufrufen (nur wenn Toggle an & noch nicht akzeptiert). Toast: „Kopiert & Ziel gesetzt: {EUR}".
- `copyAll()`: nach Clipboard-Write parallel `onAccept` für alle noch nicht akzeptierten Chatter aufrufen. Toast: „Alle Nachrichten kopiert · N Ziele gesetzt".
- Pro Card-Header dezenter Status-Hinweis, wenn Ziel gesetzt wurde („✓ Ziel gesetzt"). Bei laufendem Akzeptieren kleiner Spinner.

### `src/pages/MonthlyGoals.tsx`
- `acceptSuggestion` so anpassen, dass es als Promise nutzbar bleibt (ist schon async) und an `BulkGoalMessagesDialog` als `onAccept` weitergegeben wird.
- `setAcceptingChatter` ist single-slot — für Bulk genügt es, den lokalen Set-State im Dialog zu führen; `acceptSuggestion` ruft am Ende `setReloadKey(k => k+1)`, was die Liste neu lädt. Bei Bulk vermeiden wir N Reloads, indem wir Reload erst nach Schließen des Dialogs auslösen → kleine Anpassung: `acceptSuggestion` bekommt optionalen Parameter `{ silentReload?: boolean }`, der das `setReloadKey` überspringt. Dialog triggert beim Schließen einmalig `setReloadKey`.

### UX-Detail
- Wenn ein Ziel bereits gesetzt ist (`acceptedSet` hat den Chatter), wird beim erneuten Klick auf „Kopieren" nur noch der Text kopiert, kein zweites Insert.
- Fehler beim Akzeptieren werden pro Card via dezentem roten Hinweis gezeigt und blockieren das Kopieren nicht.

## Nicht-Ziele

- Kein neuer Backend-Code, keine Schema-Änderungen.
- Verhalten der einzelnen `SuggestionCard` („Annehmen"-Button) bleibt unverändert.
