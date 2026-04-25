
# Plan: Bewertungs-Engine v2 — Punkte 3, 4, 6, 7, 8, 9, 10

Ziel: Die Action-Kategorisierung im Swipe-Mode wird fairer, robuster, erklärbarer und stabiler. Ein einziger neuer Engine-Layer (`categorize-v2.ts`) ersetzt den Kern von `recategorizeByWindow` — alle UI-Komponenten konsumieren weiterhin die gleiche `ActionCategoryName`, bekommen aber zusätzlich `reasons[]` und `signals` für die Tooltip-Anzeige.

---

## 🎯 Was umgesetzt wird

### Punkt 3 — Konstanz statt statisches Top-20%
- **BELOHNEN** triggert ab jetzt bei einem von drei Signalen:
  - `7d-Median ≥ 30d-Median × 1.10` (positiver Trend, persönlich)
  - `≥ 5 Tage in Folge ≥ persönlicher Median` (Konstanz)
  - Zusätzlich weiterhin Top-20% **als drittes Kriterium** (nicht alleinig)
- Verhindert, dass Platz 21 nie Anerkennung bekommt.

### Punkt 4 — Soft-Onboarding bis Tag 14
- Tag 1–5: weiterhin `ONBOARDING TAG X` (bleibt explizit).
- Tag 6–14: **neuer interner Modus „grace"** — alle Schwellen werden milder:
  - `zeroRate`-Cutoff für SOFORT EINGREIFEN: 80% → **90%**
  - `zeroRate`-Cutoff für COACHING: 50% → **70%**
  - Trend-Cutoff für COACHING: −30% → **−50%**
- Verhindert harten Sprung am Tag 6.

### Punkt 6 — Antwortverzug: aktueller Wert statt max
- Bisher: `maxDelay` über das Fenster → ein alter Verzug bleibt „kleben".
- Neu: **letzter bekannter `response_delay_days`** (jüngster History-Eintrag im Fenster). `maxDelay` wird zusätzlich als Kontext-Signal gespeichert, aber triggert nicht mehr direkt SOFORT EINGREIFEN.
- Zusätzlicher Schwellenwert „Verzug-Trend" (steigend vs. fallend) als Reason-Detail.

### Punkt 7 — Account-Wechsel killt Kontinuität
- **Aggregation jetzt per `chatter_name`** (nicht mehr per `chatter_name + account`).
- Account wird als **Kontext-Liste** mitgeführt (alle Accounts, die der Chatter im Fenster hatte) und im Reason-Tooltip angezeigt: „2 Account-Wechsel im Fenster".
- Falls du in einem späteren Schritt Performance pro Account separat sehen willst, bleibt die History granular — aber die Kategorisierung nutzt die zusammengefasste Reihe.

### Punkt 8 — Erklärbarkeit (Reason-Tooltip)
- Neue Datenstruktur `CategoryDecision`:
  ```ts
  {
    name: ActionCategoryName,
    reasons: string[],         // z.B. ["4/7 Tage 0€", "Trend −35% vs. 30d-Median"]
    signals: {
      avgRev, medianRev, zeroRate, lastDelay, trend7v30,
      consistencyStreak, peerPctOfMedian, accountChanges
    },
    confidence: "low" | "medium" | "high"
  }
  ```
- Im Swipe-Mode: Tap/Hover auf das Kategorie-Badge öffnet **HoverCard** (mobile = Sheet) mit allen Reasons + Mini-Signal-Chips.
- Komponente: `CategoryReasonPopover.tsx` (neu).

