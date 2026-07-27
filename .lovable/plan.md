## Ziel

Nach jedem Report-Upload analysiert die AI automatisch die Daten, erkennt Muster und erstellt einen **Tages-Fahrplan** pro Workspace (Maloum, Brezzels, 4Based) — priorisiert nach €-Impact, mit Monatsziel-Tracking auf 300.000 €.

Ausgeschlossen: reine Zeiterfassung / Verzug (ist bereits im Heute-Tab gelöst).

## Was gebaut wird

### 1. Neue Tabellen
- `daily_briefings` — ein Briefing pro Nutzer/Plattform/Tag: Zusammenfassung, erkannte Muster, geschätzter €-Impact gesamt, Report-Bezug, Status.
- `briefing_actions` — die einzelnen Fahrplan-Punkte: Chatter/Model, Aktionstyp, Begründung aus den Daten, geschätzter €-Impact, konkrete Handlungsanweisung, Rang, Status (offen/erledigt/verworfen).
- `revenue_goals` — Monatsziel pro Plattform (Startwert 300.000 € gesamt, aufteilbar).

### 2. Edge Function `generate-daily-briefing`
Wird nach erfolgreichem Report-Upload automatisch gestartet (und manuell per Button neu auslösbar).

Sie zieht ohne Zeilenlimit zusammen:
- aktuellen Report + Historie der letzten 30 Tage (Umsatz-Trends je Chatter & Account)
- Live-Daten (offene Chats, Mass-DMs, Umsatz heute)
- Model-/Account-Potenzial (welcher Account lief mal deutlich besser)
- Peer-Vergleich innerhalb der Plattform
- bestehende Memos, Labels und AI-Memories
- Monatsziel + bisher erreichter Monatsumsatz → nötiger Tagesschnitt

Daraus generiert das Modell (`google/gemini-3.6-flash`) strukturiert:
- **Lagebild**: wo steht der Monat vs. 300k-Ziel, Pace, Lücke in €
- **Muster**: z. B. „Umsatz kippt bei X seit 5 Tagen", „Mass-DM-Quote unter 6/Tag bei N Chattern", „Account Y unterperformt vs. eigener Bestwert"
- **Fahrplan**: sortierte Aktionsliste mit €-Impact-Schätzung, Begründung und konkreter Anweisung
- **Quick Wins vs. strukturelle Hebel** getrennt

Zeiterfassungs-/Verzugs-Themen werden per Prompt explizit ausgeschlossen.

### 3. Neue Ansicht „Fahrplan"
Eigener Bereich (Sidebar-Eintrag, plattform-gefiltert):
- Kopf: Monatsziel-Ring (erreicht / Ziel / benötigter Tagesschnitt / Prognose)
- „Heutiger Fahrplan": Aktionskarten nach €-Impact absteigend, abhakbar, mit Verwerfen-Option
- Muster-Sektion mit den erkannten Trends
- „Neu generieren"-Button und Zugriff auf frühere Briefings
- Jede Aktion kann per Klick als Thread im AI-Chat vertieft werden

### 4. Upload-Integration
Am Ende von `runAnalysis` in `src/pages/Upload.tsx`: Briefing-Generierung anstoßen, Fortschritt im Status-Log anzeigen, danach Hinweis mit Direktlink zum Fahrplan.

### 5. Monatsziel-Feedback
Erledigte Aktionen werden mit tatsächlicher Umsatzentwicklung der Folgetage abgeglichen (analog zur bestehenden `action_outcomes`-Logik), damit Impact-Schätzungen über die Zeit realistischer werden.

## Technische Details
- Alle Abfragen über `fetchAllPaged` — keine 1000-Zeilen-Truncation, keine künstlichen Caps.
- Strikte Isolation nach `user_id` + `platform`; RLS-Policies und GRANTs für jede neue Tabelle.
- Strukturierte Ausgabe über Tool-Calling, ohne Längenbegrenzungen im Schema.
- Briefing läuft asynchron; die UI pollt bis Status `ready`, damit der Upload nicht blockiert.
