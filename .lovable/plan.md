## Skip-Option im Bulk-Nachrichten-Dialog

Im `BulkGoalMessagesDialog` (öffnet sich beim Klick auf „Nachrichten für alle") gibt es aktuell pro Karte nur das Häkchen zum Übernehmen. Ich füge daneben einen **Skip-Button** (X-Icon) hinzu.

### Verhalten
- **Skip pro Karte**: X-Button im Karten-Header neben dem grünen Häkchen.
- Klick → Chatter wird in `skippedSet` aufgenommen, Karte wird ausgegraut (gleiche `opacity-60` Behandlung wie „accepted") und mit Badge „Übersprungen" markiert. WhatsApp-/Copy-Buttons werden deaktiviert.
- **Persistenz**: Skip wird in den Parent (`MonthlyGoals.tsx`) über einen neuen Callback `onSkip(chatter)` gemeldet → Chatter landet im bestehenden `skipped: Set<string>` State, sodass er auch nach Dialog-Schließen aus den Vorschlägen verschwindet (gleicher Mechanismus wie der bereits existierende Swipe-Skip).
- Toggle: Erneutes Klicken auf X = Skip rückgängig.
- Skip + Accept schließen sich gegenseitig aus.

### Files
- `src/components/BulkGoalMessagesDialog.tsx`
  - Neuer Prop `onSkip?: (chatter: string) => void`
  - Neuer State `skippedSet: Set<string>`
  - X-Button (`lucide-react` `X` ist bereits importiert) im Karten-Header
  - Visuelles Styling konsistent mit Accept (opacity-60, rotes Akzent statt emerald)
- `src/pages/MonthlyGoals.tsx`
  - `<BulkGoalMessagesDialog … onSkip={(c) => setSkipped(prev => new Set(prev).add(c))} />`

### Nicht im Scope
- Keine DB-Persistenz des Skips (genau wie der bestehende Swipe-Skip nur session-lokal).
- Kein „Skip alle"-Bulk-Button — nur pro Karte.