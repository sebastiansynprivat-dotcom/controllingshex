# Nachricht akkurater machen — echte vs. „leere" Arbeitstage

## Was gerade schiefläuft

`generate-goal-message` zählt `lastMonthDays` als Anzahl Rows mit `revenue_today > 0`. Aber `chatter_history` hat **mehrere Rows pro Tag** (pro Account/Modell). Beispiel echte Daten: 78 Rows in 41 Tagen → AI bekommt „73 aktive Tage" obwohl der Monat nur ~30 hat.

Zweites Problem: 0-€-Tage werden ignoriert. Ein Chatter, der 22 Tage gearbeitet hat aber 8 Mal 0 € machte, sieht gleich aus wie einer, der 14 Tage gearbeitet hat — beide zeigen „14 aktive Tage". Dadurch wird der Schwächere künstlich besser bewertet.

## Lösung

Edge Function `generate-goal-message` erweitern, sodass die AI ein realistischeres Bild bekommt:

**1. Distinct-Tage rechnen (statt Rows zählen)**
- `workedDays` = DISTINCT `analysis_date` mit mindestens einer Row im Monat (= war eingeloggt / Report wurde abgegeben).
- `earningDays` = DISTINCT `analysis_date` mit Summe `revenue_today > 0`.
- `zeroDays` = `workedDays - earningDays` (war da, aber 0 € gemacht).
- `daysInMonth` = Kalendertage des letzten Monats.

**2. Aussagekräftigere Kennzahlen für die AI**
- Durchschnitt pro **Arbeitstag** (nicht pro Earning-Tag): `lastMonthRev / workedDays`.
- Zusätzlich: Quote `earningDays / workedDays` → erkennt jemanden, der oft „leer" rausgeht.
- Vergleich mit Vormonat: gleiche Logik auf `prevPrevMonth` anwenden, damit „Trend"-Aussage stimmt.

**3. Tonalitäts-Heuristik verbessern**
Aktuell nur `goalHit %` oder `vsPrev %`. Neu zusätzlich:
- Wenn `earningDays / workedDays < 0.5` → Tonalität-Hinweis im Prompt: „viele Nullrunden" → AI soll das thematisieren („zu viele leere Tage, lass uns die Schichten besser nutzen") statt nur Gesamtsumme zu loben/kritisieren.
- Wenn `workedDays < daysInMonth * 0.4` → Hinweis „war wenig da" → AI berücksichtigt das (kein hartes Bashen wegen niedriger Summe).

**4. Prompt erweitern**
Neuer Daten-Block an die AI:
```
- Arbeitstage letzter Monat: 22 von 30 Kalendertagen
- Davon Earning-Tage: 14 (64%) — also 8 Nullrunden
- Ø pro Arbeitstag: 145 €
- Vormonat: 18 Arbeitstage, 12 Earning-Tage, Ø 180 €/Tag
```
Plus expliziter Hinweis im System-Prompt: „Wenn viele Nullrunden: erwähn das diplomatisch, nicht abwertend. Wenn wenig Tage gearbeitet: bewerte die Tagesleistung, nicht die Monatssumme."

## Geltungsbereich

- Nur `supabase/functions/generate-goal-message/index.ts`.
- Frontend-Dialog zeigt im Kontext-Bar zusätzlich `Arbeitstage X/Y · davon Earning Z` an, damit du auf einen Blick siehst was die AI gesehen hat.
- Kein DB-Change.
