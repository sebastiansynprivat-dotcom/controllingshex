## Ziel
Wenn ein Chatter mehrere Accounts (Modelle) auf derselben Plattform hat, muss der komplette Wochenziel-Flow (Vorschlag → Fortschritt → gespeichertes Ergebnis → Status/Bucket) konsistent die **Summe aller Accounts** verwenden. Aktuell kommt es zu falschen Vorschlägen und falschen „über/unter"-Status-Werten.

## Was ich in den Daten gefunden habe
Bei „Jeanette Ob" (Maloum, KW29) hat die Chatterin 2 Model-Accounts (`bondgirl4`, `leakatz`) mit eigenen `revenue_today`-Werten pro Tag. Die Snapshot-Aggregation summiert korrekt auf 961 € (matcht `weekly_goal_results.actual_eur = 961`). Das eigentliche Problem liegt an drei Stellen im UI-Code, wo dieselbe Summen-Logik NICHT konsequent angewendet wird.

## Konkrete Bugs, die ich fixen werde

**Bug 1 — Vorschlags-Durchschnitt ist nicht dedupliziert** (`src/pages/WeeklyGoals.tsx`, Zeilen ~792–802)
`sumByChatter` addiert jede Zeile aus `chatter_history` roh auf, ohne die (chatter, date, account)-Dedup, die `monthRevByChatter` verwendet. Wenn für einen Tag/Account mehrere Reports existieren (z.B. leerer `account`-String + gefüllter Wert am selben Tag), wird der Umsatz doppelt gezählt → Ø-Tag zu hoch → Wochenziel-Vorschlag zu hoch.
→ Dieselbe MAX-Dedup wie in `monthRevMax` auch auf `sumByChatter` / `daysByChatter` anwenden.

**Bug 2 — Status-Bucket („über/unter") kann aus verzerrten Werten kommen** (`src/pages/WeeklyGoals.tsx`, Zeilen ~845–873)
`lastAchievementByChatter = actual/goal` der letzten Woche kommt direkt aus `weekly_goal_results`. Wenn der Snapshot der Vorwoche gelaufen ist, während noch nicht alle Reports drin waren, wurde ein niedrigerer `actual_eur` gespeichert → Bucket rutscht fälschlich auf „off_track" → nächste Vorschläge zu niedrig, Anzeige „unter" obwohl der Chatter eigentlich „über" war.
→ Beim Laden im UI die letzte Woche live aus `chatter_history` **neu** berechnen (dedupliziert) und diesen Wert für den Bucket verwenden. `weekly_goal_results` bleibt als historischer Snapshot bestehen, wird aber nicht mehr als Wahrheit für den Bucket der aktuell nächsten Planungswoche genutzt.

**Bug 3 — Snapshot der Vorwoche darf laufende Reports nicht einfrieren**
`snapshot-weekly-goals` läuft Montag früh und schreibt `weekly_goal_results` einmalig. Kommt später noch ein Report für einen Tag der Vorwoche rein, bleibt das gespeicherte Ergebnis falsch (zu niedrig).
→ Snapshot so umbauen, dass er beim erneuten Lauf **immer neu berechnet und upserted**, solange die Woche „frisch" (≤ 14 Tage alt) ist. Ein zusätzliches CLI-taugliches Recompute für ältere Wochen als manueller Trigger.

**Bug 4 — Backfill der bereits verfälschten Ergebnisse**
Nach Fixes einmal `weekly_goal_results` für die letzten 6 Wochen aus `chatter_history` neu aufbauen, damit die Anzeige „Vergangene Wochenziele" und die Bucket-Ableitung wieder mit der Realität übereinstimmen.

## Änderungen im Detail

### Frontend (`src/pages/WeeklyGoals.tsx`)
```text
Load-Effect:
├─ dedupHelper(rows)  →  Map<chatter|date|account, MAX(revenue_today)>
├─ sumByChatter / daysByChatter  ← aus deduped Map (statt raw)
├─ letzte-Woche-Recompute LIVE aus chatter_history (deduped)
│   └─ lastAchievementByChatter = actualLive / goalFromNote
└─ Bucket (Star/Strong/On/Close/Off) → aus live-Wert
```
Tooltip auf der Bucket-Chip erweitern: `„KW28: Ziel 1.290 € / Ist 961 € = 75 % — bondgirl4: 340 €, leakatz: 621 €"` — so ist sofort sichtbar, wie sich der Status zusammensetzt.

### Edge Function (`supabase/functions/snapshot-weekly-goals/index.ts`)
- Snapshot re-runbar machen: für alle Wochen, deren `week_end` ≤ 14 Tage her sind, neu berechnen und via `onConflict` upserten (nicht überspringen).
- Neuen optionalen Query-Parameter `?weeks=6` unterstützen, damit ich einen einmaligen Backfill-Trigger starten kann.

### Backfill (einmalig)
Über die Edge Function mit `?weeks=6` alle Vorwochen für alle aktiven User+Plattformen neu berechnen. Danach zeigt die „Vergangene Wochenziele"-Tab und die Bucket-Anzeige die korrekten Werte.

## Was NICHT geändert wird
- Snapshot-Struktur (1 Row pro `user × platform × chatter × week_key`) bleibt — pro Plattform ein Ergebnis, Multi-Account-Summe passiert innerhalb der Zeile. Das entspricht deiner Antwort „Summe (A+B)".
- Kein Cross-Platform-Merge — ein Chatter, der auf Maloum UND Brezzels arbeitet, bekommt weiterhin pro Workspace ein eigenes Wochenziel & Ergebnis (so wie bisher gewünscht).

## Verifikation nach den Fixes
1. Für einen konkreten Multi-Account-Chatter (z.B. Jeanette Ob / Maloum) prüfen: Vorschlag-Ø, laufender Wochenumsatz und Vorwochen-Achievement stimmen mit der SQL-Rohsumme überein.
2. Vergleich `weekly_goal_results.actual_eur` vor/nach Backfill für die letzten 4 Wochen — dokumentiert, welche Einträge korrigiert wurden.
3. Sichtprüfung „Vergangene Wochenziele"-Tab: Status ✅/❌ passt zu tatsächlicher Summe.