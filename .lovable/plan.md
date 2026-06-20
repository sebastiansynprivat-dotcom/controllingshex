## Warum die jetzigen Vorschläge sich „statisch" anfühlen

Die aktuelle Engine vergleicht **abstrakten Chatter-Skill** (Mass-DMs, Response-Zeit, €/Follower) gegen **Account-Größe (Follower)**. Das ist eine Korrelation, kein Beweis. Sie ignoriert die zwei stärksten Signale, die wir bereits in der DB liegen haben:

1. **`account-fit.ts`** rechnet pro `(Chatter × Account)` aus 90 Tagen `chatter_history` einen `fitScore` mit `confidence` aus — wie gut hat dieser Chatter **auf diesem konkreten Account** historisch geliefert, vs. seine eigene Baseline und vs. andere Chatter, die je drauf saßen. **Wird in der Swap-Engine aktuell gar nicht benutzt.**
2. **`swap-tracking.ts`** misst pro vergangenem Swap (`swap_decisions`) das Δ% 3 Tage davor vs. 3 Tage danach. Wir haben also echte Outcome-Daten unserer eigenen Empfehlungen — die fließen nicht zurück ins Ranking.

Dazu kommt: Die aktuelle Engine sucht nur **paarweise A↔B-Tausche**. In der Realität ist die beste Empfehlung oft „setz X auf Account Y, Bench Z" — also 1:N, nicht 1:1.

## Was die neue Engine anders macht

Statt „Skill-Rang vs. Follower-Rang" arbeiten wir mit **konkreten, account-spezifischen Beweisen** und ranken nach **Confidence × erwartetem €-Gain**.

### 1. Signal-Stack pro Account (statt pro Chatter-Skill)
Für jeden aktiven Account werden 4 Signale berechnet:

| Signal | Datenquelle | Was es aussagt |
|---|---|---|
| **Account-Decline** | `chatter_history` letzte 7d vs. Tag -30…-8 | Account verdient gerade weniger als sein eigenes 30d-Niveau |
| **Chatter-Underperformance auf diesem Account** | `account-fit` `vsPeerOnAccount` | Der aktuelle Chatter liegt unter dem Median anderer Chatter, die je drauf waren |
| **Phase-Change-Bruch** | `chatter_history` Phasen-Detection | Wechsel der Hauptbetreuung in den letzten 14 Tagen ging mit Revenue-Drop einher |
| **Verschwendetes Top-Profil** | `account-fit.byChatter` | Ein nachweislich starker Chatter (high `fitScore` auf ≥1 großem Account historisch) sitzt aktuell auf einem schwächeren Account |

Ein Account wird Swap-Kandidat, wenn **mindestens 1 Signal feuert** — nicht nur wenn er rechnerisch im Bottom-40% liegt.

### 2. Kandidaten-Matching mit echtem Fit, nicht nur Tier
Für jeden Kandidaten-Account suchen wir Ersatz-Chatter in dieser Priorität:

1. **Direkter historischer Beweis**: Chatter, die schon mal **auf genau diesem Account** waren und nachweislich mehr verdient haben (`fitScore ≥ 65`, `confidence ≥ medium`, ≥3 Tage Stichprobe).
2. **Nachbar-Account-Beweis**: Chatter mit hohem `fitScore` auf einem Account des **gleichen Tiers + ähnlicher Follower-Range (±50%)**.
3. **Skill-Fallback** (heutige Logik): Wenn weder 1 noch 2 greifen, klassischer Skill-vs-Follower-Mismatch.

Stufen 1 und 2 sind die neuen, „smarten" Vorschläge — sie bekommen high confidence. Stufe 3 läuft weiter, wird aber als „spekulativ" gelabelt.

### 3. Confidence-Score (0–100) pro Vorschlag
Damit du dich auf die Liste verlassen kannst, kriegt jeder Vorschlag eine sichtbare Confidence:

```
confidence = base_by_evidence_tier   // S1=70, S2=50, S3=25
           + sample_bonus            // +0…+15  je nach Tagen Stichprobe
           + recency_bonus           // +0…+10  je frischer die Evidenz
           + swap_tracking_bonus     // +0…+10  wenn ähnliche Swaps in der Vergangenheit positiv waren
           - risk_penalty            // -0…-15  bei großem Tier-Sprung ohne Belege
```