### Punkt 9 — Peer-Benchmarks in der Kategorisierung nutzen
- `peer-benchmarks.ts` (`getChatterBenchmark`) wird in der neuen Engine **eingebunden**.
- Neue Regel: Ein Chatter geht **nicht** in COACHING/SOFORT EINGREIFEN, wenn `peerPctOfMedian ≥ 90%` (= performt im Cluster-Schnitt) — auch wenn absolute Schwellen sagen würden „kritisch".
- Umgekehrt: Wenn `peerPctOfMedian < 50%` UND `avgRev > 0` → Reason-Hint „unter Cluster-Schnitt", schiebt ggf. von BEOBACHTEN in COACHING.
- Cold-Start (Confidence „low") → Peer-Logik wird übersprungen, Fallback auf absolute Schwellen.

### Punkt 10 — Hysterese (keine Whiplash-Wechsel)
- Neue Tabelle `chatter_category_state`:
  ```sql
  user_id, chatter_name, platform,
  current_category text,
  since_date date,           -- seit wann diese Kategorie gilt
  last_evaluation_date date,
  last_signals jsonb         -- letzte Signale (für Debug/UI)
  ```
- RLS: standard user-isoliert.
- Logik bei jeder Re-Kategorisierung:
  1. Wenn neue Kategorie = aktuelle → State aktualisieren, fertig.
  2. Wenn Wechsel **rauf** in höhere Severity (BEOBACHTEN → COACHING → SOFORT) → **sofort**.
  3. Wenn Wechsel **runter** (SOFORT → COACHING → BEOBACHTEN) → erst nach **2 Tagen** stabilen Verbesserungs-Signalen.
  4. Onboarding-Wechsel ignoriert Hysterese (folgen dem Tageszähler).
- Im Reason-Tooltip: „Stabil seit X Tagen in dieser Kategorie".

---

## 📁 Datei-Änderungen

### Neu
- **`src/lib/categorize-v2.ts`** — die neue Engine. Exportiert `categorizeChatters(rows, range, options): Map<key, CategoryDecision>`. Nutzt intern peer-benchmarks + state.
- **`src/lib/category-state.ts`** — Loader/Saver für `chatter_category_state` mit Hysterese-Logik.
- **`src/components/CategoryReasonPopover.tsx`** — UI für den Erklärbarkeits-Tooltip.
- **Migration**: Tabelle `chatter_category_state` mit RLS-Policies (user-isoliert + service_role full access).

### Geändert
- **`src/lib/timerange-categorize.ts`** — `recategorizeByWindow` ruft intern jetzt `categorizeChatters` auf, gibt für Backwards-Compat weiterhin `Map<key, ActionCategoryName>` zurück, **plus** zusätzliche Funktion `recategorizeByWindowV2` die `Map<key, CategoryDecision>` liefert.
- **`src/pages/TinderMode.tsx`** — nutzt v2 für Swipe-Cards, hängt `decision` an `ChatterData`, übergibt an `SwipeCard` für das Reason-Popover.
- **`src/components/SwipeCard.tsx`** — empfängt `decision`, rendert das Kategorie-Badge mit `CategoryReasonPopover`.
- **`src/components/CompareModeView.tsx`** + **`src/components/SwapModeView.tsx`** — zeigen ebenfalls die Reasons im Profil-Header an.

### Unverändert (nur lesend genutzt)
- `peer-benchmarks.ts`, `absence-forecast.ts`, `swap-tracking.ts`, `action-categories.ts` (Enum bleibt gleich).

---

## 🔢 Neue Schwellenwerte (zusammengefasst)

| Signal | Normal | Onboarding-Grace (Tag 6–14) |
|---|---|---|
| zeroRate → SOFORT | ≥ 80% | ≥ 90% |
| zeroRate → COACHING | ≥ 50% | ≥ 70% |
| trend7v30 → COACHING | ≤ −30% | ≤ −50% |
| trend7v30 → PUSHEN | ≥ +30% | ≥ +30% |
| BELOHNEN | 7d-Med ≥ 30d-Med×1.10 ODER 5-Tage-Streak ≥ pers. Median ODER Top-20% | gleich |
| lastDelay → SOFORT | > 3 Tage (statt maxDelay) | > 5 Tage |
| Peer-Schutz | peerPctMedian ≥ 90% blockt COACHING/SOFORT | nicht aktiv |

---

## 🧪 Was ich nach der Umsetzung manuell prüfe
1. Build läuft sauber (TypeScript).
2. Migration `chatter_category_state` deployt + RLS aktiv.
3. Auf der Swipe-Seite öffnet das Kategorie-Badge das Reason-Popover mit ≥ 1 Reason.
4. Ein Test-Chatter, der heute „SOFORT EINGREIFEN" wäre, aber peerPctMedian=95% hat → wird zu BEOBACHTEN/COACHING herabgestuft mit Reason „im Peer-Schnitt".
5. Hysterese: Ein Chatter, der heute von SOFORT auf BEOBACHTEN fallen würde, bleibt zunächst auf COACHING (Zwischenstufe) und wechselt erst nach 2 Tagen.

---

## ❓ Offene Punkte vor Umsetzung
- **Punkt 1 (Arbeitstag-aware 0€) und Punkt 5 (robusterer Trend)** waren in deiner Auswahl **nicht enthalten** — ich lasse beide bewusst aus. Falls du sie doch mit reinnehmen willst, sag Bescheid, dann ergänze ich.
- **Hysterese-Tage** (aktuell 2 Tage für Downgrade): Magic Number — falls du lieber 3 oder 1 willst, hier festlegen.

Wenn du den Plan freigibst, setze ich's in einem Rutsch um und melde mich, wenn es live testbar ist.
