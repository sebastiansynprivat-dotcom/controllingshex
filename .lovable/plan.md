# Account-Tausch im Heute-Tab — vollständige Neulogik

Die bisherige Swap-Engine wird **im Heute-Tab vollständig entfernt**. Im Filter "Account-Tausch" zählt nur noch die unten beschriebene Downgrade/Upgrade-Logik. `SwapModeView` (Tinder-Mode) bleibt unverändert.

**Globale Regel:** Tier-Median ist aus der gesamten Account-Tausch-/Swap-Engine **komplett raus** (keine Trigger, keine Thresholds, kein Ranking). Anzeige & `computeTierStatus` in `account-tiers.ts` bleiben unverändert.

---

## 1. Downgrade-Kandidaten (drei unabhängige Trigger)

Ein Chatter wird Downgrade-Kandidat, sobald **mindestens einer** der Trigger feuert.

### Trigger A — Chats im Verzug
- Account > 500 Follower
- Chatter hat Chats im Verzug laut bestehendem Signal aus `recovery-queue.ts` (keine neue Schwelle)
- → `reason: 'delay'`

### Trigger B — Unterperformance vs. Account-Historie
- Account > 500 Follower
- Lifetime-Schnitt (Tages-Umsatz, alle Chatter gepoolt) nur valide bei ≥ 14 Tagen Historie — sonst Trigger aus
- 14-Tage-Schnitt des Chatters auf diesem Account < **60 %** des Lifetime-Schnitts
- → `reason: 'underperformance'`

### Trigger C — Null-Euro-Serie
- Account > 500 Follower
- Chatter hat auf diesem Account > **7 aufeinanderfolgende Tage 0 €**
- Tage ohne Report werden übersprungen (zählen nicht als 0 €, unterbrechen die Serie nicht)
- Abwesenheit/Krankheit (auch via `absence-forecast.ts`) → Trigger feuert trotzdem
- → `reason: 'zero_streak'`

---

## 2. Upgrade-Kandidaten (drei Typen)

### Typ X — Seed-Chatter (aktiver auf kleinem Account)
- Aktueller Account < 300 Follower und Chatter ist aktiv
- **Priorität 1:** aktive Chatter **mit Revenue** auf ihrem Seed-Account
- **Priorität 2 (Fallback):** aktive Chatter **ohne Revenue**, wenn nicht genug Prio-1-Kandidaten verfügbar
- Match-Modus: **wechselt** auf den freiwerdenden Downgrade-Account
- → `reason: 'seed_upgrade'`

### Typ Y — Zweiter Account dazu (überdurchschnittlicher Solo-Performer)
- Chatter hat im letzten Report **genau 1 Account** (Mehrfach-Inhaber ausgeschlossen)
- Sein Account > 300 Follower
- 14-Tage-Schnitt ≥ **110 %** des Lifetime-Schnitts seines Accounts (alle Chatter gepoolt, ≥ 14 d)
- Match-Modus: **dazu** (er behält den bisherigen Account, kriegt den freien zusätzlich)
- → `reason: 'second_account'`

### Typ Z — Hochstufung auf stärkeren Account (NEU)
- Chatter performt auf **einem seiner Accounts** überdurchschnittlich: 14-Tage-Schnitt ≥ **110 %** vom Lifetime-Schnitt dieses Accounts (alle Chatter gepoolt, ≥ 14 d)
- **Auch Chatter mit 2 Accounts qualifizieren sich** — einer davon (der starke) wird als Bezugspunkt genommen
- Es gibt einen freien Downgrade-Slot, dessen **Lifetime-Tages-Schnitt ≥ 120 %** vom Lifetime-Schnitt des Chatter-Ist-Accounts ist (≥ 20 % höher, damit Wechsel sich lohnt)
- Match-Modus: **wechselt** vom schwächeren Ist-Account auf den stärkeren freien Account
- → `reason: 'promotion'`

---

## 3. Matching Downgrade ↔ Upgrade

### Sortierung Downgrade-Slots
- Schwere: `zero_streak` > `delay` > `underperformance`
- Innerhalb gleicher Schwere: **Followers absteigend** (größte Accounts zuerst → bekommen die stärksten Upgrades)

### Sortierung Upgrade-Pool pro Slot
Regel: **"Je größer der freie Account, desto stärker der Upgrade-Kandidat."**

1. **Typ Y** — Solo-Performer, sortiert nach Performance-Ratio absteigend (14d / Lifetime)
2. **Typ Z** — Hochstufung, sortiert nach Account-Differenz absteigend (Lifetime-Schnitt Ziel-Account / Lifetime-Schnitt Ist-Account)
3. **Typ X Prio 1** — Seed mit Revenue, sortiert nach aktuellem Tages-Revenue absteigend
4. **Typ X Prio 2** — Seed ohne Revenue, sortiert nach Aktivitäts-Score absteigend

Pro Slot wird der erste verfügbare Kandidat in dieser Reihenfolge gezogen — auch Prio-2-Seed wird vorgeschlagen, wenn nichts Stärkeres mehr da ist.

### Zuweisung
- 1:1, keine Mehrfachbelegung pro Run
- Überschuss Downgrades → "Slot frei, kein Upgrade-Kandidat verfügbar"
- Überschuss Typ-Y-Kandidaten → "Zweiter Account empfohlen, aktuell kein freier Slot"
- Match-Task `reason`: `seed_match` | `second_account_match` | `promotion_match`

---

## 4. Was im Heute-Tab erscheint

Im Filter "Account-Tausch" gibt es **nur noch**:
1. **Tausch-Paar** — Downgrade-Slot ↔ Upgrade-Kandidat gematcht (Typ Y = "dazu", Typ X/Z = "wechselt")
2. **Freier Downgrade-Slot** — kein passender Upgrade
3. **Upgrade-Markierung ohne Slot** (nur Typ Y) — "zweiter Account empfohlen"

