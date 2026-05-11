## Ziel

Talent-Scout soll **adaptive Schwellen** statt fixer Cutoffs nutzen. Wenn auf der "Underuser-Seite" viele Lecks da sind (etablierte Chatter auf guten Accounts arbeiten kaum / lassen Chats liegen), sollen die Schwellen für die "Aufsteiger-Seite" automatisch lockerer werden — und umgekehrt. Endergebnis: das System schlägt **immer die besten verfügbaren Tausch-Paare** vor, auch wenn niemand alle Idealkriterien erfüllt.

---

## Kernidee: Relativ statt absolut

Aktuell: starre Konstanten (`MIN_AVG_MASSDMS = 3`, `UNDERUSER_MIN_DELAY_DAYS = 2`, …). Wer drunter ist, fällt raus.

Neu: Beide Seiten werden als **Ranking** berechnet, nicht als Filter. Jeder qualifiziert sich grundsätzlich, bekommt aber einen **Score**. Nur die schwächsten Underuser werden mit den stärksten Risern gepaart — wenn die Lücke zwischen den beiden groß genug ist (= echter erwarteter Gewinn).

---

## Neue Logik in 3 Schritten

### 1. Underuser-Pool: nach "Leak-Score" sortieren
Jeder etablierte Chatter (≥14 Tage onboarded) auf `growth`/`top`-Account bekommt einen `leakScore`:
```
leakScore = avgDelayDays × 25
          + (avgOpenChats > poolMedian ? (avgOpenChats - poolMedian) × 0.6 : 0)
          + (1 - activityRatio) × 40        // NEU: wer wenig aktiv ist, leakt am meisten
          + (avgRev < tierMedian ? (tierMedian - avgRev) × 0.3 : 0)  // NEU: €/Tag unter Tier-Median
```
Kein harter Cutoff mehr — wir nehmen die **Top-N (N=5) mit dem höchsten leakScore**, sofern leakScore > 0.

`activityRatio` = Tage mit Revenue/MassDM-Aktivität in den letzten 7 / 7. Wer "gar nicht arbeitet" landet automatisch oben.

### 2. Riser-Pool: adaptiv lockern
Schwellen werden **abhängig vom Underuser-Pool** skaliert:
- Sind ≥3 Underuser mit hohem Leak-Score (≥40) verfügbar → **Druck hoch** → Riser-Schwellen lockern (MassDMs ≥2, Sessions ≥3, Konsistenz ≥0.35).
- Sind nur 1–2 schwache Lecks da → mittlerer Druck (aktuelle Werte: MassDMs ≥3, Sessions ≥4).
- Keine echten Lecks → strenge Werte (MassDMs ≥4, Sessions ≥5).

Onboarding-Fenster bleibt fix (Tag 5–21) — das ist eine inhaltliche Aussage, kein Schwellwert.

Riser bekommen ebenfalls einen `riserScore`:
```
riserScore = avgMassPerDay × 6
           + sessionCount × 2
           + (responseP50 ? max(0, 45 - responseP50) : 5)
           + consistency × 30
```
Top-N Riser nach Score.

### 3. Pairing nur wenn Lücke groß genug
Für jedes Paar wird ein `expectedGain` berechnet:
```
expectedGain = leakScore(underuser) × 0.6 + riserScore(riser) × 0.4
```
Paar wird nur vorgeschlagen wenn `expectedGain ≥ 25` (sonst nicht relevant). Greedy-Matching: bester Riser zum besten Underuser, max. 8 Paare.

---

## Ergebnis für den User

- **Wenn viele Etablierte schwächeln** (z.B. Sommerflaute, mehrere im Urlaub-Modus): System schlägt auch nur "okayen" Aufsteigern den Wechsel vor — weil das Gesamtergebnis trotzdem besser wird.
- **Wenn alle Etablierten top performen**: nur wirklich exzellente Aufsteiger werden vorgeschlagen — strenge Schwellen.
- **Inaktive auf guten Accounts** rutschen automatisch nach oben in der Leak-Liste (durch `activityRatio`-Komponente).

---

## Technische Details

**Datei:** ausschließlich `src/lib/talent-scout.ts`. Keine UI-Änderung, keine DB-Migration. Daten kommen wie bisher aus `chatter_history` (7T) + `get_live_efficiency` + `get_chatter_onboarding` + `models`.

**Neue Helper:**
- `computeLeakScore(agg, poolMedian, tierMedian, activityRatio)`
- `computeRiserScore(live, avgMassPerDay)`
- `deriveAdaptiveThresholds(underuserPool)` → liefert {minMass, minSessions, minConsistency} je nach Druck
- Aktivitätsquote pro Chatter aus den 7 Tagen (Tage mit Revenue>0 ODER MassDM>0).

**Tier-Mediane:** pro `tier.id` (`growth`, `top`) Median des `avgRev` aus aggs berechnen, für €/Tag-Komponente im LeakScore.

**Konstanten** bleiben oben in der Datei, aber als "weiche" Defaults statt harter Filter.

---

## Out of Scope

- Keine Änderung am UI (`DailyTodoList`, `TalentCompareModal`).
- Kein neuer Daten-Pull, keine zusätzliche RPC.
- Keine Anpassung am Onboarding-Fenster (5–21 Tage bleibt — das ist semantisch, kein Schwellwert).

---

## Schritte

1. `talent-scout.ts` — Aktivitätsquote aus History ableiten.
2. `talent-scout.ts` — `leakScore` & `riserScore` als Funktionen extrahieren.
3. `talent-scout.ts` — adaptive Schwellen abhängig vom Underuser-Pool ableiten.
4. `talent-scout.ts` — Pairing auf `expectedGain ≥ 25` umstellen, harte Filter raus.
5. Smoke-Check via DB: aktuell sichtbare Paare bleiben/erweitern sich plausibel.
