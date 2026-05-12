## Problem

Die €-Schätzungen im Heute-Tab sind teils Platzhalter (`350€` für Model-Trouble, `250€` für Talent, `8€/h` für Mismatch) oder pauschale Faktoren (`base × 0.5 × 7` für Verzug). Das ist nicht glaubwürdig — wenn der User sieht „Sarah +180€/Wo" sollte das aus **Sarahs eigenen Zahlen** kommen, nicht aus einer Konstante.

## Ziel

Jeder €-Hebel auf einer Karte ist **personengebunden** und aus echten, nachvollziehbaren Medianen abgeleitet. Wenn die Person keine Historie hat → kein €-Wert anzeigen statt eine Phantasiezahl raten.

## Personen-Baseline (pro Chatter, einmalig in `today-engine` berechnet)

Aus den letzten 30T `chatter_history` (statt 14T):

```
medianRevenueActiveDay   — Median € an Tagen mit Umsatz > 0
p75RevenueActiveDay      — was die Person an guten Tagen schafft
medianMassDms            — Median Mass-DMs an aktiven Tagen
medianOpenChats          — Median offene Chats
revenueWithMassDms       — Ø € an Tagen mit ≥3 Mass-DMs
revenueWithoutMassDms    — Ø € an Tagen mit 0 Mass-DMs
massDmLift               — Differenz (€/Tag), wie viel Mass-DMs der Person bringen
sampleSize               — Anzahl auswertbarer Tage
```

Wenn `sampleSize < 5` → person hat keine valide Baseline → Karte zeigt nur das Signal ohne €-Schätzung.

## Neue Impact-Formeln (alle ×7 für Wochenwert)

| Kategorie | Formel | Realitätsbezug |
|---|---|---|
| **verzug** | `medianRev × min(1, delayDays/3) × 7` | Verlorene Tage, gekappt bei 100 % eines Median-Tages |
| **revenue (Drop)** | `(baseRev_today_engine − todayRev) × 7 × recoveryProb` | Echte Gap aus heutigem Drop, `recoveryProb = 0.6` (historisch realistisch) |
| **activity / Mass-DM-Drop** | `massDmLift × 7 × (missingDms / 6)` | Was Mass-DMs **dieser Person** historisch bringen, anteilig zu den fehlenden DMs (Ziel 6/Tag) |
| **activity / Chat-Jam** | `medianRev × 0.25 × 7` nur wenn jam ≥ 2× Median | Konservativ: Jam = ~25 % verlorenes Tagespotenzial |
| **inactivity** | `medianRev × missingDays` (max 3 Tage) | 1:1 verlorene Tage |
| **model (Rückgang)** | `(prevAvg − currAvg) × 7` aus Model-Trouble | Schon vorhanden, einfach durchreichen statt 350 € |
| **talent / orphan** | `medianRev_riser × 7 × matchScore/100` | Was der vorgeschlagene Riser realistisch beisteuert |
| **positive** | 0 | Bleibt Win-Hinweis, kein €-Hebel |

## Recovery / Phase / Slot / Swap

Diese kommen aus `revenue-tasks.ts` und haben **bereits echte Berechnungen**:
- `recovery`: `gap × baseline × confidence` — schon real
- `phase`: `(prevAvg − currAvg) × 7` — schon real
- `slot`: Median € der Peak-Stunden — schon real
- `swap`: Engine-`expectedGain × 7` — schon real

Hier nur **prüfen ob `confidence` korrekt eingerechnet ist** und ggf. ein `Math.min(impact, medianRev × 14)` Sanity-Cap setzen, damit keine 4-stelligen Outlier-Schätzungen entstehen.

## UI-Konsequenzen

- Wenn `impactEurPerWeek == null` (zu wenig Daten) → Chip zeigt `?` statt Zahl, Sortierung fällt auf reinen Urgency-Score zurück
- In den Aufklapp-Details pro Signal kommt eine kurze Begründung der Schätzung dazu:
  `"Median 120€/Tag aktiv · Mass-DMs heben +40€/Tag → 4 fehlende = +160€/Wo"`
- Damit ist die Zahl **erklärbar**, nicht magisch

## Was wir NICHT ändern

- Score-Sortierung (Persistenz × Importance × Kind-Boost) bleibt
- Datenbank, RLS, edge functions
- Bestehende Engines (`recovery-queue`, `swap-suggestions`, `model-tracking`)
- Kategorien, Sektionen, Filter

## Technische Umsetzung

**`src/lib/today-engine.ts`:**
1. `loadChatterStats` erweitern: zusätzlich `p75RevenueActiveDay`, `medianMassDms`, `revenueWithMassDms`, `revenueWithoutMassDms`, `massDmLift`, `sampleSize` pro Chatter berechnen
2. Neue Funktion `estimateImpact(signal, stats)` ersetzt das aktuelle `estimateImpactForTodo`:
   - Liest aus `signal.kind` + ggf. Zahlen aus `signal.why` (Verzug-Tage, %-Drop) — oder besser: die Zahlen werden in `daily-todos.ts` als strukturierte Felder mitgegeben (siehe unten)
3. Sanity-Cap: `Math.min(impact, stats.medianRev × 14)` damit kein Signal mehr als 2 Wochen Median-Umsatz schätzt

**`src/lib/daily-todos.ts`:** strukturierte Zusatzfelder pro Todo:
- `meta?: { delayDays?, dropPct?, todayRevenue?, baselineRevenue?, missingMassDms? }`
Damit `today-engine` nicht aus Strings parsen muss. Backwards-kompatibel (optional).

**`src/components/PersonActionCard.tsx`:**
- €-Chip zeigt `?` wenn null
- Detail-Aufklapper zeigt Begründungs-Zeile pro Signal

## Reihenfolge

1. Stats erweitern (medianRev → komplettes Baseline-Objekt mit Mass-DM-Lift)
2. `daily-todos` um `meta`-Feld erweitern, in den Regeln befüllen
3. `estimateImpact` neu schreiben, alle Hardcoded-Zahlen entfernen
4. Sanity-Cap + null-Handling
5. UI: Begründungszeile in Aufklapper, `?` für unbekannt
