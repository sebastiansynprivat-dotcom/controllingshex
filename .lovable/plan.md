
# Heute-Karten v3 — Potenzial & Swap-Erkennung aus voller Historie

## Problem heute

Aktuelle Swap-Engine vergleicht **Skill-Score** (Disziplin/Effizienz, Chatter-weit) gegen **Follower-Tier**. Das ignoriert das Wichtigste:

- **Wer hat auf welchem Account historisch wirklich performt?** Nur Account-Phasen (`model-performance.ts`) wissen das, fließen aber nicht in Swaps ein.
- **Account-Fit ist personenabhängig**: Chatter A kann auf Model X 200 €/Tag drücken und auf Model Y nur 40 €. Heute landet alles in einem globalen Skill-Score.
- **„Riser auf falschem Account"** wird nicht erkannt: jemand der erst seit 5 Tagen einen Account hat, aber schon den 30-Tage-Schnitt des Vorgängers schlägt → Top-Kandidat für Größeres, aktuell unsichtbar.
- **Tausch-Vorschläge sind nicht historisch validiert**: Engine sagt „Swap A↔B", weiß aber nicht, dass A vor 40 Tagen schon mal genau diesen Account hatte und dort gefloppt ist.

## Ziel

Heute-Karten sollen für jede Person/jedes Pair eine **Account-Fit-Aussage mit historischem Beleg** zeigen, statt nur abstrakter Skill-Scores. Swaps werden vor Vorschlag gegen die eigene History gegengecheckt.

## Plan

### 1. Account-Fit-Matrix (neu: `src/lib/account-fit.ts`)

Pro `(chatter, account)`-Paar aus den letzten 90 Tagen `chatter_history`:

- **avgPerDay** wenn Chatter den Account hatte (Tage ≥ 3)
- **bestPhase**: längste/stärkste zusammenhängende Phase (Reuse `loadModelTimeline`)
- **rankOnAccount**: wie viele andere Chatter hatten den Account, wo steht dieser? (Top 1/3/Mitte/Bottom)
- **vsPeerOnAccount**: avgPerDay vs. Median aller anderen Chatter, die je auf diesem Account waren
- **trend**: letzte Phase steigend/fallend
- **fitScore 0..100**: Kombi aus rank + vsPeer + Stichprobe-Größe (Konfidenz)

Wird einmal pro Today-Build vorberechnet und in eine `Map<chatterKey|accountKey, FitEntry>` gestopft.

### 2. Potenzial-Detector (neu: `src/lib/potential-detector.ts`)

Drei Trigger, die aus der Matrix neue Heute-Karten-Signale erzeugen:

**a) Hidden Star** — Chatter steht auf Micro/Small-Account, hat aber auf irgendeinem **größeren** Account in der Vergangenheit Top-1/3 vsPeer gemacht.
→ Karte: „X hat vor 6 Wochen auf Model Y (10k) Top-Performance gezeigt — aktuell auf 800-Follower-Account."

**b) Wrong Fit** — Chatter ist seit ≥ 7 Tagen auf Account, fitScore < 30, gleichzeitig existiert anderer freier/schwacher Chatter mit historisch hohem fitScore auf genau diesem Account.
→ Karte: „Account Z läuft mit X bei 45 €/Tag. Y hatte denselben Account vor 2 Monaten bei 180 €/Tag."

**c) Riser confirms Fit** — Chatter hat Account erst seit 3-7 Tagen, schlägt aber bereits 30T-Schnitt des Vorgängers um ≥ 30 %.
→ Karte: „Y übernimmt gerade Z und liegt schon +35 % über dem Vorgänger — größeres Model andocken?" (Suggest Upgrade-Pair)

### 3. Swap-Engine v3 — historisch validiert (`src/lib/swap-suggestions.ts`)

Vor jedem ausgespielten `SwapPair` zwei Gegenchecks:

- **Self-fit-check**: Wenn `left` (vorgeschlagener Empfänger) auf `right.account` historisch schon mal war und `fitScore < 40` hatte → Pair komplett verwerfen oder mindestens als „Risiko" labeln.
- **Cross-fit-boost**: Wenn `left` auf `right.account` historisch `fitScore > 70` → expectedGain × 1.4, Karte zeigt „bestätigt durch Phase YYYY-MM-DD bis YYYY-MM-DD".

`expectedGain` neu = `peerMedian(targetTier) × skillScore × historicalFitMultiplier(left, right.account)` statt nur `skill/0.5`.

### 4. UI: Evidence-Block in `PersonActionCard`

Neue kleine Sektion „Beleg" pro Signal wenn aus Historie ableitbar:

```
text
┌ Beleg ─────────────────────────────┐
│ Y auf Z: Ø 180 €/Tag (12.3.–28.4.) │
│ Aktuell X auf Z: Ø 45 €/Tag (10T)  │
│ Peer-Median Z: 95 €/Tag             │
└────────────────────────────────────┘
```

Maximal 3 Zeilen, nur wenn echte Daten vorhanden — kein „?"-Fallback.

### 5. Integration in `today-engine.ts`

- Neuer Loader `loadAccountFitMatrix(platform)` parallel zu `loadChatterStats`.
- Neue Signal-Quelle `generatePotentialActions()` ergänzt `generateDailyTodos`/`generateRevenueTasks`.
- Mapping auf bestehende `ActionSourceKind`: Hidden Star → neuer Kind `"potential"`, Wrong Fit → bestehender `"swap"` aber mit Evidence, Riser confirms → `"talent"`.
- Score-Boost für `potential`: `kindBoost = 1.4`, läuft also vor normalem `swap`.

### 6. Migration

Keine neue Tabelle nötig — alles aus `chatter_history` ableitbar. Optional Phase 4: Caching in neuer `account_fit_cache` Tabelle wenn Performance zum Problem wird.

## Reihenfolge der Umsetzung

1. `account-fit.ts` mit Matrix-Aufbau + Tests gegen echte Daten
2. `potential-detector.ts` mit 3 Triggern, eingehängt in `today-engine.ts`
3. Evidence-Block in `PersonActionCard`
4. Swap-Engine v3 Self-fit-check + Cross-fit-boost
5. Manuelle QA: 5 reale Karten durchchecken, ob Belege stimmen

## Was bewusst draußen bleibt (für später)

- Modell-Tausch-Aktion direkt aus der Karte heraus ausführen (nur Vorschlag, keine Workflow-Automatisierung)
- ML-basiertes Fit-Scoring (erst wenn Heuristik nicht reicht)
- Account-Fit über Modell-Attribute (`model_attributes` style/bodyType matching) — eigener Plan, wenn Stufe 1 läuft
