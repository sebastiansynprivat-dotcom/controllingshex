## Problem

Aktuell landen Chatter in **„Läuft sauber"**, die ganz klar **nicht** sauber laufen — z. B. ältester Chat > 1 Tag offen, heute 0 € Umsatz, aber der Status ist trotzdem `active` (weil 1 DM raus oder ähnlich), und keine der harten Schwellen greift:

- `chats_pile` triggert erst bei **unread ≥ 25** ODER **oldest ≥ 3 Tagen** → 1–2 Tage alte Chats rutschen durch
- `weak_pacing` verlangt `status === "active_weak"` UND ≥ 20 € Lücke → wer wenig avgRev hat, fällt raus
- `dms_low_rev_low` greift nur wenn avgDms ≥ 3
- → Rest fällt in **`running_clean`**, obwohl tatsächlich Probleme da sind

Zusätzlich ist die **Reihenfolge der Kategorien** fix nach Kind sortiert (`inactive_push`, `weak_pacing`, …), nicht nach tatsächlicher Dringlichkeit. Ein „Läuft sauber"-Eintrag mit 0 € heute steht dadurch optisch korrekt unten — aber der Eintrag dürfte gar nicht erst dort sein.

## Änderungen (nur `src/pages/LiveTracking.tsx`)

### 1. `chats_pile` verschärfen
Schon **früher** als Stau erkennen — nicht erst bei 3 Tagen:
- Trigger: `unread ≥ 15` ODER `oldest ≥ 1` (Tag) ODER `oldest ≥ 0.5 ∧ today < avgRev * 0.4`
- Reason-Text passt sich an (Stunden statt Tagen wenn < 1d)

### 2. Neuer Trigger vor `running_clean`: **„nichts läuft heute"**
Wenn am Ende noch kein Bucket gegriffen hat, aber:
- `today < avgRev * 0.3` (deutlich unter Schnitt) ODER
- `today === 0 ∧ avgRev ≥ 10`

→ einsortieren als `weak_pacing` (Lücke zum Schnitt) oder `dms_low_rev_low` (wenn DMs auch schwach), statt `running_clean`.

### 3. `running_clean` strenger
Nur noch wenn:
- `today ≥ avgRev * 0.5` (mindestens halber Tagesschnitt erreicht oder pacing-anteilig erfüllt) UND
- `unread < 15` UND `oldest < 1` UND
- `seen` letzte 30 min aktiv

Sonst kein Eintrag → Chatter taucht in der To-Do-Liste **nicht** auf (wie vor dem letzten Schritt für unauffällige).

### 4. Sortierung innerhalb „To-Do" wirklich nach Dringlichkeit
Statt fixer `kind`-Reihenfolge: 
- Primär nach **`dayPotentialEur` desc** (was heute am meisten auf dem Spiel steht)
- Sekundär: `chats_pile` mit `oldest ≥ 2d` und `inactive_push` werden zusätzlich um +X € „Severity-Bonus" geboostet, damit lange offene Chats / komplette Ausfälle oben bleiben
- `praise` und `running_clean` immer ans Ende, intern nach Umsatz desc

### 5. Header-Counts pro Kategorie bleiben unverändert; nur Sortierung der Karten ändert sich.

## Out of scope
- Keine Änderung an `live-activity.ts` (Status-Logik bleibt)
- Keine neuen Filter/Tabs
- Keine Settings/Persistenz
