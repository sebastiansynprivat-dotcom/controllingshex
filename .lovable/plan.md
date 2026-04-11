

## Plan: Analyse-Ergebnisse einzeln löschen können

### Problem
Wenn eine fehlerhafte Analyse hochgeladen wird, gibt es keine Möglichkeit, nur diesen einen Tag zu löschen. Man müsste manuell in die Datenbank — und riskiert, versehentlich alles zu löschen.

### Lösung

**1. "Analyse löschen"-Button auf dem Dashboard**
- Neben dem Upload-Bereich ein Button "Heutige Analyse löschen" (nur sichtbar, wenn ein Ergebnis angezeigt wird)
- Klick öffnet einen Bestätigungsdialog: "Möchtest du die Analyse vom [Datum] für [Plattform] wirklich löschen?"
- Nach Bestätigung: Löscht nur die Einträge des aktuellen Tages + aktueller Plattform aus `chatter_history`

**2. Edge Function `delete-analysis`**
- Neue Edge Function, die `analysis_date` und `platform` entgegennimmt
- Löscht per SQL: `DELETE FROM chatter_history WHERE analysis_date = $date AND platform = $platform`
- Gibt zurück, wie viele Einträge gelöscht wurden

**3. Nach dem Löschen**
- Dashboard-Cache (`localStorage`) wird geleert
- UI zeigt wieder den leeren Upload-Zustand
- Alle älteren Tage bleiben komplett unberührt

### Dateien
- `supabase/functions/delete-analysis/index.ts` — neue Edge Function
- `src/pages/Dashboard.tsx` — Button + Bestätigungsdialog + Lösch-Aufruf

