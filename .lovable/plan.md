# Interaktive Coaching-Seite statt PDF

Die statische PDF wird komplett ersetzt durch eine interaktive, per Share-Link zugängliche Coaching-Seite pro Chatter/Analyse. Kontext wird nicht mehr in Fließtext gequetscht, sondern schrittweise aufgebaut: Situation → Was passiert ist → Bessere Version → Quiz-Check → Merksatz.

## User Flow

1. Du klickst im Coaching-Sheet auf „Analyse starten" (wie heute).
2. Statt PDF-Download bekommst du einen **Share-Link** (`/c/<token>`) + Kopier-Button + „Öffnen"-Vorschau.
3. Chatter öffnet den Link (kein Login) und sieht seine personalisierte Coaching-Seite.
4. Chatter arbeitet die Hebel Schritt für Schritt durch, macht Quiz, hakt Mikro-Aktionen ab.
5. Du siehst im Sheet-Historie-Eintrag: „Gelesen · Quiz 3/3 · Aktion ✓" pro Analyse.

## Aufbau der Coaching-Seite

**Cover-Sektion**
- Chatter-Name + Zeitraum + Model
- Vorperiode-Vergleich (Umsatz-Delta wie heute) — bleibt als sofortiger Kontext
- Eine große Karte: „Dein Fokus diese Woche: [Hebel 1 Titel]" mit Scroll-Prompt

