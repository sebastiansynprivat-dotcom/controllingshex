# Effort-vs-Potential Match

Ziel: Auf einen Blick sehen, **wer auf welchem Account sitzt — und ob das passt.** Chatter mit viel Zeit auf kleinen Accounts und Chatter mit wenig Zeit auf Top-Accounts werden direkt nebeneinandergestellt, damit du Re-Assignments triggern kannst.

## Wo es lebt

Neuer Block im **Live-Tracking** (oberhalb der Chatter-Liste, unter den Peak-Cards): **"Effort × Potential"**.

Optional zusätzlich verlinkt im Profil-Slide-Over als Hinweis-Pill ("Underused auf Top-Account" / "Overworking Seed-Account").

## Die Logik (clean & datenbasiert)

Pro Chatter berechnen wir zwei normierte Scores aus bestehenden Daten:

1. **Effort-Score** (0–100): Ø aktive Stunden/Tag der letzten 14 Tage aus `chatter_hourly_stats` — relativ zum Team-Median skaliert.
   - <50 = "wenig aktiv", 50–80 = "normal", >80 = "Workhorse"
2. **Potential-Score** (0–100): Tier des aktuell zugewiesenen Accounts aus `models.follower_count` via `tierForFollowers()`.
   - Seed=20, Starter=45, Growth=70, Top=95

**Match-Delta** = `Effort - Potential`:
- **Stark negativ (≤ −30)**: Hoher Effort, kleiner Account → "**Hochziehen**" (Kandidat für Top-Account)
- **Stark positiv (≥ +30)**: Wenig Effort, großer Account → "**Underused Top**" (Account verschwendet)
- **±30**: Match passt

## UI: 2-Spalten-Gegenüberstellung

```text
┌─────────────────────────────┬─────────────────────────────┐
│ HOCHZIEHEN                  │ UNDERUSED TOP-ACCOUNT       │
│ Viel Zeit · kleiner Account │ Top-Account · wenig Zeit    │
├─────────────────────────────┼─────────────────────────────┤
│ Anna   8.2h/Tag · 🌱 Seed   │ Tom    1.4h/Tag · 👑 Top    │
│        +180€ vs Tier-Med    │        −62% vs Tier-Med     │
│        → Swap-Vorschlag     │        → Swap-Vorschlag     │
│ Mike   7.1h/Tag · 🌿 Start  │ Lea    2.0h/Tag · 🔥 Growth │
│ ...                         │ ...                         │
└─────────────────────────────┴─────────────────────────────┘
```

- Jede Zeile: Chatter · Ø h/Tag · aktuelles Tier-Emoji · €-Delta vs Peer-Median (bestehende `peer-benchmarks.ts`).
- Zeile klickbar → öffnet Chatter-Profil-SlideOver.
- "Swap-Vorschlag"-Pill triggert vorhandenen Swap-Flow (`SwapModeView`).

Beide Spalten max. 5 Einträge, sortiert nach Match-Delta-Betrag (extremste Mismatches oben).

Header mit Toggle: **14d / 7d** Lookback.

## Edge Cases
- Chatter ohne zugewiesenen Account (kein `models`-Eintrag): nicht in Mismatch, sondern in eigener Mini-Pill "Kein Account zugewiesen · X Chatter".
- Onboarding (<14 Tage seit erstem `chatter_history`-Eintrag): ausgeschlossen — zu wenig Daten.
- Wenn beide Spalten leer (alle Matches passen): grüner Status "Alle Effort-Levels passen zum Account".

## Technische Details

**Neue Datei:** `src/lib/effort-potential.ts`
- `loadEffortPotentialMatrix(platform, lookbackDays)` → für jeden Chatter:
  - Aggregiert aktive Stunden aus `chatter_hourly_stats` (gleiche Logik wie `ChatterActivityHoursCard`).
  - Holt aktuellen Account-Mapping aus jüngstem `chatter_history`-Eintrag (Spalte `account`).
  - Lookup Follower → Tier via `tierForFollowers()`.
  - Berechnet `effortScore`, `potentialScore`, `delta`, `verdict: "pull_up" | "underused" | "match"`.
- Reuse `peer-benchmarks` für €-Delta-Annotation.

**Neue Komponente:** `src/components/EffortPotentialCard.tsx`
- 2-Spalten-Layout (md+), gestackt auf Mobile.
- Verwendet bestehende `premium-card`-Styles und Tier-Farben aus `account-tiers.ts`.

**Integration:** `src/pages/LiveTracking.tsx`
- Render `<EffortPotentialCard />` nach dem Peak-Cards-Grid, vor der Chatter-Liste.

Keine DB-Migrationen nötig — alle Daten existieren bereits.

## Geplante Dateien
- neu: `src/lib/effort-potential.ts`
- neu: `src/components/EffortPotentialCard.tsx`
- bearbeitet: `src/pages/LiveTracking.tsx`
