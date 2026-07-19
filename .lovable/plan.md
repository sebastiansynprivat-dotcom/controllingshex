# Chat-Coaching-Analyse

Neuer Tab "Coaching" in dem du für jeden Chatter (Model aus letztem Report) eine PDF-Analyse seiner Chats gegen deine Coaching-Prinzipien generieren lassen kannst. AI-Modell: `google/gemini-3.5-flash`.

## User Flow

1. **Coaching-Material einrichten** (einmalig, workspace-weit): Transkripte als Text einfügen/hochladen → gespeichert und in jeder Analyse als System-Kontext verwendet.
2. **Chatter auswählen**: Liste aller Chatter aus dem letzten Report je Platform mit ihrem zugeordneten Model.
3. **Zeitraum wählen**: Zwei Date-Picker (Von/Bis). Letzter analysierter Zeitraum wird pro Chatter angezeigt.
4. **Analyse starten**: System zieht alle Chats des Models im Zeitraum aus `chats_preview`, ruft Gemini pro Chat auf, aggregiert Muster, generiert PDF.
5. **History**: Alle früheren PDFs pro Chatter sichtbar (Zeitraum, Datum, Download).

## Datenmodell

**Neue Tabelle `coaching_materials`** (workspace-weit, keine `user_id`)
- `id`, `title`, `content` (TEXT – Transkript), `is_active` (BOOL), `created_at`, `updated_at`
- Mehrere aktive Materialien werden alle im Prompt zusammengeführt.
- RLS: authenticated read/write.

**Neue Tabelle `coaching_analyses`**
- `id`, `user_id`, `platform`, `chatter_name`, `model_username`
- `date_from`, `date_to`
- `pdf_path` (Storage-Path im neuen Bucket `coaching-pdfs`)
- `summary_json` (JSONB – Score, Top-Findings für Card-Preview)
- `chats_analyzed` (INT)
- `created_at`
- RLS: user_id-scoped.

**Neuer Storage-Bucket `coaching-pdfs`** (privat, signed URLs für Download).

## Edge Function: `generate-coaching-analysis`

Input: `{ chatter_name, platform, model_username, date_from, date_to }`

Ablauf:
1. Auth-Check, lade aktive `coaching_materials`.
2. Query `chats_preview` mit `platform + model_username` und filtere Chats deren letzte Message im Zeitraum liegt.
3. Für jeden Chat: Gemini-Call mit Coaching-Transkript als System-Prompt + Chat als User-Content. Struktur (JSON via `Output.object`):
   - `customer_username`, `score` (0-100), `pricing_check`, `dos` (Zitate + Erklärung), `donts` (Zitate + Erklärung + Besser-So-Beispiel), `revenue_levers` (Top 3-5)
4. Meta-Call: Alle Einzel-Ergebnisse → Gemini aggregiert wiederkehrende Muster + Overall-Score + Executive Summary.
5. PDF-Rendering server-side (jsPDF via esm.sh) mit:
   - Deckblatt: Chatter, Model, Zeitraum, Overall-Score, Executive Summary
   - Muster-Sektion: wiederkehrende Themen mit Besser-So-Beispielen
   - Pro Chat: Customer-Name als Header, Score, Do's/Don'ts mit Zitaten, Pricing-Check, konkrete Hebel
6. Upload zu Storage, insert in `coaching_analyses`, return signed URL + analysis-id.

## Frontend

**Neue Route/Seite `/coaching`** (`src/pages/Coaching.tsx`) + Sidebar-Eintrag in `AppSidebar.tsx`.

Layout:
- **Header-Bar**: Button "Coaching-Material verwalten" → öffnet `CoachingMaterialDialog` (Liste + Add/Edit/Toggle-Active).
- **Chatter-Liste** (Cards): Name, Model, letzter analysierter Zeitraum, Anzahl History-PDFs. Sortiert nach Umsatz aus letztem Report. Filtert auf aktuelle Platform.
- **Chatter-Card Click** → `ChatterCoachingSlideOver`:
  - Zwei Date-Picker (Default: letzte 7 Tage)
  - Vorschau: "Es werden X Chats analysiert" (Count-Query)
  - Button "Analyse generieren" → zeigt Progress → PDF-Vorschau + Download
  - History-Liste darunter (alle früheren Analysen mit Zeitraum, Datum, Download-Button, Score-Badge)

Neue Files:
- `src/pages/Coaching.tsx`
- `src/components/coaching/CoachingMaterialDialog.tsx`
- `src/components/coaching/ChatterCoachingSlideOver.tsx`
- `src/components/coaching/CoachingHistoryList.tsx`
- `src/lib/coaching.ts` (API-Wrapper)
- `supabase/functions/generate-coaching-analysis/index.ts`
- Migration für Tables + Bucket + RLS

## Technische Details

- **Chat-Auswahl-Logik**: `chats_preview` hat `platform + model_username + chat` (JSONB mit Messages). Filter: für jede Row prüfen ob letzte Message im Zeitraum – da Range typischerweise klein, komplette Rows laden und in Function filtern. Falls Volume-Problem: später Range-Filter auf JSONB-Extract.
- **Gemini-Call**: `google/gemini-3.5-flash` via Lovable AI Gateway (bereits konfiguriert), `Output.object` für strukturierte Extraktion pro Chat. Bei > ~10 Chats parallel batchen (Promise.all mit Concurrency-Limit 3).
- **PDF**: jsPDF – deutsche Umlaute via helvetica-Font (funktioniert), Sektionen mit `autoTable` für Zitat-Vergleiche.
- **Wording**: Deutsch, professionell, respektvoll (im Sinne bestehender Wording-Regel: nie "absäuft").

## Offene Punkte für später

- Chat-Fetch-Logik in `chats_preview` überarbeiten (User erwähnte, dass "das gerade immer Chats generiert" – klären wir separat nach Fertigstellung).
- Optional: Chatter kann PDF direkt per Link teilen (aktuell nur Download).
