## Ziel

Im Tab **Heute** (`/Today`) kommt **eine zweite Sektion "Umsatz"** dazu — getrennt von der bestehenden To-Do-Liste. Sie zeigt nur die **3–7 geistesgesund-priorisierten Aufgaben des Tages**, deren Erledigung **mathematisch nachweisbar mehr Umsatz** bringt. Jede Aufgabe hat einen **€-Impact-Schätzwert**, eine **konkrete Handlung** (nicht nur Beobachtung) und eine **transparente Begründung**.

Das ist **kein** „Mass-DMs sind unter Schnitt"-Ding. Sondern eine Engine, die alle vorhandenen Signale (History 30T, Hourly Stats, Models, Tiers, Phasen, Mismatch, Recovery, Swap-Engine, Anomalien, Peer-Benchmarks) zusammenführt und in **monetarisierbare Aktionen** übersetzt.

---

## Die 6 Revenue-Aufgaben-Klassen

Jede Klasse produziert nur Items, wenn ein **klarer €-Hebel** vorhanden ist. Items unter ~30€ Wochenpotenzial werden gefiltert.

### 1. Recovery — „Holt verlorenen Umsatz zurück"
Quelle: `recovery-queue.ts` ist bereits da, wird genutzt.
- Chatter unter 30T-Median, Gap ≥ 15 %, Recovery-EUR ≥ 50.
- **Aktion**: 1:1-Coaching / heute pushen.
- **€-Impact**: `recoveryEur` (Wochenhochrechnung mit Confidence).
- Boost: wenn Chatter Top-10 im Leaderboard → Score ×1.8.

### 2. Model-Phasen-Knick — „Creator lief gut, läuft jetzt schlechter"
Quelle: `model-tracking.ts` (`loadModelTimeline`) für jedes Model.
- Aktuelle Chatter-Phase ≥ 5 Tage UND Ø/Tag ≤ 70 % der Vorgängerphase UND Vorgänger-Ø ≥ 50 €/Tag.
- **Aktion**: „Model **X** zurück zu **Y** (Vorgänger lief +N %) — oder Phasen-Chatter coachen."
- **€-Impact**: `(prevAvg - currAvg) × 7`.
- Score zusätzlich aus Tier-Höhe (großes Model = mehr Hebel).

### 3. Tier-Mismatch (Pull-up) — „Schnellster Win überhaupt"
Quelle: `effort-potential.ts` `pullUp` (≥ 5 h/Tag auf Seed/Starter).
- Cross-Check: aktuell zugewiesener Account des Top-Tier-Models hat **Underused-Chatter** drauf (≤ 2 h/Tag).
- **Aktion**: Konkreter Tausch-Vorschlag „**A** ↔ **B** (Account **M**)".
- **€-Impact**: Skill-Score-Differenz × Peer-Median des großen Tiers (Logik bereits in `swap-suggestions.ts` vorhanden, nur konsumieren).
- Wenn kein passender Underused vorhanden → Solo-Item „**A** auf größeren Account ziehen" (kleinerer Score).

### 4. Swap-Engine Top-Pick
Quelle: `swap-suggestions.ts` (Skill-Score + Tier + Peer-Cluster).
- Top 1–2 Swaps mit `expectedGain ≥ 100 €/Tag` UND nicht in den letzten 7 Tagen schon vorgeschlagen (`swap-tracking.ts`).
- **Aktion**: „Swap **A** (M1) ↔ **B** (M2) — erwartet +X €/Tag."
- **€-Impact**: `expectedGain × 7`.

### 5. Hochfrequenz-Lücke — „Geld liegt buchstäblich auf der Straße"
Quelle: `chatter_hourly_stats` + Phasen.
- Top-Tier-Account (Growth/Top), in den **historischen Peak-Stunden** (z.B. 18–23 Uhr) heute kein Chatter aktiv (revenue+mass_dms+unread_delta = 0) **und** Median-Umsatz dieses Slots ≥ 30 €/h.
- **Aktion**: „Account **M**: 19–22 Uhr unbesetzt — Ø **X €/h** in dem Slot. Jemand hinsetzen."
- **€-Impact**: `Σ Median-€/h der unbesetzten Peak-Slots`.

### 6. Anomalie-Trigger mit €-Bezug
Quelle: `anomaly_alerts` (status='new', severity high) gefiltert auf Revenue-Anomalien.
- Nur wenn `delta_pct < -25 %` UND `metric_value` betroffene Tageseinnahmen ≥ 80 €.
- **Aktion**: „Anomalie bei **A**: −X % heute — Ursache klären (offene Chats / Verzug / Account-Wechsel)." Mit Auto-Begründung aus den anderen Signalen desselben Chatters.
- **€-Impact**: `|baseline - metric| × 5` (5 Werktage konservativ).

---

## Globaler Score & Sortierung

```
score = €Impact_pro_Woche
      × confidence(0.5..1)
      × tierMultiplier(1.0..1.6)        // große Models priorisieren
      × revenueImportance(0.3..2.0)     // Top-Earner > Low-Earner (aus daily-todos)
      × novelty(0.5..1)                 // gestern nicht schon gleiche Aufgabe
```

