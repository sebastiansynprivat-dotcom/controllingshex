## Bulk-Dialog: Accept rückgängig machen + Ziel editieren

Drei Änderungen am `BulkGoalMessagesDialog` (und passende Callbacks in `MonthlyGoals.tsx`).

### 1. Accept rückgängig (Un-Check)
Aktuell ist der grüne Haken nach Klick eingefroren. Neu: erneuter Klick = rückgängig.

- In `BulkGoalMessagesDialog.tsx`: Klick-Handler des grünen Buttons prüft, ob `acceptedSet.has(r.chatter)`. Wenn ja → `onUnaccept?.(r.chatter)` aufrufen, dann `acceptedSet` entfernen.
- Neuer Prop `onUnaccept?: (chatter: string) => Promise<void>`.
- In `MonthlyGoals.tsx` neue async-Funktion `revertAcceptedGoal(chatter)`:
  - Holt Label-ID für `LABEL_NAME`, löscht `chatter_label_assignments` (platform + label_id + chatter_name).
  - Löscht aus `coaching_notes` alle Einträge mit `note_text ILIKE 'Monatsziel%'` für (platform, chatter_name) — analog zu `clearAllCurrentGoals`.
  - Optimistisches UI: `rows` filtern (Eintrag entfernen), `suggestions` → `currentGoal: null` für diesen Chatter, `skipped` → diesen Chatter entfernen, damit er wieder in Vorschlägen + im Bulk-Dialog beim nächsten Öffnen auftaucht.
  - Toast: „Monatsziel für {chatter} entfernt".
- Dialog reicht `onUnaccept={revertAcceptedGoal}` durch.

### 2. „Schon abgehakte" beim nächsten Öffnen ausblenden
Funktioniert bereits: `effectiveTargets` filtert `currentGoal == null`. Nichts zu tun — Verhalten wird durch Punkt 1 korrekt: rückgängig-gemacht → `currentGoal=null` → erscheint wieder.

### 3. Ziel pro Karte editierbar
Im Karten-Header neben „Ziel: 1.234 €" wird das Zahlenfeld editierbar.

- Neuer State im Dialog: `editedGoals: Record<string, number>` (chatter → neuer Wert).
- Anzeige: Inline-Number-Input (kompakt, rechtsbündig, gleicher Stil wie `SuggestionCard` in `MonthlyGoals.tsx`). Pfeil-hoch/runter und Tipp-Eingabe.
- Effektiver Wert pro Karte: `editedGoals[chatter] ?? r.goal`. Dieser Wert wird verwendet bei:
  - Accept-Button-Klick → `onAccept(chatter, effectiveGoal)`
  - Copy & Auto-Accept → `acceptGoal(chatter, effectiveGoal)` und Toasts/`copyAll`-Block.
- Wenn Karte bereits accepted ist, Input disabled (erst nach Un-Accept wieder editierbar).
- Hinweis bei Änderung: kleines Badge „bearbeitet" + Originalwert ausgegraut daneben.

### Out of Scope
- Keine Persistenz des editierten Vorschlagswerts (analog zur bestehenden `SuggestionCard`-Logik — nur lokal bis Accept).
- Kein Bulk-Edit „alle ±10 %".
- DB-Verhalten bei Revert: nur Label-Assignment + `Monatsziel%`-Notes löschen. Andere Notes/State für den Chatter bleiben.

### Files
- `src/components/BulkGoalMessagesDialog.tsx` — Number-Input, `editedGoals`-State, Toggle-Logik für Accept, neuer Prop `onUnaccept`.
- `src/pages/MonthlyGoals.tsx` — Funktion `revertAcceptedGoal`, an Bulk-Dialog durchreichen.
