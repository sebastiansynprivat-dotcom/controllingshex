## Ziel

Eine „AI Company“ im AI-Consultant einführen: ein täglicher Überblick, der alle aktiven Chatters und Accounts wie ein Management-Team beobachtet, bewertet und Handlungsempfehlungen liefert – ohne selbst auszulösen. Die Ausgabe soll strukturiert, rollenbasiert und direkt im bestehenden AI-Consultant erreichbar sein.

## Was bereits existiert (geprüft)

- `daily_briefings` + `briefing_actions` → Fahrplan, automatisch nach Report-Upload
- `action_events` + `detect-action-events` / `evaluate-action-events` → automatische Erkennung/Bewertung von Account-Tausch, On-/Offboarding
- `chatter_history_live` → Echtzeit-Daten (Verzug, offene Chats, Umsatz heute)
- MCP-Tools: `get_live_status`, `get_chatter_history`, `get_account_history`, `get_top_chatters`, `read_memos`, `create_memo`
- `AIConsultant.tsx` mit angepinnten Bereichen „Fahrplan · heute“ und „Rückblick“
- Workspace-Isolierung und Thread-Persistenz sind bereits vorhanden

## Empfehlung zu den AI-Rollen

Ja, es macht Sinn – aber sehr leichtgewichtig. Statt eines komplexen Agenten-Frameworks bekommen wir 4 fiktive „AI-Rollen“, die jeweils einen festen Blickwinkel liefern. Das macht die tägliche Ausgabe lesbarer und vertrauenswürdiger, ohne dass die AI eigenmächtig handelt.

```text
Head of Revenue     → Finanz-Pulse: Ziel-Pace, Top-/Bottom-Mover, Umsatzkonzentration
Operations Manager  → Chatter-Gesundheit: Verzug, offene Chats, Burner, Coaching-Bedarf
Staffing Analyst    → Besetzung: Tausch-Empfehlungen, On-/Offboarding, Rückblick-Verdicts
Account Strategist  → Account-Potenzial: Whale-Warnung, Buyer-Diversity, unterbesetzte Accounts
```

## Konzept: „Company · heute“

Neuer angepinnter Bereich im AI-Consultant, direkt unter „Fahrplan · heute“.

```text
Sidebar
├── Fahrplan · heute
├── Rückblick (Badge bei bad-Verdicts)
├── Company · heute  ← neu (Badge bei kritischen Signalen)
└── Threads …
```

### Inhalt pro Tag

Der Digest besteht aus 4 rollenbasierten Abschnitten. Jeder Abschnitt enthält 0–n Karten mit:

- Titel + konkrete Zahlen
- Bewertung (info / warn / critical)
- Empfehlung (nur Vorschlag, keine Ausführung)
- „Im Chat besprechen“-Button → öffnet neuen Thread mit kontextualisierter Frage

Beispiel-Karten:

- Head of Revenue: „Lara La sitzt auf 34 Tagen Verzug bei xbabymarie – geschätztes Verlustpotenzial 180 €/Tag“
- Operations Manager: „3 Chatters haben heute 0 €, aber historisch >200 €/Tag bester Tag“
- Staffing Analyst: „Rückblick: Account-Tausch Maurice → Lara war schlecht (-90 €/Tag), Rückgängig prüfen“
- Account Strategist: „hotmiamor: 78 % Umsatz aus einem Buyer – Diversifizierung empfohlen“

## Datenquellen

- `chatter_history_live` (Echtzeit: Verzug, offene Chats, heutiger Umsatz)
- `chatter_history` (30–90 Tage Trends, Bestwerte, Peer-Schnitt)
- `analysis_reports` (aktiver Roster)
- `action_events` + `daily_briefings` (bereits erkannte Muster und Fahrplan)
- `ai_memories`, `chatter_memos`, `revenue_goals`

## Technische Umsetzung

### 1. Neue Tabelle `company_digests`

```text
user_id uuid
platform text
digest_date date
status text (running | ready | error)
sections_json jsonb   -- Array der 4 Rollen-Abschnitte inkl. Karten
signals_json jsonb    -- flache Liste aller Signale für Badges/Filter
created_at / updated_at timestamptz
```

- RLS auf `auth.uid()`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_digests TO authenticated;`
- `GRANT ALL ON public.company_digests TO service_role;`

### 2. Edge Function `generate-company-digest`

- Läuft automatisch nach Report-Upload (wie `generate-daily-briefing`)
- Optional täglicher Cron um 07:00 Uhr
- Sammelt alle Daten, ruft 4 parallele AI-Prompts (einer pro Rolle) mit `google/gemini-3.6-flash`
- Jeder Prompt liefert strukturiertes JSON zurück (section_title, summary, cards[])
- Speichert Ergebnis in `company_digests`, Status `ready`
- Idempotent pro Tag: bei erneutem Upload wird der gleiche Tag neu generiert

### 3. Frontend `CompanyPanel.tsx`

- Neues Panel, ähnlich wie `BriefingPanel.tsx` / `ActionReviewPanel.tsx`
- Lädt heutigen Digest aus `company_digests`
- Zeigt 4 rollenbasierte Abschnitte als Karten
- Badges: Anzahl `critical`/`warn` Signale für Sidebar-Icon
- „Im Chat besprechen“ pro Karte → `navigate(`/ai-consultant?q=...`)`
- „Neu generieren“-Button (force)
- Skeleton-Loading während `status === running`

### 4. Integration in `AIConsultant.tsx`

- Neuer Route-Parameter `threadId === "company"`
- Neuer Sidebar-Eintrag „Company · heute“ mit Badge
- `useEffect` lädt Digest beim Öffnen; startet automatisch, wenn heute noch keiner existiert
- Mobile: Eintrag in die bestehende mobile Chip-Leiste übernehmen

### 5. Trigger nach Upload

- In `src/pages/Upload.tsx` nach erfolgreichem Report-Upload aufrufen:
  `supabase.functions.invoke("generate-company-digest", { body: { platform } })`
- Gleiches Pattern wie beim Fahrplan

### 6. MCP / Chat-Integration (optional, aber sinnvoll)

- Neues MCP-Tool `get_company_digest` liefert den aktuellen Digest an die AI
- Damit kann der User im Chat fragen: „Was sagt die Company heute?“ oder „Welche kritischen Signale gibt es?“
- Keine Pflicht für den ersten Schritt

## Was die AI nicht macht (Scope-Grenze)

- Keine automatische Ausführung (kein Auto-Tausch, kein Auto-Memo, kein Auto-Push)
- Keine Echtzeit-Push-Alerts (nur täglicher Digest)
- Keine menschlichen Rollen/Rechte verwalten
- Keine plattformübergreifenden Vergleiche (weiterhin strikt pro Workspace)

## Offen für später

- Echtzeit-Alerts, sobald Verdicts als treffsicher gelten
- „In Fahrplan übernehmen“-Button pro Company-Karte
- Wochen-/Monats-Zusammenfassung der Company-Daten

## Technische Details

- Tabelle mit RLS + GRANTs wie oben
- Edge Function parallelisiert die 4 Rollen-Prompts
- Keine harten Limits: alle aktiven Chatters/Accounts werden betrachtet
- Wording-Regeln aus Memory beachten: „im Rückgang“, kein Punkt vor Emojis, 🏻-Modifier
- Neue Dateien: `src/components/ai/CompanyPanel.tsx`, `src/lib/company-digest.ts`, `supabase/functions/generate-company-digest/index.ts`
- Erweiterungen: `src/pages/AIConsultant.tsx`, `src/pages/Upload.tsx`, `src/lib/mcp/index.ts` (optional)