- Sortiert absteigend nach Score.
- Hard-Cap: max **7** Items, danach Cut.
- Dedupe: gleicher Chatter darf max 1× vorkommen (höchster Score gewinnt). Ausnahme: Hochfrequenz-Lücke (Account-bezogen, nicht Chatter).

---

## Status & Persistenz

Reuse `daily_todo_state` Tabelle. Neue Keys bekommen Präfix `rev:` damit sie sauber von normalen To-Dos getrennt sind:
- `rev:recovery:<chatter>:<date>`
- `rev:phase:<model>:<date>`
- `rev:mismatch:<chatter>:<date>`
- `rev:swap:<chatterA>:<chatterB>:<date>`
- `rev:slot:<model>:<date>`
- `rev:anomaly:<chatter>:<date>`

Done / Snooze 4 h / Dismiss heute → wie bestehende To-Dos.

---

## UI-Konzept (Heute-Tab)

```text
[ Heute zu tun ]                 ← bestehende Sektion bleibt unverändert
  • verzug …
  • activity …
  ...

──────────────────────────────────

[ 💎 Umsatz · Top 5 Hebel heute ]   ← NEU, eigene Sektion über/unter den Tasks
  ┌────────────────────────────────────────────────────┐
  │ +420 €/Wo  RECOVERY                                │
  │ Sarah pushen — −38 % vs. Median (340 €/Tag → 210)  │
  │ Top-10 Performer · 30T-Daten                       │
  │ [Erledigt] [4h] [×]                                │
  └────────────────────────────────────────────────────┘
  ┌────────────────────────────────────────────────────┐
  │ +280 €/Wo  PHASEN-KNICK                            │
  │ Model „Luna" zurück zu Mike — Ø 95€/Tag → 42€/Tag │
  │ aktuelle Phase 8 Tage                              │
  └────────────────────────────────────────────────────┘
  ...
```

**Visuelle Sprache**:
- Eigene Headline „💎 Umsatz" (Emerald/Amber Akzent statt Primary).
- Jede Karte mit **€-Impact-Pill** prominent oben links.
- **Kategorie-Pill** rechts (Recovery / Phasen-Knick / Mismatch / Swap / Slot / Anomalie).
- One-liner Action + One-liner Why.
- Klick auf Chatter-Name → bestehender `ChatterSlideOver`.
- Klick auf Model-Name → bestehender `ModelPerformanceSlideOver`.

---

## Technische Umsetzung

### Neue Datei: `src/lib/revenue-tasks.ts`
Exportiert:
```ts
export interface RevenueTask {
  key: string;
  kind: "recovery" | "phase" | "mismatch" | "swap" | "slot" | "anomaly";
  title: string;
  why: string;
  impactEurPerWeek: number;
  confidence: number;        // 0..1
  score: number;
  chatterName?: string | null;
  secondaryChatter?: string | null;  // für Swap
  modelName?: string | null;
}

export async function generateRevenueTasks(platform: string): Promise<RevenueTask[]>;
```

Intern:
- Lädt parallel: `chatter_history` (30T), `chatter_hourly_stats` (30T), `models`, `swap_decisions` (für Novelty), `anomaly_alerts` (status='new').
- Ruft die bestehenden Engines auf:
  - `loadRecoveryQueue` (recovery-queue.ts)
  - `loadMismatchMap` (effort-potential.ts)
  - `loadModelTimeline` pro Model (parallel, max 20 Models)
  - `computeSwapSuggestions` (swap-suggestions.ts)
- Sammelt Items, scored, dedupiert, cappt auf 7.

### Neue Komponente: `src/components/RevenueTaskSection.tsx`
- Selbständige Section, eigene State (eigene Lade-Logik, nutzt `daily_todo_state`).
- Pattern parallel zu `DailyTodoList.tsx` (gleiche Snooze/Done/Dismiss-Mechanik).
- Lazy: lädt nur wenn Tab `Today` aktiv.

### Änderung: `src/pages/Today.tsx`
- Headline „Heute zu tun" bleibt.
- Darunter neue `<RevenueTaskSection platform={platform} … />`.
- Slide-Over für Chatter & Model bereits vorhanden — Callbacks weiterreichen.

### Performance
- Alle Queries mit `eq(user_id)` und `ilike(platform)` → trifft RLS sauber.
- Model-Timeline in einer Schleife über `models`-Liste, parallelisiert mit `Promise.all` und Top-N (z.B. 30) Models nach Followers.
- Gesamt-Ladezeit Ziel < 1.5 s.

### Was NICHT angefasst wird
- DB-Schema (alle nötigen Tabellen sind da: `chatter_history`, `chatter_hourly_stats`, `models`, `daily_todo_state`, `swap_decisions`, `anomaly_alerts`).
- Bestehende `DailyTodoList`.
- LiveTracking, Mismatch-Filter, Swap-Engine.

---

## Out of Scope
- Push-Notifications.
- AI-generierte Texte (Logik ist deterministisch und transparent — auf Wunsch später ergänzbar).
- Cross-Platform Aggregation (immer pro Platform, wie überall sonst).