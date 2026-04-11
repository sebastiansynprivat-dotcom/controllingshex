

## Chatter-Leaderboard — neue Seite in der Sidebar

### Was wird gebaut
Eine neue Seite `/leaderboard` mit einem Top-20-Ranking der Chatter nach Umsatz (`revenue_today` aus `chatter_history`). Filter: Tag, Woche, Monat, Custom-Datumsbereich. Plattform-Filter kommt automatisch über den bestehenden `PlatformContext`.

### Datenquelle
Tabelle `chatter_history` — bereits vorhanden mit `chatter_name`, `revenue_today`, `analysis_date`, `platform`, `user_id`. Keine DB-Änderungen nötig.

### Änderungen

**1. Neue Seite `src/pages/Leaderboard.tsx`**
- Filter-Leiste oben: 4 Buttons (Heute / Woche / Monat / Custom) + optionaler DatePicker bei Custom
- Query: `chatter_history` gefiltert nach Platform + Datumsrange, gruppiert nach `chatter_name`, summiert `revenue_today`, sortiert DESC, Limit 20
- Darstellung: Nummerierte Liste (1–20) mit Name, Gesamtumsatz, Anzahl Tage aktiv
- Top 3 bekommen Gold/Silber/Bronze-Akzent
- Klick auf Chatter öffnet das bestehende `ChatterSlideOver`

**2. Sidebar `src/components/AppSidebar.tsx`**
- Neuen Eintrag "Leaderboard" mit `Trophy`-Icon einfügen, direkt unter "Videocoaching"

**3. Routing `src/App.tsx`**
- Neue Route `/leaderboard` → `<Leaderboard />`

### Kein DB-Schema-Change nötig

