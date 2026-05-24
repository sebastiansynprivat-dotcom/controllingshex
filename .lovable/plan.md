## Ziel
Einzelne Tages-Posts im Wochenplan neu generieren können, wenn dir einer nicht gefällt – ohne den ganzen Plan zu überschreiben.

## UI (`ChannelPlanView.tsx`)
- Neuer Button "🔄 Neu" pro Tageskarte (neben Copy/Edit). Mit Tooltip "Diesen Tag neu generieren".
- Beim Klick: optionales kleines Popover/Inline-Input für "Hinweis an die KI" (z.B. "kürzer", "weniger pushig", "mit Mindset-Life-Thema") – kann auch leer gelassen werden.
- Während Regenerierung: Spinner auf der Karte, andere Aktionen disabled.
- Nach Erfolg: nur diese eine Karte wird ersetzt (theme, post_text, length im context_notes).

## API-Layer (`src/lib/channel-plan.ts`)
- Neue Funktion `regeneratePlanDay({ day_id, hint? })` → ruft Edge-Function `regenerate-channel-plan-day` und gibt den aktualisierten `ChannelPlanDay` zurück.

## Edge Function (neu: `supabase/functions/regenerate-channel-plan-day/index.ts`)
- Auth wie bei `generate-channel-plan`.
- Input: `{ day_id: uuid, hint?: string }`.
- Lädt:
  - den Ziel-Tag (mit `plan_id`, `plan_date`, `weekday`, `context_notes`, `theme`, `post_text`),
  - alle anderen Tage desselben Plans (für Kontext: was schon gepostet wurde, Themen-Mix, Variations-Regeln),
  - die Wissensbasis (wie in der bestehenden Function),
  - `generation_context` des Plans.
- Baut den `DayContext` für genau diesen einen Tag (Saison, Feiertag, Money-Window) – Logik wiederverwendet (kopiert oder in shared helper, hier pragmatisch kopiert da Edge-Functions keinen Shared-Code-Pfad in diesem Projekt haben).
- Prompt:
  - Gleicher System-Prompt wie `generate-channel-plan` (Empfänger, Rollen, Themen-Mix, Money-Window, Längen, Verbote, Emoji-Regeln).
  - User-Prompt zeigt: Wissensbasis + Extra-Kontext + "Bereits geplante Posts dieser Woche" (date, theme, post_text – kompakt) + der EINE Zieltag + alter Post + Hinweis vom User.
  - Anweisung: genau EINEN neuen Post liefern, der zum Wochen-Mix passt, NICHT wiederholt was schon da ist, optional auf den `hint` eingeht.
- Tool-Schema: `regenerate_day` mit `{ theme, length, post_text }`.
- Update via Service-Role-Client: `channel_plan_days` UPDATE `theme`, `post_text`, `context_notes.length` für die Row.
- Response: aktualisierte Row.

## Memory
- Kleiner Eintrag in `mem://features/channel-audience.md`: einzelne Tage können regeneriert werden, dabei wird Wochen-Kontext (andere Posts) als Anti-Wiederholung mitgegeben.

## Files
- neu: `supabase/functions/regenerate-channel-plan-day/index.ts`
- edit: `src/lib/channel-plan.ts` (Funktion `regeneratePlanDay`)
- edit: `src/components/notes/ChannelPlanView.tsx` (Button + Popover + State + Aufruf)
- edit: `mem://features/channel-audience.md`

Keine DB-Migration nötig.