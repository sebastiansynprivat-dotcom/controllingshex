## Ziel
Wochenziel-Prozess robuster & schneller: Kanal-Filter in der Rückblick-Ansicht, plattform­übergreifende Zusammenführung pro Chatter, korrekter Tages­durchschnitt bei kleinen Zielen, saubere Behandlung neuer Chatter inkl. eigener Einführungs­nachricht.

Alle Änderungen betreffen ausschließlich das Wochenziel-System.

---

### 1) Kanal-Filter in „Vergangene Wochenziele"
Datei: `src/components/PastWeeklyGoalsTab.tsx`

- Chip-Filter oberhalb der Liste: **Alle · WhatsApp · Plattform** (mit Counts).
- Klassifikation via bereits vorhandenem `classifyName()`-Ansatz aus `BulkGoalMessagesDialog.tsx` (WhatsApp = abgekürzter Nachname / letzter Token ≤ 3 Zeichen oder endet auf „."). Helper in eine kleine Util `src/lib/chatter-channel.ts` extrahieren, damit Bulk-Dialog + Past-Tab dieselbe Logik nutzen.
- Auswahl in `localStorage` merken (Key `pastWeeklyGoals.channelFilter`).
- Optional: dezente Kanal-Chip-Anzeige pro Zeile (WA / Plattform), damit sofort erkennbar.

Analog auch in der „Aktuelle Wochenziele"-Übersicht (`WeeklyGoals.tsx`, Tab `current`) denselben Chip-Filter anbieten, damit man WA-Nachrichten am Stück durcharbeiten kann.

---

### 2) Chatter über mehrere Plattformen zusammenführen
Problem: derselbe Chatter (z. B. Maloum + Bratzzels) hat pro Plattform ein eigenes Wochenziel und eigene Zielerreichung → widersprüchliches Feedback.

Ansatz **Zusammenführung nur auf Feedback-Ebene** (kein Schema-Umbau):
- In `PastWeeklyGoalsTab` und in der Feedback-/Vorschlagslogik von `WeeklyGoals.tsx` alle `weekly_goal_results` des Chatters **plattform­übergreifend** laden (nicht mehr `.eq("platform", platform)` filtern für die Aggregation).
- Pro Chatter + Woche: `goal_eur` und `actual_eur` **über alle Plattformen summieren**, `achieved = sum(actual) ≥ sum(goal)`.
- `lastAchievementPct` (Bucket-Zuordnung Star/Strong/On-Track/Close/Off-Track) basiert auf der zusammengeführten Vorwoche → nur **ein** Bucket, damit nur **eine** Feedback-Nachricht pro Chatter.
- Bei der Nachrichten-Generierung im Bulk-Dialog werden Duplikate (gleicher Chatter-Name, mehrere Plattformen) zu einer Zeile gemergt; das Ziel wird als Summe angezeigt.
- Der Platform-Switch bleibt für die *Bearbeitung* / Zielsetzung erhalten, aber „letzte-Woche"-Klassifikation ist plattform­übergreifend.

---

### 3) Korrekte Tagesberechnung bei kleinen Wochenzielen
Datei: `supabase/functions/generate-goal-message/index.ts`

Aktuell:
```
const dailyTarget = Math.round((proposedGoal / 7) / 10) * 10;
```
→ bei Ziel 10 € = 0.

Neu (sanftes Runden, nie auf 0):
- Wenn `proposedGoal / 7 < 20` → auf **1 €** runden (`Math.max(1, Math.round(proposedGoal / 7))`).
- Sonst wie bisher auf 10 € runden.
- Ausgabe im Template `{tagesziel}` bleibt gleich, aber Wert ist nun sinnvoll (z. B. „Ø 1 €/Tag").

---

### 4) Neue Chatter erkennen (kein „letzte Woche erreicht/nicht erreicht")
- Neuer Szenario-Typ `weekly_intro` im Edge-Function-Flow.
- Erkennung: Für den Chatter existiert **kein** `weekly_goal_results`-Eintrag (plattform­übergreifend geprüft, siehe Punkt 2), d. h. er hatte noch nie ein abgeschlossenes Wochenziel.
- Wenn `weekly_intro` → wird **nicht** auto-klassifiziert nach growth/flat/decline; stattdessen wird die Intro-Vorlage verwendet.
- Sobald mindestens ein `weekly_goal_results`-Eintrag existiert, greift ab der nächsten Runde automatisch die reguläre Bucket-Logik.

---

### 5) Eigene Einführungs-Vorlage `weekly_intro`
- Neuer Scenario-Key `weekly_intro` in:
  - `supabase/functions/generate-goal-message/index.ts` (`DEFAULT_WEEKLY` + Auswahllogik).
  - `src/components/GoalMessageTemplatesDialog.tsx` (`WEEKLY_LABELS`, `DEFAULTS`, `ALL_SCENARIOS`, `activeScenarios` für Wochenziele).
- Platzhalter: `{name}`, `{ziel}`, `{tagesziel}` (kein `{letztewoche_umsatz}` da nicht vorhanden).
- Default-Text (editierbar):
  > „Hey {name}, ab jetzt arbeiten wir mit Wochenzielen 🎯🏻 Jede Woche gibt's ein klares Ziel + kurzes Feedback, damit du dich Woche für Woche steigerst.
  >
  > Dein erstes Ziel: *{ziel}* — Ø *{tagesziel}/Tag*. Ziel wird regelmäßig an deine Entwicklung angepasst. Los geht's 💪🏻"
- Im Templates-Dialog als eigene Karte (4. Karte unter Wochenziele) mit „Erstes Wochenziel (neuer Chatter)" gekennzeichnet.

---

### Technische Details

**Neue Util** `src/lib/chatter-channel.ts`
```ts
export type ChatterChannel = "whatsapp" | "platform";
export function classifyChannel(name: string): ChatterChannel { /* aus BulkGoalMessagesDialog übernommen */ }
```
Import in `BulkGoalMessagesDialog.tsx` und `PastWeeklyGoalsTab.tsx` + `WeeklyGoals.tsx`.

**Edge-Function-Flow (weekly)**
```
if (!hasAnyPreviousResult) scenario = "weekly_intro";
else scenario = scenarioOverride ?? autoBucket(vsPrior);
```
`hasAnyPreviousResult` = COUNT `weekly_goal_results` für `chatter_name` (alle Plattformen) > 0.

**Frontend (`WeeklyGoals.tsx`)**
- Beim Vorschlags-Load zusätzlich Set `chattersWithHistory` (aus `weekly_goal_results`, plattform­übergreifend) laden.
- Chatter ohne History → Bucket `new` (bereits vorhanden), aber Bulk-Dialog schickt `goal_type: "weekly"` — Edge-Function entscheidet dann selbst auf `weekly_intro`.

**Keine Schema-Änderungen** nötig. Kein Migrations-Bedarf.

---

### Betroffene Dateien
- `src/lib/chatter-channel.ts` *(neu)*
- `src/components/PastWeeklyGoalsTab.tsx`
- `src/components/BulkGoalMessagesDialog.tsx`
- `src/components/GoalMessageTemplatesDialog.tsx`
- `src/pages/WeeklyGoals.tsx`
- `supabase/functions/generate-goal-message/index.ts`
