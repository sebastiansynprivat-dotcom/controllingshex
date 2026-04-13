

## Plan: Kategorisierung & Swipe-Karten-Display fixen

### Problem (Daten bestätigt)
Die heutigen Daten zeigen massive Fehlkategorisierungen durch die KI:
- **ACCOUNT-EINBRUCH**: 32 Chatters, alle mit 0€ Umsatz — viele davon sind einfach 0€-Tage, kein Einbruch
- **ACCOUNT UPGRADE (UMSATZ-STREAK)**: 5 Chatters mit 0€ — unmöglich
- **BREAKOUT-STAR**: 2 mit 0€, **TOP PERFORMER**: 1 mit 0€, **KURZ VOR UPGRADE**: 2 mit 0€
- **WEITER SO**: 69 Chatters mit Ø 1€ — viele gehören in 0€-Kategorien

Die KI halluziniert Kategorien. `buildResultFromCsv` übernimmt die KI-Kategorie blind.

### Lösung: Client-seitiger Safety-Override nach KI-Merge

In `Upload.tsx` → `buildResultFromCsv` wird nach dem KI-Merge ein **Validierungsschritt** eingefügt:

| Regel | Bedingung | Override |
|---|---|---|
| 0€ kann kein Upgrade sein | `revenueToday === 0` UND Kategorie ist UPGRADE/BREAKOUT/TOP/KURZ VOR | → `0€ UMSATZ TAG 1` (oder passender Tag aus History) |
| 0€ bleibt 0€ bei WEITER SO | `revenueToday === 0` UND Kategorie = WEITER SO | → `0€ UMSATZ TAG X` basierend auf Streak |
| ACCOUNT-EINBRUCH braucht Beweise | `revenueToday === 0` UND keine signifikante Umsatz-Historie | → `0€ UMSATZ TAG X` statt EINBRUCH |

Zusätzlich:
- **"NULL EURO TAG"** aus `step2_categorize` in den Mapping-Funktionen (`mapToAllowed`, `mapToSwipeCategory`) erkennen → auf `0€ UMSATZ TAG 1` mappen
- **Gesamtumsatz** als KPI in `buildResultFromCsv` hinzufügen (fehlt aktuell, nur 3 KPIs)

### Dateien

| Datei | Änderung |
|---|---|
| `src/pages/Upload.tsx` | Override-Logik in `buildResultFromCsv`: 0€-Revenue erzwingt 0€-Kategorie wenn KI-Kategorie nicht passt. Gesamtumsatz-KPI hinzufügen. |
| `src/components/CategoryResultCards.tsx` | `mapToAllowed`: "NULL EURO TAG" → "0€ UMSATZ TAG 1" |
| `src/pages/TinderMode.tsx` | `mapToSwipeCategory`: "NULL EURO TAG" → "0€ UMSATZ TAG 1" |
| `supabase/functions/analyze-csv/index.ts` | Im System-Prompt klarstellen: ACCOUNT-EINBRUCH nur bei nachweislich starker Umsatz-Historie, NICHT bei 0€ ohne Historie |

### Technisches Detail

```text
buildResultFromCsv() aktuell:
  CSV-Metrics → AI-Kategorie übernehmen → fertig

buildResultFromCsv() NEU:
  CSV-Metrics → AI-Kategorie übernehmen → OVERRIDE prüfen:
    if revenueToday === 0:
      if kategorie in [UPGRADE, BREAKOUT, TOP, KURZ VOR] → 0€ TAG X
      if kategorie === WEITER SO → 0€ TAG X
      if kategorie === ACCOUNT-EINBRUCH:
        check history: hatte Chatter vorher >30€/Tag? → EINBRUCH bleibt
        sonst → 0€ TAG X
```

Der "Tag X"-Wert wird aus `chatter_history` berechnet (Streak zählen). Dafür wird die History vor dem Merge geladen.

