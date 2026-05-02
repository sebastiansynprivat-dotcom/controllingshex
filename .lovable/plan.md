## Ziel
Ein drittes Workspace „4Based" neben Maloum und Brezzels einführen. Beim ersten Wechsel dorthin sind alle Daten leer (keine Reports, keine Chatter, keine Notes etc.) — exakt wie ein frisches Setup.

## Umsetzung

### 1. Platform-Typ erweitern
**`src/contexts/PlatformContext.tsx`**
- `Platform` Union → `"Maloum" | "Brezzels" | "4Based"`
- `PLATFORMS`-Array um `"4Based"` ergänzen

### 2. Sidebar-Switcher
**`src/components/PlatformSwitcher.tsx`**
- `platformIcons` um `"4Based": "4"` erweitern (Buchstabe/Ziffer im Badge)

### 3. Daten-Isolation
Keine Migration nötig. Alle Tabellen (`analysis_reports`, `chatter_history`, `coaching_notes`, `daily_chatter_checks`, `chatter_category_state`, `models`, `todos`, `swap_decisions`, `chatter_labels`, `chatter_inputs`, `video_coachings`, `chatter_daily_goals`, `anomaly_alerts`, `alert_dismissals`) filtern bereits per `platform`-Spalte. Da noch keine Zeile mit `platform = '4Based'` existiert, ist der Workspace automatisch komplett leer — Upload, Dashboard, Anomalien, Notes etc. zeigen den jeweiligen Empty-State.

### 4. Quick-Check
- Suchen, ob irgendwo ein hartkodiertes `["Maloum","Brezzels"]`-Array außerhalb von `PlatformContext` liegt, das zusätzlich erweitert werden müsste. Falls ja, mitziehen.

## Nicht enthalten
- Kein Seed/Demo-Daten — bewusst leer.
- Keine Änderung an RLS oder Schema.
- Kein Löschen oder Verschieben von bestehenden Maloum/Brezzels-Daten.

## Ergebnis
Im Sidebar-Switcher erscheint ein dritter Eintrag „4Based". Beim Klick: leere Dashboards überall, bereit für den ersten CSV-Upload.