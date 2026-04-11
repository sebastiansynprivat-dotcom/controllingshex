

## Plan: Tägliche Reports persistent speichern & historische Daten nutzen

### Ist-Zustand
- Die `chatter_history`-Tabelle existiert bereits und speichert pro Analyse: `chatter_name`, `revenue_today`, `mass_dms`, `open_chats`, `response_delay_days`, `platform`, `analysis_date`
- Daten werden bereits gespeichert und für Graphen im ChatterSlideOver genutzt
- **Problem 1**: Kein Duplikat-Schutz — gleicher Tag + gleicher Chatter mehrfach hochladen erzeugt doppelte Einträge
- **Problem 2**: Die KI bekommt keine historischen Daten und kann daher Kategorien wie "0€ Tag 3" oder "Account-Einbruch" nicht zuverlässig erkennen
- **Problem 3**: Kategorie-Zuordnung und Empfehlung werden nicht gespeichert

### Was gebaut wird

**1. Datenbank erweitern**
- `chatter_history` bekommt zwei neue Spalten: `category` (text) und `recommendation` (text)
- Unique-Constraint auf `(chatter_name, platform, analysis_date)` — bei erneutem Upload am gleichen Tag wird der alte Eintrag überschrieben (UPSERT statt INSERT)

**2. Edge Function: Historische Daten an die KI übergeben**
- Vor der Analyse werden die letzten 14 Tage aus `chatter_history` für die aktuelle Plattform geladen
- Diese Historie wird als kompakte Tabelle an den KI-Prompt angehängt (z.B. "Max Mustermann: Tag 1: 0€, Tag 2: 0€, Tag 3: 0€")
- Damit kann die KI korrekt erkennen: "0€ Umsatz Tag 3", "Account-Einbruch", "Umsatz-Streak", etc.

**3. Edge Function: Kategorie + Empfehlung mitspeichern**
- Beim Speichern in `chatter_history` werden jetzt auch `category` und `recommendation` geschrieben
- UPSERT statt INSERT, um Duplikate zu vermeiden

**4. Plattform-Trennung**
- Ist bereits implementiert: alle Queries filtern nach `platform`. Keine Änderung nötig.

### Technische Details

```text
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  XLSX Upload     │────▶│  analyze-csv     │────▶│ chatter_history │
│  (Dashboard)     │     │  Edge Function   │     │   (Supabase)    │
└─────────────────┘     │                  │     └────────┬────────┘
                        │ 1. Load 14d hist │◀────────────┘
                        │ 2. Send to AI    │
                        │ 3. UPSERT result │
                        └──────────────────┘
```

**Migration SQL:**
- `ALTER TABLE chatter_history ADD COLUMN category text, ADD COLUMN recommendation text`
- `ALTER TABLE chatter_history ADD CONSTRAINT unique_chatter_day UNIQUE (chatter_name, platform, analysis_date)`

**Edge Function Änderungen:**
- Query: letzte 14 Tage `chatter_history` für die Plattform laden
- Prompt-Erweiterung: Historie als CSV-Block anhängen
- Speicherung: UPSERT mit `onConflict: 'chatter_name,platform,analysis_date'` + `category` und `recommendation`

