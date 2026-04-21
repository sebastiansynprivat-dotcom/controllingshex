

# Forecast Cockpit — Vorhersagen statt Reagieren

## Das Kern-Problem

Dein Dashboard ist **100% reaktiv**. Anomaly-Alerts triggern *nachdem* der Chatter eingebrochen ist. Leaderboard zeigt vergangenen Umsatz. Compare-Mode hilft nur, wenn du *schon weißt* dass jemand schwächelt. Du hast 9 Tage saubere History pro Chatter, Skill-Score, Peer-Median und Disziplin-Metriken — aber **kein einziges Feature nutzt diese Daten, um den nächsten Tag vorherzusagen**.

Das ist die Lücke. Ein guter Controlling-Manager fragt nicht *"wer war schlecht?"* — er fragt *"wer wird in 2 Tagen schlecht?"*.

## Die Lösung: Risk-Forecast pro Chatter (nächste 3 Tage)

Eine neue Seite `/forecast` (Sidebar: **„Frühwarnung"**) die für jeden aktiven Chatter einen **Risk-Score 0–100** für die nächsten 1–3 Tage berechnet — bevor irgendwas passiert.

### Was geht in den Risk-Score (alle Daten existieren bereits)

| Signal | Quelle | Logik |
|---|---|---|
| **Trend-Slope Revenue** | `chatter_history.revenue_today` letzte 7 Tage | Linear-Regression-Steigung. Negative Slope >15%/Tag = Risiko ↑ |
| **Verzug-Drift** | `response_delay_days` letzte 7 Tage | Steigt von 0→1→2 Tagen = klassischer Vor-Crash-Indikator |
| **Mass-DM-Verfall** | `mass_dms` letzte 7 Tage | Disziplin-Frühindikator. Drop vor Revenue-Drop, meist 2–3 Tage Vorlauf |
| **Chat-Stau-Wachstum** | `open_chats` Slope | Backlog wächst = Chatter verliert Kontrolle |
| **Peer-Gap-Trend** | Skill-Score vs. Peer-Cluster-Median | Driftet unter Cluster-P25 = strukturelles Problem |
| **Onboarding-Phase** | `startDate` < 14 Tage | Boost +20 — neue Chatter sind volatil per Definition |
| **Account-Tier-Mismatch** | Skill-Score niedrig + High-Tier-Account | Schon im Swap-Score, hier als *passive* Warnung statt aktivem Vorschlag |

Gewichteter Composite (z.B. 30/25/15/10/10/5/5) → 0–100. Schwelle ≥60 = **„wird wahrscheinlich crashen"**.

### Was du auf der Seite siehst

```text
┌─────────────────────────────────────────────────────────────┐
│ FRÜHWARNUNG · 7 Chatter mit Risk ≥60 für die nächsten 3 Tage│
├─────────────────────────────────────────────────────────────┤
│ 🔴 87  Niklas La        Revenue-Slope -42%/d, Verzug 0→2    │
│        Hauptursache: Mass-DMs eingebrochen (Disziplin-Drop) │
│        Prognose: Crash in ~2 Tagen, ~180€/Tag gefährdet     │
│        [Coachen] [Notiz] [Snooze 3d]                        │
├─────────────────────────────────────────────────────────────┤
│ 🟠 72  Marie Klein      Peer-Gap wächst, Chat-Stau +60%     │
│ 🟡 64  Tim Berger       Onboarding Tag 4, instabile KPIs    │
│ ...                                                          │
└─────────────────────────────────────────────────────────────┘
```

Jede Zeile **muss** zwei Dinge liefern, sonst ist es Bullshit:

1. **Den Hauptgrund in einem Satz** (welches Signal hat am stärksten gefeuert)
2. **Die geschätzte Geld-Auswirkung in €** (Slope × verbleibende Tage × current avg)

### Backtesting-View (Vertrauen aufbauen)

Ein zweiter Tab **„Treffer-Quote"** der zeigt:
> *„Von 23 Risk-≥60-Warnungen letzte Woche sind 18 tatsächlich eingetreten (78%)."*

Berechnet rückwirkend gegen `chatter_history` — du siehst sofort ob das Modell taugt oder nur Lärm produziert. Ohne diese Validierung würdest du dem Score nicht trauen, und das wäre richtig so.

### Wo es im Flow integriert wird

- **Dashboard:** Schmaler roter Streifen oben *„3 Chatter mit hohem Crash-Risiko in den nächsten 3 Tagen"* → Klick öffnet `/forecast`
- **Tinder/Compare:** Risk-Pill auf jeder Karte (kleiner roter Dot mit Score), damit du beim Triagen direkt siehst wer kippt
- **Slide-Over:** Forecast-Block mit den 7 Signalen als Mini-Sparklines

## Warum genau das

- **Nicht gamifiziert** — kein Streak, kein Badge, keine Punkte. Reines Controlling.
- **Nicht „noch ein Filter"** — generiert *neue Information* aus vorhandenen Daten.
- **Vollständig client-side berechenbar** — keine neue Edge Function, keine neue Tabelle, keine API-Kosten. Backtest läuft on-the-fly über die 9 Tage History die du schon hast.
- **Wird mit jedem Report besser** — je mehr History, desto präziser die Slope-Schätzungen und Backtest-Quoten.
- **Direkter ROI** — jeder verhinderte Crash ist barer Umsatz. Du sagst selbst, dass deine Compare/Swap-Tools nur greifen wenn du weißt *wo* du hingucken sollst. Das hier sagt's dir.

## Technische Skizze

- Neue Datei `src/lib/risk-forecast.ts` — pure Funktion `computeRiskScores(chatters, history, benchmarks): RiskScore[]`
- Neue Seite `src/pages/Forecast.tsx` mit Liste + Backtest-Tab
- Neue Komponente `src/components/RiskBadge.tsx` für die Pill (in Tinder/Compare/Slide-Over wiederverwendet)
- Sidebar-Eintrag `Frühwarnung` mit `AlertOctagon`-Icon zwischen Dashboard und Videocoaching
- Backtest: für jeden Tag T in History → Risk berechnen mit Daten bis T-1 → vergleichen mit was an T+1..T+3 *tatsächlich* passiert ist (Revenue-Drop ≥30% = "Hit")

Keine DB-Migration nötig. Kein neues Secret. Keine Edge Function (Phase 1).

