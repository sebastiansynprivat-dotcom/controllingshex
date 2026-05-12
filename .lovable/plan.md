## Ziel

Der **Heute-Tab** wird der einzige Ort, den du morgens öffnest. Du arbeitest die Liste von oben nach unten ab — am Ende ist mehr Geld verdient. Kein Dashboard-Hopping, kein Nachdenken über Zeiträume, kein "wo war nochmal Feature X".

Heute ist es: nur 7 Kategorie-Chips + Liste. Aktuell mit drei harten Schwächen:

1. **Nur 1-Tages-Brille:** Verzug/Drop/Mass-DM checken nur den letzten Report-Tag. Persistenz (3 Tage in Folge schlecht) wird nicht erkannt.
2. **Keine Aggregation pro Person:** Sarah taucht 4× auf (Verzug, DM-Drop, Chat-Jam, Revenue-Drop). Du musst selbst zusammenpuzzlen.
3. **Drei separate Engines** (`daily-todos`, `revenue-tasks`, `model-troubles`), die sich nicht koordinieren — keine gemeinsame Sortierung nach €-Hebel.

---

## Plan

### 1. Time-Horizon-Awareness (statt nur "heute")

Jede Regel bekommt zwei Sichten:

- **Heute-Signal** (heute vs. eigene 14T-Baseline) — wie bisher
- **Persistenz-Signal** (rollendes Fenster: wie viele der letzten 3 / 7 Tage war's schlecht?)

Tasks bekommen einen **Persistenz-Tag**:
```
"3. Tag in Folge"   → Score ×1.6, Label "PERSISTENT"
"heute zum 1. Mal"  → Score ×1.0, Label "NEU"
"vor 4 Tagen"       → eskaliert automatisch
```

Konkret pro Regel:
- **Verzug:** ≥3T Verzug **oder** Antwortverzug ≥1T an 3 von 5 Tagen → escaliert
- **Revenue-Drop:** −40% heute **oder** −25% im 3T-Schnitt → eskaliert
- **Mass-DMs:** unter Ziel an 3 von 5 Tagen → eskaliert
- **Inaktivität:** 1T fehlend = Hinweis, 2T+ = Verzug-Kategorie
- **Onboarding-Newbies:** zusätzlicher Check „6 Tage am Start gewesen?" — wenn ja, Bonus-Score; wenn nicht, sofort als Risiko

Optional als **Toggle oben** (Default: Auto):
`Auto · Heute · 3T-Trend · 7T-Trend` — verschiebt nur die Persistenz-Gewichtung, blendet nichts aus.

### 2. Eine Engine, ein €-Score

`daily-todos.ts` + `revenue-tasks.ts` + `model-troubles` werden in eine **Unified Action Engine** gemerged. Jede Aktion liefert dasselbe Schema:

```ts
{
  key, kind, title, why,
  impactEurPerWeek,    // für ALLE Tasks geschätzt, nicht nur Revenue
  persistence: 1..7,   // Tage in Folge
  urgency: 0..100,     // Verzug, Eskalation
  importance: 0..3,    // 30T-Umsatzanteil des Chatters
  score = impact × persistence × urgency × importance
}
```

Auch Verzug, DM-Drops und Chat-Jams kriegen €-Schätzung (Verzug-Tag = ~Median-Tagesumsatz × Recovery-Wahrscheinlichkeit).

Damit ist alles **in einer Liste vergleichbar** und nach €-Wirkung sortiert — egal aus welcher Quelle.

### 3. Person-Bündel statt 4 Karten pro Mensch

Wenn `Sarah` heute Verzug + DM-Drop + Revenue-Drop hat, wird **eine Karte** gezeigt:

```
🔥 Sarah — sofort entlasten           +180€/Wo
   3T Verzug · Mass-DMs auf 1/Tag · Umsatz −55%
   Model: Lina (45k), Ava (12k)
   [✓ Erledigt] [⏰ 4h] [✕ Heute aus] [▾ Details]
```

Details-Aufklapper zeigt die Einzelsignale + Mini-Sparkline (7T Umsatz, 7T Aktivität). Mehrfach-Treffer addieren sich zum Score, statt die Liste zuzumüllen.

Ausnahmen vom Bündeln: Talent-Matches (zwei Personen) und Modell-Phasen (Modell + Vorgänger-Chatter) bleiben eigene Karten.

### 4. Heute-Tab UI: 3 Sektionen statt 8 Chips

```
┌─ JETZT MACHEN ────────────── 4 offen · +420€/Wo ──┐
│  Top-Aktionen mit höchstem €-Hebel · sortiert     │
│  [Person-Bündel-Karten]                           │
└───────────────────────────────────────────────────┘

┌─ IM AUGE BEHALTEN ──────────── 7 offen ───────────┐
│  Trend-Warnungen, Wins, Talent-Matches            │
│  Aufklappbar, default eingeklappt                 │
└───────────────────────────────────────────────────┘

┌─ ERLEDIGT HEUTE ─────────────── 3 ────────────────┐
│  Was du heute schon weggehakt hast (Motivation)   │
└───────────────────────────────────────────────────┘
```

Filter-Chips bleiben **als optionale Verfeinerung** (klein, oben rechts), aber `Alle` ist Default und reicht für 95% der Fälle.

### 5. Tagesziel + Fortschritt oben

Header zeigt eine **eine Zahl, die zählt**:

```
Heute · Mittwoch, 12. Mai · 4Based
Offener €-Hebel:  +1.240 € / Woche       ▓▓▓▓▓▓░░░░ 60%
3 von 8 Top-Aktionen erledigt
```

Wenn die Top-Liste leer ist → großes „Alles abgearbeitet" + Vorschau auf morgen.

### 6. Smart-Defaults für „nicht nachdenken müssen"

- **Auto-Dedup:** Wenn ein Task „vor 4h erledigt" ist und das Signal verschwunden ist → bleibt erledigt. Wenn es wieder da ist → kommt zurück mit Hinweis „zurück seit 2h".
- **Auto-Snooze nachts:** Tasks, die nach 22 Uhr aufploppen, sind morgens wieder voll sichtbar (kein Snooze nötig).
- **Empty-State mit Wert:** Wenn nichts brennt, zeigen wir „1–2 proaktive Wins" (z. B. „Lara hat 3T in Folge +30% — was läuft da? Notiz machen.").