Keine Skill-Tier-Mismatch-, Phase-Change-, Wasted-Top-Profile-, Account-Decline-, Brezzels-, Fit-Matrix-, Lern-Loop- oder Tier-Median-Vorschläge mehr.

---

## Technische Umsetzung

### Neue Datei: `src/lib/account-swap-engine.ts`
Einzige öffentliche Funktion: `buildAccountSwapTasks(platform)`.

```
- getAccountLifetimeAverage(accountId, history)        // gepoolt, null bei <14d
- getChatter14dAverage(chatterName, accountId, history)
- getZeroEuroStreak(chatterName, accountId, history)   // Lücken überspringen
- getLastReportAssignments(history, platform)          // Map<chatter, accountId[]>
- getDelayedChatters(platform)                         // Wrapper um recovery-queue.ts
- isActiveChatter(chatterName, platform)               // bestehende Aktivitäts-Signale
- detectDowngrades(history, accounts, delayed) → DowngradeCandidate[]
- detectUpgradesTypeX(history, lastAssignments) → UpgradeCandidate[]
- detectUpgradesTypeY(history, accounts, lastAssignments) → UpgradeCandidate[]
- detectUpgradesTypeZ(history, accounts, lastAssignments, downgradeSlots) → UpgradeCandidate[]
    // benötigt Downgrade-Slots als Input, da Account-Differenz pro Paar geprüft wird
- matchSwaps(downgrades, upgradesY, upgradesZ, upgradesXPrio1, upgradesXPrio2) → SwapMatch[]
- buildAccountSwapTasks(platform) → RevenueTask[]
```

### Geänderte Datei: `src/lib/revenue-tasks.ts`
- Sektion "4. SWAP-ENGINE TOP-PICK" (Z. 461–548) komplett ersetzt durch `tasks.push(...await buildAccountSwapTasks(platform))`
- Entfernte Imports: `computeSwapCandidates`, `computeSwapExpectedGain`, `loadAccountFitMatrix`, `loadSwapTracking`
- Entfernt: `swap_decisions`-Query der letzten 7 Tage
- Tier-Median-Nutzung (falls in dieser Sektion vorhanden) entfernt

### Geänderte Datei: `src/lib/today-engine.ts`
- Z. 837–853: Fit-Matrix-Check für `kind === "swap"` entfernt
- `loadAccountFitMatrix`-Import entfernt, falls nirgends sonst gebraucht

### Unverändert
- `src/lib/swap-suggestions.ts`, `src/components/SwapModeView.tsx`, `src/pages/TinderMode.tsx`
- `src/lib/account-fit.ts`, `src/lib/swap-tracking.ts`
- `src/lib/recovery-queue.ts`, `src/lib/absence-forecast.ts`, `src/lib/account-tiers.ts`
- `src/components/today/MatchBoard.tsx`, `src/components/PersonActionCard.tsx`

### Task-Shape (UI-kompatibel)

```ts
{
  kind: "swap",
  title: "Account-Tausch: <Downgrade> → <Upgrade>"
       | "Hochstufung: <Upgrade> → <Ziel-Account>"
       | "Zweiter Account: <Upgrade>"
       | "Account frei: <Downgrade>",
  chatter: <Downgrade-Chatter | Upgrade-Chatter>,
  secondaryChatter: <Upgrade-Chatter | null>,
  reason: 'delay' | 'underperformance' | 'zero_streak'
        | 'seed_upgrade' | 'second_account' | 'promotion'
        | 'seed_match' | 'second_account_match' | 'promotion_match',
  evidence: {
    lifetimeAvg, current14d, ratio,
    streakDays, delayedChats,
    accountFollowers, accountId,
    sourceAccountLifetimeAvg, targetAccountLifetimeAvg, accountDiffRatio,
    upgradeType: 'seed_p1' | 'seed_p2' | 'second_account' | 'promotion'
  },
  swapMode: 'replace' | 'add'   // 'add' nur bei Typ Y
}
```

`PersonActionCard` rendert `kind: "swap"` generisch — keine Anpassung nötig.

### Daten-Quellen
- `chatter_history` (Tages-Umsatz pro Chatter pro Account, Account-Followers, analysis_date)
- `recovery-queue.ts` für "Chats im Verzug"
- Bestehende Aktivitäts-Signale (Sessions, Response-Zeit, Active-Days)
- **Kein** `swap_decisions`, **keine** Fit-Matrix, **kein** Swap-Tracking, **kein** Tier-Median
- Keine DB-Migration

---

## Abdeckung aller Prompts

- Tier-Median raus aus Swap-Logik, Anzeige bleibt ✅
- Downgrade A: Verzug + > 500 via `recovery-queue.ts` ✅
- Downgrade B: > 500, < 60 % vom Lifetime (gepoolt, ≥ 14 d), 14-d-Fenster ✅
- Downgrade C: > 500, > 7 d 0 €, Lücken übersprungen, Abwesenheit feuert ✅
- Upgrade X: < 300 Follower aktiv, Prio 1 mit Revenue, Prio 2 ohne Revenue als Fallback ✅
- Upgrade Y: 1 Account, > 300, ≥ 110 % → zweiter Account dazu (nicht statt) ✅
- Upgrade Z (NEU): ≥ 110 % auf Ist-Account (auch 2-Account-Inhaber), Ziel-Account-Lifetime ≥ 120 % vom Ist-Account-Lifetime, Wechsel ✅
- Matching: je größer der freie Account, desto stärker der Kandidat; Seed als Fallback ✅
- Komplett-Ersatz im Heute-Tab ✅
