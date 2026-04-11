

## Alte Daten bereinigen & Tag 1 = heute setzen

### Problem
In der `chatter_history` liegen 199 Einträge für Maloum vom 03.04.2026 — also alte Test-/Vorgängerdaten. Das verfälscht Trends, Onboarding-Zählung und das Performance-Profil. Die AI im `analyze-csv` bekommt diese alten Daten als Historie und zieht falsche Schlüsse.

### Was passiert

**1. Alte History-Daten löschen (Datenbank)**
- Alle `chatter_history`-Einträge mit `analysis_date < '2026-04-11'` werden gelöscht
- Damit ist heute der erste Tag mit echten Daten
- Verwendung: Supabase Insert-Tool mit DELETE-Statement

**2. Keine Code-Änderungen nötig**
- Die `analyze-csv` Edge Function lädt bereits nur die letzten 14 Tage History — ab jetzt gibt es nur Daten ab heute
- Das Performance-Profil in `ChatterSlideOver` zeigt dann korrekt nur die echten Daten
- Wenn ein Chatter nur einen Datenpunkt hat, wird dieser als Startpunkt genutzt (das funktioniert bereits so)

### Zusammenfassung
Ein einziger DELETE-Befehl bereinigt die Altdaten. Ab heute zählt Tag 1 für alle Plattformen.

