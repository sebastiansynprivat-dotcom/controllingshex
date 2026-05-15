## Ziel
Auf Talent-Karten („🚀 Riser auf Account X hochziehen") einen Button **„↻ Anderer Account"** zeigen. Klick → die aktuelle Riser-Account-Kombi wird abgelehnt und die Engine schlägt einen anderen verwaisten Account vor — **niemals einen, der gerade in einer anderen Talent-Karte steht**.

## DB
**Neue Tabelle `talent_account_rejections`**
- `user_id uuid`, `platform text`, `riser_norm text`, `account_norm text`, `rejected_at timestamptz default now()`
- RLS: own-row select/insert/delete
- Lookup: alle Einträge mit `rejected_at >= now() - 7 days` aktiv (ältere fließen wieder ein)

## Code

### `src/lib/talent-rejections.ts` (neu)
- `loadActiveRejections(platform): Promise<Set<string>>` → Set aus `${riserNorm}|${accountNorm}`
- `addRejection(platform, riserName, accountName)` → insert

### `src/lib/talent-scout.ts`
- `findTalentMatches(platform, rejectedPairs?: Set<string>)` — beim Auswählen des `candidate` zusätzlich filtern: `if (rejectedPairs.has(\`${wKey}|${norm(o.a.account)}\`)) return false;`
- `usedOrphans` bleibt → der Ersatz-Account taucht nicht in einer anderen Talent-Karte auf (existierende Logik)

### `src/lib/daily-todos.ts`
- Rejections vor `findTalentMatches` laden, übergeben
- Talent-Todo `meta` erweitern: `{ matchScore, riserNorm, accountNorm, accountLabel }`

### `src/lib/today-engine.ts`
- `ActionSignal` um optionales `rejectAccount?: { riser: string; account: string; label: string }` erweitern
- Bei `t.category === "talent"` mit `meta.accountNorm` → Feld setzen

### `src/components/PersonActionCard.tsx`
- Wenn `headlineSignal.rejectAccount` vorhanden → kleiner Button im Footer (links neben Snooze/Dismiss/Done): „↻ Anderer Account" mit `RefreshCw`-Icon. Klick → `onAct(action, "reject-account")`
- Bei gebündelten Karten: nur zeigen wenn primaryKind `talent` ist

### `src/pages/Today.tsx`
- `act`-Funktion: neuer Kind `"reject-account"`. Holt aus `action.signals[0].rejectAccount` riser+account, ruft `addRejection`, dann `buildTodayActions(platform)` neu laden, Toast „Anderer Account gesucht".

## Verhalten
- Klick „↻ Anderer Account" → diese Karte verschwindet, neue Talent-Karte mit dem **nächstbesten freien** Orphan-Account erscheint (sofern vorhanden)
- Abgelehnte Kombi bleibt 7 Tage gesperrt — danach kann sie wieder vorgeschlagen werden
- Wenn kein anderer freier Account passt → keine Ersatzkarte (still)
- Orphan-Warnungen (Solo „Account X liegt brach") bleiben unverändert — kein Button, da kein Riser-Vorschlag

## Nicht geändert
- Scoring / Sortierung
- Andere Card-Typen
- Talent-Match-Algorithmus selbst