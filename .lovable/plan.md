## Ziel
In der **Revenue Recovery** Liste wird neben jedem Chatter-Namen ein kleines Badge mit der **Leaderboard-Platzierung über 30 Tage** angezeigt (z.B. `#3`). Wenn ein Chatter aktuell zu den Top-Performern (Top 10) gehört und trotzdem unter Baseline läuft, bekommt er zusätzlich das Label **„Top-Performer im Dip"** als Warnsignal.

## Was passiert

1. **Leaderboard-Daten laden (30 Tage rolling)**
   - Beim Mount der `RecoveryQueueCard` wird parallel zur bestehenden History-Abfrage ein 30-Tage-Umsatz pro Chatter aus `chatter_history` aggregiert (gleiche Logik wie auf der Leaderboard-Seite: Summe `revenue_today` der letzten 30 Tage).
   - Daraus wird ein Rang-Mapping `chatterName → rank` gebaut (1 = höchster Umsatz).

2. **Mapping in die Recovery-Einträge mergen**
   - Jeder `RecoveryEntry` bekommt zwei optionale Felder: `leaderboardRank?: number` und `isTopPerformer?: boolean` (true wenn `rank ≤ 10`).
   - Top-Performer werden **nicht** ausgefiltert — sie bleiben sichtbar mit zusätzlichem Hinweis.

3. **UI-Erweiterung in `RecoveryQueueCard`**
   - Neben dem Chatter-Namen: kleines Badge `#3` (subtil, dezenter Stil passend zum bestehenden minimalistischen Design).
   - Falls kein Rang gefunden (Chatter nicht in Top 50 / keine Daten): kein Badge, nur „—" oder gar nichts.
   - Falls `isTopPerformer === true`: zusätzliches kleines amber/gold Label „Top-Performer im Dip" unter dem Namen, damit klar wird, dass das ein wichtiger Chatter ist, der gerade schwächelt.

4. **Tooltip / Mini-Info**
   - Hover/Tap auf das Rang-Badge zeigt Tooltip: „Platz 3 im 30-Tage-Leaderboard".

## Technische Details

**Datei: `src/lib/recovery-queue.ts`**
- Neue Funktion `loadLeaderboard30dRanks(platform, history?)`: Aggregiert 30T-Revenue pro Chatter und gibt `Map<string, number>` (name → rank) zurück. Kann die bereits geladene History wiederverwenden, um keinen zweiten DB-Call zu machen.
- `RecoveryEntry` Interface erweitern um `leaderboardRank?: number` und `isTopPerformer?: boolean`.
- `computeRecoveryQueue` bekommt optional die Rank-Map und merged sie in die Ergebnisse.

**Datei: `src/components/RecoveryQueueCard.tsx`**
- `useEffect` lädt History → berechnet Recovery + Ranks gleichzeitig (kein zusätzlicher Roundtrip nötig, da History bereits 30 Tage abdeckt).
- Render-Logik für Badge: kleines `<span>` mit `text-[10px] tabular-nums` neben Name, Stil konsistent zum bestehenden glassy Look.
- Top-Performer-Label nur wenn `rank ≤ 10`.

**Keine DB-Änderungen.** Keine neuen Tabellen, kein Migration nötig.
