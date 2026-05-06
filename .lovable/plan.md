# Effort × Potential als Filter-Chip

## Änderungen

**1. Karte raus, Filter-Chip rein**
- `<EffortPotentialCard />` aus dem Live-Tracking-Header entfernen.
- Neuen Filter-Chip **"Mismatch"** in der sticky Toolbar hinzufügen, direkt **hinter "Inaktiv"**. Count = Anzahl Mismatch-Chatter.

**2. Reine Zeit-Logik — keine Umsatz-Verzerrung**
Die bestehende Berechnung in `effort-potential.ts` ist bereits rein zeitbasiert (aktive Stunden/Tag aus `chatter_hourly_stats` vs. Follower-Tier des aktuellen Accounts). Aber zwei Sachen werden vereinfacht/präziser:

- **Effort = nackte Stunden/Tag** (Ø der letzten 14 Tage). Kein Team-Median-Scaling mehr — der war zu fragil bei kleinen Teams.
- **Potential = Follower-Tier des Accounts** (Seed/Starter/Growth/Top).
- **Mismatch-Regel** (rein zeitbasiert):
  - **Hochziehen**: Ø ≥ 5h/Tag UND Tier ∈ {Seed, Starter} → "viel Zeit auf kleinem Account"
  - **Underused Top**: Ø ≤ 2h/Tag UND Tier ∈ {Growth, Top} → "großer Account, wenig Zeit"
- Schwellen sind klar und nachvollziehbar (kein Score-Voodoo). Optional später per Setting tunable.

**3. Listen-Darstellung im Filter**
Wenn `filter === "mismatch"`:
- Standard-Bucket-Gruppierung wird übersprungen (wie bei `live_now`).
- Stattdessen flache Liste mit **2 Sektion-Headern**:
  - "Hochziehen · viel Zeit · kleiner Account" (sortiert nach Stunden absteigend)
  - "Underused · großer Account · wenig Zeit" (sortiert nach Stunden aufsteigend)
- Jede Zeile nutzt die normale `<Row />`-Komponente (konsistent mit dem Rest), bekommt aber rechts eine kleine Pill: `Ø 8.2h · 🌱 Seed` bzw. `Ø 1.4h · 👑 Top`.

**4. Korrektheit prüfen**
- Sicherstellen, dass `account` aus dem JÜNGSTEN `chatter_history`-Eintrag pro Chatter kommt (war im Code dank `order DESC` korrekt — bestätigen).
- Onboarding-Filter (<14 Tage) bleibt: zu wenig Daten → nicht in Mismatch.
- Chatter ohne Stunden-Daten (`daysObserved < 3`) raus.
- Chatter ohne zugewiesenen Account fließen NICHT in Mismatch — die haben keinen Tier-Vergleich.

## Geplante Dateien
- bearbeitet: `src/lib/effort-potential.ts` — Schwellen-Logik vereinfachen, reine Stunden-Regel
- gelöscht: `src/components/EffortPotentialCard.tsx`
- bearbeitet: `src/pages/LiveTracking.tsx` — Card-Render entfernen, Filter-Chip + Mismatch-View hinzufügen
