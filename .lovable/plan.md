## Texts → 2 Tabs: "Onboarding" + "Channel"

Aktuelle `/notes`-Seite wird in zwei Tabs aufgeteilt. Der bisherige Content (Day-Buckets, Snippets, Senden) wandert in Tab **Onboarding**. Neuer Tab **Channel** = AI-basierte Wochenplanung.

### Tab 1 – Onboarding (= heutige Funktionalität, unverändert)
Komplette aktuelle Notes-Logik bleibt 1:1, nur in einen Tab gewrappt.

### Tab 2 – Channel (neu)

**A) AI-Datenbank (Wissensbasis)**
- Freitext-Notizen, die der User anlegt (Themen, Tonalität, Briefings, Beispiele, Do/Don'ts).
- Liste mit Add / Edit / Delete, jeder Eintrag hat optional Titel + Body.
- Wird beim Generieren komplett als Kontext an die AI übergeben.

**B) Wochenplan-Generator**
- Button "Neue Woche generieren" öffnet Dialog:
  - Startdatum (Default: kommender Montag)
  - Tages-Auswahl (Mo–So Checkboxen) → an welchen Tagen soll ein Channel-Post kommen
  - Optionaler Kontext-Hinweis (Freitext, z.B. "Fokus auf Promo XY")
- Edge Function `generate-channel-plan`:
  - Lädt alle AI-DB-Einträge des Users + Platform
  - Berechnet automatisch: Wochentag, Datum, Jahreszeit, Monat, deutsche Feiertage (statische Liste der gängigen DE-Feiertage im Code, bewegliche per Berechnung) für jeden ausgewählten Tag
  - Schickt an Lovable AI (`google/gemini-3-flash-preview`) per Tool-Calling für strukturierte Output: pro Tag → `{ date, theme, post_text, context_notes }`
  - Speichert Plan in neue Tabelle `channel_plans`

**C) Anzeige & Historie**
- Aktuelle Woche oben als Karten (eine pro Tag mit Datum, Wochentag, Thema, Text, Copy-Button)
- Edit pro Tag (Text manuell anpassen → speichert in `channel_plan_days`)
- Dropdown "Vorherige Wochen" zeigt gespeicherte Pläne, anklickbar zum Anschauen

### Datenbank (neue Tabellen)

```text
channel_knowledge
  id, user_id, platform, title (nullable), body, created_at, updated_at

channel_plans
  id, user_id, platform, week_start (date), generation_context (text, nullable),
  created_at

channel_plan_days
  id, plan_id, user_id, plan_date (date), weekday (int), theme, post_text,
  context_notes (jsonb: {season, holiday, day_of_month, ...}), position, updated_at
```
RLS auf allen drei Tabellen: nur eigene Reihen.

### Edge Function

`supabase/functions/generate-channel-plan/index.ts`
- Input: `{ platform, week_start, selected_weekdays: [1..7], extra_context? }`
- Lädt `channel_knowledge`, baut System-Prompt mit Wissensbasis + Tages-Kontext (Datum, Wochentag DE, Jahreszeit, Monat, Feiertag-Hinweis falls zutrifft)
- Lovable AI mit Tool-Call `create_week_plan` → Array von `{ date, theme, post_text }`
- Schreibt `channel_plans` + `channel_plan_days` per Service-Role

### Deutsche Feiertage
Helper im Edge Function: feste Daten (Neujahr, Tag der Arbeit, Tag der Dt. Einheit, Heiligabend, Weihnachten, Silvester) + bewegliche per Gauß-Algo (Ostern → Karfreitag, Ostermontag, Pfingsten, Christi Himmelfahrt). Reicht als Default.

### Frontend

- `src/pages/Notes.tsx`: Wrap aktuelle Inhalte in `<Tabs>` mit `TabsList` (Onboarding | Channel) und `TabsContent`.
- Aktuellen Code in neue Komponente `src/components/notes/OnboardingTab.tsx` extrahieren.
- Neue Komponenten:
  - `src/components/notes/ChannelTab.tsx` — orchestriert Knowledge + Plan
  - `src/components/notes/ChannelKnowledgeList.tsx` — CRUD Wissensbasis
  - `src/components/notes/ChannelPlanGenerator.tsx` — Dialog mit Tagesauswahl
  - `src/components/notes/ChannelPlanView.tsx` — Karten der Woche + Historie-Dropdown
- `src/lib/channel-plan.ts` — Client-seitige Helper (laden, speichern Edits, Edge-Function-Aufruf)

### Sidebar
"Texts" bleibt als Eintrag — kein neuer Routen-Eintrag nötig.

### Out of Scope
- Auto-Posting / Scheduler in echte Plattform
- Bilder/Media-Generierung für Channel-Plan (nur Text-Vorschläge)
