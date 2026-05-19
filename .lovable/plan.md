## Befund

Auf dem Dashboard sieht der Brezzels-Workspace heute **0 Chatter mit Verzug** — auf der Today-Seite tauchen aber **30+ Karten in der Kategorie „Verzug"** auf (Karolina 14T, Alan 13T, Jesse 13T, Melina 13T usw.). Diskrepanz ist real und reproduzierbar.

### Ursache

Beide Seiten messen verschieden:

- **Dashboard** liest `analysis_reports.result_json.categories`. Brezzels hat heute keine `WARNUNG`-Kategorie, weil das Backend-Categorize die Chatter mit hohem `response_delay_days` als **ONBOARDING TAG X** klassifiziert (Karolina = Tag 12, Alan = Tag 11 etc.). Bei Onboarding-Chattern werden die alten unbeantworteten Chats nicht als Versäumnis gewertet — sie sind ja gerade erst angelernt.
- **Today** (`src/lib/daily-todos.ts` Zeile 205–217 und `src/lib/today-engine.ts` Verzug-Branch) liest `chatter_history.response_delay_days` direkt. Ab `delay >= 3` wird unabhängig vom Kategorie-Status ein Verzug-Todo erzeugt. Die Onboarding-Information wird ignoriert.

Beispiel Karolina Pintaske: Report sagt `Offene Chats: "12 Chats seit 14 Tagen"`, Kategorie = `ONBOARDING TAG 12`. Today macht daraus „Karolina dringend — 14 Tage Verzug" mit kritischer Priorität.

## Plan

Ziel: Today-Verzug deckt sich mit der Dashboard-Realität — Onboarding-Chatter werden nicht als Verzug eskaliert.

### 1. Report-Kategorien einmal laden (`src/lib/daily-todos.ts`)

In `generateDailyTodos` zusätzlich zum bestehenden `analysis_reports`-Read das aktuellste `result_json.categories` ziehen und eine `Set<normalizedName>` mit allen Chattern bauen, deren Kategorie `/ONBOARDING/i` matcht (`onboardingNames`).

### 2. Verzug-Branch absichern

Vor dem Push des Verzug-Todos prüfen:
```ts
if (delay >= 3 && !onboardingNames.has(normalizeChatterName(name))) { ... }
```
Damit verschwinden alle Onboarding-Karten aus der Verzug-Spalte auf Today. Die Chatter bleiben in den anderen Today-Kategorien (Aktivität, Revenue) sichtbar, falls sie dort eigenständig triggern.

### 3. Gleiche Filterung in `today-engine.ts`

Der Engine-eigene Verzug-Pfad (Zeile ~392, „verzug" Branch in `buildIntent`) benutzt dieselben `chatter_history`-Rohdaten. Hier ebenfalls die Onboarding-Set-Quelle einmal pro `buildTodayActions`-Run laden und beim Verzug-Intent denselben Skip einbauen, damit Karten und Engine konsistent sind.

### 4. Sanity-Logging

Einmaliges `console.debug("[today] verzug filtered onboarding:", n)` damit du in der Konsole siehst, wie viele Karten der Filter entfernt — kein toast, kein UI-Hinweis.

### Nicht im Scope

- Anomaly-Detector (`detect-anomalies` Edge Function): liefert Verzug-Alerts auf `/anomalies`, ist eine andere Seite. Falls dort dieselbe Diskrepanz stört, separat anfassen.
- Recovery / Account-Tausch / Talent: unverändert.
- Keine DB- oder Edge-Function-Änderungen, rein Frontend-Logik.

### Erwartetes Ergebnis Brezzels heute

- Verzug-Tab geht von 30+ Karten auf ~0–2 (nur echte Nicht-Onboarding-Verzüge wie ein potentieller älterer Chatter, falls vorhanden).
- Dashboard und Today zeigen denselben Verzug-Status.