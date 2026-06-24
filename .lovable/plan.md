## Ziel

In den Auffälligkeiten (Probleme + Highlights) zwei separate Range-Filter ergänzen:

1. **Follower-Range** des Models, dem der Chatter zugeordnet ist (min–max).
2. **Ø Lifetime-Tagesumsatz** des Chatters (min–max), berechnet aus der vollständigen `chatter_history`.

Beide Filter wirken **pro Panel getrennt** — im Vergleichs-Modus hat die rote (Probleme) und die grüne Seite (Highlights) je ein eigenes Filter-Set.

## UI

Neuer kleiner Filter-Block direkt unter dem Modus/Zeitraum-Header in `AnomalyPanel`:

```text
┌────────────────────────────────────────────────────────────────┐
│ Filter                                              [Reset]   │
│ ── Follower (Model) ──────────────────────────────────────────│
│  Min [ 0       ]   Max [ ∞       ]   Range: 0 – ∞             │
│ ── Ø Tagesumsatz (Lifetime) ──────────────────────────────────│
│  Min [ 0 €     ]   Max [ ∞ €     ]   Range: 0 € – ∞           │
└────────────────────────────────────────────────────────────────┘
```

- Zwei Zahlen-Inputs (Min/Max) pro Metrik — kein dualer Slider-Bar (passt nicht zu offenen Ranges wie „≥200k Follower").
- Leeres Min = `0`, leeres Max = unbegrenzt.
- Klein, dezent, einklappbar (Default eingeklappt; Badge zeigt „2 aktiv" wenn Filter gesetzt).
- Reset-Button leert beide Ranges.
- Stil: bestehende `border-white/[0.06] bg-white/[0.02]`-Card-Optik, monospace-Zahlen.

## Verhalten

- Filter werden auf `visibleGroups` (gruppierte Chatter-Anomalien) angewendet **nach** der Tray-Filterung.
- **Follower** pro Chatter:
  - Nutze `chatterAccounts.get(chatterName)` → Liste Account-Namen → `modelFollowers.get(name.toLowerCase().trim())` → **maximaler** Follower-Wert über alle zugeordneten Accounts (großzügig, damit Multi-Account-Chatter nicht rausfallen).
  - Chatter ohne Follower-Daten: Treffer nur bei Default-Filter (0–∞), bei aktivem Min > 0 ausgeblendet.
- **Ø Lifetime-Tagesumsatz**: bereits in `allTimeAvg: Map<string, number>` vorhanden — direkt verwenden.
- Persistenz: pro Panel-Instanz separat in `sessionStorage`, Key abhängig von `forcedMode` (`anomalies.filters.problems`, `anomalies.filters.highlights`, `anomalies.filters.single`).

## Technische Details

**Geänderte Dateien:**

- `src/components/AnomalyPanel.tsx`
  - Neuer State: `filters: { followerMin, followerMax, revMin, revMax }`, geladen aus sessionStorage mit Key abhängig von `forcedMode ?? "single"`.
  - Neue UI-Komponente (inline) zwischen Mode-Header und Liste.
  - Filter-Logik im `visibleGroups`-Memo: pro Gruppe `getChatterFollowers(name)` und `allTimeAvg.get(name) ?? 0` prüfen.
  - Helper `getChatterFollowers(name)`: iteriert über `chatterAccounts.get(name) ?? []`, summiert max via `modelFollowers`.
  - Active-Count Badge.

**Keine** Änderungen an Datenmodellen, Edge Functions oder anderen Komponenten. Reine Frontend-Filter über bereits geladene Daten.

## Edge Cases

- `Max = 0` interpretieren wir als „unbegrenzt" (leeres Feld), damit das nicht versehentlich alles ausblendet.
- Filter werden im Snapshot **nicht** persistiert (nur in sessionStorage als UI-State) — damit der Cache projektübergreifend gleich bleibt.
- Reset-Action emittiert nichts an die Tray — Tray bleibt unabhängig.
