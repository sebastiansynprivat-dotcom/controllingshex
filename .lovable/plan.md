# Voice-Memo Feature für Chatter-Profile

## Was passiert beim Klick

1. Du öffnest einen Chatter im `ChatterSlideOver`
2. Klick auf den neuen Button "🎙️ Voice-Memo generieren"
3. Backend zieht die letzten 14 Tage Daten des Chatters (Revenue, Verzug, Open Chats, Trend, letzte Notizen)
4. Gemini schreibt einen kurzen, persönlichen Coaching-Text auf Deutsch (3–5 Sätze, direkt an den Chatter gerichtet)
5. ElevenLabs synthetisiert den Text mit deiner geklonten Stimme
6. Audio-Player erscheint inline — Play / Download / "Neu generieren"

## Setup (einmalig durch dich)

- **Voice klonen:** Du erstellst auf elevenlabs.io einen Instant Voice Clone (~1 min Audio von dir hochladen), kopierst die Voice ID
- **Secrets:** Ich frage nach `ELEVENLABS_API_KEY` und `ELEVENLABS_VOICE_ID` und speichere sie als Backend-Secrets

## Technik

### Neue Edge Function `generate-voice-memo`
- Input: `{ chatterName, platform }`
- Lädt 14-Tage History + letzte 5 Notizen für diesen Chatter
- Ruft Lovable AI (`google/gemini-2.5-flash`) mit System-Prompt: "Schreibe einen persönlichen, motivierenden Coaching-Hinweis auf Deutsch, max. 60 Wörter, direkte Ansprache, konkret mit Zahlen"
- Schickt den Text an ElevenLabs TTS (`eleven_multilingual_v2`, Voice-ID aus Secret, `mp3_44100_128`)
- Gibt MP3-Binary direkt zurück (`Content-Type: audio/mpeg`)

### UI in `ChatterSlideOver.tsx`
- Neuer Button-Bereich oben rechts/unter dem Header
- State: `idle | generating | ready | error`
- Bei `ready`: HTML5 `<audio controls>` mit Blob-URL + Download-Button + "Neu generieren"
- Optional: generierter Text wird darunter angezeigt (damit du weißt was gesprochen wurde)

### Keine DB-Tabelle nötig
- Memos werden on-the-fly generiert, kein Speichern
- Falls du später Historie willst, können wir das nachziehen

## Was ich dich frage sobald du den Plan freigibst

- `ELEVENLABS_API_KEY` (aus elevenlabs.io → Profile → API Keys)
- `ELEVENLABS_VOICE_ID` (aus deinem geklonten Voice → "ID" Button)

## Kosten-Hinweis

- ElevenLabs: ~1.000 Zeichen pro Memo → bei Starter-Plan (30k chars/Monat) ca. 30 Memos
- Lovable AI: vernachlässigbar (Gemini Flash ist günstig)
