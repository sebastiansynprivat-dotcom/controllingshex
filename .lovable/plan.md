## Problem
Wenn du in den Monatsziele-Vorschlägen jemanden mit dem X überspringst, lebt das nur im React-State (`skipped: Set<string>`). Beim Plattform-Wechsel wird `MonthlyGoals` neu geladen und der Skip ist weg → derselbe Chatter taucht wieder in Vorschlägen + Bulk-Dialog auf.

Abgehakte (`Accept`) sind nicht betroffen — die werden bereits über `chatter_label_assignments` + `coaching_notes` in der DB gespeichert und beim Reload korrekt als „aktuelle Monatsziele" gefiltert.

## Lösung
Skips pro `(user_id, platform, chatter_name)` persistent in einer neuen Tabelle speichern. Beim Laden der Seite wird die Tabelle mitgelesen und in den `skipped`-Set gehydriert.

### 1. Neue Tabelle `monthly_goal_skips`
- Spalten: `id`, `user_id`, `platform`, `chatter_name`, `created_at`
- Unique-Constraint auf `(user_id, platform, chatter_name)`
- RLS: User darf nur eigene Zeilen sehen/inserten/löschen, plus `service_role` full access
- Skip ist **permanent pro Plattform**, bis du ihn aktiv aufhebst (kein Monatszeitstempel, weil du den Workflow „nicht mehr vorschlagen" willst).

### 2. `MonthlyGoals.tsx`
- **Laden**: Im Haupt-`useEffect` zusätzlich `monthly_goal_skips` für `(user, platform)` abfragen und `setSkipped(new Set(rows.map(r => r.chatter_name)))`.
- **Skip setzen** (an drei Stellen, jetzt nur State-Mutation):
  - SuggestionCard X-Button (~Zeile 1259)
  - Bulk-Dialog `onSkip` (~Zeile 1296)
  - intern in `markChatterAsHandled` (~Zeile 854)
  → Alle drei rufen neue Async-Funktion `persistSkip(chatter)` auf, die in DB upserted und dann den lokalen Set updated. Optimistisch: erst State, dann DB; bei Fehler rollback + Toast.
- **Skip aufheben**: Beim Accept (`acceptedSet` im Bulk-Dialog) und in `revertAcceptedGoal` zusätzlich die Skip-Zeile aus DB löschen, damit derselbe Chatter nach „Zurücksetzen" wieder vorgeschlagen wird (passt zur bestehenden Logik in Zeile 953–958).
- **„Aufheben"-UX** in Bulk-Dialog: Das X-Icon ist bereits Toggle (`skipped ? "Skip aufheben"`). Der Toggle-Handler ruft jetzt `persistSkip` / `persistUnskip` statt nur State.
- **Reset bei `clearAllCurrentGoals`** (Zeile 911): nicht mehr `setSkipped(new Set())`, weil Skip jetzt unabhängig von „aktuellen Zielen" lebt. Stattdessen unverändert in DB lassen.

### 3. `BulkGoalMessagesDialog.tsx`
- `skippedSet` initial aus Props-Targets ableiten: Targets, die bereits in `skipped` der Page sind, kommen ohnehin nicht rein (effectiveTargets filtert per `currentGoal == null`, aber `skipped` filtert in der Page bereits vorher → keine Änderung nötig im Dialog selbst).
- `onSkip(chatter)` → in Page = `persistSkip(chatter)`.
- Toggle „Skip aufheben" → neuer optionaler Prop `onUnskip?: (chatter: string) => Promise<void>` analog zu `onUnaccept`. Page reicht `persistUnskip` durch.

### Files
- **Neue Migration**: `monthly_goal_skips` Tabelle + GRANTs + RLS
- `src/pages/MonthlyGoals.tsx`: Skip-Hydration im Loader, `persistSkip` / `persistUnskip` Funktionen, an SuggestionCard + BulkDialog durchreichen
- `src/components/BulkGoalMessagesDialog.tsx`: neuer Prop `onUnskip`, Toggle-Handler ruft beide auf

### Out of Scope
- Bulk „alle Skips zurücksetzen" Button — kann später nachgereicht werden.
- Monatlich auslaufende Skips — bewusst nicht, du willst dauerhaftes Ausblenden.
- Persistenz von `acceptedSet` im Bulk-Dialog — bereits über `currentGoal`-Filter implizit gegeben.
