## Ziel
Neue Upgrade-Klasse `high_converter` in die bestehende Upgrade-Kandidaten-Logik einbauen. Alte Trigger (`seed`, `second_account`, `promotion`) bleiben unverändert – rein additiv.

## Was neu dazukommt

**Neue Klasse: `high_converter`**
Chatter, die pro eingehender Nachricht überdurchschnittlich viel Umsatz machen – auch wenn ihr Account (noch) klein ist.

### Datenquellen (alle vorhanden, nichts neu bauen)
- `get_live_efficiency(user_id, platform, from, to)` RPC → liefert `eur_per_incoming`, `total_incoming_proxy`, `total_revenue` pro Chatter
- `account-tiers.ts` → Tier-Zuordnung (seed/starter/growth/top) via Follower-Count
- `chatter_history` (bestehend) → aktueller Account-Zuweisungs-Snapshot

### Trigger-Bedingungen (alle müssen erfüllt sein)
1. **Volumen-Gate:** `total_incoming_proxy ≥ 50` in den letzten 14 Tagen (sonst Zufall)
2. **Aktivitäts-Gate:** `total_active_min ≥ 60` und `session_count ≥ 3` (nutzt bestehendes `hasUsableLiveData`)
3. **Conversion-Lift:** `eur_per_incoming` des Chatters ≥ **1.3× Peer-Median** auf Accounts derselben Tier-Gruppe
4. **Chatter sitzt aktuell nicht schon auf einem Top-Tier-Account** (sonst nichts zu upgraden)

### Peer-Median-Berechnung
- Für jeden Tier (`seed`, `starter`, `growth`, `top`) den Median von `eur_per_incoming` über alle Chatter berechnen, die aktuell auf einem Account dieses Tiers sitzen und das Volumen-Gate erfüllen.
- Vergleich: Chatter-Wert vs. Median seines **aktuellen** Tiers.

### Priorität im Dedup (in `account-swap-engine.ts`)
Neue Reihenfolge:
```
high_converter > second_account > promotion > seed_p1 > seed_p2
```
Pro Chatter weiterhin nur eine Karte. Wenn ein Chatter sowohl `high_converter` als auch z. B. `promotion` triggert, gewinnt `high_converter`.

### Fallback-Verhalten
- Keine Live-/Incoming-Daten für einen Chatter → `high_converter` triggert einfach nicht, alte Klassen greifen wie bisher.
- Kein Chatter fällt aus der Liste raus, der vorher drin war.

## Technische Details

### Änderungen an `src/lib/account-swap-engine.ts`
- Neuen Type `"high_converter"` zum Upgrade-Kind-Union hinzufügen
- Neue Funktion `detectHighConverters(platform, currentAssignments, followersByAcc)`:
  - Lädt Live-Efficiency für die letzten 14 Tage via `fetchLiveEfficiency` (aus `src/lib/live-efficiency.ts`)
  - Filtert auf Volumen-/Aktivitäts-Gate
  - Berechnet Peer-Median pro Tier
  - Emittiert Kandidaten mit `eur_per_incoming ≥ 1.3× tier-median`
- In der bestehenden Aggregation aufrufen und **vor** den anderen Klassen ins Dedup einspeisen
- `impactEurPerWeek` bleibt konsistent mit den anderen Upgrade-Karten (aktuell hart 0 gesetzt) – nicht anfassen

### Änderungen an `src/pages/Today.tsx`
- Nur Anzeige-Label ergänzen: `high_converter` → z. B. „Top-Konvertierer" mit Kurzbegründung („X €/Nachricht, +Y% über Peer-Median")
- Rendering nutzt weiterhin `PersonActionCard`, keine neuen Komponenten

### Keine Änderungen an
- DB-Schema, RLS, RPCs
- Bestehende Upgrade-Klassen und deren Schwellen
- `potential-detector.ts` (parallel-System bleibt wie es ist)

## Offene Punkte (kann ich mit Defaults bauen, sag Bescheid wenn was anders sein soll)
- **Zeitfenster:** 14 Tage (analog zur bestehenden Upgrade-Logik)
- **Volumen-Gate:** 50 incoming/14T
- **Lift-Faktor:** 1.3×
- **Tier-Vergleich:** gegen Peer-Median des **aktuellen** Tiers (nicht Ziel-Tier)