**Pro Hebel (3 Stück, als Sektionen untereinander scrollbar oder Step-Navigation)**
- **Situations-Karte** oben: „Worum geht's" — 2–3 Sätze Kontext + Kunden-Typ/Energie in eigener Zeile („Der Kunde war: fordernd, sexuell direkt")
- **Story-Block**: Mini-Narrativ („Stell dir vor: …") + Money-Example als Motivations-Badge
- **Storyboard-Runden** (aufklappbar oder Tabs pro Runde):
  - Kontext-Zeile (was ist bis hierhin passiert)
  - Chat-Bubbles: Kunde → deine Antwort (mit Verdict-Badge) → bessere Version (grün)
  - Warum-Zeile (1 Satz)
  - „Sag das nächste Mal" Merksatz (groß, kopierbar)
- **Quiz-Check** am Ende jedes Hebels: 1 Multiple-Choice-Frage („Was war hier der bessere Move?") mit 3 realen Chat-Antwort-Optionen. Sofort-Feedback mit Erklärung, warum die richtige Antwort passt.
- **Mikro-Aktion abhaken**: „Diese Woche mache ich: [Aktion]" mit Checkbox

**Übungsrunde (optional, am Ende)**
- 1–2 freie Szenarien: „Kunde schreibt: [X]. Was antwortest du?"
- Chatter tippt eigene Antwort in ein Textfeld
- AI bewertet gegen den Hebel und gibt Score + kurzes Feedback
- Optional/skippbar — nicht Pflicht für „abgeschlossen"

**Abschluss-Sektion**
- Fortschritt: „Hebel 1 ✓ · Hebel 2 ✓ · Hebel 3 · Quiz 3/3 · Aktion ✓"
- „Ich hab's verstanden"-Button markiert die Analyse als komplett durchgearbeitet

## Datenmodell

- **`coaching_analyses`**: bekommt `share_token` (unique, random), `progress_json` (welche Hebel gelesen, Quiz-Antworten, Aktionen abgehakt, Simulation-Antworten), `completed_at`. `pdf_path` bleibt vorerst als nullable — neue Analysen setzen es nicht mehr.
- **Keine neue Tabelle** — alles was der Chatter tut, landet in `progress_json` derselben Zeile.

## Neuer Public-Route + Edge Functions

- Route `/c/:token` (öffentlich, kein Login-Check) lädt Analyse via neue Edge Function `get-coaching-by-token` (Service-Role, nur diese eine Zeile per Token).
- Edge Function `update-coaching-progress` (Token-authentifiziert) für Quiz-Antworten, Aktions-Häkchen, Simulation-Bewertungen.
- Simulation nutzt bestehende `generate-coaching-analysis`-Infra mit einem neuen Endpunkt/Modus für Einzel-Antwort-Bewertung.

## AI-Schema Ergänzungen (`generate-coaching-analysis`)

Pro Hebel zusätzlich:
- `situation_summary` (2–3 Sätze — was war die Situation, was für ein Kunde)
- `customer_profile` (kurzes Label: „fordernd/sexuell direkt", „unsicher/schüchtern" etc.)
- `quiz`: `{ question, options: [3 chat-bubble-strings], correct_index, explanation }`
- `simulation_prompt` (optional pro Hebel): `{ customer_message, evaluation_criteria }`

## PDF-Entfernung

- PDF-Generator in `src/lib/coaching.ts` (`renderAnalysisPDF`, jsPDF-Layout-Code, Layout-Validator) wird entfernt.
- Storage-Bucket `coaching-pdfs` bleibt bestehen (alte Analysen), aber keine Neu-Uploads.
- Historie-Einträge im Sheet zeigen für neue Analysen „Öffnen" statt Download/Vorschau; alte Einträge mit `pdf_path` behalten weiterhin die PDF-Buttons als Legacy-Support.
- Automatischer Layout-Retry-Loop entfällt (kein Layout mehr → keine Layout-Fehler).

## Coaching-Sheet (`src/pages/Coaching.tsx`) Änderungen

- Nach `analyzeChats` + `saveAnalysis`: statt PDF-Preview zeigt es Toast mit „Analyse fertig" + Kopier-Feld für Share-Link.
- Historie-Row bekommt: „Öffnen"-Button (öffnet `/c/<token>` in neuem Tab), „Link kopieren", „Löschen", Progress-Badge („✓ komplett" / „2/3 Hebel").

## Technische Details

**Neue Files**
- `src/pages/CoachingView.tsx` — die öffentliche Chatter-Seite (Route `/c/:token`)
- `src/components/coaching/HebelSection.tsx`, `Storyboard.tsx`, `QuizCheck.tsx`, `SimulationRunner.tsx`
- `supabase/functions/get-coaching-by-token/index.ts`
- `supabase/functions/update-coaching-progress/index.ts`
- `supabase/functions/evaluate-coaching-simulation/index.ts`

**Geänderte Files**
- `src/lib/coaching.ts`: PDF-Code raus, `renderAnalysisPDF` + Layout-Validator entfernt, `saveAnalysis` schreibt keinen PDF mehr sondern generiert `share_token`, neue Helper `getShareUrl`, `loadAnalysisByToken`, `updateProgress`
- `src/pages/Coaching.tsx`: Retry-Loop vereinfacht (nur AI-Failures), Preview-Dialog raus, Share-Link-UI rein
- `supabase/functions/generate-coaching-analysis/index.ts`: Schema erweitert um `situation_summary`, `customer_profile`, `quiz`, `simulation_prompt`
- `src/App.tsx`: Public Route `/c/:token` (außerhalb Auth-Guard)

**Migration**
```sql
ALTER TABLE public.coaching_analyses
  ADD COLUMN share_token text UNIQUE,
  ADD COLUMN progress_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN completed_at timestamptz,
  ALTER COLUMN pdf_path DROP NOT NULL;

UPDATE public.coaching_analyses SET share_token = encode(gen_random_bytes(16), 'hex') WHERE share_token IS NULL;
```

Keine neue RLS-Policy nötig — der öffentliche Zugriff läuft ausschließlich über die Service-Role in der Edge Function nach Token-Match.

## Was bleibt gleich

- AI-Modell (`gemini-3.1-pro-preview` für Meta-Pass), Stil-Mimikry-Regeln, Bot-DM-Erkennung, Preis-Tabu, Kontext-Pflicht, alle inhaltlichen Coaching-Regeln.
- Fetch-Chats-Flow (Webhook, `chats_preview`, Historie).
- Materials-Verwaltung.
