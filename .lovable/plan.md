# Tagesziel + Peer-Ø auf Swipe-Karten

## Ziel
Auf jeder Swipe-Karte (TinderMode / Onboarding-Mode) soll der Coach
1. den **Peer-Durchschnitt** des Chatters (€/Tag, basierend auf seinem Cluster bzw. Account-Baseline) immer sichtbar haben,
2. ein **automatisch vorgeschlagenes Tagesziel** sehen, abgeleitet aus dem Peer-Median des Accounts,
3. dieses Ziel **direkt auf der Karte eintragen / bestätigen / anpassen** können,
4. das vergebene Tagesziel **dauerhaft auf der Karte angezeigt** bekommen (mit Datum / "heute vergeben").

## Architektur

### 1. Neue Tabelle `chatter_daily_goals` (Migration)
Spalten:
- `id` uuid pk
- `user_id` uuid (RLS: auth.uid())
- `platform` text default 'Maloum'
- `chatter_name` text
- `goal_date` date default current_date
- `goal_eur` numeric (das vergebene Ziel)
- `suggested_eur` numeric (was das System vorgeschlagen hat — für Auswertung)
- `source` text ('peer-cluster' | 'account-baseline' | 'global' | 'manual')
- `note` text nullable
- `created_at`, `updated_at` timestamps
- Unique-Index `(user_id, platform, chatter_name, goal_date)` → 1 Ziel pro Tag pro Chatter
- RLS: Users CRUD nur eigene Rows, Service-Role full access

### 2. Neue Helper `src/lib/daily-goals.ts`
- `suggestDailyGoal(bm: ChatterBenchmark): { eur: number; source: string; rationale: string }`
  - Priorität: Account-Baseline (avg ×1.1, "Stretch +10%") > Peer-Cluster-Median > Global-Median
  - Rundung auf nächste 5/10/25 € je nach Größe
  - Cold-Start (source = "none") → kein Vorschlag, manuelle Eingabe
- `loadTodayGoals(platform)` → Map<normalizedName, GoalRow> für heute
- `upsertDailyGoal(platform, chatterName, eur, suggested, source)` → schreibt/aktualisiert Eintrag

### 3. SwipeCard UI (`src/components/SwipeCard.tsx`)
Neuer kompakter Block direkt **unter dem Hero-KPI**, oberhalb der weiteren KPIs:

```
┌─ Tagesziel ─────────────────────────────────┐
│  Peer-Ø: 240 €/Tag  ·  Cluster 10K-30K       │
│                                               │
│  [ Vorschlag: 265 € ]   [ ✏️ anpassen ]      │
│                                               │
│   …oder bei vergeben:                         │
│  ✅ Ziel heute vergeben: 280 €  ·  14:32      │
│                                       [ändern]│
└───────────────────────────────────────────────┘
```

- **Peer-Ø-Zeile**: zeigt immer `formatBenchmarkLabel`-Wert + Cluster-Label (oder Account-Ø-Tage), egal welche Größe → fällt auf globalen Median zurück.
- **Vorschlag-Pill**: tap-bar → speichert direkt mit einem Tap (Toast „Tagesziel 265 € vergeben").
- **„✏️ anpassen"** öffnet ein leichtes Inline-Sheet (kleines Popover/Drawer) mit Number-Input + Speichern. Kein Reload.
- **Vergeben-State**: ersetzt die Vorschlag-Pill durch grünes Badge mit Wert + Uhrzeit, plus „ändern"-Link.
- Touch-Bereich groß, kein Drag-Konflikt (`stopPropagation` + `pointer-events`).
- Reihenfolge: passt zwischen `pickHeroKpi`-Block und `kpiEntries`.

### 4. TinderMode-Loader (`src/pages/TinderMode.tsx`)
- Nach `loadBenchmarks` zusätzlich `loadTodayGoals(platform)` parallel laden.
- Map `goalsByChatter` per `useState`, an SwipeCard via Prop weiterreichen (`dailyGoal` + `onAssignGoal`).
- Auf erfolgreichem Upsert: Map sofort lokal aktualisieren (optimistic) → Karte aktualisiert ohne Reload.
- Funktioniert in allen Time-Range-Modi; Suggestion bleibt aus aktuellem `peerBm`.

### 5. Optional: ChatterSlideOver
Im Detail-SlideOver oben kleiner Mirror-Block „Heutiges Ziel: 280 €" — read-only, nur falls bereits vergeben. (Hält UX konsistent, ohne Doppelaufwand.)

## Fragen / Annahmen
- **Goal-Formel**: Account-Baseline × 1.1 (Stretch +10%), sonst Cluster-Median × 1.0. Falls du lieber +20% / +0% willst → leicht änderbar in `suggestDailyGoal`.
- **Pro Tag 1 Ziel**: Falls jemand mehrfach am Tag drückt → wird aktualisiert, nicht dupliziert.
- **Sichtbarkeit Peer-Ø**: aktuell zeigt die kleine Pill oben schon `XX% vom Peer-Ø`. Im neuen Block wird der **absolute €-Wert** des Peer-Ø zusätzlich gezeigt — wie gewünscht ("egal welche Größe").

## Files
- **NEW** `supabase/migrations/<ts>_chatter_daily_goals.sql` — Tabelle + RLS
- **NEW** `src/lib/daily-goals.ts` — Suggest/Load/Upsert
- **EDIT** `src/components/SwipeCard.tsx` — Tagesziel-Block + Inline-Edit + Props
- **EDIT** `src/pages/TinderMode.tsx` — Goals laden, an Card durchreichen, Optimistic Update
- **EDIT** `src/components/ChatterSlideOver.tsx` *(optional)* — Read-only Mirror

## Out of Scope
- Auswertung/History-View vergangener Ziele (kann später ein eigener Tab werden, Daten sind dann da).
- Goals an Chatter automatisch verschicken (Webhook/DM) — nur Eintragen wie gewünscht.