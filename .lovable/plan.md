## Was ist kaputt

Die Stundenwerte in `chatter_hourly_stats` sind völlig aufgebläht. Das siehst du sofort an den Rohdaten:

- Aaron Ha hat heute insgesamt 3 Mass-DMs gesendet — aber in der Tabelle steht in **jeder einzelnen Stunde** des Tages `mass_dms = 3`. Statt einmal 3 (z.B. um 10 Uhr) wird derselbe Tageswert 24× gebucht.
- Stunde 20 zeigt insgesamt 5.132 € Umsatz, Stunde 19 = 4.625 € usw. — die Werte wachsen monoton mit der Stunde, weil jede Stunde immer wieder das **kumulierte Tagestotal** als „Delta" gebucht bekommt.
- Daraus rechnet das Frontend dann „Ø 24 Chatter aktiv" und absurd hohe €-Stundenwerte.

## Warum

Es gibt zwei Schreiber, die parallel in dieselbe Tabelle schreiben — und einer ist still kaputt:

1. **DB-Trigger** `record_live_activity_from_history_live` → addiert echte Deltas pro Live-Update. Das ist OK.
2. **Edge-Function** `snapshot-hourly-stats` (cron 1×/Std) → soll Tagestotal aus `chatter_history_live` minus „bereits in heutigen Stunden gebuchten Summen" als Stunden-Delta speichern.

Die Edge-Function hat drei Bugs:

- **Hauptursache: Supabase-Default-Limit 1000 Rows.** `prevStats` lädt 14 Tage Hourly-Stats — aktuell ~70.000 Zeilen — bekommt aber nur 1.000 zurück. Folge: Für fast jeden Chatter ist `cum.revenue = 0` und `cum.mass_dms = 0`, also wird `delta = aktuelles Tagestotal` statt `delta = neuer Zuwachs`. Jede Stunde bucht das volle Tagestotal nochmal.
- **Doppelschreiber:** Trigger addiert (`revenue = revenue + EXCLUDED.revenue`), Edge-Function überschreibt per Upsert. Beide gleichzeitig führt zu inkonsistenten Werten.
- **Tagesgrenze 00:05:** Beim 00-Uhr-Lauf wird `date: today` gebucht, obwohl die Stunde 23 vom Vortag stammt. Stunde 23 landet auf dem falschen Tag.

## Fix-Plan

### 1. Edge-Function `snapshot-hourly-stats` korrekt schreiben

- `prevStats` nur für **heute** laden (statt 14 Tage), und mit `.range(0, 99999)` bzw. paginiert, damit das 1000er-Limit nicht greift.
- `cumulativeBefore` aus genau diesen heutigen Stunden bis `prevHour` aufbauen (Bug heute: filtert in JS, lädt aber zu wenig).
- Beim 00-Uhr-Lauf: `date = prevDate` (gestern) für die Stunde 23 verwenden, statt `today`.
- Statt Upsert mit Überschreiben: explizit „setze Wert auf berechneten Delta" — Trigger deaktivieren (s.u.), damit es nur eine Quelle gibt.

### 2. Doppelschreiber auflösen

Trigger `record_live_activity_from_history_live` auf `chatter_history_live` entfernen. Die stündliche Edge-Function ist die einzige Wahrheit — pro Stunde genau ein Wert pro (chatter, hour). Damit ist die Logik deterministisch und reproduzierbar.

### 3. Vorhandene Daten reparieren

Die letzten ~11 Tage in `chatter_hourly_stats` sind verseucht. Migration:

- `chatter_hourly_stats` für die letzten 14 Tage löschen.
- Backfill aus `chatter_history` (Tagestotale) → grobe stündliche Verteilung ist aus `chatter_history` nicht möglich; daher: löschen und ab heute sauber neu sammeln. Ältere Tage haben dann „keine Stundenkurve" — das Frontend zeigt dafür schon das `noch keine Daten`-Empty-State.
- Optional: Heute (15.5.) komplett aus aktuellem `chatter_history_live`-Stand rekonstruieren — als ein einziger Eintrag in der laufenden Stunde, danach läuft der Cron sauber weiter.

### 4. Frontend-Sanity-Check

`PeakHoursCard` und `PeakRevenueCard` rechnen den Durchschnitt über `daysObserved` (Anzahl unterschiedlicher Datums-Buckets). Das ist OK, sobald die Stundendaten korrekt sind. Zwei kleine Verbesserungen:

- „Ø Chatter aktiv" soll nur auf Tage rechnen, an denen die Stunde überhaupt Daten hat — derzeit teilt es durch alle beobachteten Tage. Bei einer Stunde, die 14 Tage erst ab Tag 5 Daten hat, wird der Schnitt fälschlich gedrittelt.
- Min-Threshold: erst ab `daysObserved ≥ 3` einen Peak-Wert zeigen, sonst Hinweis „braucht ein paar Tage Datenbasis". Verhindert irreführende Anzeigen direkt nach dem Reset.

## Erwartetes Ergebnis

- Pro Chatter pro Stunde steht nur noch der echte Stundenzuwachs (€-Umsatz, Mass-DMs).
- „Peak-Chatter Ø X Chatter" liegt im realistischen Bereich (eher 5–30 statt 250).
- „Peak-Umsatz Ø Y €" zeigt einen plausiblen Stunden-Schnitt (eher 100–500 € statt 5.000 €).
- Cron läuft ab dem Fix sauber und reproduzierbar.

## Was du nach Approve siehst

- Migration: Trigger weg, Hourly-Stats der letzten 14 Tage gelöscht.
- Edge-Function-Update.
- Kleine Frontend-Anpassung an den beiden Cards.
- Erste 1–2 Tage zeigen die Cards den Empty-State, danach füllt der stündliche Cron das Profil sauber neu.