Der UI-Default zeigt **nur Vorschläge mit confidence ≥ 50** an. Darunter ist ein Toggle „Auch spekulative Vorschläge zeigen" für die heutige breite Liste.

### 4. Expected-Gain wird ehrlicher
Aktuell: `peer_cluster_median × skill_factor − current`. Neu, je nach Evidenz-Stufe:

- **S1**: `gain = bester_historischer_avg_dieses_chatters_auf_diesem_account − aktueller_avg`. Hartes, account-spezifisches Δ.
- **S2**: `gain = chatter_avg_auf_Nachbar_account × similarity_factor − aktueller_avg`.
- **S3**: heutige Peer-Cluster-Formel (bleibt als Fallback).

Negative Gains werden ausgefiltert; sehr kleine Gains (<50 €/Woche) bekommen automatisch confidence ≤ 40.

### 5. Lern-Loop über `swap_decisions` + `swap-tracking.ts`
Vor dem Ranking laden wir alle `swap_decisions` mit `status='approved'` der letzten 90 Tage und ihr `deltaPct` aus `swap-tracking.ts`. Aggregiert pro Tier-Richtung („Upgrade vs Lateral vs Downgrade") ergibt das einen **Hit-Rate-Multiplier**. Wenn z.B. Upgrades historisch +18% gebracht haben, kriegen neue Upgrade-Vorschläge `+8` Confidence. Wenn Downgrades im Schnitt -5% brachten, kriegen sie `-10`. So wird die Engine über die Zeit besser, ohne dass du was tunen musst.

### 6. UI-Sichtbarkeit der Begründung
Jede Karte zeigt **warum** dieser Tausch vorgeschlagen wird, in 1 Zeile menschenlesbar:

> „Lara verdiente auf diesem Account zwischen 12.04. und 03.05. im Schnitt **312 €/Tag** — Mia liegt aktuell bei **184 €/Tag** (7-Tage-Schnitt). Δ = +128 €/Tag. Confidence **78/100**."

Das ist der Moment, an dem du sagst „geil, darauf kann ich mich verlassen".

## Was unverändert bleibt

- Brezzels-Mismatch-Branch (`buildBrezzelsPools`) bleibt wie ist — die Plattform hat zu wenig Account-History-Tiefe für S1/S2, da ist Skill-Rang ehrlicher.
- `computeManualSwapCandidates` (manueller Modus pro Chatter) bleibt — wird nur intern auf das neue Scoring umgestellt.
- UI-Komponenten (`SwapModeView`, `PersonActionCard`) bekommen nur zwei neue Felder: `confidence` und `evidence` (Begründungs-String).

## Technische Architektur

```
src/lib/swap-suggestions.ts        ← Hauptfunktion, neuer Default-Branch
  ├─ src/lib/account-fit.ts        ← bereits da, wird jetzt importiert
  ├─ src/lib/swap-tracking.ts      ← bereits da, neu: aggregierter Hit-Rate-Multiplier
  ├─ neu: detectAccountSignals()   ← 4-Signal-Stack pro Account
  ├─ neu: rankReplacements()       ← S1 → S2 → S3 Kaskade
  └─ neu: computeConfidence()      ← 0–100 Score + Begründungs-String
```

Keine DB-Migrationen nötig — alle Daten liegen schon in `chatter_history`, `swap_decisions`, `models`, `model_attributes`.

## Was ich von dir wissen müsste, bevor ich starte

1. **Confidence-Threshold default**: Ich plane 50 als Default-Cutoff. Lieber strenger (60, zeigt weniger, aber alle „solide") oder lockerer (40, mehr Vorschläge)?
2. **Lern-Loop sofort scharf?** Hit-Rate-Multiplier braucht mindestens ~15 approved Swaps in den letzten 90 Tagen, um statistisch was wert zu sein. Soll er bei zu wenig Daten **auf 0 stehen** (sicher) oder optimistisch +5 für Upgrades vergeben (mein Default)?

Wenn beides okay ist, baue ich direkt durch.