---

## Technische Umsetzung

**Neue Datei:** `src/lib/today-engine.ts`
- Mergt `generateDailyTodos` + `generateRevenueTasks` + Model-Troubles
- Liefert `UnifiedAction[]` mit einheitlichem Schema
- Bündelt pro `chatterName` (außer Talent/Phase/Slot)
- Berechnet `persistence` aus 7T-Fenster pro Regel

**Refactor:** `daily-todos.ts` und `revenue-tasks.ts` werden zu reinen Signal-Detektoren (geben "raw signals" zurück), die Engine entscheidet Bündelung + Score.

**Geänderte Komponenten:**
- `src/pages/Today.tsx` — neue Sektionen-Struktur, Header mit €-Hebel-Summe + Fortschrittsbalken, Filter-Chips kompakt
- `src/components/DailyTodoList.tsx` → `src/components/UnifiedActionList.tsx` mit aufklappbaren Person-Bündeln
- Neuer `src/components/PersonActionCard.tsx` für Bündel-Darstellung

**Persistenz-Tracking:**
- Bestehende `chatter_history` reicht (14T Fenster wird schon geladen)
- Neue Helper: `signalDaysInWindow(rows, predicate, windowDays)` → zählt Tage mit Treffer

**Time-Horizon-Toggle:**
- Lokaler State in `Today.tsx`, kein Persistenz-Bedarf
- Default `auto`: Persistenz wird normal gewichtet
- `heute`: Persistenz-Multiplier auf 1, zeigt nur frische Signale
- `3T-Trend` / `7T-Trend`: Persistenz-Multiplier hochgedreht, einmalige Signale werden klein

---

## Was wir NICHT ändern

- `recovery-queue.ts`, `swap-suggestions.ts`, `model-tracking.ts`, `talent-scout.ts` bleiben als Signal-Quellen unverändert
- Datenbank, RLS, Edge Functions: keine Änderung
- Andere Tabs (Models, Live, Anomalien …) bleiben wie sie sind — Heute zieht nur deren Signale zusammen

---

## Reihenfolge der Umsetzung

1. `today-engine.ts` mit Unified-Schema + Bündelung + Persistenz-Score
2. Header-Stat + Sektionen-Layout in `Today.tsx`
3. `PersonActionCard` mit Aufklapper
4. Time-Horizon-Toggle (optional, kann auch Phase 2 sein)
5. Empty-States + „Erledigt heute"-Sektion

Phase 1+2+3 = der Sprung „muss nicht mehr nachdenken". Phase 4+5 = Feinschliff.
