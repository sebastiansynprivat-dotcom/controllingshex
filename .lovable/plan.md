# Monats-Nachricht pro Chatter generieren

Auf der Monatsziele-Seite kommt pro Chatter (sowohl bei "Aktuelle Ziele" als auch bei "Vorschlägen") ein neuer Button **"Nachricht generieren"**. Klick öffnet ein Modal mit einer fertig formulierten Direktnachricht an den Chatter (Boss → Mitarbeiter, locker, persönlich, kein HR-Sprech), die du in einem Rutsch kopieren und per Chat verschicken kannst.

## Inhalt der Nachricht
- Kurzer Recap des **letzten Monats** (Umsatz, vs. Ziel falls eins existierte, vs. Vormonat).
- Wenn schlecht gelaufen → Tonalität: nicht abwertend, "halb so wild, drehen wir den nächsten Monat einfach wieder", motivierend.
- Wenn gut gelaufen → echtes Lob + Push: jetzt noch einen drauflegen.
- Vorschlag/Festlegung des **neuen Monatsziels** (Zahl klar drin) mit kurzer Begründung warum genau diese Zahl.
- 3–5 Sätze, WhatsApp-Stil, Du-Form, deine Emoji-Regeln (kein Punkt vor Emoji, Hautton 🏻).

## UI

- Neuer Button "Nachricht" (Icon `MessageSquare`) auf `GoalCard` und `SuggestionCard`.
- Klick → Modal mit:
  - Loading-State während die Edge Function läuft
  - Textarea mit generierter Nachricht (editierbar)
  - Felder: vorgeschlagenes neues Ziel (vorbelegt, änderbar) — wird in den Prompt eingespeist, damit AI die Zahl konsistent nennt
  - Buttons: **Kopieren**, **Neu generieren**, **Schließen**
- Bei Aktuellen Zielen: Default-Ziel = aktuelles Ziel (oder leichte Steigerung wenn übertroffen).
- Bei Vorschlägen: Default-Ziel = bereits berechneter `suggested`-Wert.

## Backend

Neue Edge Function `generate-goal-message`:
- Input: `chatter_name`, `platform`, `proposed_goal` (number), optional `current_goal`.
- Lädt serverseitig:
  - Umsatz **letzter Kalendermonat** (chatter_history)
  - Umsatz **aktueller Monat bisher**
  - Falls vorhanden: altes Monatsziel (aus letzter Coaching-Notiz mit Zahl)
- Rechnet: Ziel-Erreichung letzter Monat in %, Differenz zu Vormonat, Trend.
- Ruft Lovable AI Gateway (`google/gemini-3-flash-preview`) mit System-Prompt im Stil deiner bestehenden Channel-Plan-Funktion (Boss/Founder-Tonalität, Emoji-Regeln, keine Floskeln) + strukturierten Daten.
- Gibt `{ message: string }` zurück. 429/402 sauber durchreichen.

Kein DB-Schema-Change.

## Technische Details

- Neue Datei: `supabase/functions/generate-goal-message/index.ts` (CORS, JWT-Validation via `supabase.auth.getUser()`, Service-Role-Client für History-Reads, Lovable AI Gateway Call mit Tool-Calling für strukturierte `message`-Ausgabe).
- Neue Komponente: `src/components/GoalMessageDialog.tsx` (shadcn Dialog + Textarea + Buttons, `supabase.functions.invoke("generate-goal-message", …)`).
- Edits in `src/pages/MonthlyGoals.tsx`: Button auf `GoalCard` und `SuggestionCard` durchreichen, State für offenen Dialog (`messageFor: { chatter, currentGoal?, proposedGoal }`).
- Emoji-/Wording-Regeln aus `mem://` werden im System-Prompt der Edge Function hartkodiert.